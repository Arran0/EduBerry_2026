'use client'

import React, { useState, useEffect, useCallback, Suspense } from 'react'
import dynamic from 'next/dynamic'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  Bus, Radio,
  SlidersHorizontal, MessageCircle, ScanLine, History, ShieldAlert, School, Map as MapIcon,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import ProtectedLayout from '@/components/ProtectedLayout'
import PageBanner from '@/components/PageBanner'
import { ADMIN } from '@/components/bus/adminUI'
import Modal from '@/components/transport/BusModal'
import { GlassSegments } from '@/components/transport/glass'
import YearToggle from '@/components/transport/YearToggle'
import { AcademicYearProvider } from '@/contexts/AcademicYearContext'
const OperationsSection = dynamic(() => import('@/components/transport/sections/OperationsSection'))
const ConfigurationSection = dynamic(() => import('@/components/transport/sections/ConfigurationSection'))
const SafetySection     = dynamic(() => import('@/components/transport/sections/SafetySection'))
const WhatsAppPanel = dynamic(() =>
  import('@/components/transport/sections/IntegrationsSection').then(m => m.WhatsAppPanel))
const DevicesPanel = dynamic(() =>
  import('@/components/transport/sections/IntegrationsSection').then(m => m.DevicesPanel))
const ScanPanel = dynamic(() => import('@/components/transport/panels').then(m => m.ScanPanel))
const SchoolLocationForm = dynamic(() => import('@/components/transport/TransportSettings').then(m => m.SchoolLocationForm))
const MapProviderForm = dynamic(() => import('@/components/transport/TransportSettings').then(m => m.MapProviderForm))
const ReplayPanel = dynamic(() => import('@/components/transport/panels').then(m => m.ReplayPanel))
import { useAuth } from '@/contexts/AuthContext'
import { isAdminRole } from '@/lib/supabase'
import { BUS_BANNER_DEFAULT } from '@/lib/pageConfig'
import BusFeeReminder from '@/components/transport/BusFeeReminder'

const ChildTransportView = dynamic(() => import('@/components/transport/ChildTransportView'), {
  ssr: false,
  loading: () => <div className="h-64 rounded-[28px] bg-white/60 animate-pulse" />,
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
          ? <AcademicYearProvider><AdminBusHub /></AcademicYearProvider>
          : <AcademicYearProvider><PassengerBusView onBack={() => router.push('/home')} /></AcademicYearProvider>}
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
// opened once a term. Bus fees are fee-app bills under the "Bus fee" head, so
// they are collected in Fees; the chart on Operations links there.
//
// Driver payroll lives at /more/bus/payroll.
// ──────────────────────────────────────────────────────────────

type SectionKey = 'live' | 'config'

const SECTIONS = [
  { key: 'live' as const, label: 'Operations', icon: Radio },
  { key: 'config' as const, label: 'Configuration', icon: SlidersHorizontal },
]

const SECTION_KEYS = SECTIONS.map(s => s.key)

type PanelKey = 'whatsapp' | 'gps' | 'scan' | 'replay' | 'incidents' | 'school' | 'map'

/** Settings popups are small forms; the rest are full working panels. */
const PANELS: Record<PanelKey, { title: string; subtitle: string; icon: LucideIcon; compact?: boolean }> = {
  whatsapp: { title: 'WhatsApp', subtitle: 'Message templates and the sending account', icon: MessageCircle },
  gps: { title: 'GPS', subtitle: 'Hardware already fitted to the buses', icon: Radio },
  scan: { title: 'Scan', subtitle: 'Cards, fobs and QR — only if you want them', icon: ScanLine },
  replay: { title: 'Replay', subtitle: 'Scrub a finished trip, and export the open data feed', icon: History },
  incidents: { title: 'Incidents', subtitle: 'SOS events and their frozen snapshots', icon: ShieldAlert },
  school: { title: 'School location', subtitle: 'Where the Operations map opens', icon: School, compact: true },
  map: { title: 'Map provider', subtitle: 'Your own Mapbox key, or the fallback', icon: MapIcon, compact: true },
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
  const routeParam = searchParams.get('route')

  // Tabs that moved elsewhere. Payroll has its own pages, and bus fees are
  // fee-app bills now (under the "Bus fee" head), collected in Fees.
  useEffect(() => {
    if (tabParam === 'payroll') router.replace('/more/bus/payroll')
    if (tabParam === 'fees') router.replace('/more/fees?section=collection')
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

  // Bumped whenever a popup closes, so anything showing a setting re-reads it.
  const [settingsVersion, setSettingsVersion] = useState(0)

  const closePanel = () => {
    setPanel(null)
    setSettingsVersion(v => v + 1)
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
        actions={<YearToggle />}
        onEditingChange={setBannerEditing}
        maxWidth={ADMIN.shellWidth}
        backgroundIcon={<Bus size={150} className="text-white" />}
      />

      <div className={`${ADMIN.shell} px-4 sm:px-6 lg:px-8 pb-12`}>
        {/* Everything but the banner fades while the banner is being edited */}
        <div style={{ opacity: bannerEditing ? 0.35 : 1, filter: bannerEditing ? 'blur(1.5px)' : 'none', pointerEvents: bannerEditing ? 'none' : 'auto', userSelect: bannerEditing ? 'none' : 'auto', transition: 'opacity 0.25s ease, filter 0.25s ease' }}>

          {/* Tab switch — overlapping the banner. Solid, not glass: through a
              translucent control the banner photo shows as noise behind the
              labels. */}
          <div className="relative z-10 -mt-6 sm:-mt-7 mb-4 sm:mb-6 flex justify-center sm:justify-start">
            <GlassSegments
              layoutId="bus-hub-tab"
              items={SECTIONS}
              value={section}
              onChange={selectSection}
              className="!bg-white ring-1 ring-black/[.06] shadow-[0_14px_30px_-12px_rgba(15,23,42,.55)]"
            />
          </div>

          {section === 'live' && (
            <OperationsSection
              onOpenPanel={openPanel}
              onOpenFees={() => router.push('/more/fees?section=collection')}
              onSetSchool={() => openPanel('school')}
              settingsVersion={settingsVersion}
            />
          )}
          {section === 'config' && (
            <ConfigurationSection onOpenPanel={openPanel} routeId={routeId} onRouteChange={selectRoute} settingsVersion={settingsVersion} />
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
        size={panelMeta?.compact ? 'sm' : 'xl'}
        fullHeight={!panelMeta?.compact}
      >
        {panel === 'whatsapp' && <WhatsAppPanel />}
        {panel === 'gps' && <DevicesPanel />}
        {panel === 'scan' && <ScanPanel />}
        {panel === 'replay' && <ReplayPanel />}
        {panel === 'incidents' && <SafetySection />}
        {panel === 'school' && <SchoolLocationForm onSaved={closePanel} />}
        {panel === 'map' && <MapProviderForm />}
      </Modal>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────
// Passenger view
// ──────────────────────────────────────────────────────────────

/**
 * The family-facing screen: one job, "where is my child". The live map, the
 * ETA to their own stop and today's boarding, under a single title.
 *
 * There is no fee tab. Bus fees are fee-app bills, paid in Fees with every
 * other bill; here they surface only as a reminder banner when one is owed.
 */
function PassengerBusView({ onBack }: { onBack: () => void }) {
  const { profile } = useAuth()

  return (
    <>
      <PageBanner
        settingKey="bus_banner"
        defaultBanner={BUS_BANNER_DEFAULT}
        icon={<Bus size={26} className="text-white" />}
        title="Bus Tracking"
        onBack={onBack}
        maxWidth="max-w-2xl lg:max-w-5xl 2xl:max-w-6xl"
        backgroundIcon={<Bus size={150} className="text-white" />}
      />

      {/* Wider than a reading column on a desktop, because this is a live map. */}
      <div className="relative z-0 max-w-2xl lg:max-w-5xl 2xl:max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 -mt-8 pb-10">
        {profile ? (
          <div className="space-y-4">
            {/* Overlaps the banner, where the tabs used to sit. Renders nothing
                when no bus fee is owed. */}
            <div className="relative z-10 empty:hidden lg:max-w-xl">
              <BusFeeReminder studentId={profile.id} />
            </div>
            <ChildTransportView
              studentId={profile.id}
              studentName={profile.full_name}
              avatarUrl={profile.avatar_url}
            />
          </div>
        ) : (
          <div className="h-64 rounded-[28px] bg-white/60 animate-pulse" />
        )}
      </div>
    </>
  )
}
