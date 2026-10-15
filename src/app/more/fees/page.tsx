'use client'

// ─────────────────────────────────────────────────────────────────────────────
// The Fee module.
//
// Three tabs, and no second row of them.
//
//   Collection Center — the money. Laid out like the Bus module's fee screen:
//                       pressable summary cards, one segmented control, and
//                       reminders, late fees and concessions behind buttons
//                       rather than behind tabs.
//   Fee Configuration — the price list itself, not a folder containing one.
//                       Late-fee policy is a button on it.
//   Fee Settings      — permissions, policies, numbering, sessions, WhatsApp.
//
// This screen used to carry a second tab strip under the first — six sections
// under Collection Center, two under Fee Configuration — and several of those
// sections carried a third strip of their own. Three levels of tabs to reach a
// list of cheques. What was a tab and is now a popup did not lose anything: it
// stopped costing everyone else a row of the screen.
//
// Sections are loaded on demand, and a tool's code only arrives when its button
// is pressed.
// ─────────────────────────────────────────────────────────────────────────────

import React, { Suspense, useCallback } from 'react'
import dynamic from 'next/dynamic'
import { useRouter, useSearchParams } from 'next/navigation'
import { Landmark, Layers, Settings, Timer } from 'lucide-react'
import ProtectedLayout from '@/components/ProtectedLayout'
import UnderConstruction from '@/components/UnderConstruction'
import { IndianRupee } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { AcademicYearProvider, useAcademicYear } from '@/contexts/AcademicYearContext'
import { useFeePermissions } from '@/hooks/useFeePermissions'
import { FeeScreen, TabBar, Loading, type TabDef } from '@/components/fees/shell'
import YearScope from '@/components/fees/config/YearScope'
import StudentFeeCard from '@/components/fees/StudentFeeCard'
import FeeToolModal from '@/components/fees/FeeToolModal'
import CollectionCenter, {
  type CenterSection, type CenterTool,
} from '@/components/fees/CollectionCenter'

// ssr:false because each of these is a client screen that reads Supabase on
// mount; server-rendering them buys a flash of empty tables and nothing else.
const FeeGridSection   = dynamic(() => import('@/components/fees/grid/FeeGridSection'), { ssr: false, loading: () => <Loading /> })
const LateFeeSettings  = dynamic(() => import('@/components/fees/sections/LateFeeSettingsSection'), { ssr: false, loading: () => <Loading /> })
const FeeSettingsPanel = dynamic(() => import('@/components/settings/FeeSettingsPanel'), { ssr: false, loading: () => <Loading /> })

type Main = 'collection' | 'config' | 'settings'

// `short` is what a phone shows. "Collection Center · Fee Configuration · Fee
// Settings" is 380px of tab strip on a 375px screen, and a strip that has to
// scroll hides the tab nobody has found yet.
const MAIN_TABS: TabDef<Main>[] = [
  { key: 'collection', label: 'Collection Center', short: 'Collection', icon: Landmark },
  { key: 'config',     label: 'Fee Configuration', short: 'Pricing',    icon: Layers },
  { key: 'settings',   label: 'Fee Settings',      short: 'Settings',   icon: Settings },
]

const SECTIONS: CenterSection[] = ['collection', 'students', 'reports']
const TOOLS: CenterTool[] = ['reminders', 'latefees', 'concessions']

/**
 * The old `sub=` values, which were the nine routes before them. Bookmarks and
 * printed slips from either generation still land where the thing they name
 * now lives — the two that became popups open as popups.
 */
const LEGACY_SUB: Record<string, { section?: CenterSection; tool?: CenterTool; tab?: Main }> = {
  counter:     { section: 'collection' },
  bills:       { section: 'collection' },
  invoices:    { section: 'collection' },
  students:    { section: 'students' },
  reports:     { section: 'reports' },
  chase:       { section: 'collection', tool: 'reminders' },
  concessions: { section: 'collection', tool: 'concessions' },
  pricing:     { tab: 'config' },
  charges:     { tab: 'config', tool: 'latefees' },
}

function FeesInner() {
  const { year } = useAcademicYear()
  const perms = useFeePermissions()
  const router = useRouter()
  const params = useSearchParams()

  const legacy = LEGACY_SUB[params.get('sub') ?? ''] ?? {}

  const main = (MAIN_TABS.some(t => t.key === params.get('tab'))
    ? params.get('tab')
    : legacy.tab ?? 'collection') as Main

  const section = (SECTIONS as string[]).includes(params.get('section') ?? '')
    ? params.get('section') as CenterSection
    : legacy.section ?? 'collection'

  const tool = (TOOLS as string[]).includes(params.get('tool') ?? '')
    ? params.get('tool') as CenterTool
    : legacy.tool ?? null

  // Tab state lives in the URL so the old routes can redirect straight to a
  // section, and so a clerk can bookmark the one tab they live in.
  const go = useCallback((next: { tab?: Main; section?: CenterSection; tool?: CenterTool | null }) => {
    const q = new URLSearchParams()
    q.set('tab', next.tab ?? main)
    const nextSection = next.section ?? section
    if ((next.tab ?? main) === 'collection' && nextSection !== 'collection') {
      q.set('section', nextSection)
    }
    const nextTool = next.tool === undefined ? tool : next.tool
    if (nextTool) q.set('tool', nextTool)
    router.replace(`/more/fees?${q.toString()}`, { scroll: false })
  }, [main, section, tool, router])

  // The late-fee popup belongs to Fee Configuration; the other three to the
  // Collection Center, which owns them itself.
  const lateFeesOpen = main === 'config' && tool === 'latefees'
    && perms.can('fees.latefee.manage')

  return (
    <FeeScreen
      title="Fees"
      subtitle={<>Session {year?.code ?? '—'}</>}
      icon={<Landmark size={17} style={{ color: '#B8983C' }} />}
      actions={<YearScope />}
    >
      <TabBar<Main> active={main} onChange={key => go({ tab: key, tool: null })} tabs={MAIN_TABS} />

      {perms.loading ? <Loading />
        : main === 'collection' ? (
          <CollectionCenter
            section={section}
            onSectionChange={s => go({ section: s })}
            tool={tool}
            onToolChange={t => go({ tool: t })}
          />
        ) : main === 'config' ? (
          <div className="px-3 sm:px-0">
            {perms.canAny('fees.view', 'fees.config.manage') ? (
              <FeeGridSection
                onLateFees={perms.can('fees.latefee.manage') ? () => go({ tool: 'latefees' }) : undefined}
              />
            ) : (
              <p className="px-3 py-10 text-[12.5px] text-[#8C8878] text-center">
                You do not have permission to see the price list.
              </p>
            )}
          </div>
        ) : perms.can('fees.settings.manage') ? (
          <FeeSettingsPanel />
        ) : (
          <p className="px-3 py-10 text-[12.5px] text-[#8C8878] text-center">
            You do not have permission to change fee settings.
          </p>
        )}

      {lateFeesOpen && (
        <FeeToolModal
          title="Late fee settings"
          subtitle="The rules, and the nightly sweep that applies them"
          icon={<Timer size={15} />}
          onClose={() => go({ tool: null })}
        >
          <LateFeeSettings />
        </FeeToolModal>
      )}
    </FeeScreen>
  )
}

function FeesGate() {
  const { profile } = useAuth()
  const isAdmin = profile?.role === 'admin'
  // Held back from everyone but admins while the module is finished. The
  // parent-facing bill view (StudentFeeCard) is written and works; it is gated
  // here rather than deleted, so turning it back on is deleting this branch.
  if (!isAdmin) {
    return (
      <UnderConstruction
        title="Fees"
        description="Online fee bills and payments are almost ready. Until then, the school office has your statement."
        icon={<IndianRupee size={30} className="text-white" />}
      />
    )
  }
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
