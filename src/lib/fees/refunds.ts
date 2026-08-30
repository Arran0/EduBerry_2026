'use client'

import { supabase } from '@/lib/supabase'

// ============================================================================
// Refunds — the browser's side.
// ----------------------------------------------------------------------------
// Requesting and deciding both go through guarded routes. Nothing here writes
// to fee_refunds directly: the over-refund cap and the maker–checker rule are
// database triggers, and going round them from the client would defeat both.
// ============================================================================

export const REFUND_REASONS = [
  { key: 'withdrawal', label: 'Withdrawal' },
  { key: 'transfer', label: 'Transfer out' },
  { key: 'overpayment', label: 'Overpayment' },
  { key: 'duplicate_payment', label: 'Paid twice' },
  { key: 'fee_revision', label: 'Fee revised' },
  { key: 'deposit_return', label: 'Deposit returned' },
  { key: 'cancelled_service', label: 'Service cancelled' },
  { key: 'other', label: 'Other' },
] as const

export type RefundReason = (typeof REFUND_REASONS)[number]['key']

export type RefundStatus =
  | 'requested' | 'approved' | 'rejected' | 'processing' | 'processed' | 'failed'

export interface LedgerCredit {
  id: string
  amount: number
  method: string | null
  gateway: string | null
  gateway_payment_id: string | null
  utr: string | null
  occurred_at: string
  note: string | null
  reverses_txn_id?: string | null
  /** The original amount less anything already returned against it. */
  refundable?: number
}

export interface Refund {
  id: string
  transaction_id: string
  source: 'school' | 'bus'
  fee_id: string | null
  student_id: string | null
  amount: number
  kind: 'full' | 'partial'
  reason: string
  reason_category: RefundReason
  status: RefundStatus
  method: string
  gateway_refund_id: string | null
  requested_by: string | null
  requested_at: string
  approved_by: string | null
  approved_at: string | null
  processed_at: string | null
  failure_reason: string | null
}

type Result = { success: boolean; error?: string }

async function authed(): Promise<string | null> {
  const { data: { session } } = await supabase.auth.getSession()
  return session?.access_token ?? null
}

export interface RefundRequestInput {
  transaction_id: string
  amount: number
  reason: string
  reason_category: RefundReason
  method?: 'gateway' | 'cash' | 'cheque' | 'bank_transfer' | 'adjustment'
}

export async function requestRefund(input: RefundRequestInput): Promise<Result & { refund_id?: string }> {
  const token = await authed()
  if (!token) return { success: false, error: 'Please sign in again.' }
  try {
    const res = await fetch('/api/fees/refunds', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(input),
    })
    const json = await res.json()
    if (!json.success) return { success: false, error: json.error ?? 'Could not raise the refund.' }
    return { success: true, refund_id: json.refund_id }
  } catch (e) {
    console.error('requestRefund failed:', e)
    return { success: false, error: 'Network error. Check your connection and try again.' }
  }
}

export async function decideRefund(
  refundId: string,
  decision: 'approve' | 'reject',
  opts: { note?: string; reference?: string } = {},
): Promise<Result & { status?: RefundStatus }> {
  const token = await authed()
  if (!token) return { success: false, error: 'Please sign in again.' }
  try {
    const res = await fetch(`/api/fees/refunds/${refundId}/decide`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ decision, ...opts }),
    })
    const json = await res.json()
    if (!json.success) return { success: false, error: json.error ?? 'Could not record the decision.' }
    return { success: true, status: json.status }
  } catch (e) {
    console.error('decideRefund failed:', e)
    return { success: false, error: 'Network error. Check your connection and try again.' }
  }
}

export async function fetchRefunds(status?: RefundStatus): Promise<Refund[]> {
  const token = await authed()
  if (!token) return []
  try {
    const url = status ? `/api/fees/refunds?status=${status}` : '/api/fees/refunds'
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
    const json = await res.json()
    return json.success ? (json.refunds as Refund[]) : []
  } catch (e) {
    console.error('fetchRefunds failed:', e)
    return []
  }
}

/** The history of a refund, for the "what happened to this" panel. */
export interface RefundEvent {
  id: string
  from_status: string | null
  to_status: string
  actor_id: string | null
  note: string | null
  created_at: string
}

export async function fetchRefundEvents(refundId: string): Promise<RefundEvent[]> {
  const { data, error } = await supabase
    .from('fee_refund_events')
    .select('id, from_status, to_status, actor_id, note, created_at')
    .eq('refund_id', refundId)
    .order('created_at', { ascending: true })
  if (error) { console.error('fetchRefundEvents failed:', error); return [] }
  return (data ?? []) as unknown as RefundEvent[]
}

export const REFUND_STATUS_LABELS: Record<RefundStatus, string> = {
  requested: 'Awaiting approval',
  approved: 'Approved',
  rejected: 'Rejected',
  processing: 'Sent to the gateway',
  processed: 'Refunded',
  failed: 'Failed',
}
