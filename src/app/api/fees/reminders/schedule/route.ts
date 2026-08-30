import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { requireCapability, serviceClient } from '@/lib/fees/serverGuard'
import { ageFee, reminderToneFor, reminderKey, type AgeingState } from '@/lib/fees/engine/ageing'
import { renderReminder } from '@/lib/fees/notify/templates'
import { availableChannels, type ChannelName } from '@/lib/fees/notify/channels'

// Work out who should hear about an outstanding fee today, and queue it.
//
// Scheduling and sending are separate on purpose. This route decides and writes
// rows; /api/fees/reminders/send delivers them. A crash between the two loses
// nothing, and a retry of either cannot double-send, because the outbox's
// unique (dedupe_key, channel, recipient) index is the guarantee rather than
// this route's control flow.
//
// The dedupe key is (fee, ageing state) — never a date. A date-based key would
// re-send the same "31-60 days overdue" notice every night the cron runs, which
// is the fastest way to teach a school's parents to ignore fee messages.
//
// Run it from pg_cron, or by hand from the fee dashboard. Either way it is
// idempotent: running it four times in an hour queues nothing extra.

export const runtime = 'nodejs'
export const maxDuration = 300

/** How many days ahead of the run we look for fees about to fall due. */
const HORIZON_DAYS = 10

interface OutstandingRow {
  fee_id: string
  student_id: string
  due_date: string | null
  billed: number
  paid: number
  grace_days: number | null
  status: string
}

export async function POST(request: NextRequest) {
  // A cron caller presents the service-role secret; a human presents a session.
  const cronSecret = request.headers.get('x-fee-cron-secret')
  const viaCron = !!cronSecret && cronSecret === process.env.FEE_CRON_SECRET

  let db: SupabaseClient
  if (viaCron) {
    const svc = serviceClient()
    if (!svc.ok) return svc.response
    db = svc.db
  } else {
    const guard = await requireCapability(request, 'view_reports')
    if (!guard.ok) return guard.response
    db = guard.actor.db
  }

  const body = await request.json().catch(() => ({}))
  const today: string = body.today ?? new Date().toISOString().slice(0, 10)
  const dryRun: boolean = body.dry_run === true

  const channels = await availableChannels(db)
  // in_app alone is still worth queueing — the parent sees it next time they
  // open the fee screen — so this never short-circuits on "no push".
  if (!channels.length) {
    return NextResponse.json({ success: true, queued: 0, skipped: 'No delivery channel is configured' })
  }

  const horizon = new Date(`${today}T00:00:00Z`)
  horizon.setUTCDate(horizon.getUTCDate() + HORIZON_DAYS)

  const { data: rows, error } = await db
    .from('fee_outstanding')
    .select('fee_id, student_id, due_date, billed, paid, grace_days, status')
    .gt('outstanding', 0)
    .lte('due_date', horizon.toISOString().slice(0, 10))
    .limit(20000)

  if (error) {
    console.error('reminders/schedule: read failed', error)
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }

  const outstanding = (rows ?? []) as unknown as OutstandingRow[]
  if (!outstanding.length) return NextResponse.json({ success: true, queued: 0, considered: 0 })

  // Everything the messages need, fetched per cohort rather than per fee.
  const studentIds = [...new Set(outstanding.map(r => r.student_id))]
  const [names, recipients, prefs, schoolName] = await Promise.all([
    firstNames(db, studentIds),
    resolveRecipients(db, studentIds),
    familyPrefs(db, studentIds),
    resolveSchoolName(db),
  ])

  const queued: Record<string, unknown>[] = []
  let considered = 0
  const byState: Record<string, number> = {}

  for (const row of outstanding) {
    const ageing = ageFee({
      dueDate: row.due_date,
      billed: Number(row.billed),
      paid: Number(row.paid),
      graceDays: row.grace_days,
      cancelled: row.status === 'cancelled',
      today,
    })

    if (reminderToneFor(ageing.state) === 'none') continue
    considered++
    byState[ageing.state] = (byState[ageing.state] ?? 0) + 1

    const message = renderReminder(ageing.state as AgeingState, {
      childFirstName: names.get(row.student_id) ?? 'your child',
      amount: ageing.outstanding,
      dueDate: row.due_date,
      daysPastDue: ageing.daysPastDue,
      schoolName,
    })
    if (!message) continue

    const to = recipients.get(row.student_id) ?? []
    for (const r of to) {
      const pref = prefs.get(r.familyId ?? '') ?? null
      // A family that has opted out is not messaged, and the absence of a
      // preference row is not consent to every channel — the default is the
      // conservative pair.
      if (pref?.optedOut) continue
      const allowed = (pref?.channels ?? ['push', 'in_app']) as ChannelName[]

      for (const channel of channels) {
        if (!allowed.includes(channel)) continue
        queued.push({
          student_id: row.student_id,
          family_id: r.familyId,
          recipient_id: r.profileId,
          fee_id: row.fee_id,
          source: 'school',
          channel,
          trigger_state: ageing.state,
          template_key: message.templateKey,
          title: message.title,
          body: message.body,
          payload: { url: message.url, outstanding: ageing.outstanding, days_past_due: ageing.daysPastDue },
          dedupe_key: reminderKey(row.fee_id, ageing.state),
          scheduled_for: new Date().toISOString(),
        })
      }
    }
  }

  if (dryRun) {
    return NextResponse.json({ success: true, dry_run: true, would_queue: queued.length, considered, by_state: byState })
  }

  // The unique (dedupe_key, channel, recipient_id) index does the deduplication.
  // Ignoring conflicts is how "run it again" stays free.
  let inserted = 0
  for (let i = 0; i < queued.length; i += 500) {
    const chunk = queued.slice(i, i + 500)
    const { data, error: insErr } = await db
      .from('fee_notifications')
      .upsert(chunk, { onConflict: 'dedupe_key,channel,recipient_id', ignoreDuplicates: true })
      .select('id')
    if (insErr) {
      console.error('reminders/schedule: queue insert failed', insErr)
      return NextResponse.json({ success: false, error: insErr.message, queued: inserted }, { status: 500 })
    }
    inserted += (data ?? []).length
  }

  return NextResponse.json({ success: true, queued: inserted, considered, by_state: byState })
}

// ── Lookups ─────────────────────────────────────────────────────────────────

/**
 * First names only. A push notification lands on a lock screen anyone nearby
 * can read, and a full name plus a class identifies a child to a stranger.
 */
async function firstNames(db: SupabaseClient, ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  for (let i = 0; i < ids.length; i += 500) {
    const { data } = await db.from('profiles').select('id, full_name').in('id', ids.slice(i, i + 500))
    for (const p of data ?? []) {
      out.set(p.id as string, String(p.full_name ?? '').trim().split(/\s+/)[0] || 'your child')
    }
  }
  return out
}

interface Recipient { profileId: string; familyId: string | null }

/**
 * Who to tell. Every payer linked to the student's family, and the student's own
 * account as a fallback — a school where a child holds the only login must still
 * be able to reach someone.
 */
async function resolveRecipients(
  db: SupabaseClient,
  studentIds: string[],
): Promise<Map<string, Recipient[]>> {
  const out = new Map<string, Recipient[]>()

  const { data: memberships } = await db
    .from('fee_family_members')
    .select('family_id, profile_id, role')
    .in('profile_id', studentIds)
    .eq('role', 'student')

  const familyByStudent = new Map<string, string>()
  for (const m of memberships ?? []) familyByStudent.set(m.profile_id as string, m.family_id as string)

  const familyIds = [...new Set([...familyByStudent.values()])]
  const payersByFamily = new Map<string, string[]>()
  if (familyIds.length) {
    const { data: payers } = await db
      .from('fee_family_members')
      .select('family_id, profile_id')
      .in('family_id', familyIds)
      .eq('role', 'payer')
    for (const p of payers ?? []) {
      const list = payersByFamily.get(p.family_id as string) ?? []
      list.push(p.profile_id as string)
      payersByFamily.set(p.family_id as string, list)
    }
  }

  for (const studentId of studentIds) {
    const familyId = familyByStudent.get(studentId) ?? null
    const payers = familyId ? payersByFamily.get(familyId) ?? [] : []
    out.set(
      studentId,
      payers.length
        ? payers.map(profileId => ({ profileId, familyId }))
        : [{ profileId: studentId, familyId }],
    )
  }
  return out
}

interface Pref { channels: string[]; optedOut: boolean }

async function familyPrefs(db: SupabaseClient, studentIds: string[]): Promise<Map<string, Pref>> {
  const out = new Map<string, Pref>()
  const { data: memberships } = await db
    .from('fee_family_members').select('family_id').in('profile_id', studentIds)
  const familyIds = [...new Set((memberships ?? []).map(m => m.family_id as string))]
  if (!familyIds.length) return out

  const { data } = await db
    .from('fee_notification_prefs')
    .select('family_id, channels, opted_out_at')
    .in('family_id', familyIds)
  for (const p of data ?? []) {
    out.set(p.family_id as string, {
      channels: (p.channels as string[]) ?? ['push', 'in_app'],
      optedOut: !!p.opted_out_at,
    })
  }
  return out
}

async function resolveSchoolName(db: SupabaseClient): Promise<string> {
  const { data } = await db.from('site_settings').select('value').eq('key', 'branding').maybeSingle()
  return (data?.value as { schoolName?: string } | null)?.schoolName ?? 'School'
}
