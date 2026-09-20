// ============================================================================
// The payroll run state machine.
// ----------------------------------------------------------------------------
// Draft → Review → Calculated → Exceptions → Pending approval → Approved →
// Locked → Paid → Reconciled.
//
// The transition table is the whole feature. A status column that anything can
// set to anything is not a workflow — it is a label. Here every move is checked
// against what is allowed *and* against guards that read the run's actual state,
// so "approved" cannot be reached while a blocking exception is open and
// "locked" cannot be reached without an approver on record.
// ============================================================================

export type RunStatus =
  | 'draft' | 'review' | 'calculated' | 'exceptions' | 'pending_approval'
  | 'approved' | 'locked' | 'paid' | 'reconciled'

export const RUN_STATUSES: RunStatus[] = [
  'draft', 'review', 'calculated', 'exceptions', 'pending_approval',
  'approved', 'locked', 'paid', 'reconciled',
]

export const RUN_STATUS_LABEL: Record<RunStatus, string> = {
  draft: 'Draft',
  review: 'Review',
  calculated: 'Calculated',
  exceptions: 'Exceptions',
  pending_approval: 'Pending approval',
  approved: 'Approved',
  locked: 'Locked',
  paid: 'Paid',
  reconciled: 'Reconciled',
}

export const RUN_STATUS_HELP: Record<RunStatus, string> = {
  draft: 'Employees are being added and inputs collected. Nothing is calculated yet.',
  review: 'The roster is settled. Attendance and structures can still be corrected.',
  calculated: 'Every line has been computed and its workings stored.',
  exceptions: 'Problems have been raised. Blocking ones must be cleared before approval.',
  pending_approval: 'Waiting for an approver to review the totals and variance.',
  approved: 'Approved. The run can now be locked.',
  locked: 'Immutable. Nothing on this run can change; corrections go to a supplementary run.',
  paid: 'Payment instructions have been issued to the bank.',
  reconciled: 'Every payment has been confirmed against the bank statement.',
}

/** Statuses at or past which the database refuses any write to lines or components. */
export const IMMUTABLE_STATUSES: RunStatus[] = ['locked', 'paid', 'reconciled']

export function isImmutable(status: RunStatus): boolean {
  return IMMUTABLE_STATUSES.includes(status)
}

const TRANSITIONS: Record<RunStatus, RunStatus[]> = {
  draft: ['review'],
  // Recalculating from review is the normal loop while inputs are still moving.
  review: ['draft', 'calculated'],
  calculated: ['review', 'exceptions', 'pending_approval'],
  exceptions: ['review', 'calculated', 'pending_approval'],
  pending_approval: ['exceptions', 'review', 'approved'],
  approved: ['pending_approval', 'locked'],
  // A locked run never goes back. The only route to a different number is a
  // supplementary run, which is what keeps every payslip already issued true.
  locked: ['paid'],
  paid: ['reconciled'],
  reconciled: [],
}

export interface RunGuardState {
  lineCount: number
  calculatedAt: string | null
  blockingExceptions: number
  unresolvedExceptions: number
  approvedBy: string | null
  varianceAcknowledged: boolean
  paidLineCount: number
}

export interface TransitionCheck {
  allowed: boolean
  reason: string
}

export function canTransition(from: RunStatus, to: RunStatus, state: RunGuardState): TransitionCheck {
  if (from === to) return { allowed: false, reason: 'The run is already in that state.' }
  if (!TRANSITIONS[from].includes(to)) {
    return {
      allowed: false,
      reason: isImmutable(from) && !isImmutable(to)
        ? `A ${RUN_STATUS_LABEL[from].toLowerCase()} run cannot be reopened. Post a supplementary run instead.`
        : `A run cannot go from ${RUN_STATUS_LABEL[from]} to ${RUN_STATUS_LABEL[to]}.`,
    }
  }

  switch (to) {
    case 'review':
      if (state.lineCount === 0) return { allowed: false, reason: 'The run has no employees on it yet.' }
      return { allowed: true, reason: '' }
    case 'calculated':
      if (state.lineCount === 0) return { allowed: false, reason: 'The run has no employees on it yet.' }
      return { allowed: true, reason: '' }
    case 'pending_approval':
      if (!state.calculatedAt) return { allowed: false, reason: 'The run has not been calculated.' }
      if (state.blockingExceptions > 0) {
        return { allowed: false, reason: `${state.blockingExceptions} blocking exception(s) must be resolved first.` }
      }
      return { allowed: true, reason: '' }
    case 'approved':
      if (state.blockingExceptions > 0) {
        return { allowed: false, reason: `${state.blockingExceptions} blocking exception(s) are still open.` }
      }
      if (!state.varianceAcknowledged) {
        return { allowed: false, reason: 'The month-on-month variance has not been reviewed.' }
      }
      return { allowed: true, reason: '' }
    case 'locked':
      if (!state.approvedBy) return { allowed: false, reason: 'The run has not been approved by anyone.' }
      return { allowed: true, reason: '' }
    case 'reconciled':
      if (state.paidLineCount < state.lineCount) {
        return { allowed: false, reason: `${state.lineCount - state.paidLineCount} line(s) have not been confirmed as paid.` }
      }
      return { allowed: true, reason: '' }
    default:
      return { allowed: true, reason: '' }
  }
}

export function nextStatuses(from: RunStatus): RunStatus[] {
  return TRANSITIONS[from]
}
