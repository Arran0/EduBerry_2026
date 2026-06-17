import { supabase } from './supabase'

// ─── Streaks ──────────────────────────────────────────────────────────────────

export interface UserStreak {
  user_id: string
  current_streak: number
  longest_streak: number
  last_open_date: string | null
  updated_at: string
}

/** Returns today's date in the *client's* local timezone as YYYY-MM-DD. */
function localToday(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Records that the current user opened the app today (local date) and returns
 *  the updated streak. Safe to call once per session; same-day calls are no-ops
 *  server-side. */
export async function recordAppOpen(): Promise<UserStreak | null> {
  const { data, error } = await supabase.rpc('record_app_open', { p_today: localToday() })
  if (error) {
    console.error('Failed to record app open:', error.message)
    return null
  }
  // RPC returns a single composite row.
  return (Array.isArray(data) ? data[0] : data) as UserStreak | null
}

/** Reads the current user's streak row (does not mutate). */
export async function fetchStreak(userId: string): Promise<UserStreak | null> {
  const { data, error } = await supabase
    .from('user_activity_streaks')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) {
    console.error('Failed to fetch streak:', error.message)
    return null
  }
  return (data as UserStreak | null) ?? null
}

// ─── EduPoints standings ────────────────────────────────────────────────────────

export interface EduStanding {
  classroom_id: string
  classroom_title: string
  points: number
  rank: number
  total_students: number
}

/** Per-classroom EduPoints, rank and class size for a student (live-derived). */
export async function fetchStudentEduStandings(studentId: string): Promise<EduStanding[]> {
  const { data, error } = await supabase.rpc('get_student_edu_standings', { p_student_id: studentId })
  if (error) {
    console.error('Failed to fetch edu standings:', error.message)
    return []
  }
  return (data ?? []) as EduStanding[]
}

// ─── Monthly EduPoints (staff analysis) ─────────────────────────────────────────

export interface EduMonthlyRow {
  student_id: string
  full_name: string
  month: string        // first-of-month date, YYYY-MM-DD
  points: number
}

/** Student-wise EduPoints earned per month in a classroom (staff only). */
export async function fetchClassroomEduMonthly(classroomId: string): Promise<EduMonthlyRow[]> {
  const { data, error } = await supabase.rpc('get_classroom_edu_monthly', { p_classroom_id: classroomId })
  if (error) {
    console.error('Failed to fetch classroom monthly edu points:', error.message)
    return []
  }
  return (data ?? []) as EduMonthlyRow[]
}
