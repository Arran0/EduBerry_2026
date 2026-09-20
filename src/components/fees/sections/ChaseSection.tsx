'use client'

// ─────────────────────────────────────────────────────────────────────────────
// Collections.
//
// Every family that owes something, most overdue first. The one question the
// office asks each morning is "who do I chase today", and this answers it
// without a report being run.
//
// Per the school's instruction there is no escalating tone: one respectful
// message, sent more or less often. What changes with lateness is which
// template is used — "due" before the date, "overdue" after — not how sternly
// it is worded.
//
// Reminders skip anyone who has already paid, anyone with no number on file,
// and anyone already reminded today. The result of a send says how many were
// skipped and why, in words, rather than reporting a silent success.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  Bell, CalendarClock, Check, CheckCheck, History, Loader2,
  MessageSquare, PhoneOff, Send, Users,
} from 'lucide-react'
import ModalShell from '@/components/ui/ModalShell'
import { useAcademicYear } from '@/contexts/AcademicYearContext'
import { useFeePermissions } from '@/hooks/useFeePermissions'
import { ADMIN, fmtDate, inr } from '@/components/fees/ui'
import { StatStrip, TabBar } from '@/components/fees/shell'
import NoAccess from '@/components/fees/NoAccess'
import { gradeLabel } from '@/lib/grades'
import { daysBetween, todayIn } from '@/lib/fees/engine/dates'
import {
  fetchUnpaidInvoices, fetchProfileList,
  type InvoiceRow, type ProfileListRow,
} from '@/lib/fees/invoices'
import {
  fetchContactableStudents, fetchReminderLog, fetchReminderSchedules,
  saveReminderSchedule, sendReminders, SKIP_REASONS,
  type ReminderLogRow, type ReminderScheduleRow, type SendRemindersResult,
} from '@/lib/fees/charges'

type Tab = 'chase' | 'log' | 'schedule'

interface Family {
  student: ProfileListRow
  bills: InvoiceRow[]
  owed: number
  /** Days past the oldest unpaid due date; negative means nothing is late yet. */
  daysLate: number
  lastReminded: string | null
  contactable: boolean
}

export default function ChaseSection() {
  const { year } = useAcademicYear()
  const perms = useFeePermissions()
  const [tab, setTab] = useState<Tab>('chase')

  const [invoices, setInvoices] = useState<InvoiceRow[]>([])
  const [people, setPeople] = useState<ProfileListRow[]>([])
  const [log, setLog] = useState<ReminderLogRow[]>([])
  const [schedules, setSchedules] = useState<ReminderScheduleRow[]>([])
  const [contactable, setContactable] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [klass, setKlass] = useState<string>('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState<SendRemindersResult | null>(null)
  const [scheduleFor, setScheduleFor] = useState<string[] | null>(null)

  const showAmounts = !perms.amountsHidden
  const canRemind = perms.can('fees.reminder.send')

  const load = useCallback(async () => {
    if (!year) return
    setLoading(true)
    try {
      const [inv, list, lg, scheds] = await Promise.all([
        fetchUnpaidInvoices(year.id),
        fetchProfileList(year.id),
        fetchReminderLog({ limit: 300 }),
        fetchReminderSchedules(year.id),
      ])
      setInvoices(inv); setPeople(list); setLog(lg); setSchedules(scheds)
      setContactable(await fetchContactableStudents(
        Array.from(new Set(inv.map(i => i.student_id)))))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load collections.')
    } finally {
      setLoading(false)
    }
  }, [year])

  useEffect(() => { void load() }, [load])

  const today = todayIn()

  const families: Family[] = useMemo(() => {
    const byStudent = new Map<string, InvoiceRow[]>()
    invoices.forEach(i => {
      if ((i.balance ?? 0) <= 0 || i.status === 'cancelled') return
      const list = byStudent.get(i.student_id) ?? []
      list.push(i)
      byStudent.set(i.student_id, list)
    })

    const lastByStudent = new Map<string, string>()
    log.forEach(l => {
      if (!l.sent_at) return
      const seen = lastByStudent.get(l.student_id)
      if (!seen || l.sent_at > seen) lastByStudent.set(l.student_id, l.sent_at)
    })

    const out: Family[] = []
    byStudent.forEach((bills, studentId) => {
      const student = people.find(p => p.student_id === studentId)
      if (!student) return
      const oldest = bills.reduce((a, b) => (a.due_date < b.due_date ? a : b))
      out.push({
        student,
        bills,
        owed: bills.reduce((a, b) => a + Number(b.balance ?? 0), 0),
        daysLate: daysBetween(oldest.due_date, today),
        lastReminded: lastByStudent.get(studentId) ?? null,
        contactable: contactable.has(studentId),
      })
    })
    // Most overdue first — the order the office actually works in.
    return out.sort((a, b) => b.daysLate - a.daysLate || b.owed - a.owed)
  }, [invoices, people, log, contactable, today])

  const classes = useMemo(() => {
    const s = new Set<string>()
    families.forEach(f => s.add(`${gradeLabel(f.student.grade)}${f.student.section ?? ''}`))
    return Array.from(s).sort()
  }, [families])

  const shown = useMemo(
    () => (klass ? families.filter(f => `${gradeLabel(f.student.grade)}${f.student.section ?? ''}` === klass) : families),
    [families, klass])

  const totals = useMemo(() => ({
    families: families.length,
    owed: families.reduce((a, f) => a + f.owed, 0),
    late: families.filter(f => f.daysLate > 0).length,
    unreachable: families.filter(f => !f.contactable).length,
  }), [families])

  const billsFor = (studentIds: string[]) =>
    families.filter(f => studentIds.includes(f.student.student_id)).flatMap(f => f.bills.map(b => b.id))

  const remind = async (studentIds: string[]) => {
    const ids = billsFor(studentIds)
    if (ids.length === 0) return
    setSending(true)
    setError(null)
    try {
      const result = await sendReminders(ids, templateFor(families, studentIds, today))
      setSent(result)
      setSelected(new Set())
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Those reminders were not queued.')
    } finally {
      setSending(false)
    }
  }

  if (perms.loading) {
    return <div className="p-10 flex justify-center"><Loader2 className="animate-spin text-[#8C8878]" /></div>
  }
  if (!perms.can('fees.profile.view')) return <NoAccess what="see who owes fees" />

  const allShownSelected = shown.length > 0 && shown.every(f => selected.has(f.student.student_id))

  return (
    <>
      <StatStrip
        loading={loading}
        stats={[
          { label: 'Families owing', value: String(totals.families) },
          { label: 'Outstanding', value: inr(totals.owed, showAmounts),
            tone: totals.owed > 0 ? '#7A6220' : undefined, strong: true },
          { label: 'Past due', value: String(totals.late) },
          { label: 'No number', value: String(totals.unreachable) },
        ]}
      />

      <TabBar<Tab>
        active={tab}
        onChange={setTab}
        tabs={[
          { key: 'chase', label: 'Who to chase', icon: Users },
          { key: 'log', label: 'Reminder log', icon: History },
          { key: 'schedule', label: 'Automatic', icon: CalendarClock },
        ]}
      />

      {error && <div className="p-3 bg-[#FCECEC] border border-[#EFCCCC] text-xs text-[#A93232]">{error}</div>}

      {loading ? (
        <div className="p-10 flex justify-center"><Loader2 className="animate-spin text-[#8C8878]" /></div>
      ) : tab === 'chase' ? (
        <div className={ADMIN.card}>
          <div className="px-4 py-2.5 border-b border-[#F0ECE2] flex flex-wrap items-center gap-2">
            <select value={klass} onChange={e => { setKlass(e.target.value); setSelected(new Set()) }}
                    className="bg-white border border-[#E3DFD3] px-2 py-1.5 text-xs text-[#18181B]
                               focus:outline-none focus:border-[#27272A]">
              <option value="">Every class</option>
              {classes.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <button
              onClick={() => setSelected(allShownSelected
                ? new Set()
                : new Set(shown.filter(f => f.contactable).map(f => f.student.student_id)))}
              className={ADMIN.ghostBtn}>
              {allShownSelected ? 'Clear' : `Select these ${shown.length}`}
            </button>
            <div className="flex-1" />
            {canRemind && (
              <>
                <button onClick={() => setScheduleFor(Array.from(selected))}
                        disabled={selected.size === 0} className={ADMIN.ghostBtn}>
                  <CalendarClock size={13} /> Send later
                </button>
                <button onClick={() => void remind(Array.from(selected))}
                        disabled={sending || selected.size === 0} className={ADMIN.darkBtn}>
                  {sending ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                  Remind {selected.size || ''}
                </button>
              </>
            )}
          </div>

          {shown.length === 0 ? (
            <p className="px-4 py-10 text-sm text-[#8C8878]">
              Nobody owes anything{klass ? ` in ${klass}` : ''}. That is worth saying out loud.
            </p>
          ) : shown.map(f => (
            <div key={f.student.student_id}
                 className="flex flex-wrap items-center gap-3 px-4 py-2.5 border-b border-[#F0ECE2] last:border-0">
              <input type="checkbox" checked={selected.has(f.student.student_id)}
                     disabled={!f.contactable}
                     onChange={e => setSelected(s => {
                       const next = new Set(s)
                       if (e.target.checked) next.add(f.student.student_id)
                       else next.delete(f.student.student_id)
                       return next
                     })} />
              <div className="flex-1 min-w-[190px]">
                <Link href={`/more/fees/students/${f.student.student_id}`}
                      className="text-sm text-[#18181B] hover:underline">
                  {f.student.full_name}
                </Link>
                <div className="text-[11px] text-[#8C8878]">
                  {gradeLabel(f.student.grade)}{f.student.section ?? ''}
                  {' · '}{f.bills.length} bill{f.bills.length === 1 ? '' : 's'}
                  {f.lastReminded
                    ? ` · last reminded ${fmtDate(f.lastReminded.slice(0, 10))}`
                    : ' · never reminded'}
                </div>
              </div>
              {!f.contactable && (
                <span title="No number on file, or opted out"
                      className="inline-flex items-center gap-1 text-[10px] font-bold uppercase
                                 tracking-wider px-2 py-0.5 bg-[#F4F1E7] text-[#6B675A] border border-[#E3DFD3]">
                  <PhoneOff size={10} /> No number
                </span>
              )}
              <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 ${lateChip(f.daysLate)}`}>
                {f.daysLate > 0 ? `${f.daysLate}d late` : f.daysLate === 0 ? 'Due today' : `In ${-f.daysLate}d`}
              </span>
              <span className="text-sm font-semibold text-[#18181B] w-24 text-right">
                {inr(f.owed, showAmounts)}
              </span>
              {canRemind && (
                <button onClick={() => void remind([f.student.student_id])}
                        disabled={sending || !f.contactable}
                        title={f.contactable ? 'Remind this family now' : 'No number on file'}
                        className={ADMIN.ghostBtn}>
                  <Bell size={13} /> Remind
                </button>
              )}
            </div>
          ))}
        </div>
      ) : tab === 'log' ? (
        <ReminderLog rows={log} people={people} showAmounts={showAmounts} />
      ) : (
        <Schedules
          rows={schedules}
          yearId={year?.id ?? ''}
          canEdit={perms.can('fees.settings.manage')}
          onChanged={load}
        />
      )}


      {sent && (
        <ModalShell onClose={() => setSent(null)} sharp size="sm" title="Reminders queued"
                    icon={<MessageSquare size={15} />} iconClassName="bg-[#EAF5EE] text-[#1F6B42]">
          <p className="text-sm text-[#18181B]">
            <strong>{sent.queued}</strong> message{sent.queued === 1 ? '' : 's'} queued
            out of {sent.considered} bill{sent.considered === 1 ? '' : 's'}.
          </p>
          {Object.keys(sent.skipped ?? {}).length > 0 && (
            <ul className="mt-3 space-y-1">
              {Object.entries(sent.skipped).map(([reason, count]) => (
                <li key={reason} className="text-xs text-[#6B675A]">
                  {count} skipped — {SKIP_REASONS[reason] ?? SKIP_REASONS.unknown}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-[11px] text-[#8C8878] leading-relaxed">
            Queued, not yet delivered. The sender picks them up within the minute; the log shows
            delivery and read receipts as WhatsApp reports them.
          </p>
          <div className="flex justify-end mt-4">
            <button onClick={() => setSent(null)} className={`${ADMIN.darkBtn} px-4`}>Done</button>
          </div>
        </ModalShell>
      )}

      {scheduleFor && (
        <SendLaterDialog
          count={scheduleFor.length}
          onClose={() => setScheduleFor(null)}
          onSubmit={async notBefore => {
            const ids = billsFor(scheduleFor)
            const result = await sendReminders(ids, undefined, notBefore)
            setScheduleFor(null)
            setSelected(new Set())
            setSent(result)
            await load()
          }}
        />
      )}
    </>
  )
}


function lateChip(days: number): string {
  if (days > 30) return 'bg-[#FCECEC] text-[#A93232] border border-[#EFCCCC]'
  if (days > 0) return 'bg-[#FAF3DF] text-[#7A6220] border border-[#E7D9AE]'
  return 'bg-[#F4F1E7] text-[#6B675A] border border-[#E3DFD3]'
}

/**
 * Which template a batch should use.
 *
 * Not a tone ladder — the school ruled that out. It is only the difference
 * between a bill that has not fallen due yet and one that has, which the two
 * templates word differently because they are describing different facts.
 */
function templateFor(families: Family[], studentIds: string[], today: string): string {
  void today
  const picked = families.filter(f => studentIds.includes(f.student.student_id))
  const anyOverdue = picked.some(f => f.daysLate > 0)
  return anyOverdue ? 'fee_reminder_overdue' : 'fee_reminder_due'
}

function ReminderLog({
  rows, people, showAmounts,
}: { rows: ReminderLogRow[]; people: ProfileListRow[]; showAmounts: boolean }) {
  const name = (id: string) => people.find(p => p.student_id === id)?.full_name ?? 'Student'
  return (
    <div className={ADMIN.card}>
      <div className="px-4 py-2.5 border-b border-[#F0ECE2]">
        <h3 className={ADMIN.label}>Every reminder sent</h3>
      </div>
      {rows.length === 0 ? (
        <p className="px-4 py-8 text-sm text-[#8C8878]">No reminders have gone out yet.</p>
      ) : rows.map(r => (
        <div key={r.id}
             className="flex flex-wrap items-center gap-3 px-4 py-2.5 border-b border-[#F0ECE2] last:border-0">
          <div className="flex-1 min-w-[190px]">
            <div className="text-sm text-[#18181B]">{name(r.student_id)}</div>
            <div className="text-[11px] text-[#8C8878]">
              {fmtDate((r.sent_at ?? r.created_at).slice(0, 10))}
              {r.msisdn ? ` · ${maskNumber(r.msisdn)}` : ''}
              {r.balance_then !== null ? ` · owed ${inr(r.balance_then, showAmounts)} then` : ''}
            </div>
          </div>
          {r.paid_at && (
            <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5
                             bg-[#EAF5EE] text-[#1F6B42] border border-[#C6E3D2]">
              Paid after
            </span>
          )}
          <DeliveryState row={r} />
        </div>
      ))}
    </div>
  )
}

/** WhatsApp reports sent, then delivered, then read. Show the furthest reached. */
function DeliveryState({ row }: { row: ReminderLogRow }) {
  if (row.failed_at) {
    return <span className="inline-flex items-center gap-1 text-[11px] text-[#A93232]">Failed</span>
  }
  if (row.read_at) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-[#3A5490]">
        <CheckCheck size={12} /> Read
      </span>
    )
  }
  if (row.delivered_at) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-[#6B675A]">
        <CheckCheck size={12} /> Delivered
      </span>
    )
  }
  if (row.sent_at) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-[#8C8878]">
        <Check size={12} /> Sent
      </span>
    )
  }
  return <span className="text-[11px] text-[#8C8878]">Queued</span>
}

/** Last four digits only — the log is read by more people than the profile is. */
function maskNumber(msisdn: string): string {
  return msisdn.length <= 4 ? msisdn : `••••${msisdn.slice(-4)}`
}

// ── Automatic reminders ───────────────────────────────────────────────────
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function Schedules({
  rows, yearId, canEdit, onChanged,
}: {
  rows: ReminderScheduleRow[]
  yearId: string
  canEdit: boolean
  onChanged: () => Promise<void> | void
}) {
  const [busy, setBusy] = useState<string | null>(null)

  const toggle = async (row: ReminderScheduleRow) => {
    setBusy(row.id)
    try {
      await saveReminderSchedule({ ...row, enabled: !row.enabled })
      await onChanged()
    } finally { setBusy(null) }
  }

  const create = async () => {
    setBusy('new')
    try {
      await saveReminderSchedule({
        academic_year_id: yearId,
        name: 'Fee reminders',
        enabled: false,
        offsets: [-3, 0, 7, 14],
        send_at: '10:00',
        channels: ['whatsapp'],
        skip_if_paid: true,
        quiet_days: [0],
      })
      await onChanged()
    } finally { setBusy(null) }
  }

  return (
    <div className={ADMIN.card}>
      <div className="px-4 py-2.5 border-b border-[#F0ECE2] flex items-center justify-between">
        <h3 className={ADMIN.label}>Automatic reminders</h3>
        {canEdit && rows.length === 0 && (
          <button onClick={() => void create()} disabled={busy === 'new'} className={ADMIN.ghostBtn}>
            {busy === 'new' && <Loader2 size={13} className="animate-spin" />} Set one up
          </button>
        )}
      </div>
      {rows.length === 0 ? (
        <p className="px-4 py-8 text-sm text-[#8C8878]">
          No schedule. Reminders only go out when somebody presses Remind.
        </p>
      ) : rows.map(r => (
        <div key={r.id} className="px-4 py-3 border-b border-[#F0ECE2] last:border-0">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex-1 min-w-[220px]">
              <div className="text-sm font-semibold text-[#18181B]">{r.name}</div>
              <p className="text-[11px] text-[#8C8878] mt-0.5">
                {describeOffsets(r.offsets)} · at {r.send_at.slice(0, 5)}
                {r.quiet_days.length > 0
                  ? ` · never on ${r.quiet_days.map(d => DAY_NAMES[d] ?? d).join(', ')}`
                  : ''}
                {r.skip_if_paid ? ' · skips anyone who has paid' : ''}
              </p>
            </div>
            <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 ${
              r.enabled
                ? 'bg-[#EAF5EE] text-[#1F6B42] border border-[#C6E3D2]'
                : 'bg-[#F4F1E7] text-[#6B675A] border border-[#E3DFD3]'}`}>
              {r.enabled ? 'On' : 'Off'}
            </span>
            {canEdit && (
              <button onClick={() => void toggle(r)} disabled={busy === r.id}
                      className={r.enabled ? ADMIN.ghostBtn : ADMIN.darkBtn}>
                {busy === r.id && <Loader2 size={13} className="animate-spin" />}
                {r.enabled ? 'Switch off' : 'Switch on'}
              </button>
            )}
          </div>
        </div>
      ))}
      <p className="px-4 py-2.5 text-[11px] text-[#8C8878] border-t border-[#F0ECE2] leading-relaxed">
        One respectful message, sent on each of these days. It does not get sterner the longer a
        bill is unpaid — a family in difficulty is not helped by a harsher wording, and the school
        asked for it that way.
      </p>
    </div>
  )
}

function describeOffsets(offsets: number[]): string {
  if (offsets.length === 0) return 'Never'
  return offsets.map(d =>
    d < 0 ? `${-d} days before` : d === 0 ? 'on the due date' : `${d} days after`).join(', ')
}

// ── Send later ────────────────────────────────────────────────────────────
function SendLaterDialog({
  count, onClose, onSubmit,
}: {
  count: number
  onClose: () => void
  onSubmit: (notBefore: string) => Promise<void>
}) {
  const [when, setWhen] = useState(() => {
    // Tomorrow at ten, in the browser's own zone — the office picks a wall
    // clock time, and the input is a local one.
    const d = new Date()
    d.setDate(d.getDate() + 1)
    d.setHours(10, 0, 0, 0)
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  return (
    <ModalShell onClose={onClose} sharp size="sm" title="Send these later"
                icon={<CalendarClock size={15} />} iconClassName="bg-[#FAF3DF] text-[#7A6220]">
      <p className="text-sm text-[#6B675A] leading-relaxed">
        {count} famil{count === 1 ? 'y' : 'ies'}. The messages are queued now and held until this
        time; anyone who pays in between is skipped when the queue runs.
      </p>
      <input type="datetime-local" value={when} onChange={e => setWhen(e.target.value)}
             className={`${ADMIN.inputPlain} mt-3`} />
      {error && <p className="mt-2 text-xs text-[#A93232]">{error}</p>}
      <div className="flex items-center justify-end gap-2 mt-4">
        <button onClick={onClose} className={ADMIN.ghostBtn}>Cancel</button>
        <button
          onClick={async () => {
            setBusy(true); setError(null)
            try { await onSubmit(new Date(when).toISOString()) }
            catch (e) { setError(e instanceof Error ? e.message : 'Could not queue those.') }
            finally { setBusy(false) }
          }}
          disabled={busy} className={`${ADMIN.darkBtn} px-4`}>
          {busy && <Loader2 size={13} className="animate-spin" />} Queue them
        </button>
      </div>
    </ModalShell>
  )
}

