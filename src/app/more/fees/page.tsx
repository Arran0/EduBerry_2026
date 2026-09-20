'use client'

// ─────────────────────────────────────────────────────────────────────────────
// The Fee module.
//
// This was a hub of nine cards leading to nine routes, which meant the clerk
// who takes a payment, the clerk who chases one, and the clerk who explains a
// bill each had to know which page they were supposed to be on. It is now one
// screen with three tabs, because there are only three things anybody does
// here: work the money, price the money, or configure how both behave.
//
//   Collection Center — everything that touches a live bill or a live family.
//   Fee Configuration — the price list, and the charges that alter it.
//   Fee Settings      — permissions, policies, numbering, sessions, WhatsApp.
//
// Each tab's sections are the old pages, unchanged below their headers. The
// routes still exist as redirects so bookmarks and printed slips keep working.
//
// Sections are loaded on demand. Landing on the Collection Center must not
// pull down the price-list editor, the settings panel and three PDF
// generators, which is what made the old Collection Center cost 140 kB more
// than it needed to.
// ─────────────────────────────────────────────────────────────────────────────

import React, { Suspense, useCallback, useMemo } from 'react'
import dynamic from 'next/dynamic'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  BadgePercent, BarChart3, FileText, GraduationCap, Layers, Landmark,
  MessageSquare, Receipt, Settings, Timer, Wallet,
} from 'lucide-react'
import ProtectedLayout from '@/components/ProtectedLayout'
import { useAuth } from '@/contexts/AuthContext'
import { AcademicYearProvider, useAcademicYear } from '@/contexts/AcademicYearContext'
import { useFeePermissions } from '@/hooks/useFeePermissions'
import { FeeScreen, TabBar, Loading, type TabDef } from '@/components/fees/shell'
import YearScope from '@/components/fees/config/YearScope'
import StudentFeeCard from '@/components/fees/StudentFeeCard'
import type { FeePermissionKey } from '@/lib/fees/permissions'

// ── Sections ────────────────────────────────────────────────────────────────
// ssr:false because every one of these is a client screen that reads Supabase
// on mount; server-rendering them buys a flash of empty tables and nothing else.
const CounterSection     = dynamic(() => import('@/components/fees/sections/CounterSection'), { ssr: false, loading: () => <Loading /> })
const StudentsSection    = dynamic(() => import('@/components/fees/sections/StudentsSection'), { ssr: false, loading: () => <Loading /> })
const BillsSection       = dynamic(() => import('@/components/fees/sections/BillsSection'), { ssr: false, loading: () => <Loading /> })
const ChaseSection       = dynamic(() => import('@/components/fees/sections/ChaseSection'), { ssr: false, loading: () => <Loading /> })
const ConcessionsSection = dynamic(() => import('@/components/fees/sections/ConcessionsSection'), { ssr: false, loading: () => <Loading /> })
const ReportsSection     = dynamic(() => import('@/components/fees/sections/ReportsSection'), { ssr: false, loading: () => <Loading /> })
const ConfigSection      = dynamic(() => import('@/components/fees/sections/ConfigSection'), { ssr: false, loading: () => <Loading /> })
const ChargesSection     = dynamic(() => import('@/components/fees/sections/ChargesSection'), { ssr: false, loading: () => <Loading /> })
const FeeSettingsPanel   = dynamic(() => import('@/components/settings/FeeSettingsPanel'), { ssr: false, loading: () => <Loading /> })

type Main = 'collection' | 'config' | 'settings'

const MAIN_TABS: TabDef<Main>[] = [
  { key: 'collection', label: 'Collection Center', icon: Landmark },
  { key: 'config',     label: 'Fee Configuration', icon: Layers },
  { key: 'settings',   label: 'Fee Settings',      icon: Settings },
]

interface Section {
  key: string
  label: string
  icon: React.ElementType
  /** Hidden outright when the viewer holds none of these. */
  needs: FeePermissionKey[]
  render: () => React.ReactNode
}

const SECTIONS: Record<Main, Section[]> = {
  collection: [
    { key: 'counter',     label: 'Counter',     icon: Wallet,        needs: ['fees.collect'],
      render: () => <CounterSection /> },
    { key: 'students',    label: 'Students',    icon: GraduationCap, needs: ['fees.profile.view'],
      render: () => <StudentsSection /> },
    { key: 'bills',       label: 'Bills',       icon: FileText,      needs: ['fees.profile.view'],
      render: () => <BillsSection /> },
    { key: 'chase',       label: 'Chase',       icon: MessageSquare, needs: ['fees.profile.view'],
      render: () => <ChaseSection /> },
    { key: 'concessions', label: 'Concessions', icon: BadgePercent,  needs: ['fees.discount.apply', 'fees.discount.approve'],
      render: () => <ConcessionsSection /> },
    { key: 'reports',     label: 'Reports',     icon: BarChart3,     needs: ['fees.reports.view'],
      render: () => <ReportsSection /> },
  ],
  config: [
    { key: 'pricing', label: 'Price list',        icon: Receipt, needs: ['fees.view', 'fees.config.manage'],
      render: () => <ConfigSection /> },
    { key: 'charges', label: 'Late fees & fines', icon: Timer,   needs: ['fees.latefee.manage', 'fees.fine.apply'],
      render: () => <ChargesSection /> },
  ],
  settings: [
    { key: 'settings', label: 'Settings', icon: Settings, needs: ['fees.settings.manage'],
      render: () => <FeeSettingsPanel /> },
  ],
}

function FeesInner() {
  const { year } = useAcademicYear()
  const perms = useFeePermissions()
  const router = useRouter()
  const params = useSearchParams()

  const main = (MAIN_TABS.some(t => t.key === params.get('tab'))
    ? params.get('tab') : 'collection') as Main

  // Only the sections this account can actually open. An admin holds every key,
  // so in practice this empties only while permissions are still loading.
  const sections = useMemo(
    () => SECTIONS[main].filter(s => perms.canAny(...s.needs)),
    [main, perms],
  )

  const sub = sections.some(s => s.key === params.get('sub'))
    ? params.get('sub')!
    : sections[0]?.key

  // Tab state lives in the URL so the old routes can redirect straight to a
  // section, and so a clerk can bookmark the one tab they live in.
  const go = useCallback((next: { tab?: Main; sub?: string }) => {
    const q = new URLSearchParams()
    q.set('tab', next.tab ?? main)
    if (next.sub) q.set('sub', next.sub)
    router.replace(`/more/fees?${q.toString()}`, { scroll: false })
  }, [main, router])

  const active = sections.find(s => s.key === sub)

  return (
    <FeeScreen
      title="Fees"
      subtitle={<>Session {year?.code ?? '—'}</>}
      icon={<Landmark size={17} style={{ color: '#B8983C' }} />}
      actions={<YearScope />}
    >
      <TabBar<Main> active={main} onChange={key => go({ tab: key })} tabs={MAIN_TABS} />

      {/* The settings panel carries its own tabs, so a second bar of one would
          be a bar that does nothing. */}
      {sections.length > 1 && (
        <TabBar
          active={sub ?? ''}
          onChange={key => go({ sub: key })}
          tabs={sections.map(s => ({ key: s.key, label: s.label, icon: s.icon }))}
        />
      )}

      {perms.loading ? <Loading />
        : !active ? (
          <p className="px-3 py-10 text-[12.5px] text-[#8C8878] text-center">
            You do not have permission to open anything in this tab.
          </p>
        ) : active.render()}
    </FeeScreen>
  )
}

function FeesGate() {
  const { profile } = useAuth()
  // Fees are an admin-only module on the staff side. Other staff roles fall
  // through to the student card, which shows only the viewer's own bills.
  const isAdmin = profile?.role === 'admin'
  if (!isAdmin) return <StudentFeeCard />
  return <FeesInner />
}

export default function FeesPage() {
  return (
    <ProtectedLayout>
      <AcademicYearProvider>
        {/* useSearchParams needs a Suspense boundary to stay out of the
            static-render bailout. */}
        <Suspense fallback={<Loading />}>
          <FeesGate />
        </Suspense>
      </AcademicYearProvider>
    </ProtectedLayout>
  )
}
