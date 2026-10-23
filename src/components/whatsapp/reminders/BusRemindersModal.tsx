'use client'

// ─────────────────────────────────────────────────────────────────────────────
// Bus reminders — from Today's trips.
//
// Every child on today's trips who has not come to the bus (still expected,
// or marked absent / no-show by the crew), grouped by trip, filterable by
// direction and route. Remind tells the family their child has not arrived
// for the bus as of now — once per trip.
//
// The automatic version runs at a set time per direction and follows one
// extra rule: a trip with nobody at all marked aboard is a route not running
// today, so nobody on it is messaged. A manual send is the admin's call, but
// the same trips are flagged here so it is a deliberate one.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, BellRing, Loader2, Send } from 'lucide-react'
import BusModal from '@/components/transport/BusModal'
import { DIRECTION_LABELS } from '@/lib/transport/types'
import { gradeShortLabel } from '@/lib/grades'
import {
  alreadyReminded, canPick, fetchBusCandidates, fetchSchedules, fetchTemplates, sendReminders,
  type BusCandidateRow, type ReminderSchedule, type SendResult, type WaTemplate,
} from '@/lib/whatsappReminders'
import {
  ErrorNote, ListShell, LoadingBlock, LogView, PickRow, Picker, RK, Readiness, ResultCard,
  ScheduleEditor, SearchBox, StatRow, TemplateEditor, ViewTabs, selectAllLabel, useReminderStatus,
  useSelection, type ReminderView,
} from './ReminderKit'

type Direction = 'inbound' | 'outbound'

const STATE_LABEL: Record<BusCandidateRow['state'], string> = {
  expected: 'Not aboard yet',
  absent: 'Marked absent by the crew',
  no_show: 'No-show',
}

const keyOf = (r: { run_id: string; student_id: string }) => `${r.run_id}|${r.student_id}`

export default function BusRemindersModal({ onClose }: { onClose: () => void }) {
  const status = useReminderStatus()

  const [view, setView] = useState<ReminderView>('list')
  const [rows, setRows] = useState<BusCandidateRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [direction, setDirection] = useState<Direction>(() => (new Date().getHours() < 12 ? 'inbound' : 'outbound'))
  const [route, setRoute] = useState('')
  const [query, setQuery] = useState('')
  const { selected, setSelected, toggle, clear } = useSelection()
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<SendResult | null>(null)

  const [schedules, setSchedules] = useState<ReminderSchedule[] | null>(null)
  const [template, setTemplate] = useState<WaTemplate | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try { setRows(await fetchBusCandidates()) }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not load today’s trips.') }
  }, [])
  useEffect(() => { void load() }, [load])

  useEffect(() => {
    if (view === 'auto' && !schedules) {
      fetchSchedules(['bus_inbound', 'bus_outbound']).then(setSchedules).catch(e => setError(e.message))
    }
    if (view === 'message' && !template) {
      fetchTemplates('transport.bus_not_arrived').then(t => setTemplate(t[0] ?? null)).catch(e => setError(e.message))
    }
  }, [view, schedules, template])

  // Only offer a direction that has trips today; fall back to whichever does.
  const directions = useMemo(() => {
    const s = new Set((rows ?? []).map(r => r.direction))
    return (['inbound', 'outbound'] as Direction[]).filter(d => s.has(d))
  }, [rows])
  useEffect(() => {
    if (directions.length > 0 && !directions.includes(direction)) setDirection(directions[0])
  }, [directions, direction])

  const inDirection = useMemo(() => (rows ?? []).filter(r => r.direction === direction), [rows, direction])

  const routes = useMemo(() => {
    const m = new Map<string, string>()
    for (const r of inDirection) m.set(r.route_id, r.route_name)
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1], undefined, { numeric: true }))
  }, [inDirection])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return inDirection.filter(r =>
      (!route || r.route_id === route) && (!q || r.full_name.toLowerCase().includes(q)))
  }, [inDirection, route, query])

  // One group per trip, in the order the trips run.
  const trips = useMemo(() => {
    const m = new Map<string, BusCandidateRow[]>()
    for (const r of shown) m.set(r.run_id, [...(m.get(r.run_id) ?? []), r])
    return [...m.values()]
  }, [shown])

  const pickable = shown.filter(canPick)
  const allPicked = pickable.length > 0 && pickable.every(r => selected.has(keyOf(r)))

  const totals = useMemo(() => ({
    waiting: inDirection.length,
    pending: inDirection.filter(canPick).length,
    reminded: inDirection.filter(alreadyReminded).length,
    noNumber: inDirection.filter(r => !r.contactable).length,
  }), [inDirection])

  const remind = async (keys: string[]) => {
    if (keys.length === 0) return
    const byRun = new Map<string, string[]>()
    for (const k of keys) {
      const [runId, studentId] = k.split('|')
      byRun.set(runId, [...(byRun.get(runId) ?? []), studentId])
    }
    setSending(true); setError(null)
    try {
      setResult(await sendReminders({
        kind: 'bus', runs: [...byRun.entries()].map(([run_id, student_ids]) => ({ run_id, student_ids })),
      }))
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
    <BusModal
      onClose={onClose}
      size="lg"
      fullHeight
      title="Bus reminders"
      subtitle={`Today, ${now} · children who have not come to the bus · WhatsApp`}
      icon={BellRing}
    >
      <div className="space-y-3">
        <ViewTabs value={view} onChange={setView} views={['list', 'log', 'auto', 'message']} />
        <Readiness status={status} />
        {error && <ErrorNote>{error}</ErrorNote>}

        {view === 'list' && (
          <>
            {directions.length > 1 && (
              <div className="flex gap-1 p-1 rounded-full bg-slate-100/90" role="tablist" aria-label="Trip">
                {directions.map(d => (
                  <button key={d} role="tab" aria-selected={d === direction}
                    onClick={() => { setDirection(d); setRoute(''); clear() }}
                    className={`flex-1 h-8 rounded-full text-[12.5px] font-semibold transition ${d === direction
                      ? 'bg-white text-[color:var(--page-primary-dark,#0B2150)] shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}>
                    {DIRECTION_LABELS[d]}
                  </button>
                ))}
              </div>
            )}

            <StatRow loading={!rows} stats={[
              { label: 'Not at the bus', value: totals.waiting, strong: true },
              { label: 'Not reminded yet', value: totals.pending },
              { label: 'Reminded', value: totals.reminded },
              { label: 'No number', value: totals.noNumber },
            ]} />

            {result && <ResultCard result={result} onClose={() => setResult(null)} />}

            <div className="flex flex-wrap items-center gap-2">
              <SearchBox value={query} onChange={setQuery} />
              {routes.length > 1 && (
                <Picker label="Route" value={route} onChange={v => { setRoute(v); clear() }}
                  options={[{ value: '', label: 'Every route' }, ...routes.map(([id, name]) => ({ value: id, label: name }))]} />
              )}
              <button onClick={() => setSelected(allPicked ? new Set() : new Set(pickable.map(keyOf)))}
                disabled={pickable.length === 0} className={RK.ghost}>
                {selectAllLabel(allPicked, pickable.length)}
              </button>
              <button onClick={() => void remind([...selected])} disabled={sending || selected.size === 0} className={RK.primary}>
                {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                Remind {selected.size || ''}
              </button>
            </div>

            {!rows ? <LoadingBlock /> : trips.length === 0 ? (
              <ListShell empty={inDirection.length === 0
                ? `Every child on today’s ${DIRECTION_LABELS[direction].toLowerCase()} trips is aboard, excused, or there are no trips.`
                : 'Nobody matches that.'}>{[]}</ListShell>
            ) : trips.map(group => {
              const t = group[0]
              const tripKeys = group.filter(canPick).map(keyOf)
              const tripPicked = tripKeys.length > 0 && tripKeys.every(k => selected.has(k))
              return (
                <section key={t.run_id} className="space-y-1.5">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-1">
                    <h3 className="text-[13.5px] font-bold text-slate-900">{t.route_name}</h3>
                    <span className="text-[12px] text-slate-500">
                      {new Date(t.scheduled_start_at).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}
                      {' · '}{t.waiting} not aboard · {t.boarded} aboard
                    </span>
                    <div className="flex-1" />
                    {tripKeys.length > 0 && (
                      <button className={RK.small} onClick={() => setSelected(s => {
                        const next = new Set(s)
                        for (const k of tripKeys) { if (tripPicked) next.delete(k); else next.add(k) }
                        return next
                      })}>
                        {tripPicked ? 'Clear trip' : `Select trip (${tripKeys.length})`}
                      </button>
                    )}
                  </div>
                  {t.boarded === 0 && (
                    <div className="flex items-start gap-2 rounded-2xl bg-amber-50 border border-amber-200 px-3 py-2 text-[12px] text-amber-900">
                      <AlertTriangle size={14} className="mt-0.5 flex-shrink-0 text-amber-600" />
                      Nobody on this trip has been marked aboard yet — the route may not be running
                      today. Automatic reminders skip a trip like this.
                    </div>
                  )}
                  <ListShell>
                    {group.map(r => (
                      <PickRow
                        key={keyOf(r)}
                        title={r.full_name}
                        subtitle={<>
                          {STATE_LABEL[r.state]}
                          {r.stop_name ? ` · ${r.stop_name}` : ''}
                          {r.grade != null ? ` · ${gradeShortLabel(r.grade)}${r.section ? `-${r.section}` : ''}` : ''}
                          {r.masked ? ` · ${r.masked}` : ''}
                        </>}
                        state={r}
                        checked={selected.has(keyOf(r))}
                        disabled={!canPick(r)}
                        onToggle={on => toggle(keyOf(r), on)}
                        onRemind={() => void remind([keyOf(r)])}
                        busy={sending}
                      />
                    ))}
                  </ListShell>
                </section>
              )
            })}

            <p className="text-[11.5px] text-slate-500 leading-relaxed px-1">
              One message per child per trip. A child who boards before it goes is skipped
              automatically. The route’s own guardian number is used when one is set.
            </p>
          </>
        )}

        {view === 'log' && (
          <LogView kind="bus_not_arrived" describe={r => {
            const trip = (rows ?? []).find(x => x.run_id === r.subject_id)
            return trip ? trip.route_name : null
          }} />
        )}

        {view === 'auto' && (schedules ? (
          <div className="space-y-3">
            {(['bus_inbound', 'bus_outbound'] as const).map(kind => {
              const s = schedules.find(x => x.kind === kind)
              if (!s) return null
              return (
                <ScheduleEditor
                  key={kind}
                  schedule={s}
                  title={kind === 'bus_inbound' ? 'Morning — to school' : 'Afternoon — from school'}
                  detail={<>At this time, every child on that day’s {kind === 'bus_inbound' ? 'to-school' : 'from-school'} trips
                    who has not come to the bus is sent the message — once. A trip with nobody marked
                    aboard is treated as not running (a holiday for that route) and skipped.</>}
                  canEdit
                  onSaved={next => setSchedules(list => (list ?? []).map(x => (x.kind === next.kind ? next : x)))}
                />
              )
            })}
          </div>
        ) : <LoadingBlock />)}

        {view === 'message' && (template ? (
          <TemplateEditor template={template} canEdit
            onSaved={() => fetchTemplates('transport.bus_not_arrived').then(t => setTemplate(t[0] ?? null))} />
        ) : <LoadingBlock />)}
      </div>
    </BusModal>
  )
}
