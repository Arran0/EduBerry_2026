'use client'

import React from 'react'
import { AlertTriangle, Gauge } from 'lucide-react'
import type { TeacherWorkload } from '@/lib/timetable/workload'
import { workloadRatio } from '@/lib/timetable/workload'

// ============================================================
// How full a teacher's week is, shown wherever a teacher is being assigned.
//
// Over-booking a teacher is arithmetic, not bad luck: the moment the periods
// asked of them exceed the periods their week has, no timetable exists. These
// render that fact next to the control that causes it, so it is caught as it
// is typed rather than reported after a generate that was never going to work.
// ============================================================

/** Red when impossible, amber when nearly full, quiet otherwise. */
export function loadTone(w: TeacherWorkload | undefined) {
  if (!w) return 'none' as const
  if (w.over > 0) return 'over' as const
  return workloadRatio(w) >= 0.9 ? 'tight' as const : 'ok' as const
}

const TONE_TEXT = {
  over: 'text-rose-600',
  tight: 'text-amber-600',
  ok: 'text-slate-500',
  none: 'text-slate-400',
} as const

const TONE_BAR = {
  over: 'bg-rose-500',
  tight: 'bg-amber-500',
  ok: 'bg-emerald-600',
  none: 'bg-slate-300',
} as const

/** "28/30" with a tone, for a list row or a chip. */
export function TeacherLoadBadge({
  workload, showIcon = true,
}: {
  workload: TeacherWorkload | undefined
  showIcon?: boolean
}) {
  if (!workload || workload.assigned === 0) return null
  const tone = loadTone(workload)
  return (
    <span
      className={`inline-flex items-center gap-0.5 text-[11px] font-medium tabular-nums flex-shrink-0 ${TONE_TEXT[tone]}`}
      title={
        workload.over > 0
          ? `${workload.assigned} periods given, room for ${workload.capacity}. ${workload.over} cannot be placed.`
          : `${workload.assigned} of ${workload.capacity} periods assigned`
      }
    >
      {showIcon && tone === 'over' && <AlertTriangle size={10} />}
      {workload.assigned}/{workload.capacity}
    </span>
  )
}

/** A labelled meter with the numbers spelled out. */
export function TeacherLoadMeter({ workload }: { workload: TeacherWorkload | undefined }) {
  const tone = loadTone(workload)
  const assigned = workload?.assigned ?? 0
  const capacity = workload?.capacity ?? 0
  const pct = capacity === 0 ? (assigned > 0 ? 100 : 0) : Math.min(100, (assigned / capacity) * 100)

  return (
    <div className="w-full max-w-[16rem]">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[12px] font-semibold text-slate-500">Weekly load</span>
        <span className={`text-sm font-semibold tabular-nums ${tone === 'over' ? 'text-rose-600' : 'text-slate-900'}`}>
          {assigned}
          <span className="text-slate-400 font-normal">/{capacity}</span>
        </span>
      </div>
      <div className="h-1.5 rounded-full overflow-hidden bg-[#EFEBE3] mt-1.5">
        <div className={`h-full rounded-full ${TONE_BAR[tone]} transition-all`} style={{ width: `${pct}%` }} />
      </div>
      <p className="text-[11.5px] text-slate-500 mt-1 leading-snug">
        {workload?.timeOff ? `${workload.timeOff} off · ` : ''}
        {workload?.weeklyCap != null ? `capped at ${workload.weeklyCap}/week · ` : ''}
        {tone === 'over' ? (
          <span className="text-rose-600 font-medium">{workload!.over} too many</span>
        ) : capacity - assigned > 0 ? (
          `${capacity - assigned} free`
        ) : (
          'full'
        )}
      </p>
    </div>
  )
}

/**
 * The standing warning: every teacher who cannot fit what they have been
 * given. Shown wherever a timetable is about to be built from them.
 */
export function OverloadedTeachersNotice({
  overloaded, teacherName, max = 4, className = '',
}: {
  overloaded: TeacherWorkload[]
  teacherName: (id: string) => string
  max?: number
  className?: string
}) {
  if (overloaded.length === 0) return null
  const shown = overloaded.slice(0, max)
  const rest = overloaded.length - shown.length

  return (
    <div className={`flex items-start gap-2 border-l-[3px] border-[#C24141] bg-[#FCEDED] px-3 py-2.5 text-[12.5px] leading-relaxed text-[#962C2C] ${className}`}>
      <Gauge size={14} className="flex-shrink-0 mt-[3px]" />
      <div className="min-w-0 break-words">
        <p>
          <strong>
            {overloaded.length === 1
              ? '1 teacher is assigned more periods than their week has'
              : `${overloaded.length} teachers are assigned more periods than their weeks have`}
          </strong>
        </p>
        <p className="mt-0.5">
          {shown.map((w) => `${teacherName(w.teacherId)} ${w.assigned}/${w.capacity}`).join(' · ')}
          {rest > 0 && ` · and ${rest} more`}
        </p>
        <p className="mt-0.5 opacity-80">
          Share the subject with another teacher, cut its periods, or free up their time off.
        </p>
      </div>
    </div>
  )
}
