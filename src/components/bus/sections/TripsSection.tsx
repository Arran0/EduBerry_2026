'use client'

import React, { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { AnimatePresence } from 'framer-motion'
import { Bus, Plus, ChevronRight, Users, Power, Clock } from 'lucide-react'
import TripFormModal from '@/components/bus/TripFormModal'
import { ADMIN } from '@/components/bus/adminUI'
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
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-2.5">
          {trips.map(trip => {
            const pickup = fmtTime(trip.pickup_time)
            const drop = fmtTime(trip.drop_time)
            return (
              <div key={trip.id} className={`${ADMIN.card} shadow-sm hover:shadow-md transition-shadow overflow-hidden`}>
                <div className="flex items-center gap-3 p-4">
                  <Link href={`/more/bus/trips/${trip.id}`} className="flex items-center gap-3 flex-1 min-w-0">
                    <div className={`w-11 h-11 rounded-lg flex items-center justify-center flex-shrink-0 ${
                      trip.active ? 'bg-[#27272A]' : 'bg-[#F4F4F5] border border-[#E4E4E7]'
                    }`}>
                      <Bus size={20} className={trip.active ? 'text-[#B8983C]' : 'text-[#A1A1AA]'} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-semibold text-[#18181B] truncate">{trip.name}</p>
                        {!trip.active && <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#F4F4F5] text-[#A1A1AA] font-semibold uppercase tracking-wide flex-shrink-0">Inactive</span>}
                      </div>
                      <p className="text-xs text-[#71717A] flex items-center flex-wrap gap-x-2 gap-y-0.5 mt-0.5">
                        <span className="flex items-center gap-1"><Users size={12} /> {counts[trip.id] ?? 0}</span>
                        <span className="truncate">{trip.default_driver?.full_name ?? 'No driver'}</span>
                        {(pickup || drop) && (
                          <span className="flex items-center gap-1 text-[#A1A1AA]">
                            <Clock size={11} /> {pickup ?? '—'}{drop ? ` · ${drop}` : ''}
                          </span>
                        )}
                      </p>
                    </div>
                  </Link>
                  <button onClick={() => toggleActive(trip)} title={trip.active ? 'Deactivate' : 'Activate'}
                    className={`p-2 rounded-lg transition-colors flex-shrink-0 ${trip.active ? 'text-[#27272A] hover:bg-[#F4F4F5]' : 'text-[#D4D4D8] hover:bg-[#F4F4F5]'}`}>
                    <Power size={16} />
                  </button>
                  <Link href={`/more/bus/trips/${trip.id}`} className="p-1 text-[#D4D4D8] flex-shrink-0">
                    <ChevronRight size={18} />
                  </Link>
                </div>
              </div>
            )
          })}
        </div>
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
