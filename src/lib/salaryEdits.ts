import { isAutoPayrollLabel } from './payroll'

// ============================================
// What has been typed into a pay cycle row by hand
// ============================================
//
// Everything else on the cycle sheet recomputes from a source that can be
// checked against something: attendance, the base-salary config, the bonus
// ledger. An override and a hand-added item cannot — they are only ever as
// right as whoever keyed them, and a mistyped one is indistinguishable from a
// deliberate correction.
//
// So the sheet pins these rows to the top and asks for a tick before the cycle
// can be locked, and the list below is both what it counts as an edit and the
// fingerprint that tick is stored against: change any of these values again
// and the row un-ticks itself.

/** The fields the aggregation needs — every salary record satisfies this. */
export interface EditableRecord {
  base_amount: number | string
  working_days_override: number | null
  leave_override: number | null
  late_override: number | null
  half_day_override: number | null
  pf_amount_override: number | null
  esi_amount_override: number | null
  items?: { label: string; amount: number | string }[] | null
}

/**
 * Every hand-typed value on a record, as stable strings.
 *
 * `configuredBase` is the person's standing base salary. A row whose base
 * differs from it has been typed over; a person with no base-salary row at all
 * has nothing to have departed from, so `null` means the base is never counted
 * as an edit — a ₹0 placeholder is not somebody's mistake to sign off.
 */
export function describeRecordEdits(
  record: EditableRecord,
  configuredBase: number | string | null | undefined,
): string[] {
  const parts: string[] = []

  const base = Number(record.base_amount) || 0
  if (configuredBase != null && Math.round(Number(configuredBase)) !== Math.round(base)) {
    parts.push(`base:${base}`)
  }
  if (record.working_days_override != null) parts.push(`days:${record.working_days_override}`)
  if (record.leave_override != null) parts.push(`leave:${record.leave_override}`)
  if (record.late_override != null) parts.push(`late:${record.late_override}`)
  if (record.half_day_override != null) parts.push(`half:${record.half_day_override}`)
  if (record.pf_amount_override != null) parts.push(`pf:${record.pf_amount_override}`)
  if (record.esi_amount_override != null) parts.push(`esi:${record.esi_amount_override}`)

  // Only what a person added counts. PF, ESI, loss of pay and the task bonus
  // are written by the app when a cycle is locked; treating those as hand
  // edits would put every row in the cycle behind the sign-off gate.
  const manual = (record.items ?? [])
    .filter(i => !isAutoPayrollLabel(i.label))
    .map(i => `${i.label}=${Number(i.amount) || 0}`)
    .sort()
  if (manual.length > 0) parts.push(`items:${manual.join('|')}`)

  return parts
}

/** The value a row's sign-off is stored against; changes whenever an edit does. */
export function editFingerprint(edits: string[]): string {
  return edits.join(';')
}
