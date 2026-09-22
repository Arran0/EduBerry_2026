'use client'

// ─────────────────────────────────────────────────────────────────────────────
// The Collection Center.
//
// Laid out the way the Bus module's fee screen is, because that arrangement
// works and two fee screens in one product should not be read two different
// ways: the money at the top as cards you can press, one segmented control for
// the two or three places you actually go, and everything else behind a button.
//
//   The cards   — collected, outstanding, today's collection, students
//                 overdue. Four figures an office actually opens this screen
//                 to see. "Efficiency" was a ratio of two of them and
//                 "students billed" was a headcount nobody chases; today's
//                 takings and the number of families behind are both things
//                 somebody does something about before the day ends.
//                 Pressing one narrows the ledger below it.
//   The control — Collection (the ledger and the counter, together), Students,
//                 Reports. Three, where there were six tabs.
//   The tools   — Reminders, Fines, Concessions. Popups, because they are
//                 errands: opened, done, closed.
//
// The URL carries both the section and whichever tool is open, so a clerk can
// bookmark the one place they live and the old routes still land somewhere
// sensible.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import {
  AlertOctagon, BadgePercent, BarChart3, Bell, CheckCircle2, Clock,
  Gavel, GraduationCap, Sunrise, Wallet,
} from 'lucide-react'
import { useAcademicYear } from '@/contexts/AcademicYearContext'
import { useFeePermissions } from '@/hooks/useFeePermissions'
import { ADMIN, inr } from '@/components/fees/ui'
import { Loading } from '@/components/fees/shell'
import FeeToolModal from '@/components/fees/FeeToolModal'
import { fetchDayCollection, fetchOverdueStudentCount, fetchYearSummary, type YearSummaryRow } from '@/lib/fees/reports'
import {
  noFilters, rangeFor, todayISO, type LedgerFilters, type StatusFacet,
} from '@/lib/fees/ledger'
import type { FeePermissionKey } from '@/lib/fees/permissions'

// ssr:false because every one of these reads Supabase on mount; server
// rendering them buys a flash of empty tables and nothing else. The tools are
// loaded only once their button is pressed, so the page does not carry three
// screens nobody opened.
const CollectionSection = dynamic(() => import('@/components/fees/sections/CollectionSection'), { ssr: false, loading: () => <Loading /> })
const StudentsSection   = dynamic(() => import('@/components/fees/sections/StudentsSection'), { ssr: false, loading: () => <Loading /> })
const ReportsSection    = dynamic(() => import('@/components/fees/sections/ReportsSection'), { ssr: false, loading: () => <Loading /> })
const RemindersSection  = dynamic(() => import('@/components/fees/sections/RemindersSection'), { ssr: false, loading: () => <Loading /> })
const FinesSection      = dynamic(() => import('@/components/fees/sections/FinesSection'), { ssr: false, loading: () => <Loading /> })
const ConcessionsSection = dynamic(() => import('@/components/fees/sections/ConcessionsSection'), { ssr: false, loading: () => <Loading /> })

export type CenterSection = 'collection' | 'students' | 'reports'
export type CenterTool = 'reminders' | 'fines' | 'concessions'

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
  { key: 'fines', label: 'Fines', title: 'Fines',
    subtitle: 'A charge for something that happened, with its own due date',
    icon: Gavel, needs: ['fees.fine.apply'] },
  { key: 'concessions', label: 'Concessions', title: 'Concessions',
    subtitle: 'Staff wards, siblings, scholarships and waivers',
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
  const [today, setToday] = useState<{ collected: number | null; receipts: number } | null>(null)
  const [overdue, setOverdue] = useState<{ students: number; bills: number } | null>(null)
  const [loadingSummary, setLoadingSummary] = useState(true)
  const [filters, setFilters] = useState<LedgerFilters>(noFilters)

  const canSeeSummary = perms.can('fees.reports.view')
  const showAmounts = !perms.amountsHidden

  const loadSummary = useCallback(async () => {
    if (!year || !canSeeSummary) { setLoadingSummary(false); return }
    setLoadingSummary(true)
    const day = todayISO()
    try {
      // Three independent reads, so they go together rather than one after the
      // other — the strip is the first thing on the screen and should not wait
      // three round trips to fill in.
      const [s, t, o] = await Promise.all([
        fetchYearSummary(year.id),
        fetchDayCollection(year.id, day),
        fetchOverdueStudentCount(year.id, day),
      ])
      setSummary(s); setToday(t); setOverdue(o)
    } catch {
      // The cards are a headline, not the screen. A view that will not answer
      // must not take the ledger down with it.
      setSummary(null); setToday(null); setOverdue(null)
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

  /**
   * A card press narrows the ledger to what the card counts; pressing the live
   * one clears it again. Each card sets the whole filter rather than one field,
   * so "Today's collection" cannot leave a stale status behind it.
   */
  const applyCardFilter = (next: LedgerFilters, live: boolean) => {
    setFilters(live ? noFilters() : next)
    onSectionChange('collection')
  }

  const statusesAre = (...wanted: StatusFacet[]) =>
    filters.statuses.size === wanted.length
    && wanted.every(w => filters.statuses.has(w))
    && filters.range.key === 'all'

  if (perms.loading) return <Loading />

  const cards: {
    key: string; label: string; value: string; sub: string
    icon: React.ReactNode; tone: 'dark' | 'light' | 'muted'
    live?: boolean; onClick?: () => void
  }[] = [
    {
      key: 'collected', label: 'Collected',
      value: inr(summary?.collected, showAmounts),
      sub: `${summary?.bills ?? 0} bill${summary?.bills === 1 ? '' : 's'} this session`,
      icon: <CheckCircle2 size={15} />, tone: 'dark',
      live: statusesAre('paid'),
      onClick: () => applyCardFilter(
        { ...noFilters(), statuses: new Set<StatusFacet>(['paid']) }, statusesAre('paid')),
    },
    {
      key: 'outstanding', label: 'Outstanding',
      value: inr(summary?.outstanding, showAmounts),
      sub: `${summary?.overdue_bills ?? 0} bill${summary?.overdue_bills === 1 ? '' : 's'} past due`,
      icon: <Clock size={15} />, tone: 'light',
      live: statusesAre('pending', 'overdue', 'partly_paid'),
      onClick: () => applyCardFilter(
        { ...noFilters(), statuses: new Set<StatusFacet>(['pending', 'overdue', 'partly_paid']) },
        statusesAre('pending', 'overdue', 'partly_paid')),
    },
    {
      key: 'today', label: "Today's collection",
      value: inr(today?.collected, showAmounts),
      sub: `${today?.receipts ?? 0} receipt${today?.receipts === 1 ? '' : 's'} today`,
      icon: <Sunrise size={15} />, tone: 'light',
      // Bills raised today, which is the list this figure sits beside — the
      // receipts themselves are on each family's counter.
      live: filters.range.key === 'today' && filters.statuses.size === 0,
      onClick: () => applyCardFilter(
        { ...noFilters(), range: rangeFor('today') },
        filters.range.key === 'today' && filters.statuses.size === 0),
    },
    {
      key: 'overdue', label: 'Students overdue',
      value: String(overdue?.students ?? 0),
      sub: `${overdue?.bills ?? 0} bill${overdue?.bills === 1 ? '' : 's'} past their date`,
      icon: <AlertOctagon size={15} />,
      tone: (overdue?.students ?? 0) > 0 ? 'muted' : 'light',
      live: statusesAre('overdue'),
      onClick: () => applyCardFilter(
        { ...noFilters(), statuses: new Set<StatusFacet>(['overdue']) }, statusesAre('overdue')),
    },
  ]

  return (
    <>
      {/* ── The money, as cards you can press ───────────────────────────── */}
      {canSeeSummary && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 mb-3 px-3 sm:px-0">
          {cards.map(c => {
            const base = c.tone === 'dark' ? 'bg-[#27272A] border-[#B8983C]'
              : c.tone === 'muted' ? 'bg-[#F4F2EC] border-[#E7E2D8]'
              : 'bg-white border-[#E3DFD3]'
            const Tag = c.onClick ? 'button' : 'div'
            return (
              <Tag
                key={c.key}
                onClick={c.onClick}
                title={c.onClick ? 'Show these bills' : undefined}
                className={`text-left border p-3 transition-all flex flex-col justify-between min-h-[82px] ${base} ${
                  c.onClick ? 'hover:border-[#B8983C] cursor-pointer' : ''
                } ${c.live ? 'ring-2 ring-[#B8983C] ring-offset-1 ring-offset-[#FDFCF9]' : ''}`}
              >
                <div className="flex items-center justify-between gap-1 mb-1.5">
                  <span className={`text-[10px] font-bold uppercase tracking-widest truncate ${
                    c.tone === 'dark' ? 'text-[#8C8878]' : 'text-[#6B675A]'}`}>
                    {c.label}
                  </span>
                  <span className={`flex-shrink-0 ${c.tone === 'dark' ? 'text-[#B8983C]' : 'text-[#8C8878]'}`}>
                    {c.icon}
                  </span>
                </div>
                <div>
                  {loadingSummary ? (
                    <div className="h-[22px] w-24 max-w-full bg-[#F4F1E7] animate-pulse" />
                  ) : (
                    <p className={`text-lg sm:text-xl font-bold tabular-nums leading-tight ${
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
                      className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 text-[11px]
                                  sm:text-[12px] font-bold uppercase tracking-[0.06em] transition-colors ${
                        on ? 'bg-[#27272A] text-white' : 'text-[#8C8878] hover:text-[#18181B] hover:bg-[#FAF8F2]'
                      }`}>
                <Icon size={13} /> <span className="truncate">{s.label}</span>
              </button>
            )
          })}
        </div>
        {tools.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {tools.map(t => {
              const Icon = t.icon
              return (
                <button key={t.key} onClick={() => onToolChange(t.key)} className={ADMIN.ghostBtn}>
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
          <CollectionSection filters={filters} onFiltersChange={setFilters}
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
          ) : openTool === 'fines' ? (
            <FinesSection onChanged={() => void loadSummary()} />
          ) : (
            <ConcessionsSection />
          )}
        </FeeToolModal>
      )}
    </>
  )
}
