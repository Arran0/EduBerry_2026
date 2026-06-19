'use client'

import React, { useState, useEffect, useCallback, Suspense } from 'react'
import dynamic from 'next/dynamic'
import { useRouter, useSearchParams } from 'next/navigation'
import { AnimatePresence } from 'framer-motion'
import {
  Bus, IndianRupee, MapPin, CreditCard, Banknote, Receipt,
} from 'lucide-react'
import ProtectedLayout from '@/components/ProtectedLayout'
import PageBanner from '@/components/PageBanner'
import FeeStatusBadge from '@/components/bus/FeeStatusBadge'
import { formatINR } from '@/components/bus/FeeCollectionSummary'
import { ADMIN, HubTabs } from '@/components/bus/adminUI'
const PayFeeModal          = dynamic(() => import('@/components/bus/PayFeeModal'))
const TripsSection         = dynamic(() => import('@/components/bus/sections/TripsSection'))
const BusFeesSection       = dynamic(() => import('@/components/bus/sections/BusFeesSection'))
const DriverPayrollSection = dynamic(() => import('@/components/bus/sections/DriverPayrollSection'))
import { useAuth } from '@/contexts/AuthContext'
import { isAdminRole } from '@/lib/supabase'
import { BUS_BANNER_DEFAULT } from '@/lib/pageConfig'
import { BusTrip, BusFee, fetchTrips, fetchFeesForPassenger } from '@/lib/bus'

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
  const router = useRouter()
  const isAdmin = profile ? isAdminRole(profile.role) : false

  return (
    <ProtectedLayout>
      <div data-page-theme="bus">
        {isAdmin
          ? <AdminBusHub onBack={() => router.back()} />
          : <PassengerBusView onBack={() => router.back()} />}
      </div>
    </ProtectedLayout>
  )
}

// ──────────────────────────────────────────────────────────────
// Admin hub — three sections: Trips / Bus Fees / Driver Payroll
// ──────────────────────────────────────────────────────────────

type SectionKey = 'trips' | 'fees' | 'payroll'

const SECTIONS = [
  { key: 'trips' as const, label: 'Trips', icon: <Bus size={15} /> },
  { key: 'fees' as const, label: 'Bus Fees', icon: <IndianRupee size={15} /> },
  { key: 'payroll' as const, label: 'Driver Payroll', icon: <Banknote size={15} /> },
]

function AdminBusHub({ onBack }: { onBack: () => void }) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const tabParam = searchParams.get('tab')
  const initial: SectionKey = tabParam === 'fees' || tabParam === 'payroll' ? tabParam : 'trips'
  const [section, setSection] = useState<SectionKey>(initial)
  const [bannerEditing, setBannerEditing] = useState(false)

  const selectSection = (key: SectionKey) => {
    setSection(key)
    // Keep the URL shareable / consistent with the active section.
    router.replace(key === 'trips' ? '/more/bus' : `/more/bus?tab=${key}`, { scroll: false })
  }

  return (
    <div data-page-theme="admin" style={{ backgroundColor: ADMIN.pageBg, minHeight: '100vh' }}>
      <PageBanner
        settingKey="bus_banner"
        defaultBanner={BUS_BANNER_DEFAULT}
        icon={<Bus size={26} className="text-white" />}
        title="Bus Manager"
        subtitle="Trips, fees & driver payroll"
        isAdmin
        onBack={onBack}
        onEditingChange={setBannerEditing}
        maxWidth="max-w-6xl"
        backgroundIcon={<Bus size={150} className="text-white" />}
      />

      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pb-10">
        {/* Everything but the banner fades while the banner is being edited */}
        <div style={{ opacity: bannerEditing ? 0 : 1, pointerEvents: bannerEditing ? 'none' : 'auto', transition: 'opacity 0.25s ease' }}>

          {/* Hub toggler — underline card tabs (Style A), overlaps the banner */}
          <div className="relative z-10 -mt-6 sm:-mt-7 mb-5">
            <HubTabs tabs={SECTIONS} value={section} onChange={selectSection} />
          </div>

          {section === 'trips' && <TripsSection />}
          {section === 'fees' && <BusFeesSection />}
          {section === 'payroll' && <DriverPayrollSection />}
        </div>
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────
// Passenger view
// ──────────────────────────────────────────────────────────────

function PassengerBusView({ onBack }: { onBack: () => void }) {
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

  const outstanding = fees
    .filter(f => f.status === 'unpaid' || f.status === 'partial')
    .reduce((s, f) => s + (Number(f.amount) || 0), 0)

  return (
    <>
      <PageBanner
        settingKey="bus_banner"
        defaultBanner={BUS_BANNER_DEFAULT}
        icon={<Bus size={26} className="text-white" />}
        title="My Bus"
        subtitle="Your trips and fees"
        onBack={onBack}
        maxWidth="max-w-2xl"
        backgroundIcon={<Bus size={150} className="text-white" />}
      />

      <div className="relative z-0 max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 -mt-8 pb-10">
        {/* Outstanding highlight */}
        {!loading && fees.length > 0 && outstanding > 0 && (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 mb-4 flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl page-icon-bg flex items-center justify-center flex-shrink-0 shadow-sm">
              <Receipt size={22} className="text-white" />
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Total outstanding</p>
              <p className="text-2xl font-bold text-slate-800 tabular-nums">{formatINR(outstanding)}</p>
            </div>
          </div>
        )}

        {loading ? (
          <div className="text-center py-12"><div className="spinner mx-auto mb-3" /><p className="text-sm text-slate-500">Loading…</p></div>
        ) : (
          <div className="space-y-6">
            {/* Trips */}
            <section>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">My trips</p>
              {trips.length === 0 ? (
                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 text-center text-sm text-slate-500">
                  You are not assigned to any bus trip yet.
                </div>
              ) : (
                <div className="space-y-2.5">
                  {trips.map(t => {
                    const tracking = trackingTripId === t.id
                    return (
                      <div key={t.id} className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 hover:shadow-md transition-shadow">
                        <div className="flex items-center gap-3">
                          <div className="w-11 h-11 rounded-xl page-accent-bg flex items-center justify-center flex-shrink-0">
                            <Bus size={20} className="page-accent-text" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-semibold text-slate-800 truncate">{t.name}</p>
                            {t.route_description && <p className="text-xs text-slate-400 truncate">{t.route_description}</p>}
                          </div>
                          <button
                            onClick={() => setTrackingTripId(tracking ? null : t.id)}
                            className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg transition-colors flex-shrink-0 ${
                              tracking ? 'page-accent-bg page-accent-text' : 'page-btn-primary'
                            }`}>
                            <MapPin size={13} /> {tracking ? 'Hide' : 'Track'}
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
                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 text-center text-sm text-slate-500">
                  No fees issued to you.
                </div>
              ) : (
                <div className="space-y-2.5">
                  {fees.map(f => (
                    <div key={f.id} className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 hover:shadow-md transition-shadow">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-bold text-slate-800 tabular-nums text-lg">{formatINR(f.amount)}</p>
                          <p className="text-xs text-slate-400 truncate">
                            {f.description || f.fee_head?.name || 'Bus fee'}{f.trip?.name ? ` · ${f.trip.name}` : ''}
                            {f.due_date ? ` · due ${f.due_date}` : ''}
                          </p>
                        </div>
                        <FeeStatusBadge status={f.status} />
                      </div>
                      {(f.status === 'unpaid' || f.status === 'partial') && (
                        <button onClick={() => setPayingFee(f)}
                          className="page-btn-primary mt-3 w-full flex items-center justify-center gap-2 text-sm !py-2.5">
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
      </div>

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
