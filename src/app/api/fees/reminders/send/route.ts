import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { requireFeePermission } from '@/lib/fees/serverGuard'

export const maxDuration = 60

/**
 * Queue reminders for one bill, or for many at once.
 *
 * Queue, not send: the message goes on the outbox and the drain picks it up
 * within the minute. That is what makes "remind this whole class" a single
 * fast request rather than 40 sequential HTTPS calls the browser waits on, and
 * what makes a failure retryable instead of lost.
 *
 * Every skip is reported by reason, because "38 sent" without "6 already paid,
 * 2 no number on file" leaves the office wondering who was missed.
 */
export async function POST(request: NextRequest) {
  const guard = await requireFeePermission(request, 'fees.reminder.send')
  if (!guard.ok) return guard.response

  let body: { invoice_ids?: string[]; template?: string; not_before?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ success: false, error: 'Bad request body' }, { status: 400 })
  }

  const ids = (body.invoice_ids ?? []).filter(Boolean)
  if (ids.length === 0) {
    return NextResponse.json({ success: false, error: 'No bills to remind about.' }, { status: 400 })
  }
  if (ids.length > 500) {
    return NextResponse.json(
      { success: false, error: 'Too many at once — remind up to 500 bills per run.' },
      { status: 400 })
  }

  let queued = 0
  const skipped: Record<string, number> = {}

  for (const id of ids) {
    const { data, error } = await guard.db.rpc('fee_queue_reminder', {
      p_invoice: id,
      p_template: body.template ?? 'fee_reminder_due',
      p_schedule: null,
      p_not_before: body.not_before ?? null,
      p_actor: guard.userId,
    })

    if (error) {
      skipped.error = (skipped.error ?? 0) + 1
      continue
    }

    const result = data as { queued?: boolean; reason?: string }
    if (result?.queued) queued++
    else skipped[result?.reason ?? 'unknown'] = (skipped[result?.reason ?? 'unknown'] ?? 0) + 1
  }

  return NextResponse.json({ success: true, queued, skipped, considered: ids.length })
}
