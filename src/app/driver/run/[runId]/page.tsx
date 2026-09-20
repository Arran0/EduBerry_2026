'use client'

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import {
  ArrowLeft, Play, Square, Wifi, WifiOff, Loader2, CheckCircle2,
  CircleSlash, Users, AlertTriangle, CloudOff,
} from 'lucide-react'
import DriverLayout from '@/components/DriverLayout'
import Avatar from '@/components/Avatar'
import { useAuth } from '@/contexts/AuthContext'
import { useRunLive } from '@/hooks/useRunLive'
import { useTransportStream } from '@/hooks/useTransportStream'
import { endRun, formatClock, markBoarding, relativeMinutes, startRun } from '@/lib/transport/runs'
import type { TransportRunPassenger, TransportRunStop } from '@/lib/transport/types'
import { DIRECTION_LABELS } from '@/lib/transport/types'
import SosButton from '@/components/transport/SosButton'
import ScanField from '@/components/transport/ScanField'

export default function DriverRunPage() {
  const params = useParams<{ runId: string }>()
  const runId = params.runId
  const router = useRouter()
  const { profile } = useAuth()

  const { run, stops, passengers, loading, reload } = useRunLive(runId, { withPassengers: true })
  const stream = useTransportStream(runId)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [working, setWorking] = useState(false)

  const isLive = run?.status === 'in_progress' || run?.status === 'boarding'
  const isDone = run?.status === 'completed'

  // The stream follows the trip: a driver should never have to remember to
  // start sharing separately from starting the trip.
  useEffect(() => {
    if (isLive && !stream.sharing && !isDone) stream.start()
    if ((isDone || run?.status === 'cancelled') && stream.sharing) stream.stop()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLive, isDone, run?.status])

  const currentStop = useMemo(() => {
    // The stop the bus is at, else the next one it has not reached.
    const arrivedNotLeft = stops.find(s => s.arrived_at && !s.departed_at)
    if (arrivedNotLeft) return arrivedNotLeft
    return stops.find(s => !s.arrived_at && !s.skipped) ?? null
  }, [stops])

  const byStop = useMemo(() => {
    const m = new Map<string, TransportRunPassenger[]>()
    for (const p of passengers) {
      const key = (run?.direction === 'inbound' ? p.board_stop_id : p.alight_stop_id) ?? 'none'
      const list = m.get(key) ?? []
      list.push(p)
      m.set(key, list)
    }
    return m
  }, [passengers, run?.direction])

  const onboard = passengers.filter(p => p.state === 'boarded').length
  const settled = passengers.filter(p => p.state !== 'expected').length

  const act = useCallback(async (
    p: TransportRunPassenger,
    event: 'board' | 'alight' | 'mark_absent' | 'undo',
  ) => {
    setBusyId(p.student_id)
    const res = await markBoarding(runId, p.student_id, event, { stopId: currentStop?.stop_id })
    setBusyId(null)
    if (!res.success) setNotice(res.error ?? 'Could not save that')
    else { setNotice(null); reload() }
  }, [runId, currentStop?.stop_id, reload])

  const onStart = async () => {
    setWorking(true)
    const res = await startRun(runId)
    setWorking(false)
    if (!res.success) { setNotice(res.error ?? 'Could not start'); return }
    setNotice(null)
    stream.start()
    reload()
  }

  const onEnd = async () => {
    setWorking(true)
    const res = await endRun(runId)
    setWorking(false)
    if (!res.success) { setNotice(res.error ?? 'Could not end the trip'); return }
    setNotice(null)
    stream.stop()
    reload()
    router.push('/driver')
  }

  if (loading) {
    return (
      <DriverLayout>
        <div className="h-40 rounded-2xl bg-slate-100 animate-pulse" />
      </DriverLayout>
    )
  }

  if (!run) {
    return (
      <DriverLayout>
        <p className="text-sm text-slate-500">This trip could not be found.</p>
      </DriverLayout>
    )
  }

  return (
    <DriverLayout>
      <div className="space-y-4">
        <Link
          href="/driver"
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-500 hover:text-slate-800"
        >
          <ArrowLeft size={15} /> Today
        </Link>

        {/* On a phone this is one column, in order. On a tablet or a desktop the
            controls a driver touches — state, SOS, start/end, the scanner —
            stay fixed on the left while the roster scrolls beside them, so
            ending a trip never means scrolling past forty children first. */}
        <div className="lg:grid lg:grid-cols-[22rem_1fr] lg:gap-5 lg:items-start space-y-4 lg:space-y-0">
        <div className="space-y-4 lg:sticky lg:top-5">

        {/* Hero: one glance answers "where am I and how many are with me". */}
        <div
          className="rounded-2xl px-4 py-4 text-white"
          style={{ background: `linear-gradient(135deg, ${run.route?.color ?? '#F97316'}, #18181B)` }}
        >
          <p className="text-xs uppercase tracking-widest opacity-70">
            {DIRECTION_LABELS[run.direction]}
          </p>
          <h1 className="text-xl font-bold truncate">{run.route?.name ?? 'Route'}</h1>
          <div className="flex items-end justify-between mt-3">
            <div>
              <p className="text-3xl font-bold leading-none">{onboard}</p>
              <p className="text-xs opacity-80 mt-1">on board now</p>
            </div>
            <div className="text-right text-xs opacity-80">
              <p>{settled} of {passengers.length} accounted for</p>
              <p className="mt-0.5">Departs {formatClock(run.scheduled_start_at)}</p>
            </div>
          </div>
        </div>

        {/* GPS state, said plainly. A driver needs to know whether parents can
            see them, not what a wake lock is. */}
        <div className="flex items-center gap-2 text-xs">
          {stream.sharing ? (
            <span className="inline-flex items-center gap-1.5 text-emerald-700 font-semibold">
              <Wifi size={14} /> Parents can see the bus
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-slate-500">
              <WifiOff size={14} /> Not sharing location
            </span>
          )}
          {stream.pending > 0 && (
            <span className="inline-flex items-center gap-1 text-amber-600">
              <CloudOff size={13} /> {stream.pending} saved to send
            </span>
          )}
          {stream.lastSentAt && (
            <span className="text-slate-400">
              · updated {new Date(stream.lastSentAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
            </span>
          )}
        </div>
        {stream.error && <p className="text-xs text-amber-600">{stream.error}</p>}
        {notice && (
          <p className="text-sm text-rose-700 bg-rose-50 border border-rose-100 rounded-xl px-3 py-2.5">
            {notice}
          </p>
        )}

        {/* Always reachable while the trip is live — an emergency must never be
            more than one control away, and never behind a scroll. */}
        {isLive && (
          <div className="sticky bottom-3 z-10">
            <SosButton runId={runId} />
          </div>
        )}

        {run.status === 'scheduled' ? (
          <button
            onClick={onStart}
            disabled={working}
            className="w-full flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white text-base font-bold py-4 rounded-2xl transition-colors disabled:opacity-60"
          >
            {working ? <Loader2 size={18} className="animate-spin" /> : <Play size={18} />}
            Start trip
          </button>
        ) : isLive ? (
          <button
            onClick={onEnd}
            disabled={working}
            className="w-full flex items-center justify-center gap-2 bg-slate-900 hover:bg-black text-white text-base font-bold py-4 rounded-2xl transition-colors disabled:opacity-60"
          >
            {working ? <Loader2 size={18} className="animate-spin" /> : <Square size={18} />}
            End trip
          </button>
        ) : (
          <p className="text-center text-sm text-slate-500 py-2">
            <CheckCircle2 size={15} className="inline mr-1 text-emerald-500" />
            This trip is finished.
          </p>
        )}

        {/* A card or a QR is a faster tap, never an unsupervised one: the name
            comes back and the attendant checks it against the child. */}
        {isLive && (
          <ScanField
            runId={runId}
            stopId={currentStop?.stop_id ?? null}
            onScanned={reload}
          />
        )}
        </div>

        {/* Stop-by-stop, not one flat roster: the driver only ever needs the
            handful of children standing in front of them. */}
        <div className="space-y-3 md:grid md:grid-cols-2 md:gap-3 md:space-y-0 lg:block lg:space-y-3 xl:grid xl:grid-cols-2 xl:gap-3 xl:space-y-0">
          {stops.map(s => (
            <StopBlock
              key={s.id}
              stop={s}
              isCurrent={currentStop?.id === s.id}
              passengers={byStop.get(s.stop_id) ?? []}
              direction={run.direction}
              disabled={!isLive}
              busyId={busyId}
              onAct={act}
            />
          ))}
          {byStop.get('none')?.length ? (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 md:col-span-2 lg:col-span-1 xl:col-span-2">
              <p className="text-sm font-semibold text-amber-800 flex items-center gap-1.5">
                <AlertTriangle size={15} /> No stop set
              </p>
              <p className="text-xs text-amber-700 mt-0.5 mb-2">
                These children have no stop on this route. Mark them as you see them and
                ask the office to fix their assignment.
              </p>
              <div className="space-y-1.5">
                {(byStop.get('none') ?? []).map(p => (
                  <PassengerRow
                    key={p.id} p={p} disabled={!isLive} busy={busyId === p.student_id}
                    direction={run.direction} onAct={act}
                  />
                ))}
              </div>
            </div>
          ) : null}
        </div>
        </div>

        {profile && (
          <p className="text-[11px] text-slate-400 text-center pt-2">
            Boarding is recorded against you, {profile.full_name}. Tap a child again to undo.
          </p>
        )}
      </div>
    </DriverLayout>
  )
}

function StopBlock({
  stop, isCurrent, passengers, direction, disabled, busyId, onAct,
}: {
  stop: TransportRunStop
  isCurrent: boolean
  passengers: TransportRunPassenger[]
  direction: 'inbound' | 'outbound'
  disabled: boolean
  busyId: string | null
  onAct: (p: TransportRunPassenger, e: 'board' | 'alight' | 'mark_absent' | 'undo') => void
}) {
  const eta = relativeMinutes(stop.eta_at)
  const arrived = !!stop.arrived_at
  const left = !!stop.departed_at

  return (
    <div
      className={`rounded-2xl border overflow-hidden ${
        isCurrent ? 'border-orange-300 bg-white shadow-md' : 'border-slate-200 bg-white'
      }`}
    >
      <div className={`px-4 py-3 flex items-center gap-3 ${isCurrent ? 'bg-orange-50' : ''}`}>
        <span
          className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0 ${
            left ? 'bg-slate-200 text-slate-500'
              : arrived ? 'bg-emerald-500 text-white'
              : 'bg-slate-900 text-white'
          }`}
        >
          {stop.seq}
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-slate-900 truncate">
            {stop.stop?.name ?? 'Stop'}
          </p>
          <p className="text-xs text-slate-500 truncate">
            {arrived
              ? `Arrived ${formatClock(stop.arrived_at)}${left ? ` · left ${formatClock(stop.departed_at)}` : ''}`
              : eta
                ? `${eta}${stop.scheduled_arrival_at ? ` · due ${formatClock(stop.scheduled_arrival_at)}` : ''}`
                : stop.scheduled_arrival_at
                  ? `Due ${formatClock(stop.scheduled_arrival_at)}`
                  : 'Not timed'}
          </p>
        </div>
        <span className="text-xs text-slate-400 flex items-center gap-1 flex-shrink-0">
          <Users size={12} /> {passengers.length}
        </span>
      </div>

      {passengers.length > 0 && (
        <div className="px-3 pb-3 space-y-1.5">
          {passengers.map(p => (
            <PassengerRow
              key={p.id} p={p} disabled={disabled} busy={busyId === p.student_id}
              direction={direction} onAct={onAct}
            />
          ))}
        </div>
      )}
    </div>
  )
}

const STATE_STYLE: Record<string, { label: string; chip: string }> = {
  expected: { label: 'Waiting', chip: 'bg-slate-100 text-slate-600' },
  boarded:  { label: 'On board', chip: 'bg-emerald-100 text-emerald-700' },
  dropped:  { label: 'Dropped off', chip: 'bg-sky-100 text-sky-700' },
  absent:   { label: 'Absent', chip: 'bg-rose-100 text-rose-700' },
  no_show:  { label: 'Did not board', chip: 'bg-rose-100 text-rose-700' },
  excused:  { label: 'On leave', chip: 'bg-violet-100 text-violet-700' },
}

function PassengerRow({
  p, disabled, busy, direction, onAct,
}: {
  p: TransportRunPassenger
  disabled: boolean
  busy: boolean
  direction: 'inbound' | 'outbound'
  onAct: (p: TransportRunPassenger, e: 'board' | 'alight' | 'mark_absent' | 'undo') => void
}) {
  const style = STATE_STYLE[p.state] ?? STATE_STYLE.expected
  // A child the school already knows is away is shown greyed and untappable,
  // so the driver never has to work through names that were never coming.
  const excused = p.state === 'excused'

  const primary: 'board' | 'alight' | 'undo' =
    p.state === 'expected' ? 'board'
      : p.state === 'boarded' ? 'alight'
        : 'undo'

  return (
    <div
      className={`flex items-center gap-2.5 rounded-xl border px-2.5 py-2 ${
        excused ? 'border-slate-100 bg-slate-50 opacity-60' : 'border-slate-200'
      }`}
    >
      <Avatar
        avatarUrl={p.student?.avatar_url ?? undefined}
        name={p.student?.full_name ?? '?'}
        size={32}
        userId={p.student_id}
      />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-slate-900 truncate">
          {p.student?.full_name ?? 'Student'}
        </p>
        <p className="text-[11px] text-slate-500 truncate">
          {p.student?.grade ? `Grade ${p.student.grade}${p.student.section ? ` · ${p.student.section}` : ''}` : ''}
          {excused && p.excuse_reason === 'leave' ? ' · on approved leave' : ''}
        </p>
      </div>

      <span className={`text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded-full ${style.chip}`}>
        {style.label}
      </span>

      {!excused && (
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            onClick={() => onAct(p, primary)}
            disabled={disabled || busy}
            className={`px-3 py-2 rounded-lg text-xs font-bold transition-colors disabled:opacity-40 ${
              primary === 'board' ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                : primary === 'alight' ? 'bg-sky-600 text-white hover:bg-sky-700'
                  : 'bg-slate-200 text-slate-700 hover:bg-slate-300'
            }`}
          >
            {busy ? <Loader2 size={13} className="animate-spin" />
              : primary === 'board' ? 'Board'
                : primary === 'alight' ? (direction === 'inbound' ? 'At school' : 'Dropped')
                  : 'Undo'}
          </button>
          {p.state === 'expected' && (
            <button
              onClick={() => onAct(p, 'mark_absent')}
              disabled={disabled || busy}
              className="px-2 py-2 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors disabled:opacity-40"
              aria-label="Mark absent"
              title="Not here"
            >
              <CircleSlash size={15} />
            </button>
          )}
        </div>
      )}
    </div>
  )
}
