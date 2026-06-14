'use client'

import React, { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { AnimatePresence } from 'framer-motion'
import {
  ArrowLeft, Bus, Pencil, Users, CalendarClock, ClipboardCheck, Clock,
} from 'lucide-react'
import ProtectedLayout from '@/components/ProtectedLayout'
import TripFormModal from '@/components/bus/TripFormModal'
import PassengerPicker from '@/components/bus/PassengerPicker'
import DriverOverrideEditor from '@/components/bus/DriverOverrideEditor'
import { UserProfile } from '@/lib/supabase'
import {
  BusTrip, TripDriverOverride, TripRosterRow,
  fetchTrip, fetchDrivers, fetchAssignablePassengers, fetchTripPassengers,
  fetchDriverOverrides, fetchTripRoster,
} from '@/lib/bus'

function todayISO(): string {
  return new Date().toLocaleDateString('en-CA')
}

function fmtTime(t?: string | null): string | null {
  if (!t) return null
  const [h, m] = t.split(':')
  const hour = parseInt(h, 10)
  const ampm = hour >= 12 ? 'PM' : 'AM'
  return `${hour % 12 === 0 ? 12 : hour % 12}:${m} ${ampm}`
}

export default function AdminTripDetailPage() {
  const params = useParams<{ tripId: string }>()
  const tripId = params.tripId
  const today = todayISO()

  const [loading, setLoading] = useState(true)
  const [trip, setTrip] = useState<BusTrip | null>(null)
  const [drivers, setDrivers] = useState<UserProfile[]>([])
  const [assignable, setAssignable] = useState<UserProfile[]>([])
  const [currentIds, setCurrentIds] = useState<string[]>([])
  const [overrides, setOverrides] = useState<TripDriverOverride[]>([])
  const [roster, setRoster] = useState<TripRosterRow[]>([])
  const [showEdit, setShowEdit] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const [t, d, a, passengers, ov, r] = await Promise.all([
      fetchTrip(tripId), fetchDrivers(), fetchAssignablePassengers(),
      fetchTripPassengers(tripId), fetchDriverOverrides(tripId), fetchTripRoster(tripId, today),
    ])
    setTrip(t); setDrivers(d); setAssignable(a)
    setCurrentIds(passengers.map(p => p.id)); setOverrides(ov); setRoster(r)
    setLoading(false)
  }, [tripId, today])

  useEffect(() => { load() }, [load])

  const pickedUp = roster.filter(r => r.record?.status === 'picked_up').length
  const dropped = roster.filter(r => r.record?.status === 'dropped').length

  return (
    <ProtectedLayout adminOnly>
      <div data-page-theme="bus" className="max-w-3xl mx-auto px-4 sm:px-6 py-6">
        <Link href="/more/bus" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 mb-4">
          <ArrowLeft size={16} /> Bus Manager
        </Link>

        {loading ? (
          <div className="text-center py-12"><div className="spinner mx-auto mb-3" /><p className="text-sm text-slate-500">Loading trip…</p></div>
        ) : !trip ? (
          <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center text-slate-500">Trip not found.</div>
        ) : (
          <div className="space-y-5">
            {/* Trip header / edit */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
              <div className="flex items-start gap-3">
                <div className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: 'linear-gradient(135deg, var(--page-gradient-from), var(--page-gradient-to))' }}>
                  <Bus size={22} className="text-white" />
                </div>
                <div className="flex-1 min-w-0">
                  <h1 className="font-display text-xl font-bold text-slate-800">{trip.name}</h1>
                  {trip.route_description && <p className="text-sm text-slate-500 mt-0.5">{trip.route_description}</p>}
                  <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs text-slate-500">
                    {fmtTime(trip.pickup_time) && <span className="flex items-center gap-1"><Clock size={12} /> Pickup {fmtTime(trip.pickup_time)}</span>}
                    {fmtTime(trip.drop_time) && <span className="flex items-center gap-1"><Clock size={12} /> Drop {fmtTime(trip.drop_time)}</span>}
                    <span>Default driver: <strong className="text-slate-700">{trip.default_driver?.full_name ?? 'None'}</strong></span>
                  </div>
                </div>
                <button onClick={() => setShowEdit(true)}
                  className="p-2 text-slate-400 hover:text-orange-600 hover:bg-orange-50 rounded-lg transition-colors" title="Edit trip">
                  <Pencil size={16} />
                </button>
              </div>
            </div>

            {/* Today's attendance summary */}
            <Section icon={<ClipboardCheck size={16} className="text-orange-500" />} title="Today's attendance">
              <div className="flex items-center gap-4">
                <Stat label="Picked up" value={pickedUp} color="text-emerald-600" />
                <Stat label="Dropped" value={dropped} color="text-blue-600" />
                <Stat label="Total" value={roster.length} color="text-slate-700" />
              </div>
              {roster.length === 0 && (
                <p className="text-xs text-slate-400 mt-2">Assign passengers below to enable attendance.</p>
              )}
            </Section>

            {/* Passengers */}
            <Section icon={<Users size={16} className="text-orange-500" />} title="Passengers">
              <PassengerPicker
                tripId={tripId}
                assignable={assignable}
                initialSelectedIds={currentIds}
                onSaved={load}
              />
            </Section>

            {/* Driver overrides */}
            <Section icon={<CalendarClock size={16} className="text-orange-500" />} title="Substitute drivers">
              <DriverOverrideEditor tripId={tripId} drivers={drivers} overrides={overrides} onChanged={load} />
            </Section>
          </div>
        )}

        <AnimatePresence>
          {showEdit && trip && (
            <TripFormModal
              trip={trip}
              drivers={drivers}
              onClose={() => setShowEdit(false)}
              onSaved={() => { setShowEdit(false); load() }}
            />
          )}
        </AnimatePresence>
      </div>
    </ProtectedLayout>
  )
}

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
      <div className="flex items-center gap-2 mb-3">
        {icon}
        <h2 className="font-semibold text-slate-800 text-sm">{title}</h2>
      </div>
      {children}
    </div>
  )
}

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div>
      <p className={`text-2xl font-bold tabular-nums ${color}`}>{value}</p>
      <p className="text-[11px] text-slate-400 uppercase tracking-wide">{label}</p>
    </div>
  )
}
