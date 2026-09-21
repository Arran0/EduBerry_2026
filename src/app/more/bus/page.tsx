'use client'

import React, { useState, useEffect, useCallback, useMemo, Suspense } from 'react'
import dynamic from 'next/dynamic'
import { useRouter, useSearchParams } from 'next/navigation'
import { AnimatePresence } from 'framer-motion'
import {
  Bus, IndianRupee, CreditCard, Banknote, Receipt, CheckCircle2, Clock, Route, Wallet, Radio,
  BarChart3, SlidersHorizontal,
} from 'lucide-react'
import ProtectedLayout from '@/components/ProtectedLayout'
import PageBanner from '@/components/PageBanner'
import FeeStatusBadge from '@/components/bus/FeeStatusBadge'
import { formatINR } from '@/components/bus/FeeCollectionSummary'
import { ADMIN, HubTabs } from '@/components/bus/adminUI'
import Modal from '@/components/workspace/Modal'
import { PANEL_TITLES, type PanelKey } from '@/components/transport/ManageLauncher'
const ManageLauncher = dynamic(() => import('@/components/transport/ManageLauncher'))
const PayFeeModal          = dynamic(() => import('@/components/bus/PayFeeModal'))
const LiveSection          = dynamic(() => import('@/components/transport/sections/LiveSection'))
const SafetySection        = dynamic(() => import('@/components/transport/sections/SafetySection'))
const IntegrationsSection  = dynamic(() => import('@/components/transport/sections/IntegrationsSection'))
const RoutesSection        = dynamic(() => import('@/components/transport/sections/RoutesSection'))
const HistorySection       = dynamic(() => import('@/components/transport/sections/HistorySection'))
const ReportsSection       = dynamic(() => import('@/components/transport/sections/ReportsSection'))
const FleetSection         = dynamic(() => import('@/components/transport/sections/FleetSection'))
const BusFeesSection       = dynamic(() => import('@/components/bus/sections/BusFeesSection'))
const DriverPayrollSection = dynamic(() => import('@/components/bus/sections/DriverPayrollSection'))
import { useAuth } from '@/contexts/AuthContext'
import { isAdminRole } from '@/lib/supabase'
import { BUS_BANNER_DEFAULT } from '@/lib/pageConfig'
import { BusFee, fetchFeesForPassenger, fetchVerifiedPaymentsForPassenger, PassengerPayment } from '@/lib/bus'

const ChildTransportView = dynamic(() => import('@/components/transport/ChildTransportView'), {
  ssr: false,
  loading: () => <div className="h-64 rounded-2xl border border-slate-200 bg-slate-50 animate-pulse" />,
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
          ? <AdminBusHub onBack={() => router.push('/')} />
          : <PassengerBusView onBack={() => router.push('/')} />}
      </div>
    </ProtectedLayout>
  )
}

// ──────────────────────────────────────────────────────────────
// Admin hub — four daily tabs, everything else behind "Manage"
//
// This used to be nine tabs across. Nine is not a navigation bar, it is a list
// with a border — it scrolled sideways on a phone, and a tab strip you have to
// scroll has stopped saying where you are. The cut here is by how often a thing
// is opened, not by what it is about: Live is opened many times a day and "GPS
// devices" is opened once, when a bus is fitted. Levelling those two cost the
// daily screens the prominence they earn.
//
// So four tabs stay, and the five occasional surfaces move into the Manage
// popup. Nothing was rewritten to move: each popup renders the same section
// component it did as a tab.
// ──────────────────────────────────────────────────────────────

type SectionKey = 'live' | 'insights' | 'fees' | 'payroll'

const SECTIONS = [
  { key: 'live' as const, label: 'Live', icon: <Radio size={15} /> },
  { key: 'insights' as const, label: 'Insights', icon: <BarChart3 size={15} /> },
  { key: 'fees' as const, label: 'Bus Fees', icon: <IndianRupee size={15} /> },
  { key: 'payroll' as const, label: 'Driver Payroll', icon: <Banknote size={15} /> },
]

const SECTION_KEYS = SECTIONS.map(s => s.key)

/**
 * Old `?tab=` values, kept working.
 *
 * `/home` links to `?tab=fees&section=issued&filter=outstanding`, the payroll
 * sub-pages link back to `?tab=payroll`, and `/more/bus/fees` redirects to
 * `?tab=fees`. Those are live links in the app and in whatever anyone has
 * bookmarked; a rename that breaks them is a rename that shipped a bug. The
 * five that became popups now open as popups over the Live tab.
 */
const LEGACY_TAB: Record<string, { tab: SectionKey; panel?: PanelKey }> = {
  reports: { tab: 'insights' },
  routes:  { tab: 'live', panel: 'routes' },
  fleet:   { tab: 'live', panel: 'fleet' },
  history: { tab: 'live', panel: 'history' },
  safety:  { tab: 'live', panel: 'safety' },
  setup:   { tab: 'live', panel: 'setup' },
}

const PANEL_KEYS: PanelKey[] = ['routes', 'fleet', 'setup', 'history', 'safety']

function AdminBusHub({ onBack }: { onBack: () => void }) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const tabParam = searchParams.get('tab')
  const panelParam = searchParams.get('panel')
  const feesSectionParam = searchParams.get('section')
  const feesFilterParam  = searchParams.get('filter')

  const legacy = tabParam ? LEGACY_TAB[tabParam] : undefined
  const initialTab: SectionKey =
    SECTION_KEYS.includes(tabParam as SectionKey) ? (tabParam as SectionKey)
    : legacy ? legacy.tab
    : 'live'
  const initialPanel: PanelKey | null =
    PANEL_KEYS.includes(panelParam as PanelKey) ? (panelParam as PanelKey)
    : legacy?.panel ?? null

  const [section, setSection] = useState<SectionKey>(initialTab)
  const [panel, setPanel] = useState<PanelKey | null>(initialPanel)
  const [manageOpen, setManageOpen] = useState(false)
  const [bannerEditing, setBannerEditing] = useState(false)

  // One place that writes the URL, so a tab change and a popup open can never
  // disagree about what the address bar says.
  const syncUrl = useCallback((tab: SectionKey, open: PanelKey | null) => {
    const qs = new URLSearchParams()
    if (tab !== 'live') qs.set('tab', tab)
    if (open) qs.set('panel', open)
    const q = qs.toString()
    router.replace(q ? `/more/bus?${q}` : '/more/bus', { scroll: false })
  }, [router])

  const selectSection = (key: SectionKey) => {
    setSection(key)
    syncUrl(key, panel)
  }

  const openPanel = (key: PanelKey) => {
    setManageOpen(false)
    setPanel(key)
    syncUrl(section, key)
  }

  const closePanel = () => {
    setPanel(null)
    syncUrl(section, null)
  }

  const panelMeta = panel ? PANEL_TITLES[panel] : null

  return (
    <div style={{ minHeight: '100vh' }}>
      <PageBanner
        settingKey="bus_banner"
        defaultBanner={BUS_BANNER_DEFAULT}
        icon={<Bus size={26} className="text-white" />}
        title="Transport"
        subtitle="Routes, fleet, fees & driver payroll"
        isAdmin
        onBack={onBack}
        onEditingChange={setBannerEditing}
        maxWidth={ADMIN.shellWidth}
        backgroundIcon={<Bus size={150} className="text-white" />}
      />

      <div className={`${ADMIN.shell} px-4 sm:px-6 lg:px-8 pb-10`}>
        {/* Everything but the banner fades while the banner is being edited */}
        <div style={{ opacity: bannerEditing ? 0.35 : 1, filter: bannerEditing ? 'blur(1.5px)' : 'none', pointerEvents: bannerEditing ? 'none' : 'auto', userSelect: bannerEditing ? 'none' : 'auto', transition: 'opacity 0.25s ease, filter 0.25s ease' }}>

          {/* Hub toggler — four tabs plus the Manage button, overlapping the banner */}
          <div className="relative z-10 -mt-6 sm:-mt-7 mb-5 flex items-stretch gap-2.5">
            <HubTabs tabs={SECTIONS} value={section} onChange={selectSection} className="flex-1 min-w-0" />
            <button
              onClick={() => setManageOpen(true)}
              className="flex flex-shrink-0 items-center gap-2 rounded-xl border border-[#E4E4E7] bg-white px-4 shadow-sm text-sm font-semibold text-[#52525B] transition-colors hover:border-[#B8983C] hover:text-[#27272A]"
            >
              <SlidersHorizontal size={15} />
              <span className="hidden sm:inline">Manage</span>
            </button>
          </div>

          {section === 'live' && <LiveSection />}
          {section === 'insights' && <ReportsSection />}
          {section === 'fees' && <BusFeesSection initialSection={feesSectionParam} initialFilter={feesFilterParam} />}
          {section === 'payroll' && <DriverPayrollSection />}
        </div>
      </div>

      <Modal
        open={manageOpen}
        onClose={() => setManageOpen(false)}
        title="Manage transport"
        subtitle="Setup and records — the things you open occasionally"
        icon={SlidersHorizontal}
        size="lg"
      >
        <ManageLauncher onPick={openPanel} />
      </Modal>

      {/* One modal, whichever panel is open. Mounted only while open, so a
          section's queries fire when it is actually shown rather than on every
          page load — which is the whole reason these are popups and not tabs. */}
      <Modal
        open={panel !== null}
        onClose={closePanel}
        title={panelMeta?.title ?? ''}
        subtitle={panelMeta?.subtitle}
        icon={panelMeta?.icon}
        size="xl"
        fullHeight
      >
        {panel === 'routes' && <RoutesSection />}
        {panel === 'fleet' && <FleetSection />}
        {panel === 'setup' && <IntegrationsSection />}
        {panel === 'history' && <HistorySection />}
        {panel === 'safety' && <SafetySection />}
      </Modal>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────
// Passenger view
// ──────────────────────────────────────────────────────────────

type PassengerTab = 'trips' | 'fees'

function PassengerBusView({ onBack }: { onBack: () => void }) {
  const { user, profile } = useAuth()
  const [loading, setLoading] = useState(true)
  const [fees, setFees] = useState<BusFee[]>([])
  const [payments, setPayments] = useState<PassengerPayment[]>([])
  const [payingFee, setPayingFee] = useState<BusFee | null>(null)
  const [tab, setTab] = useState<PassengerTab>('trips')

  const load = useCallback(async () => {
    if (!user) return
    setLoading(true)
    const [f, p] = await Promise.all([
      fetchFeesForPassenger(user.id), fetchVerifiedPaymentsForPassenger(user.id),
    ])
    setFees(f); setPayments(p)
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
    { key: 'trips', label: 'Where is my child', icon: <Route size={15} /> },
    { key: 'fees', label: 'My Bus Fees', icon: <Wallet size={15} /> },
  ]

  return (
    <>
      <PageBanner
        settingKey="bus_banner"
        defaultBanner={BUS_BANNER_DEFAULT}
        icon={<Bus size={26} className="text-white" />}
        title="My Bus"
        subtitle="Live tracking and fees"
        onBack={onBack}
        maxWidth="max-w-2xl lg:max-w-5xl 2xl:max-w-6xl"
        backgroundIcon={<Bus size={150} className="text-white" />}
      />

      {/* Wider than a reading column on a desktop, because the tracking tab is
          a live map. The fee list keeps its own measure below rather than
          stretching bank references across 1200px. */}
      <div className="relative z-0 max-w-2xl lg:max-w-5xl 2xl:max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 -mt-8 pb-10">
        {/* Inline tabs — overlap the banner */}
        <div className="relative z-10 flex items-stretch bg-white rounded-2xl border border-slate-200 shadow-lg overflow-hidden mb-5 lg:max-w-2xl">
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

        /* ══ WHERE IS MY CHILD ═════════════════════════════════════ */
        ) : tab === 'trips' ? (
          profile ? (
            <ChildTransportView
              studentId={profile.id}
              studentName={profile.full_name}
              avatarUrl={profile.avatar_url}
            />
          ) : null

        /* ══ MY BUS FEES ═══════════════════════════════════════════ */
        ) : fees.length === 0 ? (
          <EmptyState icon={<Wallet size={26} className="text-white" />} text="No fees issued to you." />
        ) : (
          <div className="space-y-5 lg:max-w-2xl">
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
            {f.description || f.fee_head?.name || 'Bus fee'}{f.route?.name ? ` · ${f.route.name}` : ''}
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
