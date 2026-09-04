// ─────────────────────────────────────────────────────────────────────────────
// Fee settings, client side.
//
// The values are effective-dated rows in `fee_settings`, not a blob, so reading
// "what did this say in September?" is possible. Saving goes through the
// fee_save_setting RPC, which closes the current version and opens a new one —
// a published row is frozen by trigger and cannot be edited in place.
// ─────────────────────────────────────────────────────────────────────────────

import { supabase, isMissingRelation } from '@/lib/supabase'

export interface NumberingSettings {
  school_code: string
  separator: string
  invoice: SeriesSettings
  receipt: SeriesSettings
}

export interface SeriesSettings {
  prefix: string
  width: number
  include_year: boolean
  reset: 'year' | 'never'
}

export interface PaymentRuleSettings {
  partial_allowed: boolean
  min_partial_amount: number
  allow_overpayment: boolean
  overpayment_becomes_credit: boolean
  allocation_order: 'oldest_due_first' | 'newest_due_first' | 'manual'
  allow_backdated_days: number
}

export interface GraceSettings { days: number }

export interface ApprovalThresholdSettings {
  discount: number; waiver: number; refund: number
}

export interface ReminderSettings {
  enabled: boolean
  send_at: string
  offsets: number[]
  channels: string[]
  skip_if_paid: boolean
  quiet_days: number[]
}

export interface WhatsAppSettings {
  enabled: boolean
  phone_number_id: string
  waba_id: string
  display_number: string
  credentials_saved: boolean
  webhook_verified: boolean
}

export interface MaskingSettings { enabled: boolean }

export interface FeeSettings {
  numbering: NumberingSettings
  payment_rules: PaymentRuleSettings
  grace: GraceSettings
  approval_thresholds: ApprovalThresholdSettings
  reminders: ReminderSettings
  whatsapp: WhatsAppSettings
  masking: MaskingSettings
}

export type FeeSettingKey = keyof FeeSettings

/**
 * The shipped defaults, repeated here.
 *
 * They are seeded in fee_r1_settings_audit.sql too, and the duplication is
 * deliberate: a deployment that has not run the migration must still render a
 * settings screen rather than a blank one, and a key added to the type but not
 * yet seeded must not read as undefined at a call site.
 */
export const DEFAULT_FEE_SETTINGS: FeeSettings = {
  numbering: {
    school_code: 'MPS',
    separator: '/',
    invoice: { prefix: 'INV', width: 4, include_year: true, reset: 'year' },
    receipt: { prefix: 'RCP', width: 4, include_year: true, reset: 'year' },
  },
  payment_rules: {
    partial_allowed: true,
    min_partial_amount: 0,
    allow_overpayment: true,
    overpayment_becomes_credit: true,
    allocation_order: 'oldest_due_first',
    allow_backdated_days: 30,
  },
  grace: { days: 0 },
  approval_thresholds: { discount: 5000, waiver: 0, refund: 0 },
  reminders: {
    enabled: false, send_at: '10:00', offsets: [-3, 0, 7, 14],
    channels: ['whatsapp'], skip_if_paid: true, quiet_days: [],
  },
  whatsapp: {
    enabled: false, phone_number_id: '', waba_id: '', display_number: '',
    credentials_saved: false, webhook_verified: false,
  },
  masking: { enabled: true },
}

/** Every live setting for a year, merged over the defaults. */
export async function fetchFeeSettings(academicYearId?: string | null): Promise<FeeSettings> {
  const { data, error } = await supabase
    .from('fee_settings')
    .select('key, value, academic_year_id, version, effective_from')
    .eq('status', 'published')
    .is('effective_to', null)

  if (error) {
    if (isMissingRelation(error)) return DEFAULT_FEE_SETTINGS
    throw error
  }

  const merged: FeeSettings = structuredClone(DEFAULT_FEE_SETTINGS)
  const rows = (data ?? []) as { key: string; value: unknown; academic_year_id: string | null }[]

  // Global rows first, then the year-specific ones on top, so a year override
  // wins for the keys it names without wiping the keys it does not.
  for (const scope of [null, academicYearId ?? null]) {
    for (const row of rows) {
      if (row.academic_year_id !== scope) continue
      if (!(row.key in merged)) continue
      const key = row.key as FeeSettingKey
      merged[key] = { ...(merged[key] as object), ...(row.value as object) } as never
    }
  }
  return merged
}

export async function saveFeeSetting<K extends FeeSettingKey>(
  key: K,
  value: FeeSettings[K],
  academicYearId?: string | null,
  notes?: string,
): Promise<void> {
  const { error } = await supabase.rpc('fee_save_setting', {
    p_key: key,
    p_value: value,
    p_year: academicYearId ?? null,
    p_notes: notes ?? null,
  })
  if (error) throw error
}

export interface FeeSettingVersion {
  id: string
  key: string
  value: unknown
  version: number
  status: 'draft' | 'published' | 'superseded'
  effective_from: string
  effective_to: string | null
  published_at: string | null
}

/** Every version of one key, newest first — the "what did this used to say" view. */
export async function fetchSettingHistory(key: FeeSettingKey): Promise<FeeSettingVersion[]> {
  const { data, error } = await supabase
    .from('fee_settings')
    .select('id, key, value, version, status, effective_from, effective_to, published_at')
    .eq('key', key)
    .order('version', { ascending: false })
  if (error) {
    if (isMissingRelation(error)) return []
    throw error
  }
  return (data ?? []) as FeeSettingVersion[]
}

/**
 * What the next number in a series will look like.
 *
 * Shown live under the numbering form, because a school will not trust a
 * receipt series they cannot see before it starts printing. The real number
 * comes from fee_next_number() in Round 2; this only formats a candidate, and
 * the two share this function so the preview cannot drift from the real thing.
 */
export function formatSeriesNumber(
  series: SeriesSettings, schoolCode: string, separator: string,
  yearCode: string, seq: number,
): string {
  const parts: string[] = []
  if (schoolCode) parts.push(schoolCode)
  if (series.prefix) parts.push(series.prefix)
  if (series.include_year) parts.push(yearCode.replace(/^\d{2}/, ''))
  parts.push(String(seq).padStart(Math.max(1, series.width), '0'))
  return parts.join(separator || '/')
}
