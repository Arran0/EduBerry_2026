'use client'

import React, { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { AnimatePresence } from 'framer-motion'
import { Bus, Plus, ChevronRight, Users, Power, Clock } from 'lucide-react'
import TripFormModal from '@/components/bus/TripFormModal'
import { ADMIN, Sheet, SHEET } from '@/components/bus/adminUI'
import { UserProfile } from '@/lib/supabase'
import {
  BusTrip, fetchTrips, fetchTripPassengerCounts, fetchDrivers, setTripActive,
} from '@/lib/bus'

function fmtTime(t?: string | null): string | null {
  if (!t) return null
  const [h, m] = t.split(':')
  const hour = parseInt(h, 10)
  const ampm = hour >= 12 ? 'PM' : 'AM'
  return `${hour % 12 === 0 ? 12 : hour % 12}:${m} ${ampm}`
}

export default function TripsSection() {
  const [loading, setLoading] = useState(true)
  const [trips, setTrips] = useState<BusTrip[]>([])
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [drivers, setDrivers] = useState<UserProfile[]>([])
  const [showCreate, setShowCreate] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const [t, c, d] = await Promise.all([
      fetchTrips(), fetchTripPassengerCounts(), fetchDrivers(),
    ])
    setTrips(t); setCounts(c); setDrivers(d)
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const toggleActive = async (trip: BusTrip) => {
    setTrips(prev => prev.map(t => t.id === trip.id ? { ...t, active: !t.active } : t))
    await setTripActive(trip.id, !trip.active)
  }

  return (
    <>
      <div className="flex items-center justify-between mb-3">
        <h2 className={ADMIN.label}>
          {trips.length} trip{trips.length === 1 ? '' : 's'}
        </h2>
        <button onClick={() => setShowCreate(true)} className={ADMIN.darkBtn}>
          <Plus size={14} /> New Trip
        </button>
      </div>

      {loading ? (
        <div className="text-center py-12"><div className="spinner mx-auto mb-3" /><p className="text-sm text-[#71717A]">Loading…</p></div>
      ) : trips.length === 0 ? (
        <div className={`${ADMIN.card} shadow-sm p-8 text-center`}>
          <div className="w-16 h-16 mx-auto mb-4 rounded-xl bg-[#27272A] flex items-center justify-center">
            <Bus size={28} className="text-[#B8983C]" strokeWidth={1.6} />
          </div>
          <p className="text-sm text-[#71717A] mb-4 max-w-sm mx-auto">No bus trips yet. Create your first route.</p>
          <button onClick={() => setShowCreate(true)} className={`${ADMIN.darkBtn} mx-auto`}>
            <Plus size={14} /> New Trip
          </button>
        </div>
      ) : (
        <Sheet
          columns={
            <>
              <span className="flex-1 ml-1 text-[10px] font-bold uppercase tracking-widest text-[#A1A1AA]">Trip / Route</span>
              <span className="w-20 text-[10px] font-bold uppercase tracking-widest text-[#A1A1AA] flex-shrink-0 hidden sm:block">Passengers</span>
              <span className="w-32 text-[10px] font-bold uppercase tracking-widest text-[#A1A1AA] flex-shrink-0 hidden md:block">Driver</span>
              <span className="w-36 text-[10px] font-bold uppercase tracking-widest text-[#A1A1AA] flex-shrink-0 hidden lg:block">Times</span>
              <span className="w-24 text-[10px] font-bold uppercase tracking-widest text-[#A1A1AA] text-right flex-shrink-0">Actions</span>
            </>
          }
        >
          {trips.map(trip => {
            const pickup = fmtTime(trip.pickup_time)
            const drop = fmtTime(trip.drop_time)
            const barColor = trip.active ? 'bg-[#27272A]' : 'bg-[#E4E4E7]'
            return (
              <div key={trip.id} className={SHEET.row}>
                <div className={`${SHEET.bar} ${barColor}`} />
                <div className="flex items-center gap-3 flex-1 min-w-0 px-3 py-2.5">
                  {/* Name + route */}
                  <Link href={`/more/bus/trips/${trip.id}`} className="flex items-center gap-2.5 flex-1 min-w-0 group">
                    <div className={`w-8 h-8 sm:w-9 sm:h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${
                      trip.active ? 'bg-[#27272A]' : 'bg-[#F4F4F5] border border-[#E4E4E7]'
                    }`}>
                      <Bus size={16} className={trip.active ? 'text-[#B8983C]' : 'text-[#A1A1AA]'} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-semibold text-[#18181B] text-sm truncate group-hover:text-[#B8983C] transition-colors">{trip.name}</p>
                        {!trip.active && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[#F4F4F5] text-[#A1A1AA] font-semibold uppercase tracking-wide flex-shrink-0">Inactive</span>
                        )}
                      </div>
                      {trip.route_description && (
                        <p className="text-[11px] text-[#71717A] truncate">{trip.route_description}</p>
                      )}
                      {/* Mobile-only secondary info */}
                      <p className="text-[11px] text-[#A1A1AA] sm:hidden flex items-center gap-2 mt-0.5">
                        <span className="flex items-center gap-1"><Users size={11} /> {counts[trip.id] ?? 0}</span>
                        {(pickup || drop) && <span className="flex items-center gap-1"><Clock size={11} /> {pickup ?? '—'}{drop ? ` · ${drop}` : ''}</span>}
                      </p>
                    </div>
                  </Link>

                  {/* Passengers */}
                  <div className="w-20 flex-shrink-0 hidden sm:flex items-center gap-1 text-sm text-[#71717A]">
                    <Users size={13} className="text-[#A1A1AA]" />
                    <span className="tabular-nums">{counts[trip.id] ?? 0}</span>
                  </div>

                  {/* Driver */}
                  <div className="w-32 flex-shrink-0 hidden md:block">
                    <p className="text-sm text-[#71717A] truncate">{trip.default_driver?.full_name ?? <span className="text-[#D4D4D8]">No driver</span>}</p>
                  </div>

                  {/* Times */}
                  <div className="w-36 flex-shrink-0 hidden lg:block">
                    {(pickup || drop) ? (
                      <p className="text-xs text-[#71717A] flex items-center gap-1">
                        <Clock size={11} className="text-[#A1A1AA] flex-shrink-0" />
                        {pickup ?? '—'}{drop ? ` · ${drop}` : ''}
                      </p>
                    ) : (
                      <span className="text-[#D4D4D8] text-xs">—</span>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="w-24 flex items-center justify-end gap-1.5 flex-shrink-0">
                    <button
                      onClick={() => toggleActive(trip)}
                      title={trip.active ? 'Deactivate' : 'Activate'}
                      className={`p-1.5 rounded-lg transition-colors ${trip.active ? 'text-[#27272A] hover:bg-[#F4F4F5]' : 'text-[#D4D4D8] hover:bg-[#F4F4F5] hover:text-[#71717A]'}`}
                    >
                      <Power size={15} />
                    </button>
                    <Link
                      href={`/more/bus/trips/${trip.id}`}
                      className="p-1.5 text-[#A1A1AA] hover:text-[#27272A] hover:bg-[#F4F4F5] rounded-lg transition-colors"
                    >
                      <ChevronRight size={15} />
                    </Link>
                  </div>
                </div>
              </div>
            )
          })}
        </Sheet>
      )}

      <AnimatePresence>
        {showCreate && (
          <TripFormModal
            drivers={drivers}
            onClose={() => setShowCreate(false)}
            onSaved={() => { setShowCreate(false); load() }}
          />
        )}
      </AnimatePresence>
    </>
  )
}
