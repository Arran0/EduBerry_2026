'use client'

import React from 'react'
import ModalShell from '@/components/ui/ModalShell'
import { CalendarDays } from 'lucide-react'
import type { DayVerdict } from '@/lib/payroll/engine/types'
import { inr } from './ui'

/**
 * The loss-of-pay drill-down: every day of the period, what it was worth, and
 * which rule decided it.
 *
 * This is the screen that settles a dispute. A teacher asking why ₹1,840 was
 * deducted gets pointed at the three days that did it, each with its own reason
 * line naming the free quota, the tier and the policy group — rather than at a
 * total they have to take on trust.
 */

const CELL: Record<DayVerdict['calendarStatus'], string> = {
  working: 'bg-white border-[#E4E4E7]',
  half_working: 'bg-[#FAFAFA] border-[#E4E4E7]',
  week_off: 'bg-[#F4F4F5] border-[#F4F4F5] text-[#A1A1AA]',
  holiday: 'bg-sky-50 border-sky-100 text-sky-700',
  before_join: 'bg-[#FAFAFA] border-dashed border-[#E4E4E7] text-[#D4D4D8]',
  after_exit: 'bg-[#FAFAFA] border-dashed border-[#E4E4E7] text-[#D4D4D8]',
}

export default function DayGrid({ days, employeeName, perDayRate, onClose }: {
  days: DayVerdict[]
  employeeName: string
  perDayRate?: number
  onClose: () => void
}) {
  const lostDays = days.filter(d => d.lopFraction > 0)
  const totalLop = days.reduce((s, d) => s + d.lopFraction, 0)

  return (
    <ModalShell
      onClose={onClose}
      size="2xl"
      title={`Attendance — ${employeeName}`}
      subtitle={
        totalLop > 0
          ? `${totalLop} day${totalLop === 1 ? '' : 's'} of pay lost${perDayRate ? `, at ${inr(perDayRate)} a day` : ''}`
          : 'No loss of pay this period'
      }
      icon={<CalendarDays size={16} />}
      iconClassName="bg-orange-100 text-orange-600"
    >
      <div className="grid grid-cols-7 gap-1 mb-5">
        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
          <div key={i} className="text-center text-[10px] font-bold uppercase tracking-wider text-[#A1A1AA] pb-1">{d}</div>
        ))}
        {/* Pad to the first day's weekday so the columns line up with real weeks. */}
        {days.length > 0 && Array.from({ length: new Date(`${days[0].date}T12:00:00Z`).getUTCDay() }).map((_, i) => (
          <div key={`pad-${i}`} />
        ))}
        {days.map(d => (
          <div
            key={d.date}
            title={d.reason}
            className={`aspect-square rounded-lg border flex flex-col items-center justify-center relative ${CELL[d.calendarStatus]}`}
          >
            <span className="text-[13px] font-semibold tabular-nums">{Number(d.date.slice(8, 10))}</span>
            {d.lopFraction > 0 && (
              <span className="text-[9px] font-bold text-rose-600 tabular-nums leading-none mt-0.5">
                −{d.lopFraction}
              </span>
            )}
            {d.lopFraction === 0 && d.attendanceStatus === 'late' && (
              <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-amber-400" />
            )}
          </div>
        ))}
      </div>

      {lostDays.length > 0 ? (
        <div>
          <h3 className="text-[10px] font-bold uppercase tracking-widest text-[#71717A] mb-2">
            Where the {totalLop} day{totalLop === 1 ? '' : 's'} went
          </h3>
          <div className="space-y-1.5">
            {lostDays.map(d => (
              <div key={d.date} className="flex items-start gap-3 py-2 px-2.5 rounded-lg bg-[#FAFAFA] border border-[#F4F4F5]">
                <span className="text-[11px] font-semibold text-[#27272A] tabular-nums w-20 flex-shrink-0">
                  {new Date(`${d.date}T12:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', weekday: 'short' })}
                </span>
                <span className="flex-1 text-[11px] text-[#52525B] leading-relaxed">{d.reason}</span>
                <span className="text-[11px] font-bold text-rose-600 tabular-nums flex-shrink-0">
                  −{d.lopFraction} day{d.lopFraction === 1 ? '' : 's'}
                  {perDayRate ? <span className="block text-[10px] font-medium text-[#A1A1AA]">{inr(d.lopFraction * perDayRate)}</span> : null}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <p className="text-[12px] text-[#71717A] text-center py-4">
          Full attendance — nothing was deducted for this period.
        </p>
      )}

      <details className="mt-4">
        <summary className="text-[11px] font-semibold text-[#71717A] cursor-pointer hover:text-[#27272A]">
          Show every day
        </summary>
        <div className="mt-2 space-y-0.5 max-h-64 overflow-y-auto">
          {days.map(d => (
            <div key={d.date} className="flex items-start gap-3 py-1 text-[11px]">
              <span className="text-[#A1A1AA] tabular-nums w-16 flex-shrink-0">{d.date.slice(5)}</span>
              <span className="flex-1 text-[#71717A] leading-relaxed">{d.reason}</span>
            </div>
          ))}
        </div>
      </details>
    </ModalShell>
  )
}
