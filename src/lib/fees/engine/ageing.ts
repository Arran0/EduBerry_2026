// ============================================================================
// Arrears ageing — when a fee becomes a problem, and how much of one.
// ----------------------------------------------------------------------------
// Pure, like the rest of the engine: a date and a balance in, a state out. That
// is what makes the reminder schedule testable without waiting three months for
// a fee to actually age.
//
// The state machine, and why it has these steps:
//
//   upcoming    → due in more than a week. Nobody needs telling yet.
//   due_soon    → due within a week. One helpful nudge.
//   due_today   → due today.
//   grace       → past due but inside the structure's grace period. NOT overdue:
//                 a school that promised seven days' grace must not send a
//                 defaulter notice on day two, and a state machine that cannot
//                 express grace will.
//   overdue_30  → 1–30 days past the grace period.
//   overdue_60  → 31–60.
//   overdue_90  → 61–90.
//   overdue_90_plus → beyond 90. Usually a conversation, not a reminder.
//
// Transitions are one-way through time, which is what lets the reminder outbox
// key on "this fee entered state X" and send exactly once.
// ============================================================================

export type AgeingState =
  | 'upcoming' | 'due_soon' | 'due_today' | 'grace'
  | 'overdue_30' | 'overdue_60' | 'overdue_90' | 'overdue_90_plus'
  | 'settled'

export const OVERDUE_STATES: AgeingState[] = ['overdue_30', 'overdue_60', 'overdue_90', 'overdue_90_plus']

/** States a reminder is worth sending for, in escalation order. */
export const REMINDER_STATES: AgeingState[] = [
  'due_soon', 'due_today', 'overdue_30', 'overdue_60', 'overdue_90', 'overdue_90_plus',
]

export const AGEING_LABELS: Record<AgeingState, string> = {
  upcoming: 'Upcoming',
  due_soon: 'Due this week',
  due_today: 'Due today',
  grace: 'In grace period',
  overdue_30: '1–30 days overdue',
  overdue_60: '31–60 days overdue',
  overdue_90: '61–90 days overdue',
  overdue_90_plus: 'Over 90 days overdue',
  settled: 'Settled',
}

/** How many days before the due date counts as "due soon". */
export const DUE_SOON_DAYS = 7

export interface AgeingInput {
  /** ISO date, or null for a fee with no due date. */
  dueDate: string | null
  /** Net payable on the fee. */
  billed: number
  /** Credits less debits from the ledger. */
  paid: number
  /** Days after the due date before the fee counts as overdue. */
  graceDays?: number | null
  /** A cancelled fee is never chased. */
  cancelled?: boolean
  /** ISO date to evaluate against. */
  today: string
}

export interface Ageing {
  state: AgeingState
  outstanding: number
  /** Negative before the due date, positive after. Null with no due date. */
  daysPastDue: number | null
  /** Days past the END of the grace period. What the buckets are keyed on. */
  daysPastGrace: number | null
  bucket: 'current' | '1-30' | '31-60' | '61-90' | '90+'
}

/** Whole days between two ISO dates, b - a. UTC, so a DST shift cannot move it. */
export function daysBetween(a: string, b: string): number {
  const ms = Date.UTC(...parts(b)) - Date.UTC(...parts(a))
  return Math.round(ms / 86_400_000)
}

function parts(iso: string): [number, number, number] {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  return [y, (m ?? 1) - 1, d ?? 1]
}

export function ageFee(input: AgeingInput): Ageing {
  const billed = Number(input.billed) || 0
  const paid = Number(input.paid) || 0
  const outstanding = round2(Math.max(0, billed - paid))

  if (input.cancelled || outstanding <= 0) {
    return { state: 'settled', outstanding: 0, daysPastDue: null, daysPastGrace: null, bucket: 'current' }
  }

  // A fee with no due date is owed but not yet late. Treating it as overdue
  // would put every hand-issued fee into the defaulter list on day one.
  if (!input.dueDate) {
    return { state: 'upcoming', outstanding, daysPastDue: null, daysPastGrace: null, bucket: 'current' }
  }

  const daysPastDue = daysBetween(input.dueDate, input.today)
  const grace = Math.max(0, input.graceDays ?? 0)
  const daysPastGrace = daysPastDue - grace

  if (daysPastDue < 0) {
    return {
      state: daysPastDue >= -DUE_SOON_DAYS ? 'due_soon' : 'upcoming',
      outstanding, daysPastDue, daysPastGrace, bucket: 'current',
    }
  }
  if (daysPastDue === 0) {
    return { state: 'due_today', outstanding, daysPastDue, daysPastGrace, bucket: 'current' }
  }
  if (daysPastGrace <= 0) {
    return { state: 'grace', outstanding, daysPastDue, daysPastGrace, bucket: 'current' }
  }

  if (daysPastGrace <= 30) return mk('overdue_30', '1-30')
  if (daysPastGrace <= 60) return mk('overdue_60', '31-60')
  if (daysPastGrace <= 90) return mk('overdue_90', '61-90')
  return mk('overdue_90_plus', '90+')

  function mk(state: AgeingState, bucket: Ageing['bucket']): Ageing {
    return { state, outstanding, daysPastDue, daysPastGrace, bucket }
  }
}

// ── Aggregation ─────────────────────────────────────────────────────────────

export interface AgeingBuckets {
  current: number
  '1-30': number
  '31-60': number
  '61-90': number
  '90+': number
  total: number
}

export function emptyBuckets(): AgeingBuckets {
  return { current: 0, '1-30': 0, '31-60': 0, '61-90': 0, '90+': 0, total: 0 }
}

export function accumulate(buckets: AgeingBuckets, ageing: Ageing): AgeingBuckets {
  if (ageing.state === 'settled') return buckets
  buckets[ageing.bucket] = round2(buckets[ageing.bucket] + ageing.outstanding)
  buckets.total = round2(buckets.total + ageing.outstanding)
  return buckets
}

export function summariseAgeing(rows: Ageing[]): AgeingBuckets {
  return rows.reduce(accumulate, emptyBuckets())
}

// ── Reminders ───────────────────────────────────────────────────────────────

/**
 * Whether a state change is worth a message, and how urgent it should sound.
 *
 * `grace` deliberately sends nothing. A parent inside a grace period the school
 * itself granted has done nothing wrong, and chasing them there is the fastest
 * way to teach everyone to ignore fee reminders.
 */
export type ReminderTone = 'none' | 'gentle' | 'firm' | 'urgent' | 'escalate'

export function reminderToneFor(state: AgeingState): ReminderTone {
  switch (state) {
    case 'due_soon':        return 'gentle'
    case 'due_today':       return 'gentle'
    case 'overdue_30':      return 'firm'
    case 'overdue_60':      return 'urgent'
    case 'overdue_90':      return 'urgent'
    case 'overdue_90_plus': return 'escalate'
    default:                return 'none'
  }
}

/**
 * The key a reminder is deduplicated on. One message per fee per state — a
 * parent must not get the same "31–60 days overdue" notice every night the cron
 * runs, which is what a date-based key would do.
 */
export function reminderKey(feeId: string, state: AgeingState): string {
  return `${feeId}:${state}`
}

function round2(n: number): number {
  if (!Number.isFinite(n)) return 0
  const s = n < 0 ? -1 : 1
  return (s * Math.round(Math.abs(n) * 100 + Number.EPSILON * 100)) / 100
}
