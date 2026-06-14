'use client'

import React, { useState, useEffect, useCallback, Suspense } from 'react'
import dynamic from 'next/dynamic'
import { useRouter, useSearchParams } from 'next/navigation'
import { AnimatePresence } from 'framer-motion'
import {
  Bus, IndianRupee, MapPin, CreditCard, Banknote,
} from 'lucide-react'
import ProtectedLayout from '@/components/ProtectedLayout'
import PayFeeModal from '@/components/bus/PayFeeModal'
import FeeStatusBadge from '@/components/bus/FeeStatusBadge'
import { formatINR } from '@/components/bus/FeeCollectionSummary'
import TripsSection from '@/components/bus/sections/TripsSection'
import BusFeesSection from '@/components/bus/sections/BusFeesSection'
import DriverPayrollSection from '@/components/bus/sections/DriverPayrollSection'
import { useAuth } from '@/contexts/AuthContext'
import { isAdminRole } from '@/lib/supabase'
import { BusTrip, BusFee, fetchTrips, fetchFeesForPassenger } from '@/lib/bus'

// Bus header icon tile follows the admin-configured page theme (data-page-theme="bus").
const busIconStyle = { background: 'linear-gradient(135deg, var(--page-gradient-from), var(--page-gradient-to))' }

// Leaflet touches `window`, so load the map only on the client.
const PassengerTripMap = dynamic(() => import('@/components/bus/PassengerTripMap'), {
  ssr: false,
  loading: () => <div className="h-[280px] rounded-2xl border border-slate-200 flex items-center justify-center"><div className="spinner" /></div>,
})

export default function BusPage() {
  return (
    <Suspense fallback={
      <ProtectedLayout>
        <div className="text-center py-20"><div className="spinner mx-auto mb-3" /><p className="text-sm text-slate-500">Loading…</p></div>
      </ProtectedLayout>
    }>
      <BusPageContent />
    </Suspense>
  )
}

function BusPageContent() {
  const { profile } = useAuth()
  const isAdmin = profile ? isAdminRole(profile.role) : false

  return (
    <ProtectedLayout>
      <div data-page-theme="bus" className="max-w-3xl mx-auto px-4 sm:px-6 py-6">
        {isAdmin ? <AdminBusHub /> : <PassengerBusView />}
      </div>
    </ProtectedLayout>
  )
}

// ──────────────────────────────────────────────────────────────
// Admin hub — three sections: Trips / Bus Fees / Driver Payroll
// ──────────────────────────────────────────────────────────────

type SectionKey = 'trips' | 'fees' | 'payroll'

const SECTIONS: { key: SectionKey; label: string; icon: React.ReactNode }[] = [
  { key: 'trips', label: 'Trips', icon: <Bus size={15} /> },
  { key: 'fees', label: 'Bus Fees', icon: <IndianRupee size={15} /> },
  { key: 'payroll', label: 'Driver Payroll', icon: <Banknote size={15} /> },
]

function AdminBusHub() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const tabParam = searchParams.get('tab')
  const initial: SectionKey = tabParam === 'fees' || tabParam === 'payroll' ? tabParam : 'trips'
  const [section, setSection] = useState<SectionKey>(initial)

  const selectSection = (key: SectionKey) => {
    setSection(key)
    // Keep the URL shareable / consistent with the active section.
    router.replace(key === 'trips' ? '/more/bus' : `/more/bus?tab=${key}`, { scroll: false })
  }

  return (
    <>
      <div className="flex items-center gap-3 mb-5">
        <div className="p-2 rounded-xl shadow" style={busIconStyle}>
          <Bus className="text-white" size={20} />
        </div>
        <h1 className="font-display text-2xl font-bold text-slate-800">Bus Manager</h1>
      </div>

      {/* Section switcher */}
      <div className="flex gap-1 mb-5 p-1 rounded-2xl glass w-full">
        {SECTIONS.map(s => {
          const active = section === s.key
          return (
            <button key={s.key} onClick={() => selectSection(s.key)}
              className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-2 rounded-xl text-sm font-semibold transition-all ${
                active ? 'bg-white text-orange-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}>
              {s.icon} <span className="truncate">{s.label}</span>
            </button>
          )
        })}
      </div>

      {section === 'trips' && <TripsSection />}
      {section === 'fees' && <BusFeesSection />}
      {section === 'payroll' && <DriverPayrollSection />}
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
        <div className="p-2 rounded-xl shadow" style={busIconStyle}>
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
