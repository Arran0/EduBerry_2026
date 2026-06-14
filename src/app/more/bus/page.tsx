'use client'

import React, { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Bus, Plus, ChevronRight, Users, IndianRupee, Power, MapPin, Settings, CreditCard, Banknote,
} from 'lucide-react'
import ProtectedLayout from '@/components/ProtectedLayout'
import TripFormModal from '@/components/bus/TripFormModal'
import PayFeeModal from '@/components/bus/PayFeeModal'
import FeeStatusBadge from '@/components/bus/FeeStatusBadge'
import FeeCollectionSummary, { formatINR } from '@/components/bus/FeeCollectionSummary'
import { useAuth } from '@/contexts/AuthContext'
import { isAdminRole, UserProfile } from '@/lib/supabase'
import {
  BusTrip, BusFee, FeeCollectionSummary as Summary,
  fetchTrips, fetchTripPassengerCounts, fetchDrivers, fetchAllFees, summarizeFees,
  setTripActive, fetchFeesForPassenger,
} from '@/lib/bus'

// Leaflet touches `window`, so load the map only on the client.
const PassengerTripMap = dynamic(() => import('@/components/bus/PassengerTripMap'), {
  ssr: false,
  loading: () => <div className="h-[280px] rounded-2xl border border-slate-200 flex items-center justify-center"><div className="spinner" /></div>,
})

export default function BusPage() {
  const { profile } = useAuth()
  const isAdmin = profile ? isAdminRole(profile.role) : false

  return (
    <ProtectedLayout>
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6">
        {isAdmin ? <AdminBusHub /> : <PassengerBusView />}
      </div>
    </ProtectedLayout>
  )
}

// ──────────────────────────────────────────────────────────────
// Admin hub
// ──────────────────────────────────────────────────────────────

function AdminBusHub() {
  const [loading, setLoading] = useState(true)
  const [trips, setTrips] = useState<BusTrip[]>([])
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [drivers, setDrivers] = useState<UserProfile[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [showCreate, setShowCreate] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const [t, c, d, fees] = await Promise.all([
      fetchTrips(), fetchTripPassengerCounts(), fetchDrivers(), fetchAllFees(),
    ])
    setTrips(t); setCounts(c); setDrivers(d); setSummary(summarizeFees(fees))
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const toggleActive = async (trip: BusTrip) => {
    setTrips(prev => prev.map(t => t.id === trip.id ? { ...t, active: !t.active } : t))
    await setTripActive(trip.id, !trip.active)
  }

  return (
    <>
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-gradient-to-br from-orange-500 to-amber-600 rounded-xl shadow">
            <Bus className="text-white" size={20} />
          </div>
          <div>
            <h1 className="font-display text-2xl font-bold text-slate-800">Bus Manager</h1>
            <p className="text-xs text-slate-500">{trips.length} trip{trips.length === 1 ? '' : 's'}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/more/bus/payroll"
            className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 transition-colors font-medium">
            <Banknote size={15} /> Payroll
          </Link>
          <Link href="/more/bus/settings"
            className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 transition-colors font-medium">
            <Settings size={15} /> Payments
          </Link>
          <button onClick={() => setShowCreate(true)} className="btn-primary flex items-center gap-2 text-sm">
            <Plus size={16} /> New Trip
          </button>
        </div>
      </div>

      {/* Fee collection at a glance */}
      {summary && (
        <Link href="/more/bus/fees" className="block mb-5">
          <FeeCollectionSummary summary={summary} />
          <p className="text-xs text-orange-600 font-medium mt-2 flex items-center gap-1">
            <IndianRupee size={12} /> Open fees & collection dashboard <ChevronRight size={12} />
          </p>
        </Link>
      )}

      {/* Trips */}
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

// ──────────────────────────────────────────────────────────────
// Passenger view
// ──────────────────────────────────────────────────────────────

function PassengerBusView() {
  const { user } = useAuth()
  const [loading, setLoading] = useState(true)
  const [trips, setTrips] = useState<BusTrip[]>([])
  const [fees, setFees] = useState<BusFee[]>([])
  const [payingFee, setPayingFee] = useState<BusFee | null>(null)
  const [trackingTripId, setTrackingTripId] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!user) return
    setLoading(true)
    const [t, f] = await Promise.all([fetchTrips(), fetchFeesForPassenger(user.id)])
    setTrips(t); setFees(f)
    setLoading(false)
  }, [user])

  useEffect(() => { load() }, [load])

  return (
    <>
      <div className="flex items-center gap-3 mb-5">
        <div className="p-2 bg-gradient-to-br from-orange-500 to-amber-600 rounded-xl shadow">
          <Bus className="text-white" size={20} />
        </div>
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-800">My Bus</h1>
          <p className="text-xs text-slate-500">Your trips and fees</p>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-12"><div className="spinner mx-auto mb-3" /><p className="text-sm text-slate-500">Loading…</p></div>
      ) : (
        <div className="space-y-6">
          {/* Trips */}
          <section>
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">My trips</p>
            {trips.length === 0 ? (
              <div className="bg-white rounded-2xl border border-slate-200 p-6 text-center text-sm text-slate-500">
                You are not assigned to any bus trip yet.
              </div>
            ) : (
              <div className="space-y-2">
                {trips.map(t => {
                  const tracking = trackingTripId === t.id
                  return (
                    <div key={t.id} className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-orange-100 flex items-center justify-center flex-shrink-0">
                          <Bus size={18} className="text-orange-600" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-slate-800 truncate">{t.name}</p>
                          {t.route_description && <p className="text-xs text-slate-400 truncate">{t.route_description}</p>}
                        </div>
                        <button
                          onClick={() => setTrackingTripId(tracking ? null : t.id)}
                          className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors ${
                            tracking ? 'bg-orange-100 text-orange-700' : 'bg-orange-500 text-white hover:bg-orange-600'
                          }`}>
                          <MapPin size={13} /> {tracking ? 'Hide' : 'Track bus'}
                        </button>
                      </div>
                      {tracking && (
                        <div className="mt-3">
                          <PassengerTripMap tripId={t.id} tripName={t.name} />
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </section>

          {/* Fees */}
          <section>
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">My fees</p>
            {fees.length === 0 ? (
              <div className="bg-white rounded-2xl border border-slate-200 p-6 text-center text-sm text-slate-500">
                No fees issued to you.
              </div>
            ) : (
              <div className="space-y-2">
                {fees.map(f => (
                  <div key={f.id} className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-semibold text-slate-800">{formatINR(f.amount)}</p>
                        <p className="text-xs text-slate-400 truncate">
                          {f.description || f.fee_head?.name || 'Bus fee'}{f.trip?.name ? ` · ${f.trip.name}` : ''}
                          {f.due_date ? ` · due ${f.due_date}` : ''}
                        </p>
                      </div>
                      <FeeStatusBadge status={f.status} />
                    </div>
                    {(f.status === 'unpaid' || f.status === 'partial') && (
                      <button onClick={() => setPayingFee(f)}
                        className="mt-3 w-full flex items-center justify-center gap-2 btn-primary text-sm">
                        <CreditCard size={15} /> Pay {formatINR(f.amount)}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}

      <AnimatePresence>
        {payingFee && (
          <PayFeeModal
            fee={payingFee}
            onClose={() => setPayingFee(null)}
            onPaid={() => { setPayingFee(null); load() }}
          />
        )}
      </AnimatePresence>
    </>
  )
}
