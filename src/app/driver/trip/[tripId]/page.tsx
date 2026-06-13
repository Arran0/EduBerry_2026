'use client'

import React, { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { ArrowLeft, MapPin, AlertCircle } from 'lucide-react'
import DriverLayout from '@/components/DriverLayout'
import TripProgressHeader from '@/components/bus/TripProgressHeader'
import PassengerAttendanceRow from '@/components/bus/PassengerAttendanceRow'
import { useDriverLocationStream } from '@/hooks/useDriverLocationStream'
import { useAuth } from '@/contexts/AuthContext'
import {
  BusTrip, TripRosterRow, TripAttendanceStatus,
  fetchTrip, fetchTripRoster, markPassenger,
} from '@/lib/bus'

function todayISO(): string {
  return new Date().toLocaleDateString('en-CA')
}

// absent (waiting) → picked_up → dropped → absent …
const NEXT_STATUS: Record<TripAttendanceStatus, TripAttendanceStatus> = {
  absent: 'picked_up',
  picked_up: 'dropped',
  dropped: 'absent',
}

function statusOf(row: TripRosterRow): TripAttendanceStatus {
  return row.record?.status ?? 'absent'
}

export default function DriverTripPage() {
  const params = useParams<{ tripId: string }>()
  const tripId = params.tripId
  const { profile, dataRefreshKey } = useAuth()
  const today = todayISO()

  const [loading, setLoading] = useState(true)
  const [trip, setTrip] = useState<BusTrip | null>(null)
  const [roster, setRoster] = useState<TripRosterRow[]>([])
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const stream = useDriverLocationStream(tripId)

  const load = useCallback(async () => {
    setLoading(true)
    const [t, r] = await Promise.all([fetchTrip(tripId), fetchTripRoster(tripId, today)])
    setTrip(t)
    setRoster(r)
    setLoading(false)
  }, [tripId, today])

  useEffect(() => { load() }, [load, dataRefreshKey])

  const cycle = async (row: TripRosterRow) => {
    const next = NEXT_STATUS[statusOf(row)]
    const passengerId = row.passenger.id
    setBusyId(passengerId)
    setError(null)

    // Optimistic: reflect the new status immediately.
    setRoster(prev => prev.map(r =>
      r.passenger.id === passengerId
        ? { ...r, record: { ...(r.record ?? {} as TripRosterRow['record']), status: next } as TripRosterRow['record'] }
        : r,
    ))

    const result = await markPassenger(tripId, passengerId, today, next)
    if (!result.success) {
      // Revert on failure.
      setRoster(prev => prev.map(r =>
        r.passenger.id === passengerId ? { ...r, record: row.record } : r,
      ))
      setError(result.error ?? 'Failed to save. Please try again.')
    }
    setBusyId(null)
  }

  const pickedUp = roster.filter(r => statusOf(r) === 'picked_up').length
  const dropped = roster.filter(r => statusOf(r) === 'dropped').length

  return (
    <DriverLayout>
      <Link href="/driver" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 mb-4">
        <ArrowLeft size={16} /> Today&apos;s trips
      </Link>

      {loading ? (
        <div className="text-center py-12"><div className="spinner mx-auto mb-3" /><p className="text-sm text-slate-500">Loading trip…</p></div>
      ) : !trip ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center text-slate-500">
          Trip not found, or you are not assigned to it today.
        </div>
      ) : (
        <>
          <TripProgressHeader
            tripName={trip.name}
            pickupTime={trip.pickup_time}
            dropTime={trip.drop_time}
            pickedUp={pickedUp}
            dropped={dropped}
            total={roster.length}
          />

          {/* Live location sharing */}
          <button
            type="button"
            onClick={() => (stream.sharing ? stream.stop() : stream.start())}
            className={`mt-3 w-full flex items-center justify-center gap-2 text-sm font-semibold py-3 rounded-2xl transition-colors ${
              stream.sharing
                ? 'bg-emerald-500 text-white hover:bg-emerald-600'
                : 'bg-white border border-slate-300 text-slate-700 hover:bg-slate-50'
            }`}
          >
            {stream.sharing ? (
              <>
                <span className="relative flex h-2.5 w-2.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75" />
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-white" />
                </span>
                Sharing live location · tap to stop
              </>
            ) : (
              <><MapPin size={16} /> Share live location</>
            )}
          </button>
          {stream.error && (
            <p className="mt-2 text-xs text-rose-600 flex items-center gap-1.5">
              <AlertCircle size={13} /> {stream.error}
            </p>
          )}
          {stream.sharing && stream.lastSentAt && (
            <p className="mt-1.5 text-[11px] text-slate-400 text-center">
              Passengers can see the bus. Last update {new Date(stream.lastSentAt).toLocaleTimeString()}.
            </p>
          )}

          {error && (
            <div className="mt-3 flex items-center gap-2 p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-xs">
              <AlertCircle size={14} className="flex-shrink-0" /> {error}
            </div>
          )}

          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mt-5 mb-2">
            Passengers · tap to update
          </p>

          {roster.length === 0 ? (
            <div className="bg-white rounded-2xl border border-slate-200 p-6 text-center text-sm text-slate-500">
              No passengers assigned to this trip.
            </div>
          ) : (
            <div className="space-y-2 pb-6">
              {roster.map(row => (
                <PassengerAttendanceRow
                  key={row.passenger.id}
                  passenger={row.passenger}
                  status={statusOf(row)}
                  busy={busyId === row.passenger.id}
                  onCycle={() => cycle(row)}
                />
              ))}
            </div>
          )}
        </>
      )}
    </DriverLayout>
  )
}
