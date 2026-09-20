'use client'

import React, { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Bus, Banknote, ArrowRight, ArrowLeft, Clock, Users, CheckCircle2 } from 'lucide-react'
import DriverLayout from '@/components/DriverLayout'
import { useAuth } from '@/contexts/AuthContext'
import { fetchMyRuns, formatClock, todayISO } from '@/lib/transport/runs'
import { vehicleLabel } from '@/lib/transport/vehicles'
import type { TransportRun } from '@/lib/transport/types'
import { DIRECTION_LABELS, RUN_STATUS_LABELS } from '@/lib/transport/types'

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

  const firstName = profile?.full_name?.split(' ')[0] ?? 'there'
  const dateLabel = new Date().toLocaleDateString([], {
    weekday: 'long', day: 'numeric', month: 'long',
  })

  return (
    <DriverLayout>
      <div className="space-y-5">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Hi {firstName} 👋</h1>
          <p className="text-sm text-slate-500">{dateLabel}</p>
        </div>

        {loading ? (
          <div className="space-y-3">
            {[0, 1].map(i => <div key={i} className="h-28 rounded-2xl bg-slate-100 animate-pulse" />)}
          </div>
        ) : runs.length === 0 ? (
          <div className="rounded-2xl border border-slate-200 bg-white px-5 py-10 text-center">
            <Bus size={30} className="mx-auto text-slate-300 mb-3" strokeWidth={1.5} />
            <p className="text-base font-semibold text-slate-700">No trips today</p>
            <p className="text-sm text-slate-500 mt-1">
              If you were expecting one, check with the transport office.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {runs.map(run => {
              const done = run.status === 'completed'
              const live = run.status === 'in_progress' || run.status === 'boarding'
              return (
                <button
                  key={run.id}
                  onClick={() => router.push(`/driver/run/${run.id}`)}
                  className={`w-full text-left rounded-2xl border bg-white px-4 py-4 transition-shadow ${
                    live ? 'border-orange-300 shadow-md' : 'border-slate-200 hover:shadow-sm'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <span
                      className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 text-white"
                      style={{ background: run.route?.color ?? '#F97316' }}
                    >
                      {run.direction === 'inbound' ? <ArrowRight size={20} /> : <ArrowLeft size={20} />}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-base font-bold text-slate-900 truncate">
                        {run.route?.name ?? 'Route'}
                      </p>
                      <p className="text-sm text-slate-500 truncate">
                        {DIRECTION_LABELS[run.direction]}
                        {run.vehicle ? ` · ${vehicleLabel(run.vehicle)}` : ''}
                      </p>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 text-xs text-slate-500">
                        <span className="inline-flex items-center gap-1">
                          <Clock size={12} /> {formatClock(run.scheduled_start_at)}
                        </span>
                        {done ? (
                          <span className="inline-flex items-center gap-1 text-emerald-600 font-semibold">
                            <CheckCircle2 size={12} /> Finished
                          </span>
                        ) : live ? (
                          <span className="inline-flex items-center gap-1 text-orange-600 font-semibold">
                            <span className="w-1.5 h-1.5 rounded-full bg-orange-500 animate-pulse" />
                            {RUN_STATUS_LABELS[run.status]}
                          </span>
                        ) : (
                          <span className="text-slate-400">{RUN_STATUS_LABELS[run.status]}</span>
                        )}
                        {run.attendant?.full_name && (
                          <span className="inline-flex items-center gap-1">
                            <Users size={12} /> with {run.attendant.full_name.split(' ')[0]}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        )}

        <Link
          href="/driver/salary"
          className="flex items-center gap-2 text-sm font-semibold text-slate-500 hover:text-slate-800 transition-colors"
        >
          <Banknote size={16} /> My salary
        </Link>
      </div>
    </DriverLayout>
  )
}
