'use client'

// ─────────────────────────────────────────────────────────────────────────────
// The Collection Center.
//
// Laid out the way the Bus module's fee screen is, because that arrangement
// works and two fee screens in one product should not be read two different
// ways: the money at the top as cards you can press, one segmented control for
// the two or three places you actually go, and everything else behind a button.
//
//   The cards   — collected, outstanding, efficiency, students billed. Pressing
//                 one narrows the ledger below it; pressing it again clears it.
//   The control — Collection (the ledger and the counter, together), Students,
//                 Reports. Three, where there were six tabs.
//   The tools   — Reminders, Late fees, Concessions. Popups, because they are
//                 errands: opened, done, closed.
//
// The URL carries both the section and whichever tool is open, so a clerk can
// bookmark the one place they live and the old routes still land somewhere
// sensible.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import {
  BadgePercent, BarChart3, Bell, CalendarCheck, CheckCircle2, Clock,
  GraduationCap, Timer, Users, Wallet,
} from 'lucide-react'
import { useAcademicYear } from '@/contexts/AcademicYearContext'
import { useFeePermissions } from '@/hooks/useFeePermissions'
import { ADMIN, inr } from '@/components/fees/ui'
import { LABEL, Loading } from '@/components/fees/shell'
import FeeToolModal from '@/components/fees/FeeToolModal'
import type { LedgerFilter } from '@/components/fees/sections/CollectionSection'
import { fetchYearSummary, type YearSummaryRow } from '@/lib/fees/reports'
import type { FeePermissionKey } from '@/lib/fees/permissions'

// ssr:false because every one of these reads Supabase on mount; server
// rendering them buys a flash of empty tables and nothing else. The tools are
// loaded only once their button is pressed, so the page does not carry three
// screens nobody opened.
const CollectionSection = dynamic(() => import('@/components/fees/sections/CollectionSection'), { ssr: false, loading: () => <Loading /> })
const StudentsSection   = dynamic(() => import('@/components/fees/sections/StudentsSection'), { ssr: false, loading: () => <Loading /> })
const ReportsSection    = dynamic(() => import('@/components/fees/sections/ReportsSection'), { ssr: false, loading: () => <Loading /> })
const RemindersSection  = dynamic(() => import('@/components/fees/sections/RemindersSection'), { ssr: false, loading: () => <Loading /> })
const LateFeeTracking   = dynamic(() => import('@/components/fees/sections/LateFeeTrackingSection'), { ssr: false, loading: () => <Loading /> })
const ConcessionsSection = dynamic(() => import('@/components/fees/sections/ConcessionsSection'), { ssr: false, loading: () => <Loading /> })

export type CenterSection = 'collection' | 'students' | 'reports'
export type CenterTool = 'reminders' | 'latefees' | 'concessions'

const CENTER_SECTIONS: {
  key: CenterSection; label: string; icon: React.ElementType; needs: FeePermissionKey[]
}[] = [
  { key: 'collection', label: 'Collection', icon: Wallet,        needs: ['fees.collect', 'fees.profile.view'] },
  { key: 'students',   label: 'Students',   icon: GraduationCap, needs: ['fees.profile.view'] },
  { key: 'reports',    label: 'Reports',    icon: BarChart3,     needs: ['fees.reports.view'] },
]

const TOOLS: {
  key: CenterTool; label: string; title: string; subtitle: string
  icon: React.ElementType; needs: FeePermissionKey[]
}[] = [
  { key: 'reminders', label: 'Reminders', title: 'Reminders',
    subtitle: 'Who to remind, what was sent, and what goes out on its own',
    icon: Bell, needs: ['fees.profile.view'] },
  { key: 'latefees', label: 'Late fees', title: 'Late fees & fines',
    subtitle: 'What the rules have actually charged',
    icon: Timer, needs: ['fees.latefee.manage', 'fees.fine.apply'] },
  { key: 'concessions', label: 'Concessions', title: 'Concessions',
    subtitle: 'Discounts, scholarships and waivers',
    icon: BadgePercent, needs: ['fees.discount.apply', 'fees.discount.approve', 'fees.scholarship.manage'] },
]

interface Props {
  section: CenterSection
  onSectionChange: (s: CenterSection) => void
  tool: CenterTool | null
  onToolChange: (t: CenterTool | null) => void
}

export default function CollectionCenter({ section, onSectionChange, tool, onToolChange }: Props) {
  const { year } = useAcademicYear()
  const perms = useFeePermissions()

  const [summary, setSummary] = useState<YearSummaryRow | null>(null)
  const [loadingSummary, setLoadingSummary] = useState(true)
  const [filter, setFilter] = useState<LedgerFilter>('all')

  const canSeeSummary = perms.can('fees.reports.view')
  const showAmounts = !perms.amountsHidden

  const loadSummary = useCallback(async () => {
    if (!year || !canSeeSummary) { setLoadingSummary(false); return }
    setLoadingSummary(true)
    try {
      setSummary(await fetchYearSummary(year.id))
    } catch {
      // The cards are a headline, not the screen. A view that will not answer
      // must not take the ledger down with it.
      setSummary(null)
    } finally {
      setLoadingSummary(false)
    }
  }, [year, canSeeSummary])

  useEffect(() => { void loadSummary() }, [loadSummary])

  const sections = useMemo(
    () => CENTER_SECTIONS.filter(s => perms.canAny(...s.needs)), [perms])
  const tools = useMemo(() => TOOLS.filter(t => perms.canAny(...t.needs)), [perms])

  // A section the viewer cannot open falls back to the first they can.
  const active = sections.some(s => s.key === section) ? section : sections[0]?.key
  const openTool = tool && tools.some(t => t.key === tool) ? tool : null
  const openToolDef = TOOLS.find(t => t.key === openTool)

  /** A card press narrows the ledger; pressing the live one clears it. */
  const pickFilter = (next: LedgerFilter) => {
    setFilter(f => (f === next ? 'all' : next))
    onSectionChange('collection')
  }

  if (perms.loading) return <Loading />

  const cards: {
    key: string; label: string; value: string; sub: string
    icon: React.ReactNode; tone: 'dark' | 'light' | 'muted'
    filter?: LedgerFilter; onClick?: () => void
  }[] = [
    {
      key: 'collected', label: 'Collected',
      value: inr(summary?.collected, showAmounts),
      sub: `${summary?.bills ?? 0} bill${summary?.bills === 1 ? '' : 's'} issued`,
      icon: <CheckCircle2 size={15} />, tone: 'dark', filter: 'paid',
    },
    {
      key: 'outstanding', label: 'Outstanding',
      value: inr(summary?.outstanding, showAmounts),
      sub: `${summary?.overdue_bills ?? 0} past due`,
      icon: <Clock size={15} />, tone: 'light', filter: 'overdue',
    },
    {
      key: 'efficiency', label: 'Efficiency',
      value: summary?.efficiency === null || summary?.efficiency === undefined
        ? '—' : `${summary.efficiency}%`,
      sub: 'of what was billed',
      icon: <CalendarCheck size={15} />, tone: 'muted',
    },
    {
      key: 'students', label: 'Students billed',
      value: String(summary?.students ?? 0), sub: 'this session',
      icon: <Users size={15} />, tone: 'light',
      onClick: () => onSectionChange('students'),
    },
  ]

  return (
    <>
      {/* ── The money, as cards you can press ───────────────────────────── */}
      {canSeeSummary && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 mb-2.5 px-3 sm:px-0">
          {cards.map(c => {
            const live = c.filter !== undefined && filter === c.filter && active === 'collection'
            const clickable = Boolean(c.onClick || c.filter)
            const base = c.tone === 'dark' ? 'bg-[#27272A] border-[#B8983C]'
              : c.tone === 'muted' ? 'bg-[#F4F2EC] border-[#E7E2D8]'
              : 'bg-white border-[#E3DFD3]'
            const Tag = clickable ? 'button' : 'div'
            return (
              <Tag
                key={c.key}
                onClick={c.onClick ?? (c.filter ? () => pickFilter(c.filter!) : undefined)}
                title={c.filter ? 'Show these bills' : undefined}
                className={`text-left border p-2.5 transition-all flex flex-col justify-between
                            min-h-[70px] ${base} ${
                  clickable ? 'hover:border-[#B8983C] cursor-pointer' : ''
                } ${live ? 'ring-2 ring-[#B8983C] ring-offset-1 ring-offset-[#FDFCF9]' : ''}`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className={`${LABEL} truncate ${
                    c.tone === 'dark' ? '!text-[#8C8878]' : '!text-[#6B675A]'}`}>
                    {c.label}
                  </span>
                  <span className={c.tone === 'dark' ? 'text-[#B8983C]' : 'text-[#8C8878]'}>{c.icon}</span>
                </div>
                <div>
                  {loadingSummary ? (
                    <div className="h-[22px] w-24 max-w-full bg-[#F4F1E7] animate-pulse" />
                  ) : (
                    <p className={`text-[17px] font-bold tabular-nums leading-tight truncate ${
                      c.tone === 'dark' ? 'text-white' : 'text-[#18181B]'}`}>
                      {c.value}
                    </p>
                  )}
                  <p className={`text-[10px] mt-0.5 truncate ${
                    c.tone === 'dark' ? 'text-[#8A8A93]' : 'text-[#8C8878]'}`}>
                    {c.sub}
                  </p>
                </div>
              </Tag>
            )
          })}
        </div>
      )}

      {/* ── One segmented control, and the tools beside it ──────────────── */}
      <div className="flex flex-wrap items-center gap-2 mb-3 px-3 sm:px-0">
        <div className="flex gap-1 p-1 bg-white border border-[#E3DFD3] flex-1 min-w-[260px]">
          {sections.map(s => {
            const on = s.key === active
            const Icon = s.icon
            return (
              <button key={s.key} onClick={() => onSectionChange(s.key)}
                      className={`flex-1 min-w-0 flex items-center justify-center gap-1 px-1.5 py-1.5
                                  text-[11px] font-bold uppercase tracking-[0.06em] transition-colors ${
                        on ? 'bg-[#27272A] text-white' : 'text-[#8C8878] hover:text-[#18181B] hover:bg-[#FAF8F2]'
                      }`}>
                <Icon size={13} className="flex-shrink-0" />
                <span className="truncate">{s.label}</span>
              </button>
            )
          })}
        </div>
        {tools.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {tools.map(t => {
              const Icon = t.icon
              return (
                <button key={t.key} onClick={() => onToolChange(t.key)}
                        className={ADMIN.ghostBtn}>
                  <Icon size={13} /> {t.label}
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* ── The section itself ──────────────────────────────────────────── */}
      <div className="px-3 sm:px-0">
        {!active ? (
          <p className="px-3 py-10 text-[12.5px] text-[#8C8878] text-center">
            You do not have permission to open anything here.
          </p>
        ) : active === 'collection' ? (
          <CollectionSection filter={filter} onFilterChange={setFilter}
                             onChanged={() => void loadSummary()} />
        ) : active === 'students' ? (
          <StudentsSection />
        ) : (
          <ReportsSection />
        )}
      </div>

      {/* ── The tools ───────────────────────────────────────────────────── */}
      {openToolDef && (
        <FeeToolModal
          title={openToolDef.title}
          subtitle={openToolDef.subtitle}
          icon={<openToolDef.icon size={15} />}
          onClose={() => onToolChange(null)}
        >
          {openTool === 'reminders' ? (
            <RemindersSection onChanged={() => void loadSummary()} />
          ) : openTool === 'latefees' ? (
            <LateFeeTracking onChanged={() => void loadSummary()} />
          ) : (
            <ConcessionsSection />
          )}
        </FeeToolModal>
      )}
    </>
  )
}
