/**
 * GPS device registry.
 *
 * A "source" is anything that can report where a bus is: the driver's phone,
 * an AIS-140 unit, or a vendor API we poll. Registering hardware here is what
 * lets `/api/transport/ingest` resolve an incoming fix to a vehicle, and hence
 * to the run it belongs to.
 */

import { supabase } from '../supabase'

export type SourceKind = 'driver_app' | 'gps_device' | 'vendor_api'

export interface TelemetrySource {
  id: string
  kind: SourceKind
  label: string
  vehicle_id: string | null
  vendor: string | null
  external_id: string | null
  /** Lower wins. A mains-powered device should outrank a driver's phone. */
  priority: number
  /** The public key id the device sends. Not derived from the secret. */
  ingest_key_prefix: string | null
  active: boolean
  last_seen_at: string | null
  last_error: string | null
  health: Record<string, unknown> | null
  created_at: string
  updated_at: string
}

export interface SourceInput {
  kind: SourceKind
  label: string
  vehicle_id?: string | null
  vendor?: string | null
  external_id?: string | null
  priority?: number
  active?: boolean
}

export async function fetchSources(): Promise<TelemetrySource[]> {
  const { data, error } = await supabase
    .from('transport_telemetry_sources')
    .select('*')
    .order('label', { ascending: true })
  if (error) { console.error('fetchSources failed:', error); return [] }
  return (data as TelemetrySource[]) || []
}

/**
 * Register a device and mint its ingest credentials.
 *
 * Two independent values are minted: a public **key id**, stored on the source
 * row so an incoming request can be resolved to a device, and a **secret**,
 * stored only in integration_secrets. They are deliberately unrelated — a key
 * id derived from the secret would mean the device had to transmit part of the
 * secret in cleartext on every request, which is the one thing an HMAC scheme
 * exists to avoid.
 *
 * The secret is returned exactly once, here. An admin who loses it rotates
 * rather than recovers.
 */
export async function createSource(
  input: SourceInput,
): Promise<{ success: boolean; id?: string; keyId?: string; secret?: string; error?: string }> {
  const { data: { user } } = await supabase.auth.getUser()
  const keyId = generateToken(8)
  const secret = generateToken(32)

  const { data, error } = await supabase
    .from('transport_telemetry_sources')
    .insert({
      ...input,
      priority: input.priority ?? (input.kind === 'gps_device' ? 10 : 50),
      ingest_key_prefix: keyId,
      created_by: user?.id,
    })
    .select('id')
    .single()

  if (error) {
    console.error('createSource failed:', error)
    if (error.code === '23505') {
      return { success: false, error: 'A source with that vendor and device id already exists.' }
    }
    return { success: false, error: error.message }
  }

  const { error: secretErr } = await supabase
    .from('integration_secrets')
    .upsert({ key: `telemetry:${data.id}`, value: { ingest_secret: secret } }, { onConflict: 'key' })

  if (secretErr) {
    console.error('createSource secret failed:', secretErr)
    // A source without a secret can never authenticate, so don't leave one behind.
    await supabase.from('transport_telemetry_sources').delete().eq('id', data.id)
    return { success: false, error: 'Could not store the ingest secret' }
  }

  return { success: true, id: data.id, keyId, secret }
}

export async function updateSource(
  sourceId: string,
  input: Partial<SourceInput>,
): Promise<{ success: boolean; error?: string }> {
  const { error } = await supabase.from('transport_telemetry_sources').update(input).eq('id', sourceId)
  if (error) { console.error('updateSource failed:', error); return { success: false, error: error.message } }
  return { success: true }
}

export async function deleteSource(sourceId: string): Promise<{ success: boolean; error?: string }> {
  const { error } = await supabase.from('transport_telemetry_sources').delete().eq('id', sourceId)
  if (error) { console.error('deleteSource failed:', error); return { success: false, error: error.message } }
  await supabase.from('integration_secrets').delete().eq('key', `telemetry:${sourceId}`)
  return { success: true }
}

/** Rotate both halves. The old pair stops working the moment this returns. */
export async function rotateSourceSecret(
  sourceId: string,
): Promise<{ success: boolean; keyId?: string; secret?: string; error?: string }> {
  const keyId = generateToken(8)
  const secret = generateToken(32)
  const { error } = await supabase
    .from('integration_secrets')
    .upsert({ key: `telemetry:${sourceId}`, value: { ingest_secret: secret } }, { onConflict: 'key' })
  if (error) { console.error('rotateSourceSecret failed:', error); return { success: false, error: error.message } }
  const { error: keyErr } = await supabase
    .from('transport_telemetry_sources')
    .update({ ingest_key_prefix: keyId })
    .eq('id', sourceId)
  if (keyErr) { console.error('rotateSourceSecret key failed:', keyErr); return { success: false, error: keyErr.message } }
  return { success: true, keyId, secret }
}

/** How healthy a device looks, in words rather than a timestamp. */
export function sourceHealth(s: TelemetrySource): { label: string; tone: 'ok' | 'warn' | 'bad' } {
  if (!s.active) return { label: 'Disabled', tone: 'warn' }
  if (!s.last_seen_at) return { label: 'Never reported', tone: 'bad' }
  const mins = (Date.now() - new Date(s.last_seen_at).getTime()) / 60000
  if (mins < 5) return { label: 'Reporting', tone: 'ok' }
  if (mins < 60) return { label: `${Math.round(mins)} min ago`, tone: 'warn' }
  if (mins < 60 * 24) return { label: `${Math.round(mins / 60)} h ago`, tone: 'bad' }
  return { label: `${Math.round(mins / 1440)} d ago`, tone: 'bad' }
}

function generateToken(bytes: number): string {
  const buf = new Uint8Array(bytes)
  crypto.getRandomValues(buf)
  return Array.from(buf, b => b.toString(16).padStart(2, '0')).join('')
}
