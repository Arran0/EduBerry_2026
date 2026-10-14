'use client'

import React from 'react'
import Link from 'next/link'
import {
  BarChart3,
  Briefcase,
  Bus,
  CalendarCheck,
  ChevronRight,
  CreditCard,
  Users,
} from 'lucide-react'
import DonutChart from '@/components/charts/DonutChart'
import MetricBars from '@/components/charts/MetricBars'
import { fmtINR, fmtINRExact } from '@/lib/formatMoney'
import { ScopeBlock, HomeAttendanceCounts } from './AttendanceInfographicPanel'
import { SkeletonBar, SkeletonDonutBlock } from '../HomeCardSkeletons'
import { HomeFeesSummary } from './FeesInfographicPanel'

const COLLECTED = '#10b981'
const OUTSTANDING = '#f59e0b'

/** A column caption: the scope's name on the left, its way out on the right. */
function ColumnHead({
  icon: Icon, title, href, linkLabel,
}: {
  icon: React.ElementType
  title: string
  /** Omitted where the column's own sub-blocks each carry their way out. */
  href?: string
  linkLabel?: string
}) {
  return (
    <div className="flex items-center justify-between gap-2 mb-3">
      <span className="flex items-center gap-1.5 min-w-0">
        <Icon size={13} className="text-slate-500 flex-shrink-0" />
        <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 truncate">
          {title}
        </span>
      </span>
      {href && (
        <Link
          href={href}
          className="flex-shrink-0 flex items-center gap-0.5 text-[11px] font-semibold text-sky-700 hover:text-sky-800 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/60"
        >
          {linkLabel} <ChevronRight size={12} />
        </Link>
      )}
    </div>
  )
}

/** One ledger — the collected/outstanding split as a donut plus its two rows. */
function FeeColumn({
  icon, title, summary, collectedHref, outstandingHref, reportHref,
}: {
  icon: React.ElementType
  title: string
  summary: HomeFeesSummary | null
  collectedHref: string
  outstandingHref: string
  reportHref: string
}) {
  const collected = summary?.collected ?? 0
  const outstanding = summary?.outstanding ?? 0
  const billed = collected + outstanding
  const rate = billed > 0 ? Math.round((collected / billed) * 100) : 0

  return (
    <div className="p-4 xl:p-5 min-w-0 h-full flex flex-col">
      <ColumnHead icon={icon} title={title} href={reportHref} linkLabel="View all" />
      {/* A null summary here means the fetch has not come back — the page only
          ever hands this a figure or nothing at all, never a loaded zero as
          null. So it shimmers rather than stating a ₹0 nobody counted and then
          replacing it, which reads as the ledger moving. */}
      {summary === null ? <SkeletonDonutBlock size={104} /> : (
      <div className="flex-1 flex items-center gap-4 xl:gap-5">
        <DonutChart
          size={104}
          thickness={12}
          centerValue={billed > 0 ? `${rate}%` : '—'}
          // Nothing billed yet is a fact about the day, not a 0% collection
          // rate — captioning an em dash "collected" would read as a failure.
          centerLabel={billed > 0 ? 'collected' : 'nothing billed'}
          ariaLabel={`${title}: ${fmtINRExact(collected)} collected of ${fmtINRExact(billed)} billed (${rate}%), ${fmtINRExact(outstanding)} outstanding.`}
          segments={[
            {
              label: 'Collected',
              value: collected,
              color: COLLECTED,
              href: collectedHref,
              display: fmtINR(collected),
              title: `Collected: ${fmtINRExact(collected)}`,
            },
            {
              label: 'Outstanding',
              value: outstanding,
              color: OUTSTANDING,
              href: outstandingHref,
              display: fmtINR(outstanding),
              title: `Outstanding: ${fmtINRExact(outstanding)}`,
            },
          ]}
        />
        <div className="flex-1 min-w-0">
          <MetricBars
            dense
            rows={[
              {
                label: 'Collected',
                value: collected,
                color: COLLECTED,
                href: collectedHref,
                display: fmtINR(collected),
                title: `Collected: ${fmtINRExact(collected)}`,
              },
              {
                label: 'Outstanding',
                value: outstanding,
                color: OUTSTANDING,
                href: outstandingHref,
                display: fmtINR(outstanding),
                title: `Outstanding: ${fmtINRExact(outstanding)}`,
              },
            ]}
          />
        </div>
      </div>
      )}
    </div>
  )
}

/** One scalar in the footer strip — a figure over its name, with a way in. */
function FooterMetric({
  icon: Icon, value, label, href, title, loading = false,
}: {
  icon: React.ElementType
  /** The figure, or null while its ledger is still loading. */
  value: string
  label: string
  href: string
  title?: string
  loading?: boolean
}) {
  return (
    <Link
      href={href}
      title={title}
      className="group flex items-center gap-2.5 px-4 xl:px-5 py-3 min-w-0 hover:bg-slate-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-500/60"
    >
      <Icon size={15} className="text-slate-500 flex-shrink-0" />
      <span className="min-w-0">
        <span className="block text-sm font-bold text-slate-800 tabular-nums leading-none">
          {loading ? <SkeletonBar w={50} h={13} cool /> : value}
        </span>
        <span className="block text-[11px] font-medium text-slate-500 mt-1 truncate">
          {label}
        </span>
      </span>
      <ChevronRight
        size={14}
        className="ml-auto flex-shrink-0 text-slate-300 group-hover:text-slate-500 transition-colors"
      />
    </Link>
  )
}

export interface SchoolOverviewPanelProps {
  attendance: { counts: HomeAttendanceCounts | null; subtitle?: string } | null
  schoolFees: HomeFeesSummary | null
  busFees: HomeFeesSummary | null
  /** Which columns this account is entitled to. */
  showAttendance: boolean
  showSchoolFees: boolean
  showBusFees: boolean
  /** Today, pre-formatted by the page so the whole page agrees on the date. */
  today: string
}

/**
 * The admin's standing statistics as one panel instead of three.
 *
 * Attendance, school fees and bus fees are read together — they are the same
 * question ("how is today going?") asked of three ledgers — so they share one
 * surface, one header and one footer strip rather than sitting in three cards
 * with three headings, three borders and three shadows between them. Each
 * column keeps its own donut, its own metric rows and every deep link its
 * mobile tile carried; only the chrome is shared.
 *
 * Widths: at `lg:` attendance takes the full first row (it carries two scopes)
 * and the two ledgers sit beneath it as peers; at `xl:` all three move onto one
 * line, attendance on half and a ledger on each quarter. The footer scalars —
 * today's collection and the dues counts — are always one strip across the
 * bottom, subordinate to the charts above them.
 */
export default function SchoolOverviewPanel({
  attendance, schoolFees, busFees, showAttendance, showSchoolFees, showBusFees, today,
}: SchoolOverviewPanelProps) {
  const feeColumns = (showSchoolFees ? 1 : 0) + (showBusFees ? 1 : 0)

  // Footer scalars, gathered from whichever ledgers this account can see.
  const footer: React.ReactNode[] = []
  if (showSchoolFees) {
    footer.push(
      <FooterMetric
        key="school-today"
        loading={schoolFees === null}
        icon={CalendarCheck}
        value={fmtINR(schoolFees?.todayCollection ?? 0)}
        label="Today's collection"
        href="/more/fees?section=collection"
        title={`Today's collection: ${fmtINRExact(schoolFees?.todayCollection ?? 0)}`}
      />,
      <FooterMetric
        key="school-dues"
        loading={schoolFees === null}
        icon={Users}
        value={String(schoolFees?.studentsWithDues ?? '—')}
        label="Students with dues"
        href="/more/fees?filter=outstanding"
      />,
    )
  }
  if (showBusFees) {
    footer.push(
      <FooterMetric
        key="bus-today"
        loading={busFees === null}
        icon={CalendarCheck}
        value={fmtINR(busFees?.todayCollection ?? 0)}
        label="Bus collection today"
        href="/more/bus?tab=fees&section=collection"
        title={`Bus collection today: ${fmtINRExact(busFees?.todayCollection ?? 0)}`}
      />,
      <FooterMetric
        key="bus-dues"
        loading={busFees === null}
        icon={Bus}
        value={String(busFees?.studentsWithDues ?? '—')}
        label="Passengers with dues"
        href="/more/bus?tab=fees&filter=outstanding"
      />,
    )
  }

  return (
    <div className="pro-card overflow-hidden">
      {/* Header band — one heading for all three ledgers. The tint separates
          it from the white columns below without adding another border. */}
      <div className="flex items-center justify-between gap-3 px-4 xl:px-5 py-3 border-b border-slate-200 bg-gradient-to-r from-slate-50 via-white to-white">
        <div className="flex items-center gap-3 min-w-0">
          <div className="icon-chip w-8 h-8 flex-shrink-0 bg-gradient-to-br from-emerald-400 to-teal-500">
            <BarChart3 size={15} className="relative z-10 text-white drop-shadow-sm" />
          </div>
          <div className="min-w-0">
            <p className="eyebrow text-slate-500 mb-1">Today</p>
            <h2 className="font-display text-[1.2rem] font-bold leading-none headline text-slate-900 truncate">
              School Overview
            </h2>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {attendance?.subtitle && (
            <span className="hidden xl:inline text-[11px] font-medium text-slate-500 truncate max-w-[18rem]">
              {attendance.subtitle}
            </span>
          )}
          <span className="text-xs font-medium text-slate-500 tabular-nums">{today}</span>
        </div>
      </div>

      {/* Charts. `divide-*` can't draw the rules here — the columns wrap at
          lg, so the dividers have to switch axis with them: a top border while
          stacked, a left border once they are side by side. */}
      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-4">
        {showAttendance && (
          <section className="lg:col-span-2 xl:col-span-2 min-w-0" aria-label="Attendance today">
            <div className="p-4 xl:p-5 pb-0 xl:pb-0">
              <ColumnHead icon={BarChart3} title="Attendance" />
            </div>
            {/* The two scopes sit side by side inside attendance's own half —
                they are the same measure of two populations and invite
                comparison, so splitting them across the panel would be wrong. */}
            <div className="flex flex-col sm:flex-row divide-y sm:divide-y-0 sm:divide-x divide-slate-200 -mt-1">
              <ScopeBlock
                loading={attendance !== null && attendance.counts === null}
                icon={Users}
                title="Students"
                tally={attendance?.counts?.students ?? null}
                reportHref="/more/attendance"
                hrefs={{
                  present: '/more/attendance#student-present',
                  absent: '/more/attendance#student-absent',
                  exception: '/more/attendance#student-irregular',
                }}
              />
              <ScopeBlock
                loading={attendance !== null && attendance.counts === null}
                icon={Briefcase}
                title="Staff"
                tally={attendance?.counts?.staff ?? null}
                reportHref="/more/staff-attendance"
                hrefs={{
                  present: '/more/staff-attendance#staff-present',
                  absent: '/more/staff-attendance#staff-absent',
                  exception: '/more/staff-attendance#staff-exceptions',
                }}
              />
            </div>
          </section>
        )}

        {showSchoolFees && (
          <section
            aria-label="School fee collection"
            className={`min-w-0 border-slate-200 ${showAttendance ? 'border-t xl:border-t-0 xl:border-l' : ''}`}
          >
            <FeeColumn
              icon={CreditCard}
              title="School Fees"
              summary={schoolFees}
              collectedHref="/more/fees?filter=collected"
              outstandingHref="/more/fees?filter=outstanding"
              reportHref="/more/fees"
            />
          </section>
        )}

        {showBusFees && (
          <section
            aria-label="Bus fee collection"
            /* Rules have to switch axis with the wrap: a top border while the
               ledgers are stacked, a left one once they pair off at lg, and
               only the left one at xl where all three columns are in a line. */
            className={`min-w-0 border-slate-200 ${showAttendance || showSchoolFees ? 'border-t xl:border-t-0 xl:border-l' : ''} ${showSchoolFees ? 'lg:border-l' : ''}`}
          >
            <FeeColumn
              icon={Bus}
              title="Bus Fees"
              summary={busFees}
              collectedHref="/more/bus?tab=fees&filter=collected"
              outstandingHref="/more/bus?tab=fees&filter=outstanding"
              reportHref="/more/bus?tab=fees"
            />
          </section>
        )}
      </div>

      {/* Footer strip — the leftover scalars, subordinate to the charts. */}
      {footer.length > 0 && (
        <div
          className={`grid grid-cols-1 sm:grid-cols-2 ${feeColumns > 1 ? 'xl:grid-cols-4' : ''} divide-y sm:divide-y-0 sm:divide-x divide-slate-200 border-t border-slate-200`}
        >
          {footer}
        </div>
      )}
    </div>
  )
}
