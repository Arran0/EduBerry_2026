import 'server-only'
import { isoTime, num, type IngestFix, type TelemetryAdapter } from './types'

export type { IngestFix, TelemetryAdapter } from './types'

/** Our own JSON shape, for anyone writing a small forwarder themselves. */
const generic: TelemetryAdapter = {
  slug: 'generic',
  parse(body) {
    const src = Array.isArray(body) ? body : [(body as { fixes?: unknown[] })?.fixes ?? body].flat()
    const out: IngestFix[] = []
    for (const raw of src as Record<string, unknown>[]) {
      if (!raw || typeof raw !== 'object') continue
      const lat = num(raw.lat ?? raw.latitude)
      const lng = num(raw.lng ?? raw.lon ?? raw.longitude)
      const at = isoTime(raw.recordedAt ?? raw.recorded_at ?? raw.timestamp ?? raw.time)
      const id = String(raw.externalId ?? raw.external_id ?? raw.deviceId ?? raw.imei ?? '')
      if (lat == null || lng == null || !at || !id) continue
      out.push({
        externalId: id, lat, lng, recordedAt: at,
        accuracyM: num(raw.accuracyM ?? raw.accuracy),
        headingDeg: num(raw.headingDeg ?? raw.heading ?? raw.course),
        speedKmh: num(raw.speedKmh ?? raw.speed_kmh),
        altitudeM: num(raw.altitudeM ?? raw.altitude),
        satellites: num(raw.satellites ?? raw.sats),
        ignition: typeof raw.ignition === 'boolean' ? raw.ignition : null,
        odometerKm: num(raw.odometerKm ?? raw.odometer),
        batteryPct: num(raw.batteryPct ?? raw.battery),
        raw,
      })
    }
    return out
  },
}

/**
 * Traccar's forward-webhook JSON.
 *
 * Traccar is the recommended gateway in front of AIS-140 hardware: it already
 * speaks 200+ device protocols over raw TCP/UDP, which Vercel cannot terminate,
 * and forwards clean JSON. Its `speed` is in knots.
 */
const traccar: TelemetryAdapter = {
  slug: 'traccar',
  parse(body) {
    const b = body as { device?: Record<string, unknown>; position?: Record<string, unknown> }
    const device = b?.device
    const pos = b?.position
    if (!device || !pos) return []

    const lat = num(pos.latitude)
    const lng = num(pos.longitude)
    const at = isoTime(pos.deviceTime ?? pos.fixTime ?? pos.serverTime)
    const id = String(device.uniqueId ?? device.id ?? '')
    if (lat == null || lng == null || !at || !id) return []

    const knots = num(pos.speed)
    const attrs = (pos.attributes ?? {}) as Record<string, unknown>

    return [{
      externalId: id, lat, lng, recordedAt: at,
      accuracyM: num(pos.accuracy),
      headingDeg: num(pos.course),
      speedKmh: knots != null ? knots * 1.852 : null,
      altitudeM: num(pos.altitude),
      satellites: num(attrs.sat),
      ignition: typeof attrs.ignition === 'boolean' ? attrs.ignition : null,
      odometerKm: num(attrs.odometer) != null ? (num(attrs.odometer) as number) / 1000 : null,
      batteryPct: num(attrs.batteryLevel),
      raw: body,
    }]
  },
}

/** flespi's parsed-message shape. Its `position.speed` is already km/h. */
const flespi: TelemetryAdapter = {
  slug: 'flespi',
  parse(body) {
    const rows = Array.isArray(body) ? body : [body]
    const out: IngestFix[] = []
    for (const raw of rows as Record<string, unknown>[]) {
      if (!raw || typeof raw !== 'object') continue
      const lat = num(raw['position.latitude'])
      const lng = num(raw['position.longitude'])
      const at = isoTime(raw.timestamp)
      const id = String(raw.ident ?? raw['device.id'] ?? '')
      if (lat == null || lng == null || !at || !id) continue
      out.push({
        externalId: id, lat, lng, recordedAt: at,
        headingDeg: num(raw['position.direction']),
        speedKmh: num(raw['position.speed']),
        altitudeM: num(raw['position.altitude']),
        satellites: num(raw['position.satellites']),
        ignition: typeof raw['engine.ignition.status'] === 'boolean'
          ? (raw['engine.ignition.status'] as boolean) : null,
        batteryPct: num(raw['battery.level']),
        raw,
      })
    }
    return out
  },
}

const ADAPTERS: Record<string, TelemetryAdapter> = {
  [generic.slug]: generic,
  [traccar.slug]: traccar,
  [flespi.slug]: flespi,
}

export function resolveAdapter(slug?: string | null): TelemetryAdapter {
  return ADAPTERS[slug ?? ''] ?? generic
}

export const ADAPTER_SLUGS = Object.keys(ADAPTERS)
