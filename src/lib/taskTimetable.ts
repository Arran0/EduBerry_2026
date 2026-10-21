'use client'

// What the published timetable says about one teacher, for the Task Manager:
// how many periods their day has (the calendar's rows) and which classes they
// teach in each period of a given week (the "fill this week" suggestions).
//
// Period groups give teachers different days: a Primary teacher's week can be
// 6 periods long and a Secondary teacher's 8. Periods are numbered within
// their group, breaks skipped, and a teacher working in two groups has
// period 3 of both on one number (see buildSchedules in timetable/generator.ts).

import { supabase } from './supabase'
import { DEFAULT_PERIOD_COUNT } from './taskSlots'
import { classLabel, sortClassLabels } from './taskClasses'
import { activeOverride, weekdayOf, type EntryOverride } from './timetable/overrides'
import { teacherIdsOf, type PeriodSlot, type Weekday } from './timetable/types'

/** One lesson of the weekly template the teacher is booked into. */
export interface TemplateCell {
  homeroomId: string
  day: Weekday
  slotId: string
  groupId: string | null
}

export interface TeacherTimetable {
  /** Rows the teacher's day needs: the longest day of any group they teach in. */
  periodCount: number
  cells: TemplateCell[]
  /** Per-date amendments in the teacher's configs, newest first. */
  overrides: EntryOverride[]
  /** slotId -> period number (1-based) within its own group. */
  periodOf: Map<string, number>
  /** homeroomId -> "7B". */
  classOf: Map<string, string>
}

/** One period of one date, as the timetable has it for the teacher. */
export interface SuggestedPeriod {
  date: string
  period: number
  classes: string[]
}

/** slotId -> period number within its group, plus each group's period count. */
export function numberPeriods(slots: Pick<PeriodSlot, 'id' | 'config_id' | 'group_id' | 'position' | 'is_break'>[]) {
  const periodOf = new Map<string, number>()
  const countOf = new Map<string, number>()
  const byGroup = new Map<string, typeof slots>()
  for (const s of slots) {
    if (s.is_break) continue
    const key = `${s.config_id}|${s.group_id ?? ''}`
    const list = byGroup.get(key)
    if (list) list.push(s)
    else byGroup.set(key, [s])
  }
  for (const [key, list] of byGroup) {
    list.sort((a, b) => a.position - b.position)
    list.forEach((s, i) => periodOf.set(s.id, i + 1))
    countOf.set(key, list.length)
  }
  return { periodOf, countOf }
}

/**
 * The teacher's periods on each of `dates`, with that date's overrides
 * applied: a cancelled period drops out, a period handed to someone else drops
 * out, and a cover lesson given to this teacher comes in. Lessons that share a
 * period (a combined class, two split groups) become one period with every
 * class on it.
 */
export function periodsForDates(tt: TeacherTimetable, teacherId: string, dates: string[]): SuggestedPeriod[] {
  const out: SuggestedPeriod[] = []
  const cellKey = (c: { homeroom_id: string; slot_id: string; group_id: string | null }) =>
    `${c.homeroom_id}|${c.slot_id}|${c.group_id ?? ''}`

  for (const date of dates) {
    const day = weekdayOf(date)
    const byPeriod = new Map<number, string[]>()
    const add = (slotId: string, homeroomId: string) => {
      const period = tt.periodOf.get(slotId)
      const label = tt.classOf.get(homeroomId)
      if (!period || !label) return
      const list = byPeriod.get(period)
      if (list) list.push(label)
      else byPeriod.set(period, [label])
    }

    const kept = new Set<string>()
    for (const c of tt.cells) {
      if (c.day !== day) continue
      const o = activeOverride(tt.overrides, c.homeroomId, day, c.slotId, c.groupId, date)
      if (o && (o.kind === 'cancel' || !teacherIdsOf(o).includes(teacherId))) continue
      kept.add(cellKey({ homeroom_id: c.homeroomId, slot_id: c.slotId, group_id: c.groupId }))
      add(c.slotId, c.homeroomId)
    }

    // Cover lessons: a replacement that books this teacher into a period they
    // don't normally teach. Only the override actually in force for its cell.
    for (const o of tt.overrides) {
      if (o.kind !== 'replace' || o.day !== day || kept.has(cellKey(o))) continue
      if (!teacherIdsOf(o).includes(teacherId)) continue
      if (activeOverride(tt.overrides, o.homeroom_id, day, o.slot_id, o.group_id, date)?.id !== o.id) continue
      kept.add(cellKey(o))
      add(o.slot_id, o.homeroom_id)
    }

    for (const [period, classes] of byPeriod) out.push({ date, period, classes: sortClassLabels(classes) })
  }
  return out.sort((a, b) => (a.date !== b.date ? a.date.localeCompare(b.date) : a.period - b.period))
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * The teacher's lessons in every published timetable of an active config. A
 * teacher with no lessons still gets a period count — the longest day of the
 * school — so their calendar has rows; with no timetable at all it is the
 * default.
 */
export async function fetchTeacherTimetable(teacherId: string): Promise<TeacherTimetable> {
  const empty: TeacherTimetable = {
    periodCount: DEFAULT_PERIOD_COUNT, cells: [], overrides: [], periodOf: new Map(), classOf: new Map(),
  }
  if (!UUID_RE.test(teacherId)) return empty

  try {
    const { data: configs } = await supabase.from('timetable_configs').select('id').eq('is_active', true)
    const configIds = (configs ?? []).map(c => c.id as string)
    if (configIds.length === 0) return empty

    const [{ data: slots }, { data: timetables }] = await Promise.all([
      supabase.from('timetable_period_slots').select('id, config_id, group_id, position, is_break').in('config_id', configIds),
      supabase.from('timetables').select('id, config_id').in('config_id', configIds).eq('status', 'published'),
    ])
    const { periodOf, countOf } = numberPeriods((slots ?? []) as PeriodSlot[])
    const schoolLongest = Math.max(0, ...countOf.values())
    const timetableIds = (timetables ?? []).map(t => t.id as string)
    if (timetableIds.length === 0) return { ...empty, periodCount: schoolLongest || DEFAULT_PERIOD_COUNT, periodOf }

    const publishedConfigs = [...new Set((timetables ?? []).map(t => t.config_id as string))]
    const [{ data: entries }, { data: overrides }] = await Promise.all([
      supabase
        .from('timetable_entries')
        .select('homeroom_id, day, slot_id, group_id')
        .in('timetable_id', timetableIds)
        .or(`teacher_id.eq.${teacherId},teacher_ids.cs.{${teacherId}}`),
      supabase
        .from('timetable_entry_overrides')
        .select('*')
        .in('config_id', publishedConfigs)
        .order('effective_from', { ascending: false }),
    ])

    const cells: TemplateCell[] = (entries ?? []).map(e => ({
      homeroomId: e.homeroom_id, day: e.day as Weekday, slotId: e.slot_id, groupId: e.group_id ?? null,
    }))
    const allOverrides = (overrides ?? []) as EntryOverride[]

    const homeroomIds = new Set(cells.map(c => c.homeroomId))
    for (const o of allOverrides) if (teacherIdsOf(o).includes(teacherId)) homeroomIds.add(o.homeroom_id)
    const classOf = new Map<string, string>()
    if (homeroomIds.size > 0) {
      const { data: homerooms } = await supabase.from('homerooms').select('id, name, grade, section').in('id', [...homeroomIds])
      for (const h of homerooms ?? []) classOf.set(h.id, classLabel(h))
    }

    // The teacher's groups decide their day's length.
    const slotKey = new Map((slots ?? []).map(s => [s.id as string, `${s.config_id}|${s.group_id ?? ''}`]))
    const theirs = new Set(cells.map(c => slotKey.get(c.slotId)).filter(Boolean) as string[])
    const longest = Math.max(0, ...[...theirs].map(k => countOf.get(k) ?? 0))

    return {
      periodCount: longest || schoolLongest || DEFAULT_PERIOD_COUNT,
      cells,
      overrides: allOverrides,
      periodOf,
      classOf,
    }
  } catch (err) {
    // Best-effort: the calendar must never hang on the timetable.
    console.error('fetchTeacherTimetable failed:', err)
    return empty
  }
}
