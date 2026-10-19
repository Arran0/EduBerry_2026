'use client'

// ─────────────────────────────────────────────────────────────────────────────
// The Fee module.
//
// Laid out like the transport admin: the banner with the session on it, one
// capsule switch overlapping the banner's foot, and the three places under it.
//
//   Collection — the money: four figures, then Bills, Students and Reports.
//   Pricing    — the price list, the late-fee rules and concessions.
//   Settings   — permissions, policies, numbering, sessions, collection, WhatsApp.
//
// Tab state lives in the URL so a clerk can bookmark the one place they work,
// and the routes and links from before still land where the thing they name
// now lives.
// ─────────────────────────────────────────────────────────────────────────────

import React, { Suspense, useCallback, useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import { useRouter, useSearchParams } from 'next/navigation'
import { BadgePercent, IndianRupee, Landmark, Layers, Settings, Timer } from 'lucide-react'
import ProtectedLayout from '@/components/ProtectedLayout'
import UnderConstruction from '@/components/UnderConstruction'
import PageBanner from '@/components/PageBanner'
import { GlassSegments } from '@/components/transport/glass'
import YearToggle from '@/components/transport/YearToggle'
import { useAuth } from '@/contexts/AuthContext'
import { AcademicYearProvider } from '@/contexts/AcademicYearContext'
import { useFeePermissions } from '@/hooks/useFeePermissions'
import { FEES_BANNER_DEFAULT } from '@/lib/pageConfig'
import { Loading, Notice, SHELL } from '@/components/fees/shell'
import FeeToolModal from '@/components/fees/FeeToolModal'
import CollectionCenter, { type CenterSection } from '@/components/fees/CollectionCenter'
import { DEFAULT_BILL_FILTERS, type BillFilters } from '@/lib/fees/bills'

// ssr:false because each of these is a client screen that reads Supabase on
// mount; server-rendering them buys a flash of empty tables and nothing else.
const FeeGridSection     = dynamic(() => import('@/components/fees/grid/FeeGridSection'), { ssr: false, loading: () => <Loading /> })
const LateFeeSettings    = dynamic(() => import('@/components/fees/sections/LateFeeSettingsSection'), { ssr: false, loading: () => <Loading /> })
const ConcessionsSection = dynamic(() => import('@/components/fees/sections/ConcessionsSection'), { ssr: false, loading: () => <Loading /> })
const FeeSettingsPanel   = dynamic(() => import('@/components/settings/FeeSettingsPanel'), { ssr: false, loading: () => <Loading /> })

type Main = 'collection' | 'config' | 'settings'
type Tool = 'reminders' | 'latefees' | 'concessions'

const MAIN_TABS = [
  { key: 'collection' as const, label: 'Collection', icon: Landmark },
  { key: 'config' as const,     label: 'Pricing',    icon: Layers },
  { key: 'settings' as const,   label: 'Settings',   icon: Settings },
]

const SECTIONS: CenterSection[] = ['bills', 'students', 'reports']

/** Section names from before the Bills tab had its name. */
const SECTION_ALIAS: Record<string, CenterSection> = {
  collection: 'bills', issued: 'bills', counter: 'bills', invoices: 'bills',
}

/**
 * The old `sub=` values, which were the nine routes before them. Bookmarks and
 * printed slips from either generation still land where the thing they name
 * now lives.
 */
const LEGACY_SUB: Record<string, { section?: CenterSection; tool?: Tool; tab?: Main }> = {
  counter:     { section: 'bills' },
  bills:       { section: 'bills' },
  invoices:    { section: 'bills' },
  students:    { section: 'students' },
  reports:     { section: 'reports' },
  chase:       { section: 'bills', tool: 'reminders' },
  concessions: { tab: 'config', tool: 'concessions' },
  pricing:     { tab: 'config' },
  charges:     { tab: 'config', tool: 'latefees' },
}

/** `?filter=` from the home page's fee cards, as the Bills tab's filters. */
function filtersFromLink(filter: string | null): BillFilters | null {
  if (filter === 'outstanding') return { ...DEFAULT_BILL_FILTERS, period: 'session', pay: ['unpaid', 'partial'] }
  if (filter === 'collected') return { ...DEFAULT_BILL_FILTERS, period: 'session', pay: ['paid', 'partial'] }
  if (filter === 'overdue') return { ...DEFAULT_BILL_FILTERS, period: 'session', pay: [], timing: ['overdue'] }
  return null
}

function FeesInner() {
  const perms = useFeePermissions()
  const router = useRouter()
  const params = useSearchParams()
  const [bannerEditing, setBannerEditing] = useState(false)

  const legacy = LEGACY_SUB[params.get('sub') ?? ''] ?? {}
  const rawSection = params.get('section') ?? ''
  const rawTool = params.get('tool') as Tool | null

  // Concessions moved to Pricing: an old Collection link to them lands there.
  const toolTab: Main | undefined = rawTool === 'concessions' || rawTool === 'latefees' ? 'config' : undefined

  const main = (MAIN_TABS.some(t => t.key === params.get('tab')) && !toolTab
    ? params.get('tab')
    : toolTab ?? legacy.tab ?? 'collection') as Main

  const section: CenterSection = (SECTIONS as string[]).includes(rawSection)
    ? rawSection as CenterSection
    : SECTION_ALIAS[rawSection] ?? legacy.section ?? 'bills'

  const tool: Tool | null = (['reminders', 'latefees', 'concessions'] as string[]).includes(rawTool ?? '')
    ? rawTool
    : legacy.tool ?? null

  const linkFilters = useMemo(() => filtersFromLink(params.get('filter')), [params])

  const go = useCallback((next: { tab?: Main; section?: CenterSection; tool?: Tool | null }) => {
    const q = new URLSearchParams()
    const tab = next.tab ?? main
    if (tab !== 'collection') q.set('tab', tab)
    const nextSection = next.section ?? section
    if (tab === 'collection' && nextSection !== 'bills') q.set('section', nextSection)
    const nextTool = next.tool === undefined ? tool : next.tool
    if (nextTool) q.set('tool', nextTool)
    const qs = q.toString()
    router.replace(qs ? `/more/fees?${qs}` : '/more/fees', { scroll: false })
  }, [main, section, tool, router])

  const lateFeesOpen = main === 'config' && tool === 'latefees' && perms.can('fees.latefee.manage')
  const canConcede = perms.canAny('fees.discount.apply', 'fees.discount.approve', 'fees.scholarship.manage')
  const concessionsOpen = main === 'config' && tool === 'concessions' && canConcede

  return (
    <div data-page-theme="fees" className="overflow-x-clip" style={{ minHeight: '100vh' }}>
      <PageBanner
        settingKey="fees_banner"
        defaultBanner={FEES_BANNER_DEFAULT}
        icon={<Landmark size={26} className="text-white" />}
        title="Fees"
        subtitle="Bills, collection, pricing and settings"
        isAdmin
        actions={<YearToggle />}
        onEditingChange={setBannerEditing}
        maxWidth="max-w-7xl 2xl:max-w-[1600px]"
        backgroundIcon={<IndianRupee size={150} className="text-white" />}
      />

      <div className={`${SHELL} px-4 sm:px-6 lg:px-8 pb-14`}>
        {/* Everything but the banner fades while the banner is being edited. */}
        <div style={{
          opacity: bannerEditing ? 0.35 : 1,
          pointerEvents: bannerEditing ? 'none' : 'auto',
          userSelect: bannerEditing ? 'none' : 'auto',
          transition: 'opacity 0.25s ease',
        }}>
          {/* The switch overlaps the banner. Solid, not glass: through a
              translucent control the banner photo shows as noise. */}
          <div className="relative z-10 -mt-6 sm:-mt-7 mb-4 sm:mb-6 flex justify-center sm:justify-start">
            <GlassSegments
              layoutId="fee-hub-tab"
              items={MAIN_TABS}
              value={main}
              onChange={key => go({ tab: key, tool: null })}
              stretch
              className="!bg-white ring-1 ring-black/[.06] shadow-[0_14px_30px_-12px_rgba(15,23,42,.55)]"
            />
          </div>

          {perms.loading ? <Loading />
            : main === 'collection' ? (
              <CollectionCenter
                section={section}
                onSectionChange={s => go({ section: s })}
                remindersOpen={tool === 'reminders'}
                onReminders={open => go({ tool: open ? 'reminders' : null })}
                initialFilters={linkFilters}
              />
            ) : main === 'config' ? (
              perms.canAny('fees.view', 'fees.config.manage') ? (
                <FeeGridSection
                  onLateFees={perms.can('fees.latefee.manage') ? () => go({ tool: 'latefees' }) : undefined}
                  onConcessions={canConcede ? () => go({ tool: 'concessions' }) : undefined}
                />
              ) : (
                <Notice>You do not have permission to see the price list.</Notice>
              )
            ) : perms.can('fees.settings.manage') ? (
              <FeeSettingsPanel />
            ) : (
              <Notice>You do not have permission to change fee settings.</Notice>
            )}
        </div>
      </div>

      {lateFeesOpen && (
        <FeeToolModal
          title="Late fee rules"
          subtitle="What is charged when a bill passes its due date, and the nightly run that charges it"
          icon={<Timer size={16} />}
          onClose={() => go({ tool: null })}
        >
          <LateFeeSettings />
        </FeeToolModal>
      )}

      {concessionsOpen && (
        <FeeToolModal
          title="Concessions"
          subtitle="Discounts, scholarships and waivers, and the requests waiting for approval"
          icon={<BadgePercent size={16} />}
          onClose={() => go({ tool: null })}
        >
          <ConcessionsSection />
        </FeeToolModal>
      )}
    </div>
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
