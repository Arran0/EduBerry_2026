'use client'

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  Bus, Banknote, ArrowRight, ArrowLeft, Clock, Users, CheckCircle2, ChevronRight, Play, Radio,
} from 'lucide-react'
import DriverLayout from '@/components/DriverLayout'
import { useAuth } from '@/contexts/AuthContext'
import { fetchMyRuns, formatClock, todayISO } from '@/lib/transport/runs'
import { vehicleLabel } from '@/lib/transport/vehicles'
import type { TransportRun } from '@/lib/transport/types'
import { DIRECTION_LABELS, RUN_STATUS_LABELS } from '@/lib/transport/types'

const isLive = (r: TransportRun) => r.status === 'in_progress' || r.status === 'boarding'

function greeting(d: Date): string {
  const h = d.getHours()
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
}

/**
 * The driver's day.
 *
 * A driver opens this with the engine running, so the one thing to do next is
 * the whole hero: the trip that is live, or else the next one due, with a
 * single big button. Everything else today sits below it as a quiet list.
 */
export default function DriverDashboardPage() {
  const { profile, dataRefreshKey } = useAuth()
  const router = useRouter()
  const [runs, setRuns] = useState<TransportRun[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    setRuns(await fetchMyRuns(todayISO()))
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load, dataRefreshKey])

  const now = new Date()
  const firstName = profile?.full_name?.split(' ')[0] ?? 'there'
  const dateLabel = now.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })

  const next = useMemo(
    () => runs.find(isLive) ?? runs.find(r => r.status === 'scheduled') ?? null,
    [runs],
  )
  const rest = runs.filter(r => r.id !== next?.id)
  const finished = runs.filter(r => r.status === 'completed').length

  return (
    <DriverLayout>
      <div className="space-y-5 lg:max-w-3xl">
        <div className="px-1">
          <h1 className="text-[1.65rem] font-bold leading-tight tracking-[-0.015em] text-[#13306B]">
            {greeting(now)}, {firstName}
          </h1>
          <p className="text-sm text-[#5B6676] mt-0.5">
            {dateLabel}
            {!loading && runs.length > 0 && ` · ${runs.length} ${runs.length === 1 ? 'trip' : 'trips'}, ${finished} finished`}
          </p>
        </div>

        {loading ? (
          <div className="space-y-3">
            <div className="h-56 rounded-[28px] bg-white/60 animate-pulse" />
            <div className="h-20 rounded-[24px] bg-white/60 animate-pulse" />
          </div>
        ) : runs.length === 0 ? (
          <div className="bus-glass px-5 py-10 text-center">
            <span className="mx-auto mb-3 w-14 h-14 rounded-2xl bg-[#FFC72C] text-[#13306B] flex items-center justify-center shadow-[inset_0_1px_0_rgba(255,255,255,.6)]">
              <Bus size={26} strokeWidth={1.8} />
            </span>
            <p className="text-base font-bold text-[#13306B]">No trips today</p>
            <p className="text-sm text-[#5B6676] mt-1">
              If you were expecting one, check with the transport office.
            </p>
          </div>
        ) : (
          <>
            {next ? <NextTrip run={next} onOpen={() => router.push(`/driver/run/${next.id}`)} /> : (
              <div className="bus-glass px-5 py-5 flex items-center gap-3">
                <CheckCircle2 size={22} className="text-emerald-600 flex-shrink-0" />
                <div>
                  <p className="text-base font-bold text-[#13306B]">All done for today</p>
                  <p className="text-sm text-[#5B6676]">Every trip is finished. Drive safe.</p>
                </div>
              </div>
            )}

            {rest.length > 0 && (
              <section>
                <h2 className="px-1 mb-2 text-[13px] font-semibold text-[#5B6676]">
                  {next ? 'Later today' : 'Today'}
                </h2>
                <div className="bus-glass p-1.5">
                  {rest.map((run, i) => (
                    <TripRow key={run.id} run={run} divider={i > 0} onOpen={() => router.push(`/driver/run/${run.id}`)} />
                  ))}
                </div>
              </section>
            )}
          </>
        )}

        <Link
          href="/driver/salary"
          className="bus-glass flex items-center gap-3 px-4 py-3.5 transition active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FFC72C]"
        >
          <span className="w-10 h-10 rounded-2xl bg-[#13306B] text-[#FFC72C] flex items-center justify-center flex-shrink-0">
            <Banknote size={18} />
          </span>
          <span className="flex-1 min-w-0">
            <span className="block text-[15px] font-bold text-[#13306B]">My salary</span>
            <span className="block text-[12.5px] text-[#5B6676]">Payslips and the bank account on file</span>
          </span>
          <ChevronRight size={18} className="text-[#94A0B1]" />
        </Link>
      </div>
    </DriverLayout>
  )
}

/** The trip to do now: what it is, when, with whom — and one button. */
function NextTrip({ run, onOpen }: { run: TransportRun; onOpen: () => void }) {
  const live = isLive(run)
  return (
    <div className="bus-slab px-5 pt-5 pb-7 sm:px-6 sm:pt-6 sm:pb-8">
      <div className="relative z-[1]">
        <div className="flex items-center justify-between gap-3">
          <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-white/75">
            {run.direction === 'inbound' ? <ArrowRight size={15} /> : <ArrowLeft size={15} />}
            {DIRECTION_LABELS[run.direction]}
          </span>
          {live ? (
            <span className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full bg-[#FFC72C] text-[#13306B] text-[11.5px] font-bold">
              <span className="w-1.5 h-1.5 rounded-full bg-[#13306B] animate-pulse" /> {RUN_STATUS_LABELS[run.status]}
            </span>
          ) : (
            <span className="text-[13px] font-semibold text-white/75">Next trip</span>
          )}
        </div>

        <p className="mt-2 text-[1.75rem] sm:text-[2rem] font-bold leading-[1.1] tracking-[-0.02em] truncate">
          {run.route?.name ?? 'Route'}
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-white/80">
          <span className="inline-flex items-center gap-1.5 tabular-nums">
            <Clock size={14} className="text-[#FFC72C]" /> {formatClock(run.scheduled_start_at)}
          </span>
          {run.vehicle && (
            <span className="inline-flex items-center gap-1.5">
              <Bus size={14} className="text-[#FFC72C]" /> {vehicleLabel(run.vehicle)}
            </span>
          )}
          {run.attendant?.full_name && (
            <span className="inline-flex items-center gap-1.5">
              <Users size={14} className="text-[#FFC72C]" /> with {run.attendant.full_name.split(' ')[0]}
            </span>
          )}
        </div>

        <button
          onClick={onOpen}
          className="mt-5 w-full h-14 rounded-2xl bg-[#FFC72C] hover:bg-[#FFD452] text-[#13306B] text-base font-bold flex items-center justify-center gap-2 shadow-[inset_0_1px_0_rgba(255,255,255,.65),0_10px_24px_-12px_rgba(255,199,44,.8)] active:scale-[0.98] transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/40"
        >
          {live ? <><Radio size={18} /> Continue trip</> : <><Play size={18} /> Open trip</>}
        </button>
      </div>
    </div>
  )
}

function TripRow({ run, divider, onOpen }: { run: TransportRun; divider: boolean; onOpen: () => void }) {
  const done = run.status === 'completed'
  return (
    <button
      onClick={onOpen}
      className={`w-full text-left flex items-center gap-3 px-3 py-3 rounded-[18px] hover:bg-white/80 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FFC72C] ${
        divider ? 'mt-0.5' : ''
      }`}
    >
      <span className={`w-14 text-[15px] font-bold tabular-nums flex-shrink-0 ${done ? 'text-[#94A0B1]' : 'text-[#13306B]'}`}>
        {formatClock(run.scheduled_start_at)}
      </span>
      <span className="w-1 self-stretch rounded-full flex-shrink-0" style={{ background: run.route?.color ?? '#FFC72C' }} />
      <span className="flex-1 min-w-0">
        <span className={`block text-[15px] font-semibold truncate ${done ? 'text-[#5B6676]' : 'text-[#13306B]'}`}>
          {run.route?.name ?? 'Route'}
        </span>
        <span className="block text-[12.5px] text-[#5B6676] truncate">
          {DIRECTION_LABELS[run.direction]}
          {run.vehicle ? ` · ${vehicleLabel(run.vehicle)}` : ''}
        </span>
      </span>
      {done ? (
        <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-emerald-700 flex-shrink-0">
          <CheckCircle2 size={14} /> Finished
        </span>
      ) : (
        <span className="text-[12px] font-medium text-[#5B6676] flex-shrink-0">{RUN_STATUS_LABELS[run.status]}</span>
      )}
      <ChevronRight size={16} className="text-[#CBD3DD] flex-shrink-0" />
    </button>
  )
}
