'use client'

// ─────────────────────────────────────────────────────────────────────────────
// Absence reminders — from the student attendance report.
//
// Everyone marked absent today with no leave behind them, by classroom. Tick
// some (or "Select these"), press Remind, and each family hears that their
// child has not arrived at school as of now. One message per student per day,
// however often Remind is pressed or the timer fires; siblings on one number
// each get their own. A class teacher sees and reminds only their own
// homerooms — the database enforces that, not this screen.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { BellRing, Loader2, Send } from 'lucide-react'
import ModalShell from '@/components/ui/ModalShell'
import { useAuth } from '@/contexts/AuthContext'
import { gradeShortLabel } from '@/lib/grades'
import {
  alreadyReminded, canPick, fetchAbsentees, fetchSchedules, fetchTemplates, sendReminders,
  type AbsenteeRow, type ReminderSchedule, type SendResult, type WaTemplate,
} from '@/lib/whatsappReminders'
import {
  ErrorNote, ListShell, LoadingBlock, LogView, PickRow, Picker, RK, Readiness, ResultCard,
  ScheduleEditor, SearchBox, StatRow, TemplateEditor, ViewTabs, selectAllLabel, useReminderStatus,
  useSelection, type ReminderView,
} from './ReminderKit'

export default function AttendanceRemindersModal({ onClose }: { onClose: () => void }) {
  const { profile } = useAuth()
  const role = profile?.role ?? ''
  const status = useReminderStatus()

  const [view, setView] = useState<ReminderView>('list')
  const [rows, setRows] = useState<AbsenteeRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [homeroom, setHomeroom] = useState('')
  const { selected, setSelected, toggle, clear } = useSelection()
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<SendResult | null>(null)

  const [schedule, setSchedule] = useState<ReminderSchedule | null>(null)
  const [template, setTemplate] = useState<WaTemplate | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try { setRows(await fetchAbsentees()) }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not load today’s absentees.') }
  }, [])
  useEffect(() => { void load() }, [load])

  useEffect(() => {
    if (view === 'auto' && !schedule) {
      fetchSchedules(['attendance_absent']).then(s => setSchedule(s[0] ?? null)).catch(e => setError(e.message))
    }
    if (view === 'message' && !template) {
      fetchTemplates('attendance.absent_not_arrived').then(t => setTemplate(t[0] ?? null)).catch(e => setError(e.message))
    }
  }, [view, schedule, template])

  const homerooms = useMemo(() => {
    const m = new Map<string, string>()
    for (const r of rows ?? []) m.set(r.homeroom_id, r.homeroom_name)
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1], undefined, { numeric: true }))
  }, [rows])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (rows ?? []).filter(r =>
      (!homeroom || r.homeroom_id === homeroom) && (!q || r.full_name.toLowerCase().includes(q)))
  }, [rows, homeroom, query])

  const pickable = shown.filter(canPick)
  const allPicked = pickable.length > 0 && pickable.every(r => selected.has(r.student_id))

  const totals = useMemo(() => {
    const all = rows ?? []
    return {
      absent: all.length,
      reminded: all.filter(alreadyReminded).length,
      waiting: all.filter(canPick).length,
      noNumber: all.filter(r => !r.contactable).length,
    }
  }, [rows])

  const remind = async (ids: string[]) => {
    if (ids.length === 0) return
    setSending(true); setError(null)
    try {
      setResult(await sendReminders({ kind: 'attendance', student_ids: ids }))
      clear()
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Those reminders were not sent.')
    } finally {
      setSending(false)
    }
  }

  const now = new Date().toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })

  return (
    <ModalShell
      onClose={onClose}
      size="2xl"
      minHClass="sm:min-h-[38rem]"
      title="Absence reminders"
      subtitle={`Today, ${now} · absent without leave · WhatsApp`}
      icon={<BellRing size={17} />}
      iconClassName="text-white bg-gradient-to-br from-[color:var(--page-gradient-from,#7c3aed)] to-[color:var(--page-gradient-to,#6d28d9)]"
      bodyClassName="space-y-3"
    >
      <ViewTabs value={view} onChange={setView} views={['list', 'log', 'auto', 'message']} />
      <Readiness status={status} />
      {error && <ErrorNote>{error}</ErrorNote>}

      {view === 'list' && (
        <>
          <StatRow loading={!rows} stats={[
            { label: 'Absent today', value: totals.absent, strong: true },
            { label: 'Not reminded yet', value: totals.waiting },
            { label: 'Reminded today', value: totals.reminded },
            { label: 'No number', value: totals.noNumber },
          ]} />

          {result && <ResultCard result={result} onClose={() => setResult(null)} />}

          <div className="flex flex-wrap items-center gap-2">
            <SearchBox value={query} onChange={setQuery} />
            {homerooms.length > 1 && (
              <Picker label="Classroom" value={homeroom}
                onChange={v => { setHomeroom(v); clear() }}
                options={[{ value: '', label: 'Every classroom' }, ...homerooms.map(([id, name]) => ({ value: id, label: name }))]} />
            )}
            <button onClick={() => setSelected(allPicked ? new Set() : new Set(pickable.map(r => r.student_id)))}
              disabled={pickable.length === 0} className={RK.ghost}>
              {selectAllLabel(allPicked, pickable.length)}
            </button>
            <button onClick={() => void remind([...selected])} disabled={sending || selected.size === 0} className={RK.primary}>
              {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
              Remind {selected.size || ''}
            </button>
          </div>

          {!rows ? <LoadingBlock /> : (
            <ListShell empty={rows.length === 0
              ? 'Nobody is marked absent without leave today. Reminders appear here as the registers are taken.'
              : 'Nobody matches that.'}>
              {shown.map(r => (
                <PickRow
                  key={r.student_id}
                  title={r.full_name}
                  subtitle={<>
                    {r.homeroom_name}
                    {r.grade != null ? ` · ${gradeShortLabel(r.grade)}${r.section ? `-${r.section}` : ''}` : ''}
                    {r.masked ? ` · ${r.masked}` : ''}
                  </>}
                  state={r}
                  checked={selected.has(r.student_id)}
                  disabled={!canPick(r)}
                  onToggle={on => toggle(r.student_id, on)}
                  onRemind={() => void remind([r.student_id])}
                  busy={sending}
                />
              ))}
            </ListShell>
          )}

          <p className="text-[11.5px] text-slate-500 leading-relaxed px-1">
            One message per student per day. A child marked present before it goes is skipped
            automatically. Siblings who share a number each get their own message.
          </p>
        </>
      )}

      {view === 'log' && <LogView kind="attendance_absent" />}

      {view === 'auto' && (schedule ? (
        <ScheduleEditor
          schedule={schedule}
          title="Remind every absentee at a set time"
          detail={<>At this time, every student still marked absent without leave is sent the
            message — once. School holidays are skipped, and a child already reminded by hand
            today is not messaged again.</>}
          canEdit={role === 'admin' || role === 'principal'}
          onSaved={setSchedule}
        />
      ) : <LoadingBlock />)}

      {view === 'message' && (template ? (
        <TemplateEditor template={template} canEdit={role === 'admin'}
          onSaved={() => fetchTemplates('attendance.absent_not_arrived').then(t => setTemplate(t[0] ?? null))} />
      ) : <LoadingBlock />)}
    </ModalShell>
  )
}
