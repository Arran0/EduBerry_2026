'use client'

import React, { useState, useEffect, useCallback, useMemo, Suspense } from 'react'
import dynamic from 'next/dynamic'
import { useRouter, useSearchParams } from 'next/navigation'
import { AnimatePresence } from 'framer-motion'
import {
  Bus, CreditCard, Receipt, CheckCircle2, Clock, Route, Wallet, Radio,
  SlidersHorizontal, MessageCircle, ScanLine, History, ShieldAlert,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import ProtectedLayout from '@/components/ProtectedLayout'
import UnderConstruction from '@/components/UnderConstruction'
import PageBanner from '@/components/PageBanner'
import FeeStatusBadge from '@/components/bus/FeeStatusBadge'
import { formatINR } from '@/components/bus/FeeCollectionSummary'
import { ADMIN } from '@/components/bus/adminUI'
import Modal from '@/components/workspace/Modal'
import { GlassSegments } from '@/components/transport/glass'
const PayFeeModal          = dynamic(() => import('@/components/bus/PayFeeModal'))
const OperationsSection = dynamic(() => import('@/components/transport/sections/OperationsSection'))
const ConfigurationSection = dynamic(() => import('@/components/transport/sections/ConfigurationSection'))
const SafetySection     = dynamic(() => import('@/components/transport/sections/SafetySection'))
const BusFeesSection    = dynamic(() => import('@/components/bus/sections/BusFeesSection'))
const WhatsAppPanel = dynamic(() =>
  import('@/components/transport/sections/IntegrationsSection').then(m => m.WhatsAppPanel))
const DevicesPanel = dynamic(() =>
  import('@/components/transport/sections/IntegrationsSection').then(m => m.DevicesPanel))
const ScanPanel = dynamic(() => import('@/components/transport/panels').then(m => m.ScanPanel))
const ReplayPanel = dynamic(() => import('@/components/transport/panels').then(m => m.ReplayPanel))
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
  const isAdmin = profile ? isAdminRole(profile.role) : false

  return (
    <ProtectedLayout>
      <div data-page-theme="bus">
        {isAdmin
          ? <AdminBusHub />
          : (
            /*
             * Parents and students see an under-construction notice for now.
             * PassengerBusView below is complete and working — the child-centric
             * "where is my child" screen, the live map, the ETA to their own
             * stop and the fee tab — and is deliberately left in the file
             * rather than deleted: switching it back on is deleting this
             * branch, not rebuilding a screen.
             */
            <UnderConstruction
              title="Bus tracking"
              description="Live bus tracking for families is nearly ready. The school office can tell you about today's trip in the meantime."
              icon={<Bus size={30} className="text-white" />}
            />
          )}
      </div>
    </ProtectedLayout>
  )
}

// ──────────────────────────────────────────────────────────────
// Admin hub — Operations and Configuration
//
// Two tabs, split by what the admin is doing: watching (Operations — the map,
// today's trips, what needs attention, the fee position by month) or setting
// up (Configuration — routes with their stops, riders and fee grids, the fleet,
// the crew, monthly billing, and the connections).
//
// There is no "Manage" popup any more. Routes, fleet and crew were three
// popups that only make sense together, so they are one page now; Replay and
// Incidents sit above the map they belong to; WhatsApp, GPS and Scan still
// open in their own popups from the foot of Configuration, because they are
// opened once a term. The fee ledger (collection, issued fees, fee heads) is
// a popup from the fee chart on Operations.
//
// Driver payroll lives at /more/bus/payroll.
// ──────────────────────────────────────────────────────────────

type SectionKey = 'live' | 'config'

const SECTIONS = [
  { key: 'live' as const, label: 'Operations', icon: Radio },
  { key: 'config' as const, label: 'Configuration', icon: SlidersHorizontal },
]

const SECTION_KEYS = SECTIONS.map(s => s.key)

type PanelKey = 'whatsapp' | 'gps' | 'scan' | 'replay' | 'incidents' | 'ledger'

const PANELS: Record<PanelKey, { title: string; subtitle: string; icon: LucideIcon }> = {
  whatsapp: { title: 'WhatsApp', subtitle: 'Message templates and the sending account', icon: MessageCircle },
  gps: { title: 'GPS', subtitle: 'Hardware already fitted to the buses', icon: Radio },
  scan: { title: 'Scan', subtitle: 'Cards, fobs and QR — only if you want them', icon: ScanLine },
  replay: { title: 'Replay', subtitle: 'Scrub a finished trip, and export the open data feed', icon: History },
  incidents: { title: 'Incidents', subtitle: 'SOS events and their frozen snapshots', icon: ShieldAlert },
  ledger: { title: 'Bus fee ledger', subtitle: 'Collection, issued fees and fee heads', icon: Wallet },
}

const PANEL_KEYS = Object.keys(PANELS) as PanelKey[]

/**
 * Old `?tab=` values, kept working.
 *
 * `/home` links to `?tab=fees&section=issued&filter=outstanding`, the payroll
 * sub-pages link back to `?tab=payroll`, and `/more/bus/fees` redirects to
 * `?tab=fees`. Those are live links in the app and in whatever anyone has
 * bookmarked; a rename that breaks them is a rename that shipped a bug.
 */
const LEGACY_TAB: Record<string, { tab: SectionKey; panel?: PanelKey }> = {
  insights: { tab: 'live' },
  reports:  { tab: 'live' },
  fees:     { tab: 'live', panel: 'ledger' },
  routes:   { tab: 'config' },
  fleet:    { tab: 'config' },
  crew:     { tab: 'config' },
  configuration: { tab: 'config' },
  history:  { tab: 'live', panel: 'replay' },
  replay:   { tab: 'live', panel: 'replay' },
  safety:   { tab: 'live', panel: 'incidents' },
  setup:    { tab: 'config', panel: 'whatsapp' },
  payroll:  { tab: 'live' },
}

function AdminBusHub() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const tabParam = searchParams.get('tab')
  const panelParam = searchParams.get('panel')
  const feesSectionParam = searchParams.get('section')
  const feesFilterParam  = searchParams.get('filter')
  const routeParam = searchParams.get('route')

  // ?tab=payroll used to open a tab that no longer exists here.
  useEffect(() => {
    if (tabParam === 'payroll') router.replace('/more/bus/payroll')
  }, [tabParam, router])

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
  const [routeId, setRouteId] = useState<string | null>(routeParam)
  const [bannerEditing, setBannerEditing] = useState(false)

  // One place that writes the URL, so a tab change and a popup open can never
  // disagree about what the address bar says.
  const syncUrl = useCallback((tab: SectionKey, open: PanelKey | null, route: string | null = null) => {
    const qs = new URLSearchParams()
    if (tab !== 'live') qs.set('tab', tab)
    if (tab === 'config' && route) qs.set('route', route)
    if (open) qs.set('panel', open)
    const q = qs.toString()
    router.replace(q ? `/more/bus?${q}` : '/more/bus', { scroll: false })
  }, [router])

  const selectSection = (key: SectionKey) => {
    setSection(key)
    syncUrl(key, panel, routeId)
  }

  const openPanel = (key: PanelKey) => {
    setPanel(key)
    syncUrl(section, key, routeId)
  }

  const closePanel = () => {
    setPanel(null)
    syncUrl(section, null, routeId)
  }

  // The open route lives in the URL, so a route can be linked to directly.
  const selectRoute = useCallback((id: string | null) => {
    setRouteId(id)
    syncUrl('config', panel, id)
  }, [syncUrl, panel])

  const panelMeta = panel ? PANELS[panel] : null

  return (
    <div style={{ minHeight: '100vh' }}>
      {/* No back button: it cost the banner a whole row, and the app's own
          navigation already goes back. */}
      <PageBanner
        settingKey="bus_banner"
        defaultBanner={BUS_BANNER_DEFAULT}
        icon={<Bus size={26} className="text-white" />}
        title="Transport"
        subtitle="Live fleet, boarding, routes, fees & crew"
        isAdmin
        onEditingChange={setBannerEditing}
        maxWidth={ADMIN.shellWidth}
        backgroundIcon={<Bus size={150} className="text-white" />}
      />

      <div className={`${ADMIN.shell} px-4 sm:px-6 lg:px-8 pb-12`}>
        {/* Everything but the banner fades while the banner is being edited */}
        <div style={{ opacity: bannerEditing ? 0.35 : 1, filter: bannerEditing ? 'blur(1.5px)' : 'none', pointerEvents: bannerEditing ? 'none' : 'auto', userSelect: bannerEditing ? 'none' : 'auto', transition: 'opacity 0.25s ease, filter 0.25s ease' }}>

          {/* Tab switch — a glass segmented control, overlapping the banner */}
          <div className="relative z-10 -mt-6 sm:-mt-7 mb-6 flex justify-center sm:justify-start">
            <GlassSegments
              layoutId="bus-hub-tab"
              items={SECTIONS}
              value={section}
              onChange={selectSection}
              className="!bg-white/75 shadow-[0_12px_30px_-14px_rgba(15,23,42,.45)]"
            />
          </div>

          {section === 'live' && (
            <OperationsSection
              onOpenPanel={openPanel}
              onOpenLedger={() => openPanel('ledger')}
            />
          )}
          {section === 'config' && (
            <ConfigurationSection onOpenPanel={openPanel} routeId={routeId} onRouteChange={selectRoute} />
          )}
        </div>
      </div>

      {/* One modal, whichever panel is open. Mounted only while open, so a
          panel's queries fire when it is actually shown. */}
      <Modal
        open={panel !== null}
        onClose={closePanel}
        title={panelMeta?.title ?? ''}
        subtitle={panelMeta?.subtitle}
        icon={panelMeta?.icon}
        size="xl"
        fullHeight
      >
        {panel === 'whatsapp' && <WhatsAppPanel />}
        {panel === 'gps' && <DevicesPanel />}
        {panel === 'scan' && <ScanPanel />}
        {panel === 'replay' && <ReplayPanel />}
        {panel === 'incidents' && <SafetySection />}
        {panel === 'ledger' && <BusFeesSection initialSection={feesSectionParam} initialFilter={feesFilterParam} />}
      </Modal>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────
// Passenger view
// ──────────────────────────────────────────────────────────────

type PassengerTab = 'trips' | 'fees'

/**
 * The family-facing screen: "where is my child", the live map, the ETA to
 * their own stop, boarding history and the fee tab.
 *
 * Finished and working, and currently unreachable on purpose — non-admins get
 * an under-construction notice above while the module is completed. It is kept
 * rather than deleted because switching it back on is deleting one branch in
 * BusPageContent, whereas deleting it would mean rebuilding the screen.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
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
