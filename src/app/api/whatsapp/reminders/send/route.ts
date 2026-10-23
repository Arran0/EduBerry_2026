import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { adminClient, callerUserId } from '@/lib/serverAuth'
import { drainReminders, ensureReminderRuntime } from '@/lib/whatsapp/reminderServer'

export const runtime = 'nodejs'
export const maxDuration = 60

type Body =
  | { kind: 'attendance'; student_ids: string[] }
  | { kind: 'announcement'; announcement_id: string; student_ids: string[]; template?: string }
  | { kind: 'bus'; runs: { run_id: string; student_ids: string[] }[] }

interface QueueResult { queued: number; considered: number; skipped: Record<string, number> }

/**
 * Queue reminders, then send what was queued.
 *
 * The decisions — who is still absent, who is in the audience, who has
 * already been told today, who opted out — are all made by the wa_queue_*
 * RPCs in the database, which also re-check permission against the caller.
 * This route only identifies the caller (the RPCs trust its p_actor because
 * it arrives with the service role) and then runs one drain pass, so the
 * office sees "sent" within seconds instead of at the next minute's tick.
 */
export async function POST(request: NextRequest) {
  const db = adminClient()
  if (!db) return NextResponse.json({ success: false, error: 'Server not configured' }, { status: 500 })

  const userId = await callerUserId(db, request)
  if (!userId) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })

  let body: Body
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ success: false, error: 'Bad request body' }, { status: 400 })
  }

  await ensureReminderRuntime(db, request.nextUrl.origin)

  const total: QueueResult = { queued: 0, considered: 0, skipped: {} }
  const add = (r: QueueResult) => {
    total.queued += r.queued ?? 0
    total.considered += r.considered ?? 0
    for (const [k, v] of Object.entries(r.skipped ?? {})) total.skipped[k] = (total.skipped[k] ?? 0) + v
  }

  const calls: { fn: string; args: Record<string, unknown> }[] = []
  if (body.kind === 'attendance') {
    calls.push({ fn: 'wa_queue_attendance', args: { p_students: body.student_ids ?? [], p_actor: userId } })
  } else if (body.kind === 'announcement') {
    calls.push({
      fn: 'wa_queue_announcement',
      args: {
        p_announcement: body.announcement_id, p_students: body.student_ids ?? [],
        p_template: body.template || 'announcement.reminder', p_actor: userId,
      },
    })
  } else if (body.kind === 'bus') {
    for (const r of body.runs ?? []) {
      if (r.student_ids?.length) {
        calls.push({ fn: 'wa_queue_bus', args: { p_run: r.run_id, p_students: r.student_ids, p_actor: userId } })
      }
    }
  } else {
    return NextResponse.json({ success: false, error: 'Unknown reminder kind' }, { status: 400 })
  }

  if (calls.length === 0) {
    return NextResponse.json({ success: false, error: 'Nobody picked to remind.' }, { status: 400 })
  }

  for (const c of calls) {
    const { data, error } = await db.rpc(c.fn, c.args)
    if (error) {
      // The RPCs raise in plain words ("Only an admin can send bus reminders").
      const forbidden = /permission|only|cannot/i.test(error.message)
      return NextResponse.json({ success: false, error: error.message }, { status: forbidden ? 403 : 400 })
    }
    add(data as QueueResult)
  }

  // Best effort: anything this pass does not finish, the cron drain does.
  let sent = 0
  let note: string | undefined
  if (total.queued > 0) {
    try {
      const pass = await drainReminders(db, 50)
      sent = pass.sent
      note = pass.note
    } catch (e) {
      console.error('reminders/send: inline drain failed', e)
    }
  }

  return NextResponse.json({ success: true, ...total, sent, note })
}
