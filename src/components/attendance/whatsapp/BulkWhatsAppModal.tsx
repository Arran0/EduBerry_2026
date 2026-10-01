'use client'

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle, CalendarClock, Check, CheckCheck, History, Info, Loader2,
  MessageCircle, PhoneOff, Send, Square, X,
} from 'lucide-react'
import ModalShell from '@/components/ui/ModalShell'
import Avatar from '@/components/Avatar'
import { DateToggler } from '@/components/workspace/ui'
import { gradeLabel } from '@/lib/grades'
import type { Homeroom } from '@/lib/homerooms'
import { ATTENDANCE_STATUS_LABELS, fetchAttendanceTimezone, type AttendanceStatus } from '@/lib/attendance'
import {
  MESSAGE_KIND_LABELS, MESSAGE_KIND_PILL, TEMPLATE_ORDER,
  describeSkips, fetchAttendanceTemplates, fetchMessageCandidates, fetchNotifyAccess,
  fetchWhatsAppReady, isApprovedLeaveKind, queueAttendanceMessages, renderTemplate,
  templateForKind,
  type AttendanceTemplate, type BulkQueueResult, type MessageCandidate, type MessageKind,
} from '@/lib/attendanceWhatsApp'
import StudentTypeahead from './StudentTypeahead'

const AutomationSheet = React.lazy(() => import('./AutomationSheet'))
const HistorySheet = React.lazy(() => import('./HistorySheet'))

/**
 * Bulk WhatsApp from the student attendance report.
 *
 * The report says who was absent. The only thing an office does with that
 * answer is tell the parents, and until now that meant forty phone calls or a
 * WhatsApp group that leaks every family's number to every other family. This
 * is the same job in one screen.
 *
 * Three decisions worth defending, because each one is the obvious thing done
 * differently:
 *
 *  - The list is built in the database, not filtered in the browser, and every
 *    row arrives already knowing whether a message can reach that family. A
 *    list that looks sendable and then isn't is worse than no list: the office
 *    believes the parents were told.
 *
 *  - The default template is "match each student's own day". One press then
 *    tells an absent family they were absent and a family whose medical leave
 *    was approved that it is on record — rather than sending forty families the
 *    same sentence, six of which it is not true for.
 *
 *  - Nothing is sent from here. Everything is queued on the existing outbox and
 *    a worker sends it, so "message this whole class" is one fast request
 *    instead of forty the user watches, and a failure is retried rather than
 *    lost.
 */

/** The report's own three buckets, reused so the popup matches what you clicked. */
type Preset = 'absent' | 'late' | 'irregular' | 'all'

/** How many candidates one load pulls. A whole-school day of absences is well
 *  inside this; the list says so when it is not, because a quietly truncated
 *  list is a set of families the office believes it has contacted. */
const CANDIDATE_LIMIT = 500

const PRESETS: { key: Preset; label: string; statuses: AttendanceStatus[] }[] = [
  { key: 'absent',    label: 'Absent',    statuses: ['absent', 'on_leave'] },
  { key: 'late',      label: 'Late',      statuses: ['late'] },
  { key: 'irregular', label: 'Irregular', statuses: ['half_day', 'excused', 'on_duty'] },
  { key: 'all',       label: 'Everyone not present', statuses: [] },
]

export interface BulkWhatsAppModalProps {
  /** The date the report is showing. */
  date: string
  todayStr: string
  /** Homerooms the viewer may pick from — their own, for a class teacher. */
  homerooms: Homeroom[]
  /** Set when the report is already scoped to one homeroom, so the popup opens
   *  on the same class rather than the whole school. */
  initialHomeroomId?: string | null
  /** Which report tab the button was pressed from. */
  initialPreset?: Preset
  onClose: () => void
}

export default function BulkWhatsAppModal({
  date: initialDate, todayStr, homerooms, initialHomeroomId, initialPreset = 'absent', onClose,
}: BulkWhatsAppModalProps) {
  const [date, setDate] = useState(initialDate)
  const [preset, setPreset] = useState<Preset>(initialPreset)
  const [grade, setGrade] = useState<number | null>(null)
  const [section, setSection] = useState<string | null>(null)
  const [homeroomId, setHomeroomId] = useState<string | null>(initialHomeroomId ?? null)

  const [rows, setRows] = useState<MessageCandidate[]>([])
  const [added, setAdded] = useState<MessageCandidate[]>([])
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [templates, setTemplates] = useState<AttendanceTemplate[]>([])
  /** '' means "match each student's own day". */
  const [templateKey, setTemplateKey] = useState('')

  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<BulkQueueResult | null>(null)
  const [sheet, setSheet] = useState<'automation' | 'history' | null>(null)

  const [isManager, setIsManager] = useState(false)
  const [waReady, setWaReady] = useState<boolean | null>(null)
  const [timezone, setTimezone] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const [access, tpls, ready, tz] = await Promise.all([
        fetchNotifyAccess(), fetchAttendanceTemplates(), fetchWhatsAppReady(),
        fetchAttendanceTimezone(),
      ])
      if (cancelled) return
      setIsManager(access.isManager)
      setTemplates(tpls)
      setWaReady(ready)
      setTimezone(tz)
    })()
    return () => { cancelled = true }
  }, [])

  const statuses = useMemo(
    () => PRESETS.find(p => p.key === preset)?.statuses ?? [],
    [preset])

  const grades = useMemo(
    () => [...new Set(homerooms.map(h => h.grade).filter((g): g is number => g != null))].sort((a, b) => a - b),
    [homerooms])
  const sections = useMemo(
    () => [...new Set(homerooms.map(h => h.section).filter((s): s is string => !!s))].sort(),
    [homerooms])
  // Null means "every class the viewer may see", not "every class" — the RPC
  // scopes a class teacher to their own homerooms itself, so there is no need
  // to enumerate them here (and no way for a tampered request to widen it).
  const homeroomIds = useMemo(() => (homeroomId ? [homeroomId] : null), [homeroomId])

  const load = useCallback(async () => {
    setLoading(true); setError(null); setResult(null)
    try {
      const data = await fetchMessageCandidates({
        date,
        homeroomIds,
        grades: homeroomId ? null : grade != null ? [grade] : null,
        sections: homeroomId ? null : section ? [section] : null,
        statuses,
        limit: CANDIDATE_LIMIT,
      })
      setRows(data)
      // Pre-tick everyone who can actually be reached and has not been messaged
      // about this day already — the common case is "send to all of these", and
      // the exceptions are the rows that need a decision.
      setPicked(new Set(
        data.filter(r => r.contactable && !r.already_sent && r.kind).map(r => r.student_id)))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load that list.')
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [date, homeroomIds, homeroomId, grade, section, statuses])

  useEffect(() => { void load() }, [load])
  // A hand-added student belongs to the date they were added for.
  useEffect(() => { setAdded([]) }, [date])

  /** The filtered list plus anything searched for by hand, deduped. */
  const list = useMemo(() => {
    const seen = new Set(rows.map(r => r.student_id))
    return [...added.filter(a => !seen.has(a.student_id)), ...rows]
  }, [rows, added])

  const listIds = useMemo(() => new Set(list.map(r => r.student_id)), [list])

  const sendable = useMemo(
    () => list.filter(r => picked.has(r.student_id) && r.contactable && r.kind),
    [list, picked])

  const unreachable = useMemo(() => list.filter(r => !r.contactable).length, [list])
  const approvedLeave = useMemo(
    () => list.filter(r => isApprovedLeaveKind(r.kind)).length, [list])

  const toggle = (id: string) =>
    setPicked(p => {
      const next = new Set(p)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })

  const allPickable = useMemo(
    () => list.filter(r => r.contactable && r.kind).map(r => r.student_id),
    [list])
  const allPicked = allPickable.length > 0 && allPickable.every(id => picked.has(id))

  const addStudent = (student: MessageCandidate) => {
    setAdded(a => (a.some(x => x.student_id === student.student_id) ? a : [student, ...a]))
    if (student.contactable && student.kind) {
      setPicked(p => new Set(p).add(student.student_id))
    }
  }

  const send = async () => {
    if (sendable.length === 0) return
    setSending(true); setError(null)
    try {
      const r = await queueAttendanceMessages(
        sendable.map(s => s.student_id), date, templateKey || null)
      setResult(r)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Those messages were not queued.')
    } finally {
      setSending(false)
    }
  }

  /** Preview, drawn from the first student who would actually be sent to. */
  const preview = useMemo(() => {
    const target = sendable[0] ?? list.find(r => r.kind) ?? null
    if (!target) return null
    const key = templateKey || target.template_key
    const tpl = templates.find(t => t.key === key)
    if (!tpl) return null
    return {
      forName: target.full_name,
      body: renderTemplate(tpl.body_template, {
        student: target.full_name,
        class: target.homeroom_name
          || [target.grade != null ? gradeLabel(target.grade) : '', target.section ?? '']
              .filter(Boolean).join(' ')
          || 'class',
        date: new Date(date + 'T12:00:00').toLocaleDateString('en-GB', {
          day: '2-digit', month: 'short', year: 'numeric',
        }),
      }),
      inactive: !tpl.active,
    }
  }, [sendable, list, templateKey, templates, date])

  /** Which templates the current list actually needs, for the Auto option's blurb. */
  const kindsInList = useMemo(() => {
    const set = new Set<MessageKind>()
    list.forEach(r => { if (r.kind && picked.has(r.student_id)) set.add(r.kind) })
    return [...set]
  }, [list, picked])

  return (
    <>
      <ModalShell
        onClose={onClose}
        size="2xl"
        title="WhatsApp parents"
        subtitle="Attendance notices to the parent's number on file"
        icon={<MessageCircle size={16} />}
        iconClassName="bg-emerald-100 text-emerald-600"
        minHClass="sm:min-h-[34rem]"
        headerActions={
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setSheet('history')}
              title="What has been sent"
              className="inline-flex items-center gap-1 px-2 py-1.5 text-xs font-medium text-[#52525B] border border-[#D4D4D8] rounded-md hover:bg-[#F5F5F5]"
            >
              <History size={13} /> <span className="hidden sm:inline">History</span>
            </button>
            <button
              onClick={() => setSheet('automation')}
              title="Send this automatically every day"
              className="inline-flex items-center gap-1 px-2 py-1.5 text-xs font-medium text-[#52525B] border border-[#D4D4D8] rounded-md hover:bg-[#F5F5F5]"
            >
              <CalendarClock size={13} /> <span className="hidden sm:inline">Automate</span>
            </button>
          </div>
        }
        footer={
          <div className="flex items-center justify-between gap-3 w-full">
            <p className="text-[11px] text-[#71717A] min-w-0">
              {sendable.length > 0
                ? <><strong className="text-[#18181B]">{sendable.length}</strong> will be messaged</>
                : 'Nobody is selected who can be messaged'}
              {unreachable > 0 && <span className="text-amber-600"> · {unreachable} with no number</span>}
            </p>
            <button
              onClick={() => void send()}
              disabled={sending || sendable.length === 0}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50 flex-shrink-0"
            >
              {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
              Send {sendable.length > 0 ? sendable.length : ''}
            </button>
          </div>
        }
      >
        <div className="space-y-3">
          {waReady === false && (
            <Notice tone="amber" icon={<AlertTriangle size={14} />}>
              WhatsApp is not connected yet, so nothing will actually leave the building.
              Messages you send now stay queued and go out the moment an administrator finishes
              the WhatsApp Business setup.
            </Notice>
          )}

          {/* ── Filters ── */}
          <div className="flex flex-wrap items-center gap-2">
            <DateToggler value={date} onChange={setDate} max={todayStr} todayStr={todayStr} size="sm" />
            <div className="inline-flex items-stretch rounded-md overflow-hidden border border-[#D4D4D8]">
              {PRESETS.map(p => (
                <button
                  key={p.key}
                  onClick={() => setPreset(p.key)}
                  aria-pressed={preset === p.key}
                  className={`px-2.5 py-1.5 text-xs font-medium transition-colors border-r border-[#E4E4E7] last:border-r-0 ${
                    preset === p.key ? 'bg-[#27272A] text-white' : 'bg-white text-[#52525B] hover:bg-[#F5F5F5]'
                  }`}
                >
                  {p.key === 'all' ? 'All' : p.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              value={homeroomId ?? ''}
              onChange={e => { setHomeroomId(e.target.value || null) }}
              className="px-2.5 py-1.5 text-xs border border-[#D4D4D8] bg-white rounded-md focus:outline-none focus:border-[#27272A]"
            >
              <option value="">All classes</option>
              {homerooms.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
            </select>
            <select
              value={grade ?? ''}
              onChange={e => setGrade(e.target.value ? Number(e.target.value) : null)}
              disabled={!!homeroomId}
              className="px-2.5 py-1.5 text-xs border border-[#D4D4D8] bg-white rounded-md disabled:opacity-50 focus:outline-none focus:border-[#27272A]"
            >
              <option value="">All grades</option>
              {grades.map(g => <option key={g} value={g}>{gradeLabel(g)}</option>)}
            </select>
            <select
              value={section ?? ''}
              onChange={e => setSection(e.target.value || null)}
              disabled={!!homeroomId}
              className="px-2.5 py-1.5 text-xs border border-[#D4D4D8] bg-white rounded-md disabled:opacity-50 focus:outline-none focus:border-[#27272A]"
            >
              <option value="">All sections</option>
              {sections.map(s => <option key={s} value={s}>Section {s}</option>)}
            </select>
            {(grade != null || section || homeroomId) && (
              <button
                onClick={() => { setGrade(null); setSection(null); setHomeroomId(null) }}
                className="inline-flex items-center gap-1 px-2 py-1.5 text-xs text-[#71717A] hover:text-[#18181B]"
              >
                <X size={12} /> Clear
              </button>
            )}
          </div>

          {/* ── Add by hand ── */}
          <StudentTypeahead date={date} onPick={addStudent} excludeIds={listIds} />

          {/* ── Result of the last send ── */}
          {result && (
            <Notice tone={result.queued > 0 ? 'emerald' : 'amber'} icon={<CheckCheck size={14} />}>
              <strong>{result.queued}</strong>{' '}
              {result.queued === 1 ? 'message queued' : 'messages queued'}
              {describeSkips(result.skipped).length > 0 && (
                <> — {describeSkips(result.skipped).join(', ')}</>
              )}
              {result.queued > 0 && '. They go out within the minute; History shows delivery.'}
            </Notice>
          )}

          {error && (
            <Notice tone="rose" icon={<AlertTriangle size={14} />}>{error}</Notice>
          )}

          {/* ── Template ── */}
          <div className="border border-[#E4E4E7] rounded-lg overflow-hidden">
            <div className="px-3 py-2 bg-[#FAFAF9] border-b border-[#E4E4E7] flex items-center justify-between gap-2">
              <span className="text-[10px] font-bold uppercase tracking-widest text-[#525252]">Message</span>
              {approvedLeave > 0 && (
                <span className="text-[11px] text-[#71717A]">
                  {approvedLeave} on approved leave or permit in this list
                </span>
              )}
            </div>
            <div className="p-3 space-y-2">
              <select
                value={templateKey}
                onChange={e => setTemplateKey(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-[#D4D4D8] bg-white rounded-md focus:outline-none focus:border-[#27272A]"
              >
                <option value="">
                  Match each student’s own day (recommended)
                </option>
                {TEMPLATE_ORDER.map(kind => {
                  const key = templateForKind(kind)
                  const tpl = templates.find(t => t.key === key)
                  return (
                    <option key={kind} value={key} disabled={!tpl}>
                      Send everyone: {MESSAGE_KIND_LABELS[kind]}
                      {!tpl ? ' (not registered)' : tpl.active ? '' : ' (switched off)'}
                    </option>
                  )
                })}
              </select>

              {!templateKey && kindsInList.length > 0 && (
                <p className="text-[11px] text-[#71717A]">
                  This list will send {kindsInList.length === 1 ? 'one message' : `${kindsInList.length} different messages`}:{' '}
                  {kindsInList.map(k => MESSAGE_KIND_LABELS[k]).join(', ')}.
                </p>
              )}

              {templateKey && approvedLeave > 0 && (
                <p className="text-[11px] text-amber-600 flex items-start gap-1.5">
                  <Info size={12} className="mt-0.5 flex-shrink-0" />
                  {approvedLeave} of these students have an approved leave or permit for this day.
                  Forcing one message means telling them something that is not true of their day —
                  “Match each student’s own day” sends each family the right one.
                </p>
              )}

              {preview && (
                <div className="bg-[#E7FFDB] border border-[#C6EFB4] rounded-lg px-3 py-2">
                  <p className="text-[10px] font-semibold text-[#4F7A3C] uppercase tracking-wider mb-1">
                    Preview · as {preview.forName}’s parent will read it
                  </p>
                  <p className="text-[13px] text-[#1F2D16] leading-relaxed whitespace-pre-line">
                    {preview.body}
                  </p>
                  {preview.inactive && (
                    <p className="text-[11px] text-rose-600 mt-1.5">
                      This message is switched off, so it will not be sent.
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* ── The list ── */}
          <div>
            <div className="flex items-center justify-between gap-2 mb-2">
              <button
                onClick={() => setPicked(allPicked ? new Set() : new Set(allPickable))}
                disabled={allPickable.length === 0}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-[#52525B] hover:text-[#18181B] disabled:opacity-40"
              >
                {allPicked ? <Square size={13} /> : <CheckCheck size={13} />}
                {allPicked ? 'Clear all' : `Select all ${allPickable.length}`}
              </button>
              <span className="text-[11px] text-[#A1A1AA]">
                {loading ? 'Loading…' : `${list.length} in the list`}
              </span>
            </div>

            {!loading && rows.length >= CANDIDATE_LIMIT && (
              <p className="mb-2 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2.5 py-1.5">
                Showing the first {CANDIDATE_LIMIT}. Narrow by class, grade or section to see and
                send to the rest — the list below is not everybody.
              </p>
            )}

            {loading ? (
              <div className="border border-[#E4E4E7] divide-y divide-[#F0F0EF] rounded-lg overflow-hidden">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-2.5 px-3 py-2">
                    <div className="skeleton w-4 h-4 rounded" />
                    <div className="skeleton w-6 h-6 rounded-full" />
                    <div className="skeleton h-2.5 w-1/3 rounded" />
                  </div>
                ))}
              </div>
            ) : list.length === 0 ? (
              <p className="text-sm text-[#71717A] border border-[#E4E4E7] bg-[#FAFAF9] px-3 py-3 rounded-lg">
                Nobody matches those filters for this date. Search above to add a student by name.
              </p>
            ) : (
              <div className="border border-[#E4E4E7] divide-y divide-[#F0F0EF] rounded-lg overflow-hidden max-h-80 overflow-y-auto">
                {list.map(row => (
                  <CandidateRow
                    key={row.student_id}
                    row={row}
                    checked={picked.has(row.student_id)}
                    onToggle={() => toggle(row.student_id)}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </ModalShell>

      {sheet === 'automation' && (
        <React.Suspense fallback={null}>
          <AutomationSheet
            homerooms={homerooms}
            canEdit={isManager}
            timezone={timezone}
            onClose={() => setSheet(null)}
          />
        </React.Suspense>
      )}
      {sheet === 'history' && (
        <React.Suspense fallback={null}>
          <HistorySheet date={date} todayStr={todayStr} onClose={() => setSheet(null)} />
        </React.Suspense>
      )}
    </>
  )
}

// ── One row of the bulk list ────────────────────────────────────────────────

const CandidateRow = React.memo(function CandidateRow({
  row, checked, onToggle,
}: {
  row: MessageCandidate
  checked: boolean
  onToggle: () => void
}) {
  // A student with no number, or an opt-out, or no attendance mark cannot be
  // messaged. Disabled rather than hidden: "why is this family not on the list"
  // is exactly the question the office needs answered on screen.
  const blocked = !row.contactable || !row.kind
  const klass = row.homeroom_name
    || [row.grade != null ? gradeLabel(row.grade) : '', row.section ?? ''].filter(Boolean).join(' ')

  const note = !row.kind
    ? (row.status === 'present' ? 'marked present' : 'no attendance marked')
    : row.opted_out ? 'replied STOP — opted out'
    : !row.contactable ? 'no number on file'
    : row.already_sent ? 'already messaged for this day'
    : row.msisdn_tail ? `••••••${row.msisdn_tail}` : null

  return (
    <label
      className={`flex items-center gap-2.5 px-2.5 sm:px-3 py-2 transition-colors ${
        blocked ? 'bg-[#FAFAF9] cursor-default' : 'bg-white hover:bg-[#FAFAF9] cursor-pointer'
      }`}
    >
      <input
        type="checkbox"
        checked={checked && !blocked}
        onChange={onToggle}
        disabled={blocked}
        className="w-4 h-4 accent-emerald-600 flex-shrink-0 disabled:opacity-40"
      />
      <Avatar
        avatarUrl={row.avatar_url} name={row.full_name} email={row.email}
        size={24} userId={row.student_id}
      />
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-medium truncate ${blocked ? 'text-[#A1A1AA]' : 'text-[#18181B]'}`}>
          {row.full_name}
        </p>
        <p className="text-[11px] text-[#A1A1AA] truncate">
          {[klass, note].filter(Boolean).join(' · ')}
        </p>
      </div>
      {row.opted_out && <PhoneOff size={13} className="text-rose-400 flex-shrink-0" />}
      {row.already_sent && !row.opted_out && <Check size={13} className="text-emerald-500 flex-shrink-0" />}
      {row.kind && (
        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border flex-shrink-0 ${MESSAGE_KIND_PILL[row.kind]}`}>
          {MESSAGE_KIND_LABELS[row.kind]}
        </span>
      )}
      {!row.kind && row.status && (
        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full border bg-slate-100 text-slate-500 border-slate-200 flex-shrink-0">
          {ATTENDANCE_STATUS_LABELS[row.status] ?? row.status}
        </span>
      )}
    </label>
  )
})

// ── Shared notice strip ─────────────────────────────────────────────────────

const NOTICE_TONES = {
  amber:   'bg-amber-50 border-amber-200 text-amber-800',
  emerald: 'bg-emerald-50 border-emerald-200 text-emerald-800',
  rose:    'bg-rose-50 border-rose-200 text-rose-700',
} as const

function Notice({
  tone, icon, children,
}: {
  tone: keyof typeof NOTICE_TONES
  icon: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className={`flex items-start gap-2 border text-sm px-3 py-2.5 rounded-lg ${NOTICE_TONES[tone]}`}>
      <span className="mt-0.5 flex-shrink-0">{icon}</span>
      <span className="min-w-0">{children}</span>
    </div>
  )
}
