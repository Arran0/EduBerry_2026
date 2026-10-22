import crypto from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { adminClient, callerUserId } from '@/lib/serverAuth'
import { readIntegrationSecrets } from '@/lib/serverIntegrationSecrets'
import { sampleBody } from '@/lib/transport/adapters'

export const runtime = 'nodejs'

/**
 * "Send test" on the GPS panel.
 *
 * Builds the request the device's gateway would send — the same body shape and
 * the same HMAC signature — and posts it to this deployment's own ingest
 * endpoint as a dry run. That proves the key, the secret and the payload format
 * end to end without a gateway, a device or a terminal, and stores nothing.
 */
export async function POST(request: NextRequest) {
  const client = adminClient()
  if (!client) {
    return NextResponse.json({ success: false, error: 'Server configuration error' }, { status: 500 })
  }

  const uid = await callerUserId(client, request)
  if (!uid) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await client.from('profiles').select('role').eq('id', uid).single()
  if (profile?.role !== 'admin') {
    return NextResponse.json({ success: false, error: 'Admin access required' }, { status: 403 })
  }

  const body = await request.json().catch(() => null) as { sourceId?: string; lat?: number; lng?: number } | null
  const lat = Number(body?.lat)
  const lng = Number(body?.lng)
  if (!body?.sourceId || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return NextResponse.json({ success: false, error: 'sourceId, lat and lng are required' }, { status: 400 })
  }

  const { data: source } = await client
    .from('transport_telemetry_sources')
    .select('id, vendor, external_id, ingest_key_prefix')
    .eq('id', body.sourceId)
    .maybeSingle()
  if (!source?.ingest_key_prefix) {
    return NextResponse.json({ success: false, error: 'Device not found' }, { status: 404 })
  }

  const { ingest_secret: secret } = await readIntegrationSecrets(client, `telemetry:${source.id}`)
  if (!secret) {
    return NextResponse.json({ success: false, error: 'This device has no secret. Rotate its key.' }, { status: 400 })
  }

  const payload = JSON.stringify(sampleBody(source.vendor, source.external_id || 'test', lat, lng))
  const timestamp = String(Math.floor(Date.now() / 1000))
  const signature = 'sha256=' + crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.${payload}`)
    .digest('hex')

  // basePath keeps this pointed at the right school if the app is ever served
  // under a path prefix rather than its own host.
  const url = `${request.nextUrl.origin}${request.nextUrl.basePath}/api/transport/ingest`

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-transport-key-id': source.ingest_key_prefix,
        'x-transport-timestamp': timestamp,
        'x-transport-signature': signature,
        'x-transport-test': '1',
      },
      body: payload,
      cache: 'no-store',
    })
    const json = await res.json().catch(() => ({})) as { success?: boolean; usable?: number; error?: string }
    if (!res.ok || !json.success) {
      return NextResponse.json({ success: false, error: json.error ?? `Ingest answered ${res.status}` }, { status: 502 })
    }
    if (!json.usable) {
      return NextResponse.json({ success: false, error: 'The endpoint answered but could not read the position' }, { status: 502 })
    }
    return NextResponse.json({ success: true, endpoint: url })
  } catch (e) {
    console.error('device test: ingest unreachable', e)
    return NextResponse.json({ success: false, error: 'Could not reach the ingest endpoint' }, { status: 502 })
  }
}
