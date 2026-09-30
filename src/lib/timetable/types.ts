// ============================================================
// Timetable — shared types
// Co-located with the timetable feature; mirrors the DB model in
// supabase-migrations/add_timetable.sql.
// ============================================================

import { UserProfile } from '../supabase'

export type RoomType = 'classroom' | 'science_lab' | 'computer_lab' | 'other'

export type TimetableStatus = 'draft' | 'published'

export type Weekday =
  | 'monday'
  | 'tuesday'
  | 'wednesday'
  | 'thursday'
  | 'friday'
  | 'saturday'
  | 'sunday'

export const WEEKDAYS: Weekday[] = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
]

export const ROOM_TYPE_LABELS: Record<RoomType, string> = {
  classroom: 'Classroom',
  science_lab: 'Science Lab',
  computer_lab: 'Computer Lab',
  other: 'Other',
}

export const WEEKDAY_LABELS: Record<Weekday, string> = {
  monday: 'Monday',
  tuesday: 'Tuesday',
  wednesday: 'Wednesday',
  thursday: 'Thursday',
  friday: 'Friday',
  saturday: 'Saturday',
  sunday: 'Sunday',
}

// ── Records ──────────────────────────────────────────────────

export interface Subject {
  id: string
  name: string
  code: string | null
  color: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface Room {
  id: string
  name: string
  room_type: RoomType
  capacity: number | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface TimetableConfig {
  id: string
  name: string
  academic_year: string | null
  working_days: Weekday[]
  is_active: boolean
  created_by: string | null
  created_at: string
  updated_at: string
}

// ── Slot groups (Round 9) ────────────────────────────────────
// A school can run more than one bell schedule side by side — Primary on a
// 5-day week of 6 periods, Secondary on 6 days of 8. A slot group owns its own
// working days and its own period slots; homerooms are assigned to one.
// A config with no groups behaves as before: the base schedule is
// config.working_days plus the slots whose group_id is null.

export interface SlotGroup {
  id: string
  config_id: string
  name: string
  working_days: Weekday[]
  position: number
  color: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface SlotGroupHomeroom {
  id: string
  config_id: string
  group_id: string
  homeroom_id: string
  created_at: string
}

/**
 * The week one homeroom is scheduled against: its slot group's days and slots,
 * or the config's base schedule when it isn't assigned to a group.
 */
export interface ScheduleWeek {
  groupId: string | null
  name: string
  days: Weekday[]
  slots: PeriodSlot[] // teaching slots only (breaks filtered out)
}

export interface PeriodSlot {
  id: string
  config_id: string
  // Round 9: which bell schedule this period belongs to. null = the config's
  // base schedule, followed by every homeroom not assigned to a slot group.
  group_id: string | null
  position: number
  label: string | null
  // Timings are optional (Round 1): a slot can be defined by
  // position/label alone. Null when the admin didn't enter times.
  start_time: string | null // "HH:MM" / "HH:MM:SS"
  end_time: string | null
  is_break: boolean
  created_at: string
  updated_at: string
}

export interface Requirement {
  id: string
  config_id: string
  homeroom_id: string
  subject_id: string
  // Primary teacher (kept for every legacy query); teacher_ids carries the
  // full co-teaching list, primary first. Round 8.
  teacher_id: string | null
  teacher_ids: string[] | null
  periods_per_week: number
  room_type: RoomType
  max_per_day: number
  // Consecutive-period blocks (Round 4). min_block = max_block = 1 → the
  // classic "single period" behaviour. min_block = 2 → schedule the subject
  // as double periods (contiguous slots, no break between).
  min_block: number
  max_block: number
  // Split classes (Round 5). null → whole class; otherwise this requirement
  // targets one group, and parallel group requirements share a period.
  group_id: string | null
  created_at: string
  updated_at: string
  // Optional joins
  subject?: Subject
  teacher?: UserProfile
  group?: HomeroomGroup
}

/**
 * Every teacher attached to a lesson-ish record, primary first and de-duped.
 * Round 8 introduced co-teaching: `teacher_ids` / `teacherIds` is the list and
 * the singular field stays as the primary, so both shapes have to be merged
 * wherever teachers are read.
 */
export function teacherIdsOf(
  x:
    | { teacher_id?: string | null; teacher_ids?: string[] | null }
    | { teacherId?: string | null; teacherIds?: string[] | null },
): string[] {
  const rec = x as {
    teacher_id?: string | null
    teacher_ids?: string[] | null
    teacherId?: string | null
    teacherIds?: string[] | null
  }
  const primary = rec.teacher_id ?? rec.teacherId ?? null
  const list = rec.teacher_ids ?? rec.teacherIds ?? []
  const out: string[] = []
  for (const id of [primary, ...list]) {
    if (id && !out.includes(id)) out.push(id)
  }
  return out
}

/**
 * The teacher line to print under a lesson: every teacher of a co-taught
 * period, falling back to the denormalised single name and then to the joined
 * profile. Null when nobody is assigned.
 */
export function entryTeacherLabel(e: {
  teacher_names?: string[] | null
  teacher_name?: string | null
  teacher?: { full_name?: string | null } | null
}): string | null {
  const names = (e.teacher_names ?? []).filter(Boolean)
  if (names.length > 0) return names.join(', ')
  return e.teacher_name ?? e.teacher?.full_name ?? null
}

export interface TeacherUnavailability {
  id: string
  config_id: string
  teacher_id: string
  day: Weekday
  slot_id: string
  created_at: string
}

// ── Constraints (Round 3) ────────────────────────────────────
// One polymorphic record type covers every scheduling constraint.
// scope_id === null means "all" of that scope (e.g. all teachers).
// homeroom_id optionally narrows a min/max rule to a single homeroom.

export type ConstraintScope = 'teacher' | 'homeroom' | 'subject' | 'group' | 'class_teacher'

export type ConstraintType =
  | 'time_off'
  | 'min_per_day'
  | 'max_per_day'
  | 'min_per_week'
  | 'max_per_week'
  | 'max_in_a_row'
  | 'pin_class_teacher'

export interface TimetableConstraint {
  id: string
  config_id: string
  scope: ConstraintScope
  scope_id: string | null
  homeroom_id: string | null
  type: ConstraintType
  value: number | null
  day: Weekday | null
  slot_id: string | null
  created_at: string
  updated_at: string
}

export interface Timetable {
  id: string
  config_id: string
  name: string
  status: TimetableStatus
  generated_at: string | null
  published_at: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface TimetableEntry {
  id: string
  timetable_id: string
  homeroom_id: string
  day: Weekday
  slot_id: string
  subject_id: string | null
  teacher_id: string | null
  // Co-teaching (Round 8): every teacher of this period, primary first.
  teacher_ids: string[] | null
  room_id: string | null
  is_locked: boolean
  // Denormalized teacher display name(s) so students (who cannot read staff
  // profiles via RLS) still see who teaches each period.
  teacher_name: string | null
  teacher_names: string[] | null
  // Split classes (Round 5). group_id null → whole-class lesson; otherwise
  // this is one parallel group's lesson. split_key ties the parallel entries
  // that share one homeroom cell together. combined_key (Round 6) ties the
  // member-homeroom entries of a combined class together.
  group_id: string | null
  split_key: string | null
  combined_key: string | null
  // Every period of one double/triple block shares this key (Round 9), so a
  // block moves, pins and is scored as a single unit. null = single period.
  block_key: string | null
  created_at: string
  updated_at: string
  // Optional joins
  subject?: Subject
  teacher?: UserProfile
  room?: Room
  group?: HomeroomGroup
}

// ── Homeroom groups (Round 2) ────────────────────────────────
// A homeroom can be split into named groups — either subject-
// filtered (Biology vs Computer students) or custom. Groups are
// the targeting unit for split classes in a later round.

export type HomeroomGroupKind = 'subject' | 'custom'

export interface HomeroomGroup {
  id: string
  homeroom_id: string
  name: string
  kind: HomeroomGroupKind
  subject_id: string | null
  color: string | null
  created_by: string | null
  created_at: string
  updated_at: string
  // Optional joins
  subject?: Subject
  members?: GroupMember[]
}

export interface GroupMember {
  id: string
  group_id: string
  student_id: string
  created_at: string
  // Optional join
  student?: UserProfile
}

// ── Combined classes (Round 6) ───────────────────────────────
// Several homerooms attend one lesson together (one teacher, one room).

export interface CombinedClass {
  id: string
  config_id: string
  name: string
  subject_id: string | null
  teacher_id: string | null
  teacher_ids: string[] | null
  room_id: string | null
  periods_per_week: number
  created_by: string | null
  created_at: string
  updated_at: string
  // Optional joins
  subject?: Subject
  teacher?: UserProfile
  room?: Room
  members?: CombinedMember[]
}

export interface CombinedMember {
  id: string
  combined_id: string
  homeroom_id: string
  // null = the whole homeroom attends; otherwise just this group of it.
  group_id: string | null
  created_at: string
  // Optional join
  group?: HomeroomGroup
}

// The shape the solver consumes (flattened members).
export interface CombinedClassInput {
  id: string
  subjectId: string
  teacherId: string | null
  teacherIds: string[]
  roomId: string | null
  periodsPerWeek: number
  members: { homeroomId: string; groupId: string | null }[]
}

// ── Generator I/O ────────────────────────────────────────────
// Used by src/lib/timetable/generator.ts (Round 3). Defined here
// so the data layer and the engine share one contract.

// Minimal homeroom shape the solver needs (for pin_class_teacher).
export interface HomeroomLite {
  id: string
  class_teacher_id: string | null
}

// A draft placement produced by the solver (not yet persisted).
export interface PlacedEntry {
  homeroomId: string
  day: Weekday
  slotId: string
  subjectId: string
  // Primary teacher; teacherIds holds every teacher of the period (Round 8).
  teacherId: string | null
  teacherIds?: string[]
  roomId: string | null
  isLocked: boolean
  // Split classes (Round 5) / combined classes (Round 6).
  groupId?: string | null
  splitKey?: string | null
  combinedKey?: string | null
  // Consecutive-period block (Round 9): shared by every period of one block.
  blockKey?: string | null
}

export interface GeneratorInput {
  config: TimetableConfig
  slots: PeriodSlot[] // every slot of the config; breaks are filtered internally
  // Round 9: extra bell schedules. Each group carries its own working days and
  // owns the slots whose group_id matches it; `homeroomGroupIds` says which
  // homerooms follow which. Anything unlisted falls back to config.working_days
  // and the slots with group_id null, so omitting both is the old behaviour.
  slotGroups?: SlotGroup[]
  homeroomGroupIds?: Record<string, string | null>
  requirements: Requirement[]
  unavailability: TeacherUnavailability[]
  rooms: Room[]
  // Round 3/4: unified constraints + homeroom class-teacher lookup.
  constraints?: TimetableConstraint[]
  homerooms?: HomeroomLite[]
  // Round 6: combined classes (many homerooms, one teacher/room).
  combined?: CombinedClassInput[]
  locked?: PlacedEntry[] // pre-placed cells to preserve
  seed?: number
}

export interface GeneratorConflict {
  kind:
    | 'unplaced_lesson'
    | 'teacher_double_booked'
    | 'room_double_booked'
    | 'homeroom_double_booked'
    | 'no_room_available'
    | 'time_off_violated'
    | 'max_in_a_row_exceeded'
    | 'pin_unfilled'
    | 'block_unplaceable'
  message: string
  homeroomId?: string
  subjectId?: string
  teacherId?: string
  day?: Weekday
  slotId?: string
}

export interface GeneratorResult {
  entries: PlacedEntry[]
  conflicts: GeneratorConflict[]
  unplacedCount: number
  softPenalty: number
  ok: boolean // true when every required lesson was placed with no hard conflicts
}

// ── Viewer bundle ────────────────────────────────────────────
// One TimetableViewData per active config the viewer belongs to.
// Returned by fetchTimetableForStudent / fetchTimetableForStaff.
export interface TimetableViewData {
  config: TimetableConfig
  slots: PeriodSlot[]
  timetable: Timetable
  entries: TimetableEntry[]
}
