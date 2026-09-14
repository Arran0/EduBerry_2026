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

/** The streak row `recordAppOpen` already returned this session. Sign-in calls
 *  record_app_open once per user and the RPC hands back the updated row, so the
 *  academics header can read that instead of issuing its own query. */
let streakCache: UserStreak | null = null

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
  const streak = (Array.isArray(data) ? data[0] : data) as UserStreak | null
  if (streak) streakCache = streak
  return streak
}

/** Reads the current user's streak row (does not mutate). Served from the row
 *  `recordAppOpen` returned at sign-in when that is for the same user. */
export async function fetchStreak(userId: string): Promise<UserStreak | null> {
  if (streakCache?.user_id === userId) return streakCache
  const { data, error } = await supabase
    .from('user_activity_streaks')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) {
    console.error('Failed to fetch streak:', error.message)
    return null
  }
  const streak = (data as UserStreak | null) ?? null
  if (streak) streakCache = streak
  return streak
}

// ─── EduPoints standings ────────────────────────────────────────────────────────

export interface EduStanding {
  classroom_id: string
  classroom_title: string
  points: number
  rank: number
  total_students: number
}

/** One row per classroom the student is enrolled in, as returned by
 *  `get_student_edu_dashboard`: coursework points, homework points, live rank
 *  and class size, plus the rank as of the start of this month. */
export interface EduDashboardRow extends EduStanding {
  /** EduPoints from completed smart-board homework, added to `points` for
   *  display (the leaderboard rank itself counts coursework only). */
  hw_points: number
  /** Rank as of the first of this month — the "rank up" celebration compares
   *  this with `rank`. */
  prev_rank: number
}

export interface RankTrendInfo {
  currRank: number
  prevRank: number
  /** True when the student climbed the leaderboard since last month. */
  improved: boolean
  delta: number
}

/**
 * Everything the academics EduPoints carousel needs, in one round trip:
 * per-classroom coursework points, homework points, rank, class size and
 * last month's rank. This replaced three separate calls (a standings RPC, a
 * rank-trend RPC and a two-query client-side homework tally) that each
 * re-derived the same leaderboard.
 */
export async function fetchStudentEduDashboard(studentId: string): Promise<EduDashboardRow[]> {
  const { data, error } = await supabase.rpc('get_student_edu_dashboard', { p_student_id: studentId })
  if (error) {
    console.error('Failed to fetch edu dashboard:', error.message)
    return []
  }
  return (data ?? []) as EduDashboardRow[]
}

/** Rank movement since the start of the month for one dashboard row. */
export function rankTrendOf(row: EduDashboardRow): RankTrendInfo {
  const delta = row.prev_rank - row.rank // positive = climbed
  return { currRank: row.rank, prevRank: row.prev_rank, improved: delta > 0, delta }
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
