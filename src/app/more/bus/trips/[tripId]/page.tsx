'use client'

import React, { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { AnimatePresence } from 'framer-motion'
import {
  ArrowLeft, Bus, Pencil, Users, CalendarClock, ClipboardCheck, Clock, MapPin,
} from 'lucide-react'
import ProtectedLayout from '@/components/ProtectedLayout'
import TripFormModal from '@/components/bus/TripFormModal'
import PassengerPicker from '@/components/bus/PassengerPicker'
import DriverOverrideEditor from '@/components/bus/DriverOverrideEditor'
import { ADMIN } from '@/components/bus/adminUI'
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
  const pickup = fmtTime(trip?.pickup_time)
  const drop = fmtTime(trip?.drop_time)

  return (
    <ProtectedLayout adminOnly>
      <div data-page-theme="admin" style={{ backgroundColor: ADMIN.pageBg, minHeight: '100vh' }}>
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <Link href="/more/bus" className="inline-flex items-center gap-1.5 text-sm text-[#71717A] hover:text-[#27272A] mb-5">
            <ArrowLeft size={16} /> Bus Manager
          </Link>

          {loading ? (
            <div className="text-center py-16"><div className="spinner mx-auto mb-3" /><p className="text-sm text-[#71717A]">Loading trip…</p></div>
          ) : !trip ? (
            <div className={`${ADMIN.card} p-8 text-center text-[#71717A]`}>Trip not found.</div>
          ) : (
            <div className="space-y-4">
              {/* Hero header */}
              <div className="relative overflow-hidden rounded-2xl bg-[#27272A] p-5 sm:p-6">
                <div className="absolute -bottom-8 -right-6 opacity-[0.07] pointer-events-none">
                  <Bus size={150} className="text-white" />
                </div>
                <div className="relative flex items-start gap-4">
                  <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-xl bg-white/10 border border-white/15 flex items-center justify-center flex-shrink-0">
                    <Bus size={24} className="text-[#D8B967]" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h1 className="font-display text-xl sm:text-2xl font-bold text-white truncate">{trip.name}</h1>
                      {!trip.active && <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/15 text-white/70 font-semibold uppercase tracking-wide flex-shrink-0">Inactive</span>}
                    </div>
                    {trip.route_description && (
                      <p className="text-sm text-white/60 mt-0.5 flex items-center gap-1.5">
                        <MapPin size={13} className="flex-shrink-0" /> {trip.route_description}
                      </p>
                    )}
                    <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3 text-xs text-white/70">
                      {pickup && <span className="flex items-center gap-1"><Clock size={12} /> Pickup {pickup}</span>}
                      {drop && <span className="flex items-center gap-1"><Clock size={12} /> Drop {drop}</span>}
                      <span>Driver: <strong className="text-white/90 font-semibold">{trip.default_driver?.full_name ?? 'None'}</strong></span>
                    </div>
                  </div>
                  <button onClick={() => setShowEdit(true)}
                    className="p-2 bg-white/10 hover:bg-white/20 border border-white/15 rounded-lg text-white transition-colors flex-shrink-0" title="Edit trip">
                    <Pencil size={16} />
                  </button>
                </div>
              </div>

              {/* Today's attendance — stat tiles */}
              <div>
                <div className="flex items-center gap-2 mb-2.5">
                  <ClipboardCheck size={15} className="text-[#B8983C]" />
                  <h2 className={ADMIN.label}>Today&apos;s attendance</h2>
                </div>
                <div className="grid grid-cols-3 gap-2.5">
                  <StatTile label="Picked up" value={pickedUp} accent />
                  <StatTile label="Dropped" value={dropped} />
                  <StatTile label="Total" value={roster.length} />
                </div>
                {roster.length === 0 && (
                  <p className="text-xs text-[#A1A1AA] mt-2">Assign passengers below to enable attendance.</p>
                )}
              </div>

              {/* Passengers */}
              <Section icon={<Users size={15} className="text-[#B8983C]" />} title="Passengers">
                <PassengerPicker
                  tripId={tripId}
                  assignable={assignable}
                  initialSelectedIds={currentIds}
                  onSaved={load}
                />
              </Section>

              {/* Driver overrides */}
              <Section icon={<CalendarClock size={15} className="text-[#B8983C]" />} title="Substitute drivers">
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
      </div>
    </ProtectedLayout>
  )
}

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className={`${ADMIN.card} shadow-sm p-4 sm:p-5`}>
      <div className="flex items-center gap-2 mb-3">
        {icon}
        <h2 className="font-semibold text-[#27272A] text-sm">{title}</h2>
      </div>
      {children}
    </div>
  )
}

function StatTile({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div className={`rounded-xl border p-3.5 ${accent ? 'bg-[#27272A] border-[#27272A]' : 'bg-white border-[#E4E4E7]'}`}>
      <p className={`text-2xl font-bold tabular-nums ${accent ? 'text-white' : 'text-[#18181B]'}`}>{value}</p>
      <p className={`text-[10px] uppercase tracking-widest font-bold mt-0.5 ${accent ? 'text-[#A1A1AA]' : 'text-[#71717A]'}`}>{label}</p>
    </div>
  )
}
