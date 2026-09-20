'use client'

import React, { useState, useEffect, useCallback, useMemo, Suspense } from 'react'
import dynamic from 'next/dynamic'
import { useRouter, useSearchParams } from 'next/navigation'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Bus, IndianRupee, MapPin, CreditCard, Banknote, Receipt, CheckCircle2, Clock, Route, Wallet,
} from 'lucide-react'
import ProtectedLayout from '@/components/ProtectedLayout'
import UnderConstruction from '@/components/UnderConstruction'
import PageBanner from '@/components/PageBanner'
import FeeStatusBadge from '@/components/bus/FeeStatusBadge'
import { formatINR } from '@/components/bus/FeeCollectionSummary'
import { HubTabs } from '@/components/bus/adminUI'
const PayFeeModal          = dynamic(() => import('@/components/bus/PayFeeModal'))
const TripsSection         = dynamic(() => import('@/components/bus/sections/TripsSection'))
const BusFeesSection       = dynamic(() => import('@/components/bus/sections/BusFeesSection'))
const DriverPayrollSection = dynamic(() => import('@/components/bus/sections/DriverPayrollSection'))
import { useAuth } from '@/contexts/AuthContext'
import { isAdminRole } from '@/lib/supabase'
import { BUS_BANNER_DEFAULT } from '@/lib/pageConfig'
import { BusTrip, BusFee, fetchTrips, fetchFeesForPassenger, fetchVerifiedPaymentsForPassenger, PassengerPayment } from '@/lib/bus'

// Leaflet touches `window`, so load the map only on the client.
const PassengerTripMap = dynamic(() => import('@/components/bus/PassengerTripMap'), {
  ssr: false,
  loading: () => <div className="h-[372px] rounded-2xl border border-slate-200 bg-slate-50 flex items-center justify-center"><div className="spinner" /></div>,
})

export default function BusPage() {
  return (
    <ProtectedLayout>
      <UnderConstruction
        title="Bus Management"
        description="Bus trips, fees, and payroll tools are being rebuilt. Check back soon!"
        icon={<Bus className="w-14 h-14 text-mps-blue-500" strokeWidth={1.5} />}
      />
    </ProtectedLayout>
  )
}

// The pre-rebuild bus page, kept deliberately: the default export above
// renders UnderConstruction while these tools are rebuilt, and this is the
// reference implementation that rebuild works against. It is the only thing
// holding the rest of this file reachable — deleting it strips the whole
// parked UI with it.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function BusPageOriginal() {
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
          ? <AdminBusHub onBack={() => router.push('/')} />
          : <PassengerBusView onBack={() => router.push('/')} />}
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
  const feesSectionParam = searchParams.get('section')
  const feesFilterParam  = searchParams.get('filter')
  const initial: SectionKey = tabParam === 'fees' || tabParam === 'payroll' ? tabParam : 'trips'
  const [section, setSection] = useState<SectionKey>(initial)
  const [bannerEditing, setBannerEditing] = useState(false)

  const selectSection = (key: SectionKey) => {
    setSection(key)
    // Keep the URL shareable / consistent with the active section.
    router.replace(key === 'trips' ? '/more/bus' : `/more/bus?tab=${key}`, { scroll: false })
  }

  return (
    <div style={{ minHeight: '100vh' }}>
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
        <div style={{ opacity: bannerEditing ? 0.35 : 1, filter: bannerEditing ? 'blur(1.5px)' : 'none', pointerEvents: bannerEditing ? 'none' : 'auto', userSelect: bannerEditing ? 'none' : 'auto', transition: 'opacity 0.25s ease, filter 0.25s ease' }}>

          {/* Hub toggler — underline card tabs (Style A), overlaps the banner */}
          <div className="relative z-10 -mt-6 sm:-mt-7 mb-5">
            <HubTabs tabs={SECTIONS} value={section} onChange={selectSection} />
          </div>

          {section === 'trips' && <TripsSection />}
          {section === 'fees' && <BusFeesSection initialSection={feesSectionParam} initialFilter={feesFilterParam} />}
          {section === 'payroll' && <DriverPayrollSection />}
        </div>
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────
// Passenger view
// ──────────────────────────────────────────────────────────────

type PassengerTab = 'trips' | 'fees'

function PassengerBusView({ onBack }: { onBack: () => void }) {
  const { user } = useAuth()
  const [loading, setLoading] = useState(true)
  const [trips, setTrips] = useState<BusTrip[]>([])
  const [fees, setFees] = useState<BusFee[]>([])
  const [payments, setPayments] = useState<PassengerPayment[]>([])
  const [payingFee, setPayingFee] = useState<BusFee | null>(null)
  const [trackingTripId, setTrackingTripId] = useState<string | null>(null)
  const [tab, setTab] = useState<PassengerTab>('trips')

  const load = useCallback(async () => {
    if (!user) return
    setLoading(true)
    const [t, f, p] = await Promise.all([
      fetchTrips(), fetchFeesForPassenger(user.id), fetchVerifiedPaymentsForPassenger(user.id),
    ])
    setTrips(t); setFees(f); setPayments(p)
    setLoading(false)
  }, [user])

  useEffect(() => { load() }, [load])

  // Verified amount paid per fee id — drives remaining balance for partial fees.
  const paidByFee = useMemo(() => {
    const m = new Map<string, number>()
    for (const p of payments) {
      const id = p.fee?.id
      if (id) m.set(id, (m.get(id) ?? 0) + (Number(p.amount) || 0))
    }
    return m
  }, [payments])

  const remainingOf = useCallback((f: BusFee) => {
    const amt = Number(f.amount) || 0
    if (f.status === 'paid' || f.status === 'cancelled') return 0
    return Math.max(0, amt - (paidByFee.get(f.id) ?? 0))
  }, [paidByFee])

  const outstandingFees = fees.filter(f => f.status === 'unpaid' || f.status === 'partial')
  const paidFees = fees.filter(f => f.status === 'paid')
  const otherFees = fees.filter(f => f.status === 'cancelled')
  const outstanding = outstandingFees.reduce((s, f) => s + remainingOf(f), 0)
  const paidTotal = paidFees.reduce((s, f) => s + (Number(f.amount) || 0), 0)

  const TABS: { key: PassengerTab; label: string; icon: React.ReactNode }[] = [
    { key: 'trips', label: 'My Trips', icon: <Route size={15} /> },
    { key: 'fees', label: 'My Bus Fees', icon: <Wallet size={15} /> },
  ]

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
        {/* Inline tabs — overlap the banner */}
        <div className="relative z-10 flex items-stretch bg-white rounded-2xl border border-slate-200 shadow-lg overflow-hidden mb-5">
          {TABS.map((t, i) => {
            const active = tab === t.key
            const badge = t.key === 'fees' && outstandingFees.length > 0 ? outstandingFees.length : null
            return (
              <button key={t.key} onClick={() => setTab(t.key)}
                className={`relative flex flex-1 items-center justify-center gap-1.5 px-3 py-3.5 text-sm font-semibold transition-colors ${
                  i > 0 ? 'border-l border-slate-100' : ''
                } ${active ? 'text-slate-900' : 'text-slate-400 hover:text-slate-600 hover:bg-slate-50'}`}>
                {t.icon}
                <span>{t.label}</span>
                {badge && (
                  <span className="ml-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-rose-500 text-white tabular-nums">{badge}</span>
                )}
                <span className="absolute left-5 right-5 bottom-0 h-[3px] rounded-t-full transition-colors"
                  style={active ? { backgroundColor: 'var(--page-gradient-from)' } : undefined} />
              </button>
            )
          })}
        </div>

        {loading ? (
          <div className="text-center py-16"><div className="spinner mx-auto mb-3" /><p className="text-sm text-slate-500">Loading…</p></div>

        /* ══ MY TRIPS ══════════════════════════════════════════════ */
        ) : tab === 'trips' ? (
          trips.length === 0 ? (
            <EmptyState icon={<Route size={26} className="text-white" />} text="You are not assigned to any bus trip yet." />
          ) : (
            <div className="space-y-3">
              {trips.map(t => {
                const tracking = trackingTripId === t.id
                return (
                  <div key={t.id} className={`bg-white rounded-2xl border shadow-sm overflow-hidden transition-all ${tracking ? 'border-slate-300 shadow-md' : 'border-slate-200 hover:shadow-md'}`}>
                    <div className="flex items-center gap-3 p-4">
                      <div className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 shadow-sm" style={{ background: 'linear-gradient(135deg, var(--page-gradient-from), var(--page-gradient-to))' }}>
                        <Bus size={22} className="text-white" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-slate-800 truncate">{t.name}</p>
                        {t.route_description
                          ? <p className="text-xs text-slate-400 truncate flex items-center gap-1"><MapPin size={11} /> {t.route_description}</p>
                          : <p className="text-xs text-slate-300">Bus route</p>}
                      </div>
                      <button
                        onClick={() => setTrackingTripId(tracking ? null : t.id)}
                        className={`flex items-center gap-1.5 text-xs font-semibold px-3.5 py-2 rounded-lg transition-colors flex-shrink-0 ${
                          tracking ? 'bg-slate-100 text-slate-600' : 'page-btn-primary'
                        }`}>
                        <MapPin size={13} /> {tracking ? 'Hide' : 'Track'}
                      </button>
                    </div>
                    <AnimatePresence initial={false}>
                      {tracking && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                          className="overflow-hidden">
                          <div className="px-3 pb-3">
                            <PassengerTripMap tripId={t.id} tripName={t.name} />
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                )
              })}
            </div>
          )

        /* ══ MY BUS FEES ═══════════════════════════════════════════ */
        ) : fees.length === 0 ? (
          <EmptyState icon={<Wallet size={26} className="text-white" />} text="No fees issued to you." />
        ) : (
          <div className="space-y-5">
            {/* Outstanding / Paid summary tiles */}
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-4">
                <div className="flex items-center gap-1.5 mb-1.5">
                  <Receipt size={14} className="text-rose-500" />
                  <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Outstanding</p>
                </div>
                <p className="text-2xl font-bold text-slate-900 tabular-nums leading-tight">{formatINR(outstanding)}</p>
                <p className="text-[11px] text-slate-400 mt-0.5">{outstandingFees.length} pending</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-4">
                <div className="flex items-center gap-1.5 mb-1.5">
                  <CheckCircle2 size={14} className="text-emerald-500" />
                  <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Paid</p>
                </div>
                <p className="text-2xl font-bold text-slate-900 tabular-nums leading-tight">{formatINR(paidTotal)}</p>
                <p className="text-[11px] text-slate-400 mt-0.5">{paidFees.length} settled</p>
              </div>
            </div>

            {/* Outstanding section */}
            {outstandingFees.length > 0 && (
              <section>
                <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2 flex items-center gap-1.5">
                  <Clock size={12} className="text-rose-500" /> Outstanding · {outstandingFees.length}
                </p>
                <div className="space-y-2.5">
                  {outstandingFees.map(f => (
                    <FeeRow key={f.id} fee={f} remaining={remainingOf(f)} onPay={() => setPayingFee(f)} />
                  ))}
                </div>
              </section>
            )}

            {/* Paid + history section */}
            {(paidFees.length > 0 || otherFees.length > 0) && (
              <section>
                <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2 flex items-center gap-1.5">
                  <CheckCircle2 size={12} className="text-emerald-500" /> Paid &amp; history · {paidFees.length + otherFees.length}
                </p>
                <div className="space-y-2.5">
                  {[...paidFees, ...otherFees].map(f => (
                    <FeeRow key={f.id} fee={f} />
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
      </div>

      <AnimatePresence>
        {payingFee && (
          <PayFeeModal
            fee={payingFee}
            payable={remainingOf(payingFee)}
            onClose={() => setPayingFee(null)}
            onPaid={() => { setPayingFee(null); load() }}
          />
        )}
      </AnimatePresence>
    </>
  )
}

function EmptyState({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-10 text-center">
      <div className="w-16 h-16 mx-auto mb-4 rounded-2xl flex items-center justify-center shadow-sm" style={{ background: 'linear-gradient(135deg, var(--page-gradient-from), var(--page-gradient-to))' }}>
        {icon}
      </div>
      <p className="text-sm text-slate-500 max-w-xs mx-auto">{text}</p>
    </div>
  )
}

function FeeRow({ fee: f, remaining, onPay }: { fee: BusFee; remaining?: number; onPay?: () => void }) {
  const isPayable = f.status === 'unpaid' || f.status === 'partial'
  const amt = Number(f.amount) || 0
  const due = remaining ?? amt
  const paid = amt - due
  const pct = amt > 0 ? Math.min(100, Math.round((paid / amt) * 100)) : 0
  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 hover:shadow-md transition-shadow">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className={`font-bold tabular-nums text-lg ${f.status === 'cancelled' ? 'text-slate-400 line-through' : 'text-slate-800'}`}>
            {formatINR(f.status === 'partial' ? due : amt)}
          </p>
          <p className="text-xs text-slate-400 truncate">
            {f.description || f.fee_head?.name || 'Bus fee'}{f.trip?.name ? ` · ${f.trip.name}` : ''}
            {f.due_date ? ` · due ${f.due_date}` : ''}
          </p>
          {f.status === 'partial' && (
            <p className="text-[11px] text-slate-400 mt-0.5">
              of {formatINR(amt)} billed
            </p>
          )}
        </div>
        <FeeStatusBadge status={f.status} />
      </div>
      {f.status === 'partial' && (
        <div className="mt-3">
          <div className="flex items-center justify-between text-[11px] mb-1 tabular-nums">
            <span className="font-semibold text-emerald-600">{formatINR(paid)} paid</span>
            <span className="text-slate-400">of {formatINR(amt)}</span>
          </div>
          <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
            <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}
      {isPayable && onPay && (
        <button onClick={onPay}
          className="page-btn-primary mt-3 w-full flex items-center justify-center gap-2 text-sm !py-2.5">
          <CreditCard size={15} /> Pay {formatINR(due)}
        </button>
      )}
    </div>
  )
}
