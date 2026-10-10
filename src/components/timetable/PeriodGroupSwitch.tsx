'use client'

import React, { useEffect, useMemo, useState } from 'react'
import { CalendarRange } from 'lucide-react'
import { MiniTabs } from './ui'
import type { ScheduleWeek } from '@/lib/timetable'

// ============================================================
// Picking which bell schedule you are looking at.
//
// A school can run several period groups — Primary on 5 days of 6 periods,
// Secondary on 6 days of 8. Their periods are different rows and cannot share
// a grid, so a teacher who works across two bands used to get both calendars
// stacked down the page: two scroll lengths to compare, and no way to tell at a
// glance which bands a person is even in.
//
// This turns that stack into a switch. It shows only the groups the subject of
// the page actually appears in, says how many periods each holds for them, and
// disappears entirely when there is one group — a school with a single bell
// schedule should never see the concept at all.
// ============================================================

export interface PeriodGroupSwitchProps {
  /** Every schedule week of the config, in display order. */
  weeks: ScheduleWeek[]
  /**
   * Group ids this page's subject appears in. A teacher's bands, a subject's
   * bands, a class's single band. Weeks outside it are dropped.
   */
  present: Set<string | null>
  /** Periods currently scheduled in each group, keyed by group id (null = base). */
  counts?: Map<string | null, number>
  value: string | null
  onChange: (groupId: string | null) => void
  className?: string
}

/** `null` is a legitimate group id (the base schedule), so it is tokenised. */
const BASE = '__base__'
const tok = (id: string | null) => id ?? BASE
const untok = (k: string) => (k === BASE ? null : k)

export default function PeriodGroupSwitch({
  weeks, present, counts, value, onChange, className = '',
}: PeriodGroupSwitchProps) {
  const shown = useMemo(
    () => weeks.filter((w) => present.has(w.groupId) && w.slots.length > 0),
    [weeks, present],
  )

  // A band the page's subject left (their last lesson there was moved) must not
  // leave the switch pointing at nothing.
  useEffect(() => {
    if (shown.length > 0 && !shown.some((w) => w.groupId === value)) {
      onChange(shown[0].groupId)
    }
  }, [shown, value, onChange])

  if (shown.length < 2) return null

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <CalendarRange size={14} className="text-[#A1A1AA] flex-shrink-0" aria-hidden />
      <MiniTabs
        ariaLabel="Period group"
        tabs={shown.map((w) => ({
          key: tok(w.groupId),
          label: w.name,
          meta: counts ? String(counts.get(w.groupId) ?? 0) : undefined,
        }))}
        value={tok(value)}
        onChange={(k) => onChange(untok(k))}
      />
    </div>
  )
}

/**
 * The switch's state, plus the week it resolves to.
 *
 * Kept as a hook so every tab that shows one person's or one subject's week
 * selects a band the same way, and so `present` and the counts are derived from
 * the same pass over the lessons rather than three times per page.
 */
export function usePeriodGroupSwitch(
  weeks: ScheduleWeek[],
  /** The lessons on this page, with the group each one's class follows. */
  lessonGroupIds: (string | null)[],
) {
  const [groupId, setGroupId] = useState<string | null>(null)

  const { present, counts } = useMemo(() => {
    const counts = new Map<string | null, number>()
    for (const g of lessonGroupIds) counts.set(g, (counts.get(g) ?? 0) + 1)
    // With no lessons yet there is still a week to mark time off in, so every
    // band stays on offer rather than the switch vanishing.
    const present = counts.size > 0
      ? new Set<string | null>(counts.keys())
      : new Set<string | null>(weeks.map((w) => w.groupId))
    return { present, counts }
  }, [lessonGroupIds, weeks])

  const shown = useMemo(
    () => weeks.filter((w) => present.has(w.groupId) && w.slots.length > 0),
    [weeks, present],
  )
  const week = shown.find((w) => w.groupId === groupId) ?? shown[0] ?? null

  return { groupId: week?.groupId ?? null, setGroupId, present, counts, week, shown }
}
