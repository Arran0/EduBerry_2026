'use client'

// ─────────────────────────────────────────────────────────────────────────────
// The Collection Center.
//
//   The tiles   — collected, outstanding, efficiency, and how many students
//                 are overdue. Pressing one opens the bills (or students)
//                 behind it.
//   The switch  — Bills, Students, Reports.
//   Reminders   — a popup, because it is an errand: opened, done, closed.
//
// The Bills tab's filters live here rather than in the tab, so a press on a
// tile can set them and switching to Students and back keeps them.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import {
  AlarmClock, BarChart3, Bell, CheckCircle2, Gauge, GraduationCap, Hourglass, ReceiptText,
} from 'lucide-react'
import { useAcademicYear } from '@/contexts/AcademicYearContext'
import { useFeePermissions } from '@/hooks/useFeePermissions'
import { ADMIN, inr } from '@/components/fees/ui'
import { Loading, Notice, Segmented } from '@/components/fees/shell'
import { StatTile } from '@/components/fees/glass'
import FeeToolModal from '@/components/fees/FeeToolModal'
import { fetchYearSummary, type YearSummaryRow } from '@/lib/fees/reports'
import {
  DEFAULT_BILL_FILTERS, countOverdueStudents, isoDay, sameFilters, type BillFilters,
} from '@/lib/fees/bills'
import type { FeePermissionKey } from '@/lib/fees/permissions'

// ssr:false because every one of these reads Supabase on mount.
const BillsSection     = dynamic(() => import('@/components/fees/sections/BillsSection'), { ssr: false, loading: () => <Loading /> })
const StudentsSection  = dynamic(() => import('@/components/fees/sections/StudentsSection'), { ssr: false, loading: () => <Loading /> })
const ReportsSection   = dynamic(() => import('@/components/fees/sections/ReportsSection'), { ssr: false, loading: () => <Loading /> })
const RemindersSection = dynamic(() => import('@/components/fees/sections/RemindersSection'), { ssr: false, loading: () => <Loading /> })

export type CenterSection = 'bills' | 'students' | 'reports'

const CENTER_SECTIONS: {
  key: CenterSection; label: string; icon: React.ElementType; needs: FeePermissionKey[]
}[] = [
  { key: 'bills',    label: 'Bills',    icon: ReceiptText,   needs: ['fees.collect', 'fees.profile.view'] },
  { key: 'students', label: 'Students', icon: GraduationCap, needs: ['fees.profile.view'] },
  { key: 'reports',  label: 'Reports',  icon: BarChart3,     needs: ['fees.reports.view'] },
]

interface Props {
  section: CenterSection
  onSectionChange: (s: CenterSection) => void
  remindersOpen: boolean
  onReminders: (open: boolean) => void
  /** Filters a link arrived with (the home page's fee cards). */
  initialFilters: BillFilters | null
}

/** The four presets a tile press can put on the Bills tab. */
const TILE_FILTERS: Record<'collected' | 'outstanding', BillFilters> = {
  collected:   { ...DEFAULT_BILL_FILTERS, period: 'session', pay: ['paid', 'partial'] },
  outstanding: { ...DEFAULT_BILL_FILTERS, period: 'session', pay: ['unpaid', 'partial'] },
}

export default function CollectionCenter({
  section, onSectionChange, remindersOpen, onReminders, initialFilters,
}: Props) {
  const { year } = useAcademicYear()
  const perms = useFeePermissions()

  const [summary, setSummary] = useState<YearSummaryRow | null>(null)
  const [overdueStudents, setOverdueStudents] = useState<number | null>(null)
  const [loadingSummary, setLoadingSummary] = useState(true)
  const [filters, setFilters] = useState<BillFilters>(initialFilters ?? DEFAULT_BILL_FILTERS)
  // Students opens on the families with something overdue.
  const [overdueOnly, setOverdueOnly] = useState(true)

  useEffect(() => { if (initialFilters) setFilters(initialFilters) }, [initialFilters])

  const canSeeSummary = perms.can('fees.reports.view')
  const showAmounts = !perms.amountsHidden

  const loadSummary = useCallback(async () => {
    if (!year || !canSeeSummary) { setLoadingSummary(false); return }
    setLoadingSummary(true)
    try {
      const [s, n] = await Promise.all([
        fetchYearSummary(year.id),
        countOverdueStudents(year.id, isoDay(new Date())),
      ])
      setSummary(s)
      setOverdueStudents(n)
    } catch {
      // The tiles are a headline, not the screen. A view that will not answer
      // must not take the bills down with it.
      setSummary(null)
      setOverdueStudents(null)
    } finally {
      setLoadingSummary(false)
    }
  }, [year, canSeeSummary])

  useEffect(() => { void loadSummary() }, [loadSummary])

  const sections = useMemo(
    () => CENTER_SECTIONS.filter(s => perms.canAny(...s.needs)), [perms])
  const canRemind = perms.can('fees.profile.view')

  // A section the viewer cannot open falls back to the first they can.
  const active = sections.some(s => s.key === section) ? section : sections[0]?.key

  const showBills = (preset: BillFilters) => {
    setFilters(f => (sameFilters(f, preset) ? DEFAULT_BILL_FILTERS : preset))
    onSectionChange('bills')
  }

  if (perms.loading) return <Loading />

  const live = (preset: BillFilters) => active === 'bills' && sameFilters(filters, preset)
  const efficiency = summary?.efficiency
  const progress = summary?.session_progress

  return (
    <>
      {/* ── The money ────────────────────────────────────────────────────── */}
      {canSeeSummary && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3 mb-4 sm:mb-5">
          <StatTile
            dark
            label="Collected"
            icon={CheckCircle2}
            loading={loadingSummary}
            value={inr(summary?.collected, showAmounts)}
            sub={`against ${summary?.bills ?? 0} bill${summary?.bills === 1 ? '' : 's'}`}
            live={live(TILE_FILTERS.collected)}
            onClick={() => showBills(TILE_FILTERS.collected)}
            title="Show the bills money came in against"
          />
          <StatTile
            label="Outstanding"
            icon={Hourglass}
            loading={loadingSummary}
            value={inr(summary?.outstanding, showAmounts)}
            sub={`${summary?.overdue_bills ?? 0} bill${summary?.overdue_bills === 1 ? '' : 's'} past due`}
            live={live(TILE_FILTERS.outstanding)}
            onClick={() => showBills(TILE_FILTERS.outstanding)}
            title="Show the bills still owed"
          />
          <StatTile
            label="Efficiency"
            icon={Gauge}
            loading={loadingSummary}
            value={efficiency === null || efficiency === undefined ? '—' : `${efficiency}%`}
            sub={progress === null || progress === undefined
              ? 'of what was billed'
              : `of what was billed · ${Math.round(progress)}% of the session gone`}
          />
          <StatTile
            label="Overdue students"
            icon={AlarmClock}
            loading={loadingSummary}
            value={overdueStudents === null ? '—' : String(overdueStudents)}
            sub="a bill past its due date"
            live={active === 'students' && overdueOnly}
            onClick={() => {
              const next = !(active === 'students' && overdueOnly)
              setOverdueOnly(next)
              onSectionChange('students')
            }}
            title="Show the students with an overdue bill"
          />
        </div>
      )}

      {/* ── Where you are, and the one errand ───────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2 mb-3 sm:mb-4">
        <Segmented<CenterSection>
          fill="phone"
          value={active ?? 'bills'}
          onChange={onSectionChange}
          options={sections.map(s => ({ key: s.key, label: s.label, icon: s.icon }))}
          className="max-sm:w-full"
        />
        {/* On a phone the switch has the row to itself, so its three parts sit
            evenly; Reminders moves into the Bills and Students filter rows. */}
        {canRemind && (
          <button onClick={() => onReminders(true)} className={`${ADMIN.ghostBtn} h-9 ml-auto max-sm:hidden`}
                  title="Who to remind, what was sent, and what goes out on its own">
            <Bell size={14} /> Reminders
          </button>
        )}
      </div>

      {/* ── The section ─────────────────────────────────────────────────── */}
      {!active ? (
        <Notice>You do not have permission to open anything here.</Notice>
      ) : active === 'bills' ? (
        <BillsSection filters={filters} onFiltersChange={setFilters}
                      onChanged={() => void loadSummary()}
                      onReminders={canRemind ? () => onReminders(true) : undefined} />
      ) : active === 'students' ? (
        <StudentsSection overdueOnly={overdueOnly} onOverdueOnlyChange={setOverdueOnly}
                         onReminders={canRemind ? () => onReminders(true) : undefined} />
      ) : (
        <ReportsSection />
      )}

      {remindersOpen && canRemind && (
        <FeeToolModal
          title="Reminders"
          subtitle="Who to remind, what was sent, and what goes out on its own"
          icon={<Bell size={16} />}
          onClose={() => onReminders(false)}
        >
          <RemindersSection onChanged={() => void loadSummary()} />
        </FeeToolModal>
      )}
    </>
  )
}
