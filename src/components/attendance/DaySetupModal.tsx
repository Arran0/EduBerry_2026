'use client'

import React from 'react'
import { Settings2, Umbrella, Ban, Clock, Repeat, ChevronRight } from 'lucide-react'
import ModalShell from '@/components/ui/ModalShell'
import type { HolidayGroup, NonWorkingDayGroup, DayTimingGroup } from '@/lib/attendance'
import { SETUP_SHEET_HEIGHT } from './reportKit'

function formatTimeShort(t: string) {
  const [h, m] = t.split(':').map(Number)
  const d = new Date()
  d.setHours(h, m, 0, 0)
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

/**
 * The report's day setup — holiday, non-working day and cutoff times for the
 * day on screen — as a popup in the Documents popup's design: the same glass
 * sheet, the same chooser rows, the same fixed height. Each row says what is
 * set for the day now and opens that rule's own editor.
 *
 * Rules still loading draw as a grey line in the row, at the row's height, so
 * nothing in the sheet moves when they land.
 *
 * Render inside <AnimatePresence> for the exit animation.
 */
export default function DaySetupModal({
  dateLabel, holidayRules, nonWorkingRules, dayTimings, onOpenHoliday, onOpenNonWorking, onOpenTiming, onClose,
}: {
  dateLabel: string
  /** undefined while loading. */
  holidayRules: HolidayGroup[] | undefined
  nonWorkingRules: NonWorkingDayGroup[] | undefined
  dayTimings: DayTimingGroup[] | undefined
  onOpenHoliday: () => void
  onOpenNonWorking: () => void
  onOpenTiming: () => void
  onClose: () => void
}) {
  const scope = (r: { is_default: boolean; staff_ids: string[] }) => r.is_default ? 'everyone' : `${r.staff_ids.length} staff`

  const rows: {
    key: string
    title: string
    icon: React.ReactNode
    chip: string
    /** null while loading */
    status: string | null
    set: boolean
    explain: string
    onClick: () => void
  }[] = [
    {
      key: 'holiday',
      title: 'Holiday',
      icon: <Umbrella size={19} className="relative z-10 text-white" />,
      chip: 'bg-[linear-gradient(135deg,#a78bfa,#7c3aed)]',
      status: holidayRules === undefined ? null
        : holidayRules.length === 0 ? 'Not a holiday'
          : holidayRules.map(r => `${r.name} (${scope(r)})`).join(' · '),
      set: !!holidayRules?.length,
      explain: 'A paid day off — nobody is marked absent.',
      onClick: onOpenHoliday,
    },
    {
      key: 'non_working',
      title: 'Non-working day',
      icon: <Ban size={19} className="relative z-10 text-white" />,
      chip: 'bg-[linear-gradient(135deg,#94a3b8,#475569)]',
      status: nonWorkingRules === undefined ? null
        : nonWorkingRules.length === 0 ? 'A working day'
          : nonWorkingRules.map(r => `${r.name} (${scope(r)})`).join(' · '),
      set: !!nonWorkingRules?.length,
      explain: 'Not worked and not paid.',
      onClick: onOpenNonWorking,
    },
    {
      key: 'timing',
      title: 'Cutoff times',
      icon: dayTimings?.[0]?.scope_type === 'weekday'
        ? <Repeat size={19} className="relative z-10 text-white" />
        : <Clock size={19} className="relative z-10 text-white" />,
      chip: 'bg-[linear-gradient(135deg,#CBAB55,#A07F2A)]',
      status: dayTimings === undefined ? null
        : dayTimings.length === 0 ? 'School default cutoffs'
          : dayTimings.map(t => `${dayTimings.length > 1 ? `${t.label}: ` : ''}late after ${formatTimeShort(t.late_cutoff)}, half day before ${formatTimeShort(t.checkout_cutoff)}`).join(' · '),
      set: !!dayTimings?.length,
      explain: 'When a check-in turns Late, and a check-out a Half day.',
      onClick: onOpenTiming,
    },
  ]

  return (
    <ModalShell
      onClose={onClose}
      glass
      size="lg"
      title="Day setup"
      subtitle={dateLabel}
      icon={<Settings2 size={17} className="text-white" />}
      iconClassName="bg-[linear-gradient(135deg,#3D3B40,#27272A)]"
      minHClass={SETUP_SHEET_HEIGHT}
    >
      <div className="space-y-2.5">
        {rows.map(r => (
          <button
            key={r.key}
            onClick={r.onClick}
            className="group w-full flex items-center gap-3.5 p-3.5 rounded-2xl text-left bg-[#FAF9F6] border border-[#27272A]/[0.06] hover:bg-white hover:border-[#B8983C]/40 hover:shadow-[0_10px_24px_-16px_rgba(15,23,42,0.45)] active:scale-[0.99] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B8983C]/60"
          >
            <span className={`icon-chip w-11 h-11 flex-shrink-0 ${r.chip}`}>{r.icon}</span>
            <span className="flex-1 min-w-0">
              <span className="flex items-center gap-2">
                <span className="text-[14px] font-semibold text-slate-900">{r.title}</span>
                {r.set && <span className="text-[10px] font-semibold px-1.5 py-[1px] rounded-full bg-[#B8983C]/15 text-[#7A6224]">Set</span>}
              </span>
              {/* Fixed at one line, loading or not */}
              <span className="block h-[18px] mt-0.5 text-[12px] leading-[18px] text-slate-600 truncate">
                {r.status === null
                  ? <span className="inline-block align-middle h-2.5 w-40 rounded bg-[#EEEBE5] animate-pulse" />
                  : r.status}
              </span>
              <span className="block text-[11.5px] leading-snug text-slate-400 truncate">{r.explain}</span>
            </span>
            <ChevronRight size={16} className="text-slate-300 group-hover:text-[#B8983C] group-hover:translate-x-0.5 transition flex-shrink-0" />
          </button>
        ))}
        <p className="text-[11.5px] text-slate-500 pt-1 px-1">
          Each rule can cover the whole school or chosen teams, on this date or every week on this weekday.
        </p>
      </div>
    </ModalShell>
  )
}
