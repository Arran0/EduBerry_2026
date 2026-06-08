import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// Supabase enforces a server-side max-rows cap (1000 by default) that a plain
// `.limit(n)` cannot exceed. A busy month — daily-recurring tasks across every
// staff member — produces far more than 1000 task/subtask rows, so a single
// query silently truncates to the first 1000 and every count comes out far too
// low. Page through the full result set with `.range()` instead.
async function fetchAllRows(
  makeQuery: (from: number, to: number) => PromiseLike<{ data: any[] | null; error: unknown }>,
  label: string,
): Promise<any[]> {
  const PAGE = 1000
  const out: any[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await makeQuery(from, from + PAGE - 1)
    if (error) {
      console.error(`[team-analytics] ${label} error:`, error)
      break
    }
    const rows = data ?? []
    out.push(...rows)
    if (rows.length < PAGE) break
  }
  return out
}

export async function GET(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !anonKey) {
    return NextResponse.json({ error: 'Server configuration error' }, { status: 500 })
  }

  // Verify caller via their session token
  const authHeader = request.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const token = authHeader.slice(7)

  const anonClient = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { data: { user: callerUser }, error: authError } = await anonClient.auth.getUser(token)
  if (authError || !callerUser) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Service role bypasses RLS entirely. Without it, use the caller's own JWT
  // so direct table queries satisfy the "authenticated staff" RLS policies.
  const queryClient = serviceRoleKey
    ? createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } })
    : createClient(supabaseUrl, anonKey, {
        auth: { autoRefreshToken: false, persistSession: false },
        global: { headers: { Authorization: `Bearer ${token}` } },
      })

  // Fetch caller's profile to determine their role
  const { data: callerProfile } = await queryClient
    .from('profiles')
    .select('role')
    .eq('id', callerUser.id)
    .single()

  if (!callerProfile || callerProfile.role === 'student') {
    return NextResponse.json({ error: 'Staff access required' }, { status: 403 })
  }

  const { role: userRole } = callerProfile
  const userId = callerUser.id

  // ── Resolve which members to include ────────────────────────────────────
  let memberIds: string[] = [userId]

  if (userRole === 'admin' || userRole === 'principal') {
    const roles = userRole === 'admin'
      ? ['teacher', 'coordinator', 'principal']
      : ['teacher', 'coordinator']
    const { data: members } = await queryClient
      .from('profiles')
      .select('id')
      .in('role', roles)
    memberIds = [userId, ...(members || []).map((m: { id: string }) => m.id)]
  } else if (userRole === 'coordinator' || userRole === 'teacher') {
    const { data: myTeams } = await queryClient
      .from('team_members')
      .select('team_id')
      .eq('user_id', userId)
    if (myTeams && myTeams.length > 0) {
      const teamIds = myTeams.map((t: { team_id: string }) => t.team_id)
      const { data: members } = await queryClient
        .from('team_members')
        .select('user_id')
        .in('team_id', teamIds)
      const seen = new Set<string>([userId])
      ;(members || []).forEach((m: { user_id: string }) => seen.add(m.user_id))
      memberIds = Array.from(seen)
    }
  }

  // ── Month bounds ─────────────────────────────────────────────────────────
  // Accept optional ?month=YYYY-MM; default to current month.
  // Build strings directly to avoid server-timezone drift.
  const monthParam = request.nextUrl.searchParams.get('month')
  let year: number, month: number
  if (monthParam && /^\d{4}-\d{2}$/.test(monthParam)) {
    ;[year, month] = monthParam.split('-').map(Number)
  } else {
    const now = new Date()
    year = now.getFullYear()
    month = now.getMonth() + 1
  }
  const monthStart    = `${year}-${String(month).padStart(2, '0')}-01`
  const monthStartISO = `${monthStart}T00:00:00.000Z`

  // Exclusive upper bound: first day of the NEXT month
  const nextYear  = month === 12 ? year + 1 : year
  const nextMonth = month === 12 ? 1 : month + 1
  const monthEnd    = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`
  const monthEndISO = `${monthEnd}T00:00:00.000Z`

  // ── Fetch member profiles ────────────────────────────────────────────────
  const { data: profiles } = await queryClient
    .from('profiles')
    .select('*')
    .in('id', memberIds)

  type MStats = { completed: number; bonus: number; overdue: number; total: number }
  const statsMap = new Map<string, MStats>()
  const ensure = (uid: string) => {
    if (!statsMap.has(uid)) statsMap.set(uid, { completed: 0, bonus: 0, overdue: 0, total: 0 })
  }

  // ── Preferred path: aggregate entirely in Postgres ───────────────────────
  // get_monthly_member_stats JOINs tasks/subtasks, applies the month filter,
  // and returns ONE row per member (completed, bonus, overdue, total). This is
  // both correct and immune to Supabase's 1000-row response cap — the JS table
  // queries below silently truncate to 1000 rows on busy months, which is what
  // made every staffer's counts come out far too low.
  // Deploy supabase-migrations/get_monthly_member_stats.sql to enable it.
  const { data: rpcRows, error: rpcError } = await queryClient.rpc('get_monthly_member_stats', {
    p_member_ids:     memberIds,
    p_month_start:    monthStart,
    p_month_start_ts: monthStartISO,
  })

  if (!rpcError && Array.isArray(rpcRows)) {
    for (const r of rpcRows as any[]) {
      statsMap.set(r.user_id, {
        completed: Number(r.completed) || 0,
        bonus:     Number(r.bonus)     || 0,
        overdue:   Number(r.overdue)   || 0,
        total:     Number(r.total)     || 0,
      })
    }
  } else {
    // ── Fallback: aggregate in JS from paginated table reads ───────────────
    // Used when the RPC has not been deployed. `.range()` pages past the
    // 1000-row cap; task_assignees is chunked to keep request URLs short.
    if (rpcError) {
      console.warn('[team-analytics] get_monthly_member_stats unavailable, using table-query fallback:', rpcError.message)
    }

    const [datedTasks, undatedTasks] = await Promise.all([
      fetchAllRows((from, to) =>
        queryClient
          .from('tasks')
          .select('id, status, bonus_points, due_date')
          .gte('due_date', monthStart)
          .lt('due_date', monthEnd)
          .range(from, to),
        'datedTasks',
      ),
      fetchAllRows((from, to) =>
        queryClient
          .from('tasks')
          .select('id, status, bonus_points')
          .is('due_date', null)
          .gte('created_at', monthStartISO)
          .lt('created_at', monthEndISO)
          .range(from, to),
        'undatedTasks',
      ),
    ])

    const taskById = new Map<string, { status: string; bonus_points: number | null; due_date: string | null }>()
    for (const t of datedTasks) taskById.set(t.id, t)
    for (const t of undatedTasks) taskById.set(t.id, { ...t, due_date: null })

    const taskIds = Array.from(taskById.keys())
    const memberIdSet = new Set(memberIds)
    const taskAssigneeRows: { user_id: string; task_id: string }[] = []
    if (taskIds.length > 0) {
      const CHUNK = 100
      const chunks: string[][] = []
      for (let i = 0; i < taskIds.length; i += CHUNK) {
        chunks.push(taskIds.slice(i, i + CHUNK))
      }
      const perChunk = await Promise.all(
        chunks.map(chunk =>
          fetchAllRows((from, to) =>
            queryClient
              .from('task_assignees')
              .select('user_id, task_id')
              .in('task_id', chunk)
              .range(from, to),
            'taskAssignees',
          )
        )
      )
      for (const rows of perChunk) {
        for (const row of rows) {
          if (memberIdSet.has(row.user_id)) taskAssigneeRows.push(row)
        }
      }
    }

    const [datedSubs, undatedSubs] = await Promise.all([
      fetchAllRows((from, to) =>
        queryClient
          .from('subtasks')
          .select('assignee_id, status, bonus_points, due_date')
          .in('assignee_id', memberIds)
          .gte('due_date', monthStart)
          .lt('due_date', monthEnd)
          .range(from, to),
        'datedSubs',
      ),
      fetchAllRows((from, to) =>
        queryClient
          .from('subtasks')
          .select('assignee_id, status, bonus_points, due_date')
          .in('assignee_id', memberIds)
          .is('due_date', null)
          .gte('created_at', monthStartISO)
          .lt('created_at', monthEndISO)
          .range(from, to),
        'undatedSubs',
      ),
    ])
    const allSubtasks = [...datedSubs, ...undatedSubs]

    // For overdue: past months use month-end as the cutoff; current month uses today.
    const today = new Date().toISOString().split('T')[0]
    const overdueThreshold = monthEnd <= today ? monthEnd : today

    for (const row of taskAssigneeRows) {
      const task = taskById.get(row.task_id)
      if (!task) continue
      ensure(row.user_id)
      const s = statsMap.get(row.user_id)!
      s.total++
      const isDone = task.status === 'done' || task.status === 'checked'
      if (isDone) {
        s.completed++
        s.bonus += task.bonus_points ?? 0
      } else if (task.due_date && task.due_date < overdueThreshold) {
        s.overdue++
      }
    }

    for (const sub of allSubtasks) {
      if (!sub.assignee_id) continue
      ensure(sub.assignee_id)
      const s = statsMap.get(sub.assignee_id)!
      s.total++
      const isDone = sub.status === 'done' || sub.status === 'checked'
      if (isDone) {
        s.completed++
        s.bonus += sub.bonus_points ?? 0
      } else if (sub.due_date && sub.due_date < overdueThreshold) {
        s.overdue++
      }
    }
  }

  // ── Build per-member response ────────────────────────────────────────────
  const memberStats = (profiles ?? []).map((member: any) => {
    const s = statsMap.get(member.id) ?? { completed: 0, bonus: 0, overdue: 0, total: 0 }
    return {
      user: member,
      stats: {
        completed:      s.completed,
        bonus:          s.bonus,
        overdue:        s.overdue,
        total:          s.total,
        completionRate: s.total > 0 ? Math.round((s.completed / s.total) * 100) : 0,
      },
    }
  })

  const teamTotal          = memberStats.reduce((s: number, m: any) => s + m.stats.total, 0)
  const teamChecked        = memberStats.reduce((s: number, m: any) => s + m.stats.completed, 0)
  const teamCompletionRate = teamTotal > 0 ? Math.round((teamChecked / teamTotal) * 100) : 0

  return NextResponse.json({ members: memberStats, teamCompletionRate })
}
