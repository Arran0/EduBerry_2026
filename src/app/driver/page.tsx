'use client'

import React, { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { Bus, Banknote } from 'lucide-react'
import DriverLayout from '@/components/DriverLayout'
import DriverTripCard from '@/components/bus/DriverTripCard'
import { useAuth } from '@/contexts/AuthContext'
import {
  BusTrip, fetchDriverTripsForDate, fetchTripRoster, TripRosterRow,
} from '@/lib/bus'

interface TripWithCounts {
  trip: BusTrip
  pickedUp: number
  dropped: number
  total: number
}

function todayISO(): string {
  return new Date().toLocaleDateString('en-CA') // YYYY-MM-DD in local time
}

function countRoster(rows: TripRosterRow[]) {
  let pickedUp = 0, dropped = 0
  for (const r of rows) {
    if (r.record?.status === 'picked_up') pickedUp++
    else if (r.record?.status === 'dropped') dropped++
  }
  return { pickedUp, dropped, total: rows.length }
}

export default function DriverDashboardPage() {
  const { user, profile, dataRefreshKey } = useAuth()
  const [loading, setLoading] = useState(true)
  const [trips, setTrips] = useState<TripWithCounts[]>([])
  const today = todayISO()

  const load = useCallback(async () => {
    if (!profile) return
    setLoading(true)
    const driverTrips = await fetchDriverTripsForDate(profile.id, today)
    const withCounts = await Promise.all(
      driverTrips.map(async trip => ({ trip, ...countRoster(await fetchTripRoster(trip.id, today)) })),
    )
    setTrips(withCounts)
    setLoading(false)
  }, [profile, today])

  useEffect(() => { load() }, [load, dataRefreshKey])

  const firstName = profile?.full_name?.split(' ')[0] ?? 'Driver'
  const dateLabel = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })

  return (
    <DriverLayout>
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-800">Hi {firstName} 👋</h1>
          <p className="text-slate-500 text-sm">{dateLabel}</p>
        </div>
        <Link
          href="/driver/salary"
          className="flex items-center gap-1.5 text-xs font-medium text-slate-600 bg-white border border-slate-200 px-3 py-2 rounded-xl hover:bg-slate-50 transition-colors"
        >
          <Banknote size={15} /> Salary
        </Link>
      </div>

      {loading && !user ? null : loading ? (
        <div className="text-center py-12"><div className="spinner mx-auto mb-3" /><p className="text-sm text-slate-500">Loading today&apos;s trips…</p></div>
      ) : trips.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-8 text-center">
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-orange-50 flex items-center justify-center">
            <Bus size={30} className="text-orange-500" strokeWidth={1.5} />
          </div>
          <h2 className="text-lg font-semibold text-slate-800 mb-1">No trip assigned today</h2>
          <p className="text-sm text-slate-500 leading-relaxed max-w-sm mx-auto">
            When an admin assigns you to a bus trip for today, it will appear here with
            the passenger list and pickup/drop controls.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">
            Today&apos;s trip{trips.length === 1 ? '' : 's'}
          </p>
          {trips.map(({ trip, pickedUp, dropped, total }) => (
            <DriverTripCard
              key={trip.id}
              trip={trip}
              pickedUp={pickedUp}
              dropped={dropped}
              total={total}
              isSubstitute={profile ? trip.default_driver_id !== profile.id : false}
            />
          ))}
        </div>
      )}
    </DriverLayout>
  )
}
