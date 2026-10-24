import 'server-only'

/**
 * Client for EduBerry's shared Traccar gateway (infra/gps-gateway).
 *
 * Each school's app links its own devices: one Traccar device per IMEI, whose
 * `forward.url` attribute points at that school's ingest endpoint. The token is
 * the gateway's service-account token (web.serviceAccountToken), which acts as
 * an admin — so a device created here carries no user permission, and lookups
 * list everything rather than relying on one.
 */

export interface GatewayConfig {
  url: string
  token: string
}

/** Null when this deployment has not been connected to a gateway. */
export function gatewayConfig(): GatewayConfig | null {
  const url = process.env.TRACCAR_URL?.trim().replace(/\/$/, '')
  const token = process.env.TRACCAR_TOKEN?.trim()
  return url && token ? { url, token } : null
}

interface TraccarDevice {
  id: number
  name: string
  uniqueId: string
  disabled: boolean
  attributes: Record<string, unknown>
  [key: string]: unknown
}

/** The attribute that records which school owns a device on the shared gateway. */
const OWNER = 'eduberry.school'

export class GatewayError extends Error {}

async function call<T>(cfg: GatewayConfig, method: string, path: string, body?: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${cfg.url}/api${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${cfg.token}`,
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    })
  } catch {
    throw new GatewayError('Could not reach the GPS server')
  }
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      throw new GatewayError('The GPS server rejected EduBerry’s credentials')
    }
    // Traccar answers 400 with a Java exception and its stack; the first line
    // is the useful part.
    const text = (await res.text().catch(() => '')).split('\n')[0].slice(0, 160)
    throw new GatewayError(`GPS server answered ${res.status}${text ? `: ${text}` : ''}`)
  }
  return (res.status === 204 ? undefined : await res.json()) as T
}

async function findDevice(cfg: GatewayConfig, uniqueId: string): Promise<TraccarDevice | null> {
  const list = await call<TraccarDevice[]>(
    cfg, 'GET', `/devices?all=true&keyword=${encodeURIComponent(uniqueId)}`,
  )
  return list.find(d => d.uniqueId === uniqueId) ?? null
}

function assertOwned(device: TraccarDevice, school: string) {
  const owner = device.attributes?.[OWNER]
  // A device someone added by hand has no owner yet and may be claimed.
  if (owner && owner !== school) {
    throw new GatewayError('This IMEI is already linked to another EduBerry school. Contact EduBerry support.')
  }
}

/** Create or update the device so the gateway forwards it to this school. */
export async function linkDevice(cfg: GatewayConfig, o: {
  uniqueId: string
  name: string
  school: string
  forwardUrl: string
  disabled: boolean
}): Promise<void> {
  const existing = await findDevice(cfg, o.uniqueId)
  if (existing) {
    assertOwned(existing, o.school)
    await call(cfg, 'PUT', `/devices/${existing.id}`, {
      ...existing,
      name: o.name,
      disabled: o.disabled,
      attributes: { ...existing.attributes, [OWNER]: o.school, 'forward.url': o.forwardUrl },
    })
    return
  }
  await call(cfg, 'POST', '/devices', {
    name: o.name,
    uniqueId: o.uniqueId,
    disabled: o.disabled,
    attributes: { [OWNER]: o.school, 'forward.url': o.forwardUrl },
  })
}

/** Remove the device, unless it belongs to another school. Missing is fine. */
export async function unlinkDevice(cfg: GatewayConfig, o: { uniqueId: string; school: string }): Promise<void> {
  const existing = await findDevice(cfg, o.uniqueId)
  if (!existing) return
  assertOwned(existing, o.school)
  await call(cfg, 'DELETE', `/devices/${existing.id}`)
}
