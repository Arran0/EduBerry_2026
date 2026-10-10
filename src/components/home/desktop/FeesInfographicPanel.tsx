'use client'

import React from 'react'
import Link from 'next/link'
import { CalendarCheck, Users } from 'lucide-react'
import DonutChart from '@/components/charts/DonutChart'
import MetricBars from '@/components/charts/MetricBars'
import { fmtINR, fmtINRExact } from '@/lib/formatMoney'

export interface HomeFeesSummary {
  collected: number
  outstanding: number
  todayCollection: number
  studentsWithDues: number
}

interface FeesInfographicPanelProps {
  summary: HomeFeesSummary | null
  /** Base route for the segment deep links (school fees vs bus fees). */
  collectedHref: string
  outstandingHref: string
  todayHref: string
  /** 'Students with Dues' vs 'Passengers with Dues'. */
  duesLabel: string
}

/**
 * Desktop replacement for the mobile 2×2 fee tile card: the collected/outstanding
 * split as a donut with the collection rate in the hole, the same two figures
 * read off as metric rows beside it, and the leftover scalars in a subordinate
 * footer. Every segment keeps the deep link its mobile tile carried.
 */
export default function FeesInfographicPanel({
  summary, collectedHref, outstandingHref, todayHref, duesLabel,
}: FeesInfographicPanelProps) {
  const collected = summary?.collected ?? 0
  const outstanding = summary?.outstanding ?? 0
  const billed = collected + outstanding
  const rate = billed > 0 ? Math.round((collected / billed) * 100) : 0

  return (
    <div className="pro-card h-full flex flex-col">
      <div className="flex-1 flex items-center gap-5 xl:gap-7 p-4 xl:p-5">
        <DonutChart
          size={136}
          thickness={15}
          centerValue={`${rate}%`}
          centerLabel="collected"
          ariaLabel={`Fee collection: ${fmtINRExact(collected)} collected of ${fmtINRExact(billed)} billed (${rate}%), ${fmtINRExact(outstanding)} outstanding.`}
          segments={[
            {
              label: 'Collected',
              value: collected,
              color: '#10b981',
              href: collectedHref,
              display: fmtINR(collected),
              title: `Collected: ${fmtINRExact(collected)}`,
            },
            {
              label: 'Outstanding',
              value: outstanding,
              color: '#f59e0b',
              href: outstandingHref,
              display: fmtINR(outstanding),
              title: `Outstanding: ${fmtINRExact(outstanding)}`,
            },
          ]}
        />

        <div className="flex-1 min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-2">
            Billed this year · {fmtINR(billed)}
          </p>
          <MetricBars
            showPercent
            rows={[
              {
                label: 'Collected',
                value: collected,
                color: '#10b981',
                href: collectedHref,
                display: fmtINR(collected),
                title: `Collected: ${fmtINRExact(collected)}`,
              },
              {
                label: 'Outstanding',
                value: outstanding,
                color: '#f59e0b',
                href: outstandingHref,
                display: fmtINR(outstanding),
                title: `Outstanding: ${fmtINRExact(outstanding)}`,
              },
            ]}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 divide-x divide-slate-200 border-t border-slate-200">
        <Link
          href={todayHref}
          className="flex items-center gap-2.5 px-4 py-3 hover:bg-slate-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/60"
          title={`Today's collection: ${fmtINRExact(summary?.todayCollection ?? 0)}`}
        >
          <CalendarCheck size={15} className="text-slate-500 flex-shrink-0" />
          <span className="min-w-0">
            <span className="block text-sm font-bold text-slate-800 tabular-nums leading-none">
              {fmtINR(summary?.todayCollection ?? 0)}
            </span>
            <span className="block text-[11px] font-medium text-slate-500 mt-1 truncate">
              Today&apos;s collection
            </span>
          </span>
        </Link>
        <Link
          href={outstandingHref}
          className="flex items-center gap-2.5 px-4 py-3 hover:bg-slate-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/60"
        >
          <Users size={15} className="text-slate-500 flex-shrink-0" />
          <span className="min-w-0">
            <span className="block text-sm font-bold text-slate-800 tabular-nums leading-none">
              {summary?.studentsWithDues ?? '—'}
            </span>
            <span className="block text-[11px] font-medium text-slate-500 mt-1 truncate">
              {duesLabel}
            </span>
          </span>
        </Link>
      </div>
    </div>
  )
}
