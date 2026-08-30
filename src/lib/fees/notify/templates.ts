// ============================================================================
// What a fee reminder actually says.
// ----------------------------------------------------------------------------
// Pure, so the wording is testable and reviewable without sending anything.
//
// Two rules govern every string here:
//
//   • Tone escalates with age, but never becomes a threat. A school that
//     threatens over a missed instalment loses the parent long before it gets
//     the money, and most late fees are an oversight rather than a refusal.
//
//   • DPDP data minimisation: a push notification appears on a lock screen that
//     anyone nearby can read. So the message carries the child's FIRST name, the
//     amount and a link — never the full name, class, admission number, fee
//     head breakdown or anything else that would identify a minor to a stranger
//     glancing at a phone. The detail is behind the link, where the parent has
//     signed in.
// ============================================================================

import type { AgeingState } from '../engine/ageing'

export interface TemplateInput {
  /** First name only — see the note above. */
  childFirstName: string
  amount: number
  dueDate: string | null
  daysPastDue: number | null
  schoolName: string
}

export interface RenderedMessage {
  templateKey: string
  title: string
  body: string
  url: string
}

function inr(n: number): string {
  return `₹${Math.round(n).toLocaleString('en-IN')}`
}

function niceDate(iso: string | null): string {
  if (!iso) return 'soon'
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`)
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' })
}

const FEES_URL = '/more/fees'

/** Null when this state is not worth a message — a grace period, most notably. */
export function renderReminder(state: AgeingState, input: TemplateInput): RenderedMessage | null {
  const { childFirstName: name, amount, dueDate, daysPastDue } = input
  const money = inr(amount)

  switch (state) {
    case 'due_soon':
      return {
        templateKey: 'fee.due_soon',
        title: `${name}'s school fee is due ${niceDate(dueDate)}`,
        body: `${money} is due on ${niceDate(dueDate)}. You can pay in the app whenever suits you.`,
        url: FEES_URL,
      }

    case 'due_today':
      return {
        templateKey: 'fee.due_today',
        title: `${name}'s school fee is due today`,
        body: `${money} is due today. Tap to pay — it takes about a minute.`,
        url: FEES_URL,
      }

    case 'overdue_30':
      return {
        templateKey: 'fee.overdue_30',
        title: `${name}'s fee payment is overdue`,
        body: `${money} was due ${daysPastDue ? `${daysPastDue} days ago` : 'recently'}. If you have already paid, please ignore this — it can take a day to show.`,
        url: FEES_URL,
      }

    case 'overdue_60':
      return {
        templateKey: 'fee.overdue_60',
        title: `${name}'s fee is over a month overdue`,
        body: `${money} is still outstanding. If paying is difficult right now, please talk to the office — instalments can usually be arranged.`,
        url: FEES_URL,
      }

    case 'overdue_90':
      return {
        templateKey: 'fee.overdue_90',
        title: `${name}'s fee needs your attention`,
        body: `${money} has been outstanding for over two months. Please get in touch with the school office so we can sort this out together.`,
        url: FEES_URL,
      }

    // Past ninety days this stops being a reminder problem. A fourth automated
    // message will not collect what three did not; a person needs to call.
    case 'overdue_90_plus':
      return {
        templateKey: 'fee.overdue_90_plus',
        title: `Please contact the school office`,
        body: `There is an outstanding fee balance of ${money} on ${name}'s account. The office would like to speak with you about it.`,
        url: FEES_URL,
      }

    default:
      return null
  }
}

/** The receipt confirmation, sent once when money lands. */
export function renderReceiptNotice(input: {
  childFirstName: string
  amount: number
  receiptNo: string
  outstanding: number
}): RenderedMessage {
  const paid = inr(input.amount)
  const body = input.outstanding > 0
    ? `${paid} received for ${input.childFirstName}. ${inr(input.outstanding)} is still outstanding. Receipt ${input.receiptNo}.`
    : `${paid} received for ${input.childFirstName} — fully paid, thank you. Receipt ${input.receiptNo}.`
  return {
    templateKey: 'fee.receipt',
    title: 'Payment received',
    body,
    url: FEES_URL,
  }
}

/** A cheque that came back. The parent has to know before the arrears do. */
export function renderBounceNotice(input: {
  childFirstName: string
  amount: number
  instrumentNo: string | null
}): RenderedMessage {
  return {
    templateKey: 'fee.cheque_bounced',
    title: 'A cheque could not be cleared',
    body: `The ${inr(input.amount)} cheque${input.instrumentNo ? ` (${input.instrumentNo})` : ''} for ${input.childFirstName}'s fees was returned by the bank, so the fee is outstanding again. Please contact the office.`,
    url: FEES_URL,
  }
}
