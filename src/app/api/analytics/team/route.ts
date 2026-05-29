import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

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

  const queryClient = serviceRoleKey
    ? createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } })
    : anonClient

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

  // ── Fetch tasks that fall within this month ──────────────────────────────
  // Run both queries in parallel: tasks with a due_date in range, and
  // tasks with no due_date but created within the month.
  const [{ data: datedTasks }, { data: undatedTasks }] = await Promise.all([
    queryClient
      .from('tasks')
      .select('id, status, bonus_points, due_date')
      .gte('due_date', monthStart)
      .lt('due_date', monthEnd)
      .limit(10000),
    queryClient
      .from('tasks')
      .select('id, status, bonus_points')
      .is('due_date', null)
      .gte('created_at', monthStartISO)
      .lt('created_at', monthEndISO)
      .limit(10000),
  ])

  // Build a lookup: task_id → task row
  const taskById = new Map<string, { status: string; bonus_points: number | null; due_date: string | null }>()
  for (const t of (datedTasks || [])) taskById.set(t.id, t)
  for (const t of (undatedTasks || [])) taskById.set(t.id, { ...t, due_date: null })

  const taskIds = Array.from(taskById.keys())

  // ── Fetch assignments for those tasks, filtered to our member list ────────
  let taskAssigneeRows: { user_id: string; task_id: string }[] = []
  if (taskIds.length > 0) {
    const { data } = await queryClient
      .from('task_assignees')
      .select('user_id, task_id')
      .in('user_id', memberIds)
      .in('task_id', taskIds)
      .limit(10000)
    taskAssigneeRows = data || []
  }

  // ── Fetch subtasks that fall within this month ───────────────────────────
  const [{ data: datedSubs }, { data: undatedSubs }] = await Promise.all([
    queryClient
      .from('subtasks')
      .select('assignee_id, status, bonus_points, due_date')
      .in('assignee_id', memberIds)
      .gte('due_date', monthStart)
      .lt('due_date', monthEnd)
      .limit(10000),
    queryClient
      .from('subtasks')
      .select('assignee_id, status, bonus_points')
      .in('assignee_id', memberIds)
      .is('due_date', null)
      .gte('created_at', monthStartISO)
      .lt('created_at', monthEndISO)
      .limit(10000),
  ])
  const allSubtasks = [...(datedSubs || []), ...(undatedSubs || [])]

  // ── Aggregate per member ─────────────────────────────────────────────────
  // For overdue: past months use month-end as the cutoff; current month uses today.
  const today = new Date().toISOString().split('T')[0]
  const overdueThreshold = monthEnd <= today ? monthEnd : today

  type MStats = { completed: number; bonus: number; overdue: number; total: number }
  const statsMap = new Map<string, MStats>()
  const ensure = (uid: string) => {
    if (!statsMap.has(uid)) statsMap.set(uid, { completed: 0, bonus: 0, overdue: 0, total: 0 })
  }

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
