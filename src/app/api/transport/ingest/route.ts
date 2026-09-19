import crypto from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { adminClient } from '@/lib/serverAuth'
import { readIntegrationSecrets } from '@/lib/serverIntegrationSecrets'
import { resolveAdapter, type IngestFix } from '@/lib/transport/adapters'

export const runtime = 'nodejs'

/**
 * Position ingest for GPS hardware the school already owns.
 *
 * AIS-140 devices push comma-delimited ASCII over a raw TCP socket to a
 * configured backend IP, which Vercel cannot terminate — so EdZee does not try.
 * The school points the device's *second* server slot (the standard mandates
 * dual-server push) at a Traccar or flespi channel, which owns the protocol zoo
 * and forwards clean JSON here. Their statutory feed to the state backend is
 * untouched and no vendor is displaced.
 *
 * Whatever arrives lands in transport_telemetry through the same trigger the
 * driver's phone uses, so stop detection, ETA and alerting are identical for
 * both without a line of source-specific logic.
 */

/** Reject a fix older than this: a device dumping last week helps nobody. */
const MAX_AGE_MS = 24 * 60 * 60 * 1000
/** …or one from the future beyond ordinary clock skew. */
const MAX_SKEW_MS = 5 * 60 * 1000
const MAX_ACCURACY_M = 2000
/** Above this implied speed the fix is kept but flagged: it is the "the bus
 *  teleported across town" artefact, and excluding it from derivation is the
 *  single most effective filter this endpoint has. */
const MAX_IMPLIED_KMH = 150
/** Replay window on the signature. */
const MAX_SIGNATURE_AGE_S = 300
/** One POST is one batch, not a backfill. A forwarder with more splits it. */
const MAX_BATCH = 500
/** A signature is hex of a fixed width; anything longer is not worth hashing. */
const MAX_BODY_BYTES = 512 * 1024

export async function POST(request: NextRequest) {
  const client = adminClient()
  if (!client) {
    return NextResponse.json({ success: false, error: 'Server configuration error' }, { status: 500 })
  }

  const rawBody = await request.text()
  if (Buffer.byteLength(rawBody) > MAX_BODY_BYTES) {
    return NextResponse.json({ success: false, error: 'Payload too large' }, { status: 413 })
  }

  const keyId = request.headers.get('x-transport-key-id')
    ?? request.nextUrl.searchParams.get('key')
  // A key id identifies the source and is public; the secret never travels
  // except inside the signature. The two are unrelated values, so seeing one
  // request tells an observer nothing about how to forge the next.
  if (!keyId || !/^[0-9a-f]{16}$/.test(keyId)) {
    return NextResponse.json({ success: false, error: 'Missing key' }, { status: 401 })
  }

  const { data: source } = await client
    .from('transport_telemetry_sources')
    .select('id, vendor, vehicle_id, active, ingest_key_prefix')
    .eq('ingest_key_prefix', keyId)
    .maybeSingle()

  if (!source || !source.active) {
    return NextResponse.json({ success: false, error: 'Unknown or inactive source' }, { status: 401 })
  }

  const secrets = await readIntegrationSecrets(client, `telemetry:${source.id}`)
  const secret = secrets.ingest_secret
  if (!secret) {
    return NextResponse.json({ success: false, error: 'Source has no ingest secret configured' }, { status: 401 })
  }

  if (!verify(request, rawBody, secret)) {
    return NextResponse.json({ success: false, error: 'Bad signature' }, { status: 401 })
  }

  let parsed: IngestFix[] = []
  try {
    parsed = resolveAdapter(source.vendor).parse(JSON.parse(rawBody))
  } catch {
    parsed = []
  }

  const now = Date.now()
  let rejected = 0
  if (parsed.length > MAX_BATCH) {
    rejected += parsed.length - MAX_BATCH
    parsed = parsed.slice(0, MAX_BATCH)
  }
  const usable = parsed.filter(f => {
    const t = new Date(f.recordedAt).getTime()
    if (!Number.isFinite(t) || now - t > MAX_AGE_MS || t - now > MAX_SKEW_MS) { rejected++; return false }
    if (Math.abs(f.lat) > 90 || Math.abs(f.lng) > 180) { rejected++; return false }
    // (0,0) is Null Island — a device with no fix, not a bus in the Atlantic.
    if (f.lat === 0 && f.lng === 0) { rejected++; return false }
    if (f.accuracyM != null && f.accuracyM > MAX_ACCURACY_M) { rejected++; return false }
    return true
  })

  if (usable.length === 0) {
    // Always 202: devices retry forever on an error status, so one malformed
    // batch must never wedge the stream.
    return NextResponse.json({ success: true, accepted: 0, deduped: 0, rejected }, { status: 202 })
  }

  // Resolve the vehicle's current run once for the batch.
  const runId = source.vehicle_id ? await resolveRun(client, source.vehicle_id) : null

  const { data: last } = await client
    .from('transport_telemetry')
    .select('lat, lng, recorded_at')
    .eq('source_id', source.id)
    .order('recorded_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  let previous = last ? { lat: last.lat, lng: last.lng, at: new Date(last.recorded_at).getTime() } : null

  const rows = usable
    .sort((a, b) => new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime())
    .map(f => {
      const at = new Date(f.recordedAt).getTime()
      let suspect = false
      if (previous && at > previous.at) {
        const km = haversineKm(previous, { lat: f.lat, lng: f.lng })
        const hours = (at - previous.at) / 3_600_000
        if (hours > 0 && km / hours > MAX_IMPLIED_KMH) suspect = true
      }
      if (!suspect) previous = { lat: f.lat, lng: f.lng, at }

      return {
        run_id: runId,
        vehicle_id: source.vehicle_id,
        source_id: source.id,
        source: 'device_push' as const,
        lat: f.lat,
        lng: f.lng,
        accuracy_m: f.accuracyM ?? null,
        heading_deg: f.headingDeg ?? null,
        speed_kmh: f.speedKmh ?? null,
        altitude_m: f.altitudeM ?? null,
        satellites: f.satellites ?? null,
        ignition: f.ignition ?? null,
        odometer_km: f.odometerKm ?? null,
        battery_pct: f.batteryPct ?? null,
        suspect,
        recorded_at: f.recordedAt,
        raw: f.raw ?? null,
      }
    })

  // ignoreDuplicates makes a vendor redelivery free rather than an error.
  const { data: inserted, error } = await client
    .from('transport_telemetry')
    .upsert(rows, { onConflict: 'source_id,recorded_at', ignoreDuplicates: true })
    .select('id')

  if (error) {
    console.error('ingest: insert failed', error)
    await client.from('transport_telemetry_sources')
      .update({ last_error: error.message }).eq('id', source.id)
    return NextResponse.json({ success: false, error: 'Could not store fixes' }, { status: 500 })
  }

  const accepted = inserted?.length ?? 0
  await client.from('transport_telemetry_sources').update({
    last_seen_at: new Date().toISOString(),
    last_error: null,
  }).eq('id', source.id)

  return NextResponse.json(
    { success: true, accepted, deduped: rows.length - accepted, rejected },
    { status: 202 },
  )
}

/**
 * HMAC over `${timestamp}.${body}`, the same shape the existing Razorpay and
 * bank webhooks verify. A query-string secret is accepted as a documented
 * second-best for forwarders that cannot sign — it is compared in constant time,
 * but it does end up in access logs, which is why it is a separate parameter
 * from the key id rather than the key id itself.
 */
function verify(request: NextRequest, rawBody: string, secret: string): boolean {
  const signature = request.headers.get('x-transport-signature')
  const timestamp = request.headers.get('x-transport-timestamp')

  if (!signature || !timestamp) {
    const provided = request.nextUrl.searchParams.get('secret')
    return !!provided && timingSafeEqual(provided, secret)
  }

  const ts = Number(timestamp)
  if (!Number.isFinite(ts)) return false
  const age = Math.abs(Date.now() / 1000 - ts)
  if (age > MAX_SIGNATURE_AGE_S) return false

  const expected = 'sha256=' + crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.${rawBody}`)
    .digest('hex')

  return timingSafeEqual(signature, expected)
}

function timingSafeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ab.length !== bb.length) return false
  return crypto.timingSafeEqual(ab, bb)
}

/**
 * Which run is this vehicle on right now?
 *
 * A live run wins. Otherwise a scheduled one whose window is open, so a bus
 * that starts moving early still attaches rather than reporting into nothing.
 */
async function resolveRun(
  client: NonNullable<ReturnType<typeof adminClient>>,
  vehicleId: string,
): Promise<string | null> {
  const today = new Date().toLocaleDateString('en-CA')

  const { data: live } = await client
    .from('transport_trip_runs')
    .select('id')
    .eq('vehicle_id', vehicleId)
    .in('status', ['boarding', 'in_progress'])
    .order('scheduled_start_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (live) return live.id

  const now = Date.now()
  const { data: scheduled } = await client
    .from('transport_trip_runs')
    .select('id, scheduled_start_at, scheduled_end_at')
    .eq('vehicle_id', vehicleId)
    .eq('service_date', today)
    .eq('status', 'scheduled')
    .order('scheduled_start_at', { ascending: true })

  for (const r of scheduled ?? []) {
    const start = new Date(r.scheduled_start_at).getTime() - 20 * 60_000
    const end = r.scheduled_end_at
      ? new Date(r.scheduled_end_at).getTime() + 45 * 60_000
      : new Date(r.scheduled_start_at).getTime() + 3 * 3_600_000
    if (now >= start && now <= end) return r.id
  }
  // No run: the fix is still stored, so the fleet map shows an idle bus rather
  // than nothing at all.
  return null
}

function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}
