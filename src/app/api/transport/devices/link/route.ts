import { NextRequest, NextResponse } from 'next/server'
import { adminClient, callerUserId } from '@/lib/serverAuth'
import { readIntegrationSecrets } from '@/lib/serverIntegrationSecrets'
import { gatewayConfig, GatewayError, linkDevice, unlinkDevice } from '@/lib/transport/traccar'

export const runtime = 'nodejs'

/** Traccar's AIS-140 (`its`) decoder; what vendors put in the device. */
const DEFAULT_PORT = 5179

/**
 * Keeps a school's GPS devices registered on EduBerry's shared gateway, so
 * linking a bus needs nobody at EduBerry: the panel calls this after every
 * register, rotate, enable/disable and before every delete.
 *
 * GET tells the panel whether this deployment is connected to a gateway and
 * the address vendors should use; it is public information by design.
 */

export async function GET(request: NextRequest) {
  const client = adminClient()
  if (!client) return NextResponse.json({ success: false, error: 'Server configuration error' }, { status: 500 })
  if (!(await callerUserId(client, request))) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }
  return NextResponse.json({
    success: true,
    configured: !!gatewayConfig(),
    host: process.env.GPS_GATEWAY_HOST?.trim() || null,
    port: Number(process.env.GPS_GATEWAY_PORT) || DEFAULT_PORT,
  })
}

export async function POST(request: NextRequest) {
  const client = adminClient()
  if (!client) return NextResponse.json({ success: false, error: 'Server configuration error' }, { status: 500 })

  const uid = await callerUserId(client, request)
  if (!uid) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  const { data: profile } = await client.from('profiles').select('role').eq('id', uid).single()
  if (profile?.role !== 'admin') {
    return NextResponse.json({ success: false, error: 'Admin access required' }, { status: 403 })
  }

  const body = await request.json().catch(() => null) as { sourceId?: string; action?: string } | null
  const action = body?.action
  if (!body?.sourceId || (action !== 'link' && action !== 'unlink')) {
    return NextResponse.json({ success: false, error: 'sourceId and action (link|unlink) are required' }, { status: 400 })
  }

  const cfg = gatewayConfig()
  if (!cfg) return NextResponse.json({ success: true, linked: false, reason: 'not_configured' })

  const { data: source } = await client
    .from('transport_telemetry_sources')
    .select('id, label, vendor, external_id, active, ingest_key_prefix, health')
    .eq('id', body.sourceId)
    .maybeSingle()
  if (!source) return NextResponse.json({ success: false, error: 'Device not found' }, { status: 404 })
  // Only devices behind the gateway; flespi and custom forwarders link themselves.
  if (source.vendor !== 'traccar') return NextResponse.json({ success: true, linked: false, reason: 'not_gateway' })
  if (!source.external_id) {
    return NextResponse.json({ success: false, error: 'This device has no IMEI' }, { status: 400 })
  }

  // The site URL wins over the request's host, so an admin on a preview URL
  // still links the device to the school's real address.
  const school = (process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '')
    || `${request.nextUrl.origin}${request.nextUrl.basePath}`)

  const record = async (gateway: Record<string, unknown>) => {
    const health = (source.health ?? {}) as Record<string, unknown>
    await client.from('transport_telemetry_sources')
      .update({ health: { ...health, gateway: { ...gateway, at: new Date().toISOString() } } })
      .eq('id', source.id)
  }

  try {
    if (action === 'unlink') {
      await unlinkDevice(cfg, { uniqueId: source.external_id, school })
      return NextResponse.json({ success: true, linked: false })
    }

    const { ingest_secret: secret } = await readIntegrationSecrets(client, `telemetry:${source.id}`)
    if (!secret || !source.ingest_key_prefix) {
      return NextResponse.json({ success: false, error: 'This device has no key. Rotate its key.' }, { status: 400 })
    }
    // Traccar cannot sign, so the secret rides in the URL; it authorises
    // nothing beyond posting positions for this one device.
    const forwardUrl = `${school}/api/transport/ingest`
      + `?key=${encodeURIComponent(source.ingest_key_prefix)}&secret=${encodeURIComponent(secret)}`

    await linkDevice(cfg, {
      uniqueId: source.external_id,
      name: `${new URL(school).host} · ${source.label}`,
      school,
      forwardUrl,
      disabled: !source.active,
    })
    await record({ linked: true })
    return NextResponse.json({ success: true, linked: true })
  } catch (e) {
    const message = e instanceof GatewayError ? e.message : 'Could not update the GPS server'
    if (!(e instanceof GatewayError)) console.error('device link failed:', e)
    if (action === 'link') await record({ linked: false, error: message })
    return NextResponse.json({ success: false, error: message }, { status: 502 })
  }
}
