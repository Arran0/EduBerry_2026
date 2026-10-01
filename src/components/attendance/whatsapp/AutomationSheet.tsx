'use client'

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle, CalendarClock, Check, Clock, Loader2, Plus, Power, Trash2,
} from 'lucide-react'
import ModalShell from '@/components/ui/ModalShell'
import { gradeLabel } from '@/lib/grades'
import type { Homeroom } from '@/lib/homerooms'
import { ATTENDANCE_STATUS_LABELS, type AttendanceStatus } from '@/lib/attendance'
import {
  MESSAGE_KIND_LABELS, TEMPLATE_ORDER, deleteNotifySchedule, describeSkips,
  fetchNotifySchedules, saveNotifySchedule, setNotifyScheduleEnabled,
  templateForKind, type NotifySchedule,
} from '@/lib/attendanceWhatsApp'

/**
 * The automatic morning run.
 *
 * "Every day at 10:30, every class, absentees' parents" is the whole point of
 * this screen, and it is the default a new schedule opens on — a school should
 * be able to switch that on without reading anything.
 *
 * Three things here are not configurable and should not be:
 *
 *   - the message goes to the parent's number, never the student's
 *   - a family who replied STOP is never messaged, whatever the schedule says
 *   - a double run cannot happen: the tick records the day it ran, and a
 *     schedule that has already run today is skipped until tomorrow
 *
 * Times are the school's wall clock (site_settings.attendance_config →
 * timezone), the same zone the check-in cutoffs use. The browser's zone is not
 * consulted, so a principal travelling abroad does not move the morning
 * message to the middle of the night at home.
 */

const STATUS_CHOICES: AttendanceStatus[] = ['absent', 'late', 'half_day', 'on_leave', 'on_duty', 'excused']
const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

interface Draft {
  id?: string
  name: string
  enabled: boolean
  statuses: AttendanceStatus[]
  homeroom_ids: string[] | null
  grades: number[] | null
  sections: string[] | null
  send_at: string
  quiet_days: number[]
  template_key: string | null
  skip_approved_leave: boolean
}

/** What a school almost always wants, so "New" is one press from done. */
const NEW_DRAFT: Draft = {
  name: 'Daily absentee notice',
  enabled: true,
  statuses: ['absent'],
  homeroom_ids: null,
  grades: null,
  sections: null,
  send_at: '10:30',
  // Sunday off. A school with no Sunday sheet would otherwise burn a run on
  // nothing every week.
  quiet_days: [0],
  template_key: null,
  skip_approved_leave: true,
}

export default function AutomationSheet({
  homerooms, canEdit, timezone, onClose,
}: {
  homerooms: Homeroom[]
  /** Only managers may change what the whole school is messaged automatically. */
  canEdit: boolean
  timezone: string | null
  onClose: () => void
}) {
  const [rows, setRows] = useState<NotifySchedule[]>([])
  const [loading, setLoading] = useState(true)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [saving, setSaving] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setRows(await fetchNotifySchedules())
    setLoading(false)
  }, [])

  useEffect(() => { void load() }, [load])

  const grades = useMemo(
    () => [...new Set(homerooms.map(h => h.grade).filter((g): g is number => g != null))].sort((a, b) => a - b),
    [homerooms])
  const sections = useMemo(
    () => [...new Set(homerooms.map(h => h.section).filter((s): s is string => !!s))].sort(),
    [homerooms])

  const save = async () => {
    if (!draft) return
    setSaving(true); setError(null)
    try {
      await saveNotifySchedule(draft)
      setDraft(null)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save that schedule.')
    } finally {
      setSaving(false)
    }
  }

  const toggle = async (row: NotifySchedule) => {
    setBusyId(row.id); setError(null)
    try {
      await setNotifyScheduleEnabled(row.id, !row.enabled)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not change that schedule.')
    } finally {
      setBusyId(null)
    }
  }

  const remove = async (row: NotifySchedule) => {
    setBusyId(row.id); setError(null)
    try {
      await deleteNotifySchedule(row.id)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete that schedule.')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <ModalShell
      onClose={onClose}
      size="xl"
      zClass="z-[210]"
      title="Automatic messages"
      subtitle={timezone ? `Times are ${timezone} — the school's clock` : 'Times are the school’s clock'}
      icon={<CalendarClock size={16} />}
      iconClassName="bg-violet-100 text-violet-600"
      minHClass="sm:min-h-[26rem]"
      footer={
        draft ? (
          <div className="flex items-center gap-2">
            <button
              onClick={() => void save()}
              disabled={saving}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-semibold bg-violet-600 text-white rounded-lg hover:bg-violet-700 disabled:opacity-60"
            >
              {saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
              {draft.id ? 'Save changes' : 'Create schedule'}
            </button>
            <button
              onClick={() => { setDraft(null); setError(null) }}
              className="px-3 py-2 text-sm font-medium text-[#52525B] border border-[#D4D4D8] rounded-lg hover:bg-[#F5F5F5]"
            >
              Cancel
            </button>
          </div>
        ) : canEdit ? (
          <button
            onClick={() => setDraft({ ...NEW_DRAFT })}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-semibold bg-violet-600 text-white rounded-lg hover:bg-violet-700"
          >
            <Plus size={14} /> New schedule
          </button>
        ) : null
      }
    >
      {error && (
        <div className="mb-3 flex items-start gap-2 bg-rose-50 border border-rose-200 text-rose-700 text-sm px-3 py-2.5 rounded-lg">
          <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" /> <span>{error}</span>
        </div>
      )}

      {draft ? (
        <DraftForm
          draft={draft} setDraft={setDraft}
          homerooms={homerooms} grades={grades} sections={sections}
        />
      ) : loading ? (
        <div className="py-14 flex justify-center"><Loader2 className="animate-spin text-[#A1A1AA]" /></div>
      ) : rows.length === 0 ? (
        <div className="py-12 text-center px-6">
          <div className="w-14 h-14 rounded-2xl bg-slate-100 flex items-center justify-center mx-auto mb-3">
            <Clock size={24} className="text-slate-300" />
          </div>
          <p className="text-sm font-semibold text-[#52525B] mb-1">Nothing runs automatically yet</p>
          <p className="text-xs text-[#A1A1AA] max-w-xs mx-auto">
            {canEdit
              ? 'A new schedule starts as “every day at 10:30, every class, absentees only” — switch it on and nobody has to remember.'
              : 'Ask an administrator to set one up.'}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map(row => (
            <ScheduleRow
              key={row.id}
              row={row}
              homerooms={homerooms}
              canEdit={canEdit}
              busy={busyId === row.id}
              onToggle={() => void toggle(row)}
              onEdit={() => setDraft({
                id: row.id,
                name: row.name,
                enabled: row.enabled,
                statuses: row.statuses,
                homeroom_ids: row.homeroom_ids,
                grades: row.grades,
                sections: row.sections,
                send_at: row.send_at.slice(0, 5),
                quiet_days: row.quiet_days ?? [],
                template_key: row.template_key,
                skip_approved_leave: row.skip_approved_leave,
              })}
              onDelete={() => void remove(row)}
            />
          ))}
        </div>
      )}
    </ModalShell>
  )
}

// ── One saved schedule ──────────────────────────────────────────────────────

function ScheduleRow({
  row, homerooms, canEdit, busy, onToggle, onEdit, onDelete,
}: {
  row: NotifySchedule
  homerooms: Homeroom[]
  canEdit: boolean
  busy: boolean
  onToggle: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  const [confirming, setConfirming] = useState(false)

  const scope = useMemo(() => {
    if (row.homeroom_ids?.length) {
      const names = row.homeroom_ids
        .map(id => homerooms.find(h => h.id === id)?.name)
        .filter(Boolean)
      return names.length > 0 ? names.join(', ') : `${row.homeroom_ids.length} homerooms`
    }
    const parts: string[] = []
    if (row.grades?.length) parts.push(row.grades.map(g => gradeLabel(g)).join(', '))
    if (row.sections?.length) parts.push(`Sec ${row.sections.join(', ')}`)
    return parts.length > 0 ? parts.join(' · ') : 'Every class'
  }, [row, homerooms])

  const lastRun = row.last_run_summary
  const quiet = (row.quiet_days ?? []).map(d => DAY_LABELS[d]).filter(Boolean)

  return (
    <div className="border border-[#E4E4E7] rounded-lg bg-white overflow-hidden">
      <div className="flex items-start gap-3 px-3 py-2.5">
        <button
          onClick={onToggle}
          disabled={!canEdit || busy}
          title={row.enabled ? 'Switch off' : 'Switch on'}
          className={`mt-0.5 w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 border transition-colors disabled:opacity-60 ${
            row.enabled
              ? 'bg-emerald-50 border-emerald-200 text-emerald-600 hover:bg-emerald-100'
              : 'bg-[#F5F5F5] border-[#E4E4E7] text-[#A1A1AA] hover:bg-[#EBEBEB]'
          }`}
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Power size={14} />}
        </button>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-[#18181B]">{row.name}</span>
            <span className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border ${
              row.enabled
                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                : 'bg-[#F4F4F5] text-[#71717A] border-[#E4E4E7]'
            }`}>
              {row.enabled ? 'On' : 'Off'}
            </span>
          </div>
          <p className="text-[11px] text-[#71717A] mt-1">
            {row.send_at.slice(0, 5)} · {scope} · {row.statuses.map(s => ATTENDANCE_STATUS_LABELS[s] ?? s).join(', ')}
          </p>
          <p className="text-[11px] text-[#A1A1AA] mt-0.5">
            {row.template_key
              ? `Always sends “${row.template_key.replace('attendance_', '').replace(/_/g, ' ')}”`
              : 'Each student gets the message their own day calls for'}
            {row.skip_approved_leave && ' · approved leave left alone'}
            {quiet.length > 0 && ` · not on ${quiet.join(', ')}`}
          </p>
          {lastRun && (
            <p className="text-[11px] text-[#71717A] mt-1.5 border-t border-[#F4F4F5] pt-1.5">
              Last run {row.last_run_on ?? '—'}:{' '}
              {lastRun.skipped_reason === 'quiet_day'
                ? 'quiet day, nothing sent'
                : <>
                    <strong className="text-[#18181B]">{lastRun.queued ?? 0}</strong> messaged
                    {typeof lastRun.considered === 'number' && ` of ${lastRun.considered}`}
                    {lastRun.skipped && describeSkips(lastRun.skipped).length > 0
                      && ` — ${describeSkips(lastRun.skipped).join(', ')}`}
                  </>}
            </p>
          )}
        </div>

        {canEdit && (
          <div className="flex items-center gap-1 flex-shrink-0">
            <button
              onClick={onEdit}
              className="px-2 py-1 text-xs font-medium text-[#52525B] border border-[#D4D4D8] rounded hover:bg-[#F5F5F5]"
            >
              Edit
            </button>
            <button
              onClick={() => setConfirming(v => !v)}
              aria-label="Delete schedule"
              className="p-1.5 text-[#A1A1AA] hover:text-rose-600 hover:bg-rose-50 rounded"
            >
              <Trash2 size={13} />
            </button>
          </div>
        )}
      </div>

      {confirming && (
        <div className="flex items-center justify-between gap-2 px-3 py-2 bg-rose-50 border-t border-rose-200">
          <span className="text-xs text-rose-700">Delete this schedule? Messages already sent stay in the history.</span>
          <span className="flex gap-1.5 flex-shrink-0">
            <button
              onClick={() => { setConfirming(false); onDelete() }}
              className="px-2 py-1 text-xs font-semibold text-white bg-rose-600 rounded hover:bg-rose-700"
            >
              Delete
            </button>
            <button
              onClick={() => setConfirming(false)}
              className="px-2 py-1 text-xs font-medium text-rose-700 border border-rose-200 rounded hover:bg-rose-100"
            >
              Keep
            </button>
          </span>
        </div>
      )}
    </div>
  )
}

// ── The form ────────────────────────────────────────────────────────────────

const FIELD_LABEL = 'text-[10px] font-bold uppercase tracking-widest text-[#525252]'

function DraftForm({
  draft, setDraft, homerooms, grades, sections,
}: {
  draft: Draft
  setDraft: React.Dispatch<React.SetStateAction<Draft | null>>
  homerooms: Homeroom[]
  grades: number[]
  sections: string[]
}) {
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft(d => (d ? { ...d, [key]: value } : d))

  const toggleIn = <T,>(list: T[] | null, value: T): T[] | null => {
    const next = (list ?? []).includes(value)
      ? (list ?? []).filter(v => v !== value)
      : [...(list ?? []), value]
    return next.length > 0 ? next : null
  }

  return (
    <div className="space-y-4">
      <div>
        <label className={`${FIELD_LABEL} block mb-1.5`}>Name</label>
        <input
          value={draft.name}
          onChange={e => set('name', e.target.value)}
          placeholder="Daily absentee notice"
          className="w-full px-3 py-2 text-sm border border-[#D4D4D8] rounded-md focus:outline-none focus:border-[#27272A]"
        />
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        <div>
          <label className={`${FIELD_LABEL} block mb-1.5`}>Send at</label>
          <input
            type="time"
            value={draft.send_at}
            onChange={e => set('send_at', e.target.value)}
            className="w-full px-3 py-2 text-sm border border-[#D4D4D8] rounded-md focus:outline-none focus:border-[#27272A]"
          />
          <p className="text-[11px] text-[#A1A1AA] mt-1">
            Late enough that the sheets are in. Runs within five minutes of this time.
          </p>
        </div>
        <div>
          <label className={`${FIELD_LABEL} block mb-1.5`}>Never on</label>
          <div className="flex flex-wrap gap-1">
            {DAY_LABELS.map((label, day) => {
              const off = draft.quiet_days.includes(day)
              return (
                <button
                  key={day}
                  onClick={() => set('quiet_days',
                    off ? draft.quiet_days.filter(d => d !== day) : [...draft.quiet_days, day])}
                  aria-pressed={off}
                  className={`px-2 py-1.5 text-[11px] font-medium rounded border transition-colors ${
                    off
                      ? 'bg-[#27272A] text-white border-[#27272A]'
                      : 'bg-white text-[#52525B] border-[#D4D4D8] hover:bg-[#F5F5F5]'
                  }`}
                >
                  {label}
                </button>
              )
            })}
          </div>
        </div>
      </div>

      <div>
        <label className={`${FIELD_LABEL} block mb-1.5`}>Notify about</label>
        <div className="flex flex-wrap gap-1.5">
          {STATUS_CHOICES.map(status => {
            const on = draft.statuses.includes(status)
            return (
              <button
                key={status}
                onClick={() => set('statuses',
                  on
                    ? draft.statuses.filter(s => s !== status)
                    : [...draft.statuses, status])}
                aria-pressed={on}
                className={`px-2.5 py-1.5 text-xs font-medium rounded-md border transition-colors ${
                  on
                    ? 'bg-violet-600 text-white border-violet-600'
                    : 'bg-white text-[#52525B] border-[#D4D4D8] hover:bg-[#F5F5F5]'
                }`}
              >
                {ATTENDANCE_STATUS_LABELS[status] ?? status}
              </button>
            )
          })}
        </div>
        {draft.statuses.length === 0 && (
          <p className="text-[11px] text-amber-600 mt-1.5">
            Pick at least one — a schedule with none would run and send nothing. Absent only, if unsure.
          </p>
        )}
      </div>

      <div>
        <label className={`${FIELD_LABEL} block mb-1.5`}>Which classes</label>
        <p className="text-[11px] text-[#A1A1AA] mb-2">
          Pick nothing for every class in the school, which is what most schools want.
        </p>
        <div className="space-y-2">
          <div>
            <p className="text-[11px] font-medium text-[#71717A] mb-1">Grades</p>
            <div className="flex flex-wrap gap-1">
              {grades.map(g => {
                const on = (draft.grades ?? []).includes(g)
                return (
                  <button
                    key={g}
                    onClick={() => set('grades', toggleIn(draft.grades, g))}
                    aria-pressed={on}
                    className={`px-2 py-1 text-[11px] font-medium rounded border ${
                      on ? 'bg-[#27272A] text-white border-[#27272A]' : 'bg-white text-[#52525B] border-[#D4D4D8] hover:bg-[#F5F5F5]'
                    }`}
                  >
                    {gradeLabel(g)}
                  </button>
                )
              })}
            </div>
          </div>
          <div>
            <p className="text-[11px] font-medium text-[#71717A] mb-1">Sections</p>
            <div className="flex flex-wrap gap-1">
              {sections.map(s => {
                const on = (draft.sections ?? []).includes(s)
                return (
                  <button
                    key={s}
                    onClick={() => set('sections', toggleIn(draft.sections, s))}
                    aria-pressed={on}
                    className={`px-2 py-1 text-[11px] font-medium rounded border ${
                      on ? 'bg-[#27272A] text-white border-[#27272A]' : 'bg-white text-[#52525B] border-[#D4D4D8] hover:bg-[#F5F5F5]'
                    }`}
                  >
                    {s}
                  </button>
                )
              })}
            </div>
          </div>
          {homerooms.length > 0 && (
            <details className="border border-[#E4E4E7] rounded-md">
              <summary className="px-2.5 py-2 text-[11px] font-medium text-[#52525B] cursor-pointer">
                …or name individual homerooms
                {draft.homeroom_ids?.length ? ` (${draft.homeroom_ids.length} picked)` : ''}
              </summary>
              <div className="px-2.5 pb-2.5 flex flex-wrap gap-1 max-h-40 overflow-y-auto">
                {homerooms.map(h => {
                  const on = (draft.homeroom_ids ?? []).includes(h.id)
                  return (
                    <button
                      key={h.id}
                      onClick={() => set('homeroom_ids', toggleIn(draft.homeroom_ids, h.id))}
                      aria-pressed={on}
                      className={`px-2 py-1 text-[11px] font-medium rounded border ${
                        on ? 'bg-[#27272A] text-white border-[#27272A]' : 'bg-white text-[#52525B] border-[#D4D4D8] hover:bg-[#F5F5F5]'
                      }`}
                    >
                      {h.name}
                    </button>
                  )
                })}
              </div>
              {draft.homeroom_ids?.length ? (
                <p className="px-2.5 pb-2.5 text-[11px] text-[#A1A1AA]">
                  Named homerooms win — the grade and section choices above are ignored while any are picked.
                </p>
              ) : null}
            </details>
          )}
        </div>
      </div>

      <div>
        <label className={`${FIELD_LABEL} block mb-1.5`}>Message</label>
        <select
          value={draft.template_key ?? ''}
          onChange={e => set('template_key', e.target.value || null)}
          className="w-full px-3 py-2 text-sm border border-[#D4D4D8] rounded-md bg-white focus:outline-none focus:border-[#27272A]"
        >
          <option value="">Match each student’s own day (recommended)</option>
          {TEMPLATE_ORDER.map(kind => (
            <option key={kind} value={templateForKind(kind)}>
              Always send: {MESSAGE_KIND_LABELS[kind]}
            </option>
          ))}
        </select>
        <p className="text-[11px] text-[#A1A1AA] mt-1">
          Matching means an absent family hears “absent” and a family with approved medical leave
          hears that their leave is on record — from the same run.
        </p>
      </div>

      <label className="flex items-start gap-2.5 px-3 py-2.5 border border-[#E4E4E7] rounded-lg cursor-pointer hover:bg-[#FAFAF9]">
        <input
          type="checkbox"
          checked={draft.skip_approved_leave}
          onChange={e => set('skip_approved_leave', e.target.checked)}
          className="mt-0.5 w-4 h-4 accent-violet-600 flex-shrink-0"
        />
        <span className="min-w-0">
          <span className="block text-sm font-medium text-[#18181B]">Leave approved absences alone</span>
          <span className="block text-[11px] text-[#71717A] mt-0.5">
            A family who applied for leave and had it granted has already been told. Messaging them
            again is the fastest way to teach a parent that these messages are noise.
          </span>
        </span>
      </label>
    </div>
  )
}
