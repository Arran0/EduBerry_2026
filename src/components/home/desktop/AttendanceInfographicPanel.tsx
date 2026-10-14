'use client'

import React from 'react'
import Link from 'next/link'
import { Briefcase, ChevronRight, Users } from 'lucide-react'
import DonutChart from '@/components/charts/DonutChart'
import MetricBars from '@/components/charts/MetricBars'
import { SkeletonDonutBlock } from '../HomeCardSkeletons'

export interface AttendanceTally {
  present: number
  absent: number
  exception: number
}

export interface HomeAttendanceCounts {
  students: AttendanceTally
  staff: AttendanceTally
}

const PRESENT = '#10b981'
const ABSENT = '#ef4444'
const IRREGULAR = '#f59e0b'

/**
 * One attendance scope — students or staff — as a donut with the rate in the
 * hole and the counts read off beside it. Exported because the combined
 * School Overview panel composes the same two blocks inside its own box
 * rather than reimplementing them.
 */
export function ScopeBlock({
  icon: Icon, title, tally, reportHref, hrefs, loading = false,
}: {
  icon: React.ElementType
  title: string
  tally: AttendanceTally | null
  reportHref: string
  hrefs: { present: string; absent: string; exception: string }
  /** The fetch is still in flight. A panel handed no data otherwise draws a
   *  perfectly confident 0 / 0% — a reading nobody took — and then swaps it for
   *  the real one, which is indistinguishable from the numbers having changed.
   *  While this is set the figures shimmer instead; the caption and the way out
   *  to the full report stay, so the block is never a hole. */
  loading?: boolean
}) {
  const present = tally?.present ?? 0
  const absent = tally?.absent ?? 0
  const exception = tally?.exception ?? 0
  const total = present + absent + exception
  const rate = total > 0 ? Math.round((present / total) * 100) : 0

  return (
    <div className="flex-1 min-w-0 p-4 xl:p-5">
      <div className="flex items-center justify-between mb-3">
        <span className="flex items-center gap-1.5">
          <Icon size={13} className="text-slate-500" />
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{title}</span>
        </span>
        <Link
          href={reportHref}
          className="flex items-center gap-0.5 text-[11px] font-semibold text-sky-600 hover:text-sky-700 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/60"
        >
          View report <ChevronRight size={12} />
        </Link>
      </div>

      {loading ? <SkeletonDonutBlock size={118} /> : (
      <div className="flex items-center gap-4 xl:gap-5">
        <DonutChart
          size={118}
          thickness={13}
          centerValue={total > 0 ? `${rate}%` : '—'}
          // A day nobody has been marked yet says so, rather than captioning an
          // em dash "present" as though it were a reading.
          centerLabel={total > 0 ? 'present' : 'not marked yet'}
          ariaLabel={`${title} attendance today: ${present} present, ${absent} absent, ${exception} irregular out of ${total}.`}
          segments={[
            { label: 'Present', value: present, color: PRESENT, href: hrefs.present },
            { label: 'Absent', value: absent, color: ABSENT, href: hrefs.absent },
            { label: 'Irregular', value: exception, color: IRREGULAR, href: hrefs.exception },
          ]}
        />
        <div className="flex-1 min-w-0">
          <MetricBars
            dense
            rows={[
              { label: 'Present', value: present, color: PRESENT, href: hrefs.present },
              { label: 'Absent', value: absent, color: ABSENT, href: hrefs.absent },
              { label: 'Irregular', value: exception, color: IRREGULAR, href: hrefs.exception },
            ]}
          />
        </div>
      </div>
      )}
    </div>
  )
}

/**
 * Desktop replacement for the mobile attendance card's two rows of three tiles:
 * both scopes side by side, each as a present/absent/irregular donut with its
 * attendance rate in the hole and the counts read off beside it. Same deep
 * links as the tiles, so nothing a phone user could reach is lost.
 */
export default function AttendanceInfographicPanel({
  counts,
  loading = false,
}: {
  counts: HomeAttendanceCounts | null
  loading?: boolean
}) {
  return (
    <div className="pro-card h-full flex flex-row divide-x divide-slate-200 items-center">
      <ScopeBlock
        loading={loading}
        icon={Users}
        title="Students"
        tally={counts?.students ?? null}
        reportHref="/more/attendance"
        hrefs={{
          present: '/more/attendance#student-present',
          absent: '/more/attendance#student-absent',
          exception: '/more/attendance#student-irregular',
        }}
      />
      <ScopeBlock
        loading={loading}
        icon={Briefcase}
        title="Staff"
        tally={counts?.staff ?? null}
        reportHref="/more/staff-attendance"
        hrefs={{
          present: '/more/staff-attendance#staff-present',
          absent: '/more/staff-attendance#staff-absent',
          exception: '/more/staff-attendance#staff-exceptions',
        }}
      />
    </div>
  )
}
