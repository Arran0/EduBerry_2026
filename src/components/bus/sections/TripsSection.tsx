'use client'

import React, { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { AnimatePresence } from 'framer-motion'
import { Bus, Plus, ChevronRight, Users, Power } from 'lucide-react'
import TripFormModal from '@/components/bus/TripFormModal'
import { UserProfile } from '@/lib/supabase'
import {
  BusTrip, fetchTrips, fetchTripPassengerCounts, fetchDrivers, setTripActive,
} from '@/lib/bus'

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
        <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wide">
          {trips.length} trip{trips.length === 1 ? '' : 's'}
        </h2>
        <button onClick={() => setShowCreate(true)} className="glass-btn glass-btn-accent">
          <Plus size={14} /> New Trip
        </button>
      </div>

      {loading ? (
        <div className="text-center py-12"><div className="spinner mx-auto mb-3" /><p className="text-sm text-slate-500">Loading…</p></div>
      ) : trips.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center">
          <Bus size={30} className="text-slate-300 mx-auto mb-3" />
          <p className="text-sm text-slate-500 mb-4">No bus trips yet. Create your first one.</p>
          <button onClick={() => setShowCreate(true)} className="btn-primary text-sm inline-flex items-center gap-2">
            <Plus size={15} /> New Trip
          </button>
        </div>
      ) : (
        <div className="space-y-2.5">
          {trips.map(trip => (
            <div key={trip.id} className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="flex items-center gap-3 p-4">
                <Link href={`/more/bus/trips/${trip.id}`} className="flex items-center gap-3 flex-1 min-w-0">
                  <div className={`w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 ${
                    trip.active ? 'bg-gradient-to-br from-orange-500 to-amber-600' : 'bg-slate-300'
                  }`}>
                    <Bus size={20} className="text-white" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-semibold text-slate-800 truncate">{trip.name}</p>
                      {!trip.active && <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 font-medium">Inactive</span>}
                    </div>
                    <p className="text-xs text-slate-400 flex items-center gap-1.5 mt-0.5">
                      <Users size={12} /> {counts[trip.id] ?? 0} passengers
                      <span>· {trip.default_driver?.full_name ?? 'No driver'}</span>
                    </p>
                  </div>
                </Link>
                <button onClick={() => toggleActive(trip)} title={trip.active ? 'Deactivate' : 'Activate'}
                  className={`p-2 rounded-lg transition-colors ${trip.active ? 'text-emerald-500 hover:bg-emerald-50' : 'text-slate-300 hover:bg-slate-100'}`}>
                  <Power size={16} />
                </button>
                <Link href={`/more/bus/trips/${trip.id}`} className="p-1 text-slate-300">
                  <ChevronRight size={18} />
                </Link>
              </div>
            </div>
          ))}
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
