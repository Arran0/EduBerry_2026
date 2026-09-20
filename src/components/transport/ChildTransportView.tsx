'use client'

import React, { useEffect, useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import {
  Bus, MapPin, Phone, MessageCircle, AlertTriangle, CheckCircle2, Clock,
  Loader2, WifiOff, CalendarOff,
} from 'lucide-react'
import Avatar from '@/components/Avatar'
import { useChildTransport } from '@/hooks/useChildTransport'
import { fetchCrewCards, type CrewCard } from '@/lib/transport/staff'
import { fixAgeSeconds, formatClock, relativeMinutes } from '@/lib/transport/runs'
import { vehicleLabel } from '@/lib/transport/vehicles'
import type { ChildTransportState } from '@/hooks/useChildTransport'
import { ALERT_TYPE_LABELS, DIRECTION_LABELS } from '@/lib/transport/types'

const TransportMap = dynamic(() => import('./TransportMap'), {
  ssr: false,
  loading: () => (
    <div className="h-[300px] rounded-2xl border border-slate-200 bg-slate-50 flex items-center justify-center">
      <Loader2 className="animate-spin text-slate-300" size={20} />
    </div>
  ),
})

/**
 * The parent screen.
 *
 * Headed by the child's name, not the bus's, because that is the question being
 * asked. Every block below answers one part of it, and the hero answers all of
 * it in a sentence for the case — the common case — where the parent only
 * glances.
 */
export default function ChildTransportView({
  studentId, studentName, avatarUrl,
}: {
  studentId: string
  studentName: string
  avatarUrl?: string | null
}) {
  const state = useChildTransport(studentId)
  const { loading, assignment, activeRun, stops, myStop, me, alerts, routeStops } = state
  const [crew, setCrew] = useState<Record<string, CrewCard>>({})

  // The run row carries the crew's names; their phone numbers live on the
  // transport_staff record, which RLS narrows to what a parent may see.
  useEffect(() => {
    const ids = [activeRun?.driver_id, activeRun?.attendant_id].filter(Boolean) as string[]
    if (ids.length === 0) { setCrew({}); return }
    let alive = true
    fetchCrewCards(ids).then(c => { if (alive) setCrew(c) })
    return () => { alive = false }
  }, [activeRun?.driver_id, activeRun?.attendant_id])

  const firstName = studentName.split(' ')[0]
  const hero = useMemo(() => heroLine(state, firstName), [state, firstName])

  if (loading) {
    return <div className="h-64 rounded-2xl bg-slate-100 animate-pulse" />
  }

  if (!assignment) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white px-5 py-10 text-center">
        <Bus size={30} className="mx-auto text-slate-300 mb-3" strokeWidth={1.5} />
        <p className="text-base font-semibold text-slate-700">{firstName} isn&apos;t on a bus route</p>
        <p className="text-sm text-slate-500 mt-1">
          If that&apos;s wrong, the school office can add them to one.
        </p>
      </div>
    )
  }

  const stale = activeRun ? activeRun.telemetry_state !== 'live' : true
  const ageSec = activeRun ? fixAgeSeconds(activeRun) : null
  const mapStops = routeStops.map(s => ({
    id: s.id, seq: s.seq, name: s.name, lat: s.lat, lng: s.lng,
    radius_m: s.radius_m, shape: s.shape, polygon: s.polygon,
    isSchool: s.kind === 'school',
  }))

  return (
    <div className="space-y-4">
      {/* Hero */}
      <div className="rounded-2xl bg-gradient-to-br from-slate-900 to-slate-700 text-white px-5 py-5">
        <div className="flex items-center gap-3">
          <Avatar avatarUrl={avatarUrl ?? undefined} name={studentName} size={40} userId={studentId} />
          <div className="min-w-0">
            <p className="text-lg font-bold leading-tight">{hero.title}</p>
            {hero.detail && <p className="text-sm opacity-80 mt-0.5">{hero.detail}</p>}
          </div>
        </div>
      </div>

      {/* Anything the school needs the parent to know comes before the map. */}
      {alerts.length > 0 && (
        <div className="space-y-2">
          {alerts.map(a => (
            <div
              key={a.id}
              className={`rounded-xl px-3.5 py-3 border ${
                a.severity === 'critical'
                  ? 'bg-rose-50 border-rose-200 text-rose-800'
                  : 'bg-amber-50 border-amber-200 text-amber-800'
              }`}
            >
              <p className="text-sm font-semibold flex items-center gap-1.5">
                <AlertTriangle size={14} /> {a.title}
              </p>
              {a.detail && <p className="text-xs mt-0.5 opacity-90">{a.detail}</p>}
              <p className="text-[10px] uppercase tracking-wider opacity-60 mt-1">
                {ALERT_TYPE_LABELS[a.type]}
              </p>
            </div>
          ))}
        </div>
      )}

      {activeRun && (
        /* On a phone this is one column in order of urgency. On a desktop the
           map takes the space it deserves on the left and sticks while the
           answers beside it scroll — a parent watching a bus approach should
           not have to choose between seeing it and reading the ETA. */
        <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_24rem] lg:gap-5 lg:items-start space-y-4 lg:space-y-0">
        <div className="space-y-4 lg:sticky lg:top-4">
          <TransportMap
            stops={mapStops}
            selectedStopId={myStop?.stop_id ?? null}
            bus={
              activeRun.last_lat != null && activeRun.last_lng != null
                ? { lat: activeRun.last_lat, lng: activeRun.last_lng, label: vehicleLabel(activeRun.vehicle) }
                : null
            }
            showFences={false}
            heightClass="h-[300px] lg:h-[32rem]"
            className="rounded-2xl overflow-hidden border border-slate-200"
          />

          {stale && (
            <p className="text-xs text-amber-600 flex items-center gap-1.5">
              <WifiOff size={13} />
              {ageSec == null
                ? 'The bus hasn’t reported its position yet.'
                : `Last seen ${Math.round(ageSec / 60)} min ago — showing scheduled times until it reports again.`}
            </p>
          )}
        </div>

        <div className="space-y-4">
          {/* My stop — the ETA that actually matters. */}
          {myStop && (
            <div className="rounded-2xl border border-slate-200 bg-white px-4 py-4">
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                {activeRun.direction === 'inbound' ? 'Pickup stop' : 'Drop-off stop'}
              </p>
              <p className="text-base font-bold text-slate-900 mt-1 flex items-center gap-1.5">
                <MapPin size={15} className="text-slate-400" /> {myStop.stop?.name ?? 'Your stop'}
              </p>
              <div className="flex items-baseline gap-3 mt-2">
                {myStop.arrived_at ? (
                  <span className="text-sm text-emerald-700 font-semibold flex items-center gap-1">
                    <CheckCircle2 size={14} /> Reached at {formatClock(myStop.arrived_at)}
                  </span>
                ) : myStop.eta_at ? (
                  <>
                    <span className="text-2xl font-bold text-slate-900">
                      {relativeMinutes(myStop.eta_at)}
                    </span>
                    <span className="text-xs text-slate-500">
                      about {formatClock(myStop.eta_at)}
                    </span>
                  </>
                ) : (
                  <span className="text-sm text-slate-500">
                    {myStop.scheduled_arrival_at
                      ? `Scheduled ${formatClock(myStop.scheduled_arrival_at)}`
                      : 'No time set'}
                  </span>
                )}
              </div>
              {myStop.scheduled_arrival_at && myStop.eta_at && !myStop.arrived_at && (
                <p className="text-xs text-slate-500 mt-1">
                  Scheduled {formatClock(myStop.scheduled_arrival_at)}
                  {typeof activeRun.delay_seconds === 'number' && activeRun.delay_seconds > 60
                    ? ` · running ${Math.round(activeRun.delay_seconds / 60)} min late`
                    : ' · on time'}
                </p>
              )}
            </div>
          )}

          {/* Journey so far */}
          <div className="rounded-2xl border border-slate-200 bg-white px-4 py-4">
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2.5">
              {firstName}&apos;s journey
            </p>
            <Timeline me={me} direction={activeRun.direction} />
          </div>

          {/* Progress */}
          <div className="rounded-2xl border border-slate-200 bg-white px-4 py-4">
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">
              Where the bus is
            </p>
            {stops.filter(s => !s.skipped).map(s => {
              const isNext = activeRun.next_stop_id === s.stop_id
              const isMine = myStop?.stop_id === s.stop_id
              return (
                <div key={s.id} className="flex items-center gap-2.5 py-1">
                  <span
                    className={`w-2 h-2 rounded-full flex-shrink-0 ${
                      s.arrived_at ? 'bg-emerald-500' : isNext ? 'bg-orange-500 animate-pulse' : 'bg-slate-200'
                    }`}
                  />
                  <span className={`flex-1 min-w-0 text-sm truncate ${
                    isMine ? 'font-bold text-slate-900' : s.arrived_at ? 'text-slate-400' : 'text-slate-600'
                  }`}>
                    {s.stop?.name ?? 'Stop'}{isMine ? ' · your stop' : ''}
                  </span>
                  <span className="text-xs text-slate-400 flex-shrink-0">
                    {s.arrived_at ? formatClock(s.arrived_at)
                      : s.eta_at ? relativeMinutes(s.eta_at)
                        : formatClock(s.scheduled_arrival_at) ?? ''}
                  </span>
                </div>
              )
            })}
          </div>

          {/* Crew */}
          {(activeRun.driver || activeRun.attendant) && (
            <div className="rounded-2xl border border-slate-200 bg-white px-4 py-4">
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2.5">
                Today&apos;s crew
              </p>
              <div className="space-y-2.5">
                {activeRun.driver && (
                  <CrewRow person={activeRun.driver} role="Driver" phone={crew[activeRun.driver.id]?.phone ?? null} />
                )}
                {activeRun.attendant && (
                  <CrewRow person={activeRun.attendant} role="Attendant" phone={crew[activeRun.attendant.id]?.phone ?? null} />
                )}
              </div>
              {activeRun.vehicle && (
                <p className="text-xs text-slate-500 mt-3 flex items-center gap-1.5">
                  <Bus size={13} /> {vehicleLabel(activeRun.vehicle)} · {activeRun.vehicle.registration_no}
                </p>
              )}
              {activeRun.change_note && (
                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-2.5 py-2 mt-3">
                  {activeRun.change_note}
                </p>
              )}
            </div>
          )}
        </div>
        </div>
      )}
    </div>
  )
}

/**
 * One sentence that answers the question.
 *
 * Ordered by what a parent most wants to know first: something is wrong, then
 * the child is aboard, then when the bus arrives, then why there is nothing to
 * show. "No trip today" and "on leave" are first-class answers, not empty
 * states — a blank screen reads as a broken app at exactly the moment a parent
 * is anxious.
 */
function heroLine(s: ChildTransportState, firstName: string): { title: string; detail?: string } {
  const { activeRun, me, myStop, runs } = s

  if (me?.state === 'excused') {
    return { title: `${firstName} is marked on leave`, detail: 'We’re not expecting them on the bus today.' }
  }
  if (!activeRun) {
    if (runs.length === 0) return { title: 'No bus today', detail: 'There are no trips scheduled on this route.' }
    return { title: 'No trip running', detail: 'Today’s trips have finished.' }
  }
  if (me?.state === 'dropped') {
    return {
      title: activeRun.direction === 'inbound'
        ? `${firstName} arrived at school`
        : `${firstName} was dropped off`,
      detail: me.alighted_at ? `At ${formatClock(me.alighted_at)}.` : undefined,
    }
  }
  if (me?.state === 'boarded') {
    const next = activeRun.next_stop_eta_at ? relativeMinutes(activeRun.next_stop_eta_at) : null
    return {
      title: `${firstName} is on the bus`,
      detail: activeRun.direction === 'inbound'
        ? next ? `Reaching school ${next}.` : 'On the way to school.'
        : next ? `Next stop ${next}.` : 'On the way home.',
    }
  }
  if (me?.state === 'absent' || me?.state === 'no_show') {
    return { title: `${firstName} did not board`, detail: 'The school has been notified.' }
  }
  if (activeRun.status === 'scheduled') {
    return {
      title: 'Bus hasn’t started yet',
      detail: `Due to leave at ${formatClock(activeRun.scheduled_start_at)}.`,
    }
  }
  if (myStop?.eta_at) {
    return {
      title: `Bus arriving ${relativeMinutes(myStop.eta_at)}`,
      detail: `At ${myStop.stop?.name ?? 'your stop'}.`,
    }
  }
  return {
    title: `Bus is on its way`,
    detail: `${DIRECTION_LABELS[activeRun.direction]} — waiting for a position update.`,
  }
}

function CrewRow({
  person, role, phone,
}: {
  person: { id: string; full_name: string; avatar_url?: string | null }
  role: string
  phone: string | null
}) {
  // Same digits-only normalisation ProfileCard uses for its wa.me links.
  const digits = phone ? phone.replace(/\D/g, '') : ''

  return (
    <div className="flex items-center gap-2.5">
      <Avatar avatarUrl={person.avatar_url ?? undefined} name={person.full_name} size={30} userId={person.id} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-slate-900 truncate">{person.full_name}</p>
        <p className="text-[11px] text-slate-500">{role}</p>
      </div>
      {digits && (
        <div className="flex items-center gap-1 flex-shrink-0">
          <a
            href={`tel:${digits}`}
            className="p-2 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors"
            aria-label={`Call ${person.full_name}`}
          >
            <Phone size={15} />
          </a>
          <a
            href={`https://wa.me/${digits}`}
            target="_blank"
            rel="noreferrer"
            className="p-2 rounded-lg text-emerald-600 hover:bg-emerald-50 transition-colors"
            aria-label={`WhatsApp ${person.full_name}`}
          >
            <MessageCircle size={15} />
          </a>
        </div>
      )}
    </div>
  )
}

function Timeline({
  me, direction,
}: {
  me: { state: string; boarded_at: string | null; alighted_at: string | null } | null
  direction: 'inbound' | 'outbound'
}) {
  const steps = direction === 'inbound'
    ? [
      { label: 'Boarded the bus', at: me?.boarded_at, done: !!me?.boarded_at },
      { label: 'Arrived at school', at: me?.alighted_at, done: !!me?.alighted_at },
    ]
    : [
      { label: 'Boarded for home', at: me?.boarded_at, done: !!me?.boarded_at },
      { label: 'Dropped off', at: me?.alighted_at, done: !!me?.alighted_at },
    ]

  if (me?.state === 'excused') {
    return (
      <p className="text-sm text-violet-700 flex items-center gap-1.5">
        <CalendarOff size={14} /> On approved leave today.
      </p>
    )
  }

  return (
    <div className="space-y-2">
      {steps.map(step => (
        <div key={step.label} className="flex items-center gap-2.5">
          {step.done
            ? <CheckCircle2 size={16} className="text-emerald-500 flex-shrink-0" />
            : <Clock size={16} className="text-slate-300 flex-shrink-0" />}
          <span className={`flex-1 text-sm ${step.done ? 'text-slate-900' : 'text-slate-400'}`}>
            {step.label}
          </span>
          {step.at && <span className="text-xs text-slate-500">{formatClock(step.at)}</span>}
        </div>
      ))}
    </div>
  )
}
