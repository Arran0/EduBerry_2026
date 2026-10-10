// ============================================================
// Per-date overrides — the layer that lets one Tuesday differ.
//
// A timetable is a weekly template: period 3 on Tuesday is the same lesson on
// every Tuesday. An override amends ONE cell of that template over a date
// range, and the template itself is never rewritten — so lifting the override
// brings the ordinary week straight back.
//
//   effective_from === effective_to  → that date only
//   effective_to === null            → that date and every one after it
//
// Resolution is deliberately boring: the most recently *started* override
// covering the date wins, ties going to the most recently created. That makes
// "swap these two from Monday" and "…except this one Tuesday" compose the way
// a person expects, with the narrower, later decision on top.
//
// UI-free apart from the fetch/write helpers.
// ============================================================

import { supabase } from '../supabase'
import { WEEKDAYS, teacherIdsOf } from './types'
import type { TimetableEntry, Weekday } from './types'
import type { Subject, Room } from './types'
import type { UserProfile } from '../supabase'

/** 'replace' puts a different lesson in the cell; 'cancel' empties it. */
export type OverrideKind = 'replace' | 'cancel'

/** How far forward an override reaches. */
export type OverrideSpan = 'date' | 'onwards'

export interface EntryOverride {
  id: string
  config_id: string
  timetable_id: string | null
  homeroom_id: string
  day: Weekday
  slot_id: string
  group_id: string | null
  effective_from: string // YYYY-MM-DD
  effective_to: string | null // null = open ended
  kind: OverrideKind
  subject_id: string | null
  teacher_id: string | null
  teacher_ids: string[] | null
  room_id: string | null
  note: string | null
  created_by: string | null
  created_at: string
  updated_at: string
  // Optional joins
  subject?: Subject
  teacher?: UserProfile
  room?: Room
}

export interface OverrideInput {
  config_id: string
  timetable_id?: string | null
  homeroom_id: string
  day: Weekday
  slot_id: string
  group_id?: string | null
  effective_from: string
  /** Omit or pass null for "and every date after". */
  effective_to?: string | null
  kind: OverrideKind
  subject_id?: string | null
  teacher_ids?: string[]
  room_id?: string | null
  note?: string | null
}

const OVERRIDE_SELECT =
  '*, subject:timetable_subjects(*), room:timetable_rooms(*)'

// ── Dates ────────────────────────────────────────────────────

/** Today in the browser's own timezone — `toISOString()` would shift the day. */
export function todayISO(now: Date = new Date()): string {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** The weekday an ISO date falls on, in the app's Monday-first vocabulary. */
export function weekdayOf(iso: string): Weekday {
  const d = new Date(`${iso}T12:00:00`)
  return WEEKDAYS[(d.getDay() + 6) % 7]
}

/** The next date on or after `fromISO` that falls on `day`. */
export function nextDateOn(day: Weekday, fromISO: string = todayISO()): string {
  const want = WEEKDAYS.indexOf(day)
  const d = new Date(`${fromISO}T12:00:00`)
  const have = (d.getDay() + 6) % 7
  d.setDate(d.getDate() + ((want - have + 7) % 7))
  return todayISO(d)
}

export function formatDateLabel(iso: string): string {
  return new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
  })
}

// ── Resolution ───────────────────────────────────────────────

const covers = (o: EntryOverride, iso: string) =>
  o.effective_from <= iso && (o.effective_to === null || o.effective_to >= iso)

/** Layer identity: which lesson of the cell an override amends. */
const sameLayer = (
  o: EntryOverride, homeroomId: string, day: Weekday, slotId: string, groupId: string | null,
) =>
  o.homeroom_id === homeroomId && o.day === day && o.slot_id === slotId &&
  (o.group_id ?? null) === groupId

/** Later start wins; same start, later creation wins. */
const moreSpecific = (a: EntryOverride, b: EntryOverride) =>
  a.effective_from !== b.effective_from
    ? a.effective_from > b.effective_from
    : a.created_at > b.created_at

/**
 * The override in force for one cell layer on one date, if any.
 */
export function activeOverride(
  overrides: EntryOverride[],
  homeroomId: string,
  day: Weekday,
  slotId: string,
  groupId: string | null,
  iso: string,
): EntryOverride | null {
  let best: EntryOverride | null = null
  for (const o of overrides) {
    if (!covers(o, iso) || !sameLayer(o, homeroomId, day, slotId, groupId)) continue
    if (!best || moreSpecific(o, best)) best = o
  }
  return best
}

/** Every override that touches a cell layer at all, newest first. */
export function overridesForCell(
  overrides: EntryOverride[],
  homeroomId: string,
  day: Weekday,
  slotId: string,
  groupId: string | null,
): EntryOverride[] {
  return overrides
    .filter((o) => sameLayer(o, homeroomId, day, slotId, groupId))
    .sort((a, b) => (moreSpecific(a, b) ? -1 : 1))
}

/**
 * The weekly template with the overrides in force on `iso` applied.
 *
 * Cancelled cells drop out; replaced cells keep their identity (so the grid
 * still knows which period changed) and carry `override` so the UI can mark
 * them. An override on a cell the template leaves empty becomes a new entry —
 * which is how "put a cover lesson in Thursday's free period" works.
 */
export function applyOverrides(
  entries: TimetableEntry[],
  overrides: EntryOverride[],
  iso: string,
): (TimetableEntry & { override?: EntryOverride })[] {
  const inForce = overrides.filter((o) => covers(o, iso))
  if (inForce.length === 0) return entries

  const out: (TimetableEntry & { override?: EntryOverride })[] = []
  const used = new Set<string>()

  for (const e of entries) {
    const o = activeOverride(
      inForce, e.homeroom_id, e.day, e.slot_id, e.group_id ?? null, iso,
    )
    if (!o) {
      out.push(e)
      continue
    }
    used.add(o.id)
    if (o.kind === 'cancel') continue
    out.push({
      ...e,
      subject_id: o.subject_id,
      subject: o.subject ?? e.subject,
      teacher_id: o.teacher_id,
      teacher_ids: o.teacher_ids,
      // The denormalized names belong to the lesson being replaced, so they
      // would print the wrong teacher next to the new subject.
      teacher_name: null,
      teacher_names: null,
      room_id: o.room_id,
      room: o.room ?? undefined,
      override: o,
    })
  }

  // Overrides that landed on a period the template leaves empty.
  for (const o of inForce) {
    if (used.has(o.id) || o.kind !== 'replace') continue
    out.push({
      id: `override:${o.id}`,
      timetable_id: o.timetable_id ?? '',
      homeroom_id: o.homeroom_id,
      day: o.day,
      slot_id: o.slot_id,
      subject_id: o.subject_id,
      teacher_id: o.teacher_id,
      teacher_ids: o.teacher_ids,
      room_id: o.room_id,
      is_locked: false,
      teacher_name: null,
      teacher_names: null,
      group_id: o.group_id,
      split_key: null,
      combined_key: null,
      block_key: null,
      created_at: o.created_at,
      updated_at: o.updated_at,
      subject: o.subject,
      room: o.room,
      override: o,
    })
  }
  return out
}

/** One line describing an override's reach, for the UI. */
export function describeSpan(o: EntryOverride): string {
  if (o.effective_to === null) return `from ${formatDateLabel(o.effective_from)} onwards`
  if (o.effective_to === o.effective_from) return formatDateLabel(o.effective_from)
  return `${formatDateLabel(o.effective_from)} – ${formatDateLabel(o.effective_to)}`
}

// ── Reads ────────────────────────────────────────────────────

export async function fetchOverrides(configId: string): Promise<EntryOverride[]> {
  const { data, error } = await supabase
    .from('timetable_entry_overrides')
    .select(OVERRIDE_SELECT)
    .eq('config_id', configId)
    .order('effective_from', { ascending: false })

  if (error) {
    console.error('fetchOverrides error:', error)
    return []
  }
  return (data ?? []) as EntryOverride[]
}

/**
 * Overrides for a set of homerooms across every active config — what the
 * student and staff week views need, where the config is not known up front.
 */
export async function fetchOverridesForHomerooms(
  homeroomIds: string[],
): Promise<EntryOverride[]> {
  if (homeroomIds.length === 0) return []
  const { data, error } = await supabase
    .from('timetable_entry_overrides')
    .select(OVERRIDE_SELECT)
    .in('homeroom_id', homeroomIds)
    .order('effective_from', { ascending: false })

  if (error) {
    console.error('fetchOverridesForHomerooms error:', error)
    return []
  }
  return (data ?? []) as EntryOverride[]
}

// ── Writes ───────────────────────────────────────────────────

export async function createOverride(input: OverrideInput): Promise<EntryOverride | null> {
  const teacherIds = input.teacher_ids ?? []
  const { data: auth } = await supabase.auth.getUser()
  const { data, error } = await supabase
    .from('timetable_entry_overrides')
    .insert({
      config_id: input.config_id,
      timetable_id: input.timetable_id ?? null,
      homeroom_id: input.homeroom_id,
      day: input.day,
      slot_id: input.slot_id,
      group_id: input.group_id ?? null,
      effective_from: input.effective_from,
      effective_to: input.effective_to ?? null,
      kind: input.kind,
      subject_id: input.kind === 'replace' ? input.subject_id ?? null : null,
      teacher_id: teacherIds[0] ?? null,
      teacher_ids: teacherIds.length > 0 ? teacherIds : null,
      room_id: input.room_id ?? null,
      note: input.note?.trim() || null,
      created_by: auth?.user?.id ?? null,
    })
    .select(OVERRIDE_SELECT)
    .single()

  if (error) {
    console.error('createOverride error:', error)
    return null
  }
  return data as EntryOverride
}

export async function deleteOverride(id: string): Promise<boolean> {
  const { error } = await supabase.from('timetable_entry_overrides').delete().eq('id', id)
  if (error) {
    console.error('deleteOverride error:', error)
    return false
  }
  return true
}

/** Teacher ids on an override, primary first — same shape as entries. */
export const overrideTeacherIds = (o: EntryOverride): string[] => teacherIdsOf(o)
