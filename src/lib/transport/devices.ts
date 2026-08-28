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
 * Register a device and mint its ingest secret.
 *
 * The secret is returned exactly once, here — only its 8-character prefix is
 * stored on the source row, and the secret itself goes into
 * integration_secrets, which admins alone can read. An admin who loses it
 * rotates rather than recovers.
 */
export async function createSource(
  input: SourceInput,
): Promise<{ success: boolean; id?: string; secret?: string; error?: string }> {
  const { data: { user } } = await supabase.auth.getUser()
  const secret = generateSecret()
  const prefix = secret.slice(0, 8)

  const { data, error } = await supabase
    .from('transport_telemetry_sources')
    .insert({
      ...input,
      priority: input.priority ?? (input.kind === 'gps_device' ? 10 : 50),
      ingest_key_prefix: prefix,
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

  return { success: true, id: data.id, secret }
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

export async function rotateSourceSecret(
  sourceId: string,
): Promise<{ success: boolean; secret?: string; error?: string }> {
  const secret = generateSecret()
  const { error } = await supabase
    .from('integration_secrets')
    .upsert({ key: `telemetry:${sourceId}`, value: { ingest_secret: secret } }, { onConflict: 'key' })
  if (error) { console.error('rotateSourceSecret failed:', error); return { success: false, error: error.message } }
  await supabase
    .from('transport_telemetry_sources')
    .update({ ingest_key_prefix: secret.slice(0, 8) })
    .eq('id', sourceId)
  return { success: true, secret }
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

function generateSecret(): string {
  const bytes = new Uint8Array(24)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
}
