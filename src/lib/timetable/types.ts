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

export interface PeriodSlot {
  id: string
  config_id: string
  position: number
  label: string | null
  start_time: string // "HH:MM" / "HH:MM:SS"
  end_time: string
  is_break: boolean
  created_at: string
  updated_at: string
}

export interface Requirement {
  id: string
  config_id: string
  homeroom_id: string
  subject_id: string
  teacher_id: string | null
  periods_per_week: number
  room_type: RoomType
  max_per_day: number
  created_at: string
  updated_at: string
  // Optional joins
  subject?: Subject
  teacher?: UserProfile
}

export interface TeacherUnavailability {
  id: string
  config_id: string
  teacher_id: string
  day: Weekday
  slot_id: string
  created_at: string
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
  room_id: string | null
  is_locked: boolean
  created_at: string
  updated_at: string
  // Optional joins
  subject?: Subject
  teacher?: UserProfile
  room?: Room
}

// ── Generator I/O ────────────────────────────────────────────
// Used by src/lib/timetable/generator.ts (Round 3). Defined here
// so the data layer and the engine share one contract.

// A single placeable lesson unit expanded from a requirement
// (a requirement of periods_per_week = 5 becomes 5 LessonUnits).
export interface LessonUnit {
  requirementId: string
  homeroomId: string
  subjectId: string
  teacherId: string | null
  roomType: RoomType
  maxPerDay: number
}

// A cell in the grid the solver can place a lesson into.
export interface GridCell {
  day: Weekday
  slotId: string
}

// A draft placement produced by the solver (not yet persisted).
export interface PlacedEntry {
  homeroomId: string
  day: Weekday
  slotId: string
  subjectId: string
  teacherId: string | null
  roomId: string | null
  isLocked: boolean
}

export interface GeneratorInput {
  config: TimetableConfig
  slots: PeriodSlot[] // teaching slots (is_break filtered out by caller)
  requirements: Requirement[]
  unavailability: TeacherUnavailability[]
  rooms: Room[]
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
