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

  const nextYear  = month === 12 ? year + 1 : year
  const nextMonth = month === 12 ? 1 : month + 1
  const monthEnd    = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`
  const monthEndISO = `${monthEnd}T00:00:00.000Z`

  // ── Fetch member profiles ────────────────────────────────────────────────
  const { data: profiles } = await queryClient
    .from('profiles')
    .select('*')
    .in('id', memberIds)

  // ── Fetch tasks ──────────────────────────────────────────────────────────
  //
  // Two separate sets with different purposes:
  //
  //   Scheduled set  — tasks with due_date in this month (or created this month
  //                    when there is no due_date).  Used for: total, overdue,
  //                    and the completion-rate denominator.
  //
  //   Done-in-month  — tasks whose status is done/checked AND whose updated_at
  //                    falls within this month, i.e. the completion OCCURRED
  //                    this month.  Used for: completed count and bonus points.
  //
  // Keeping them separate means "completed in June" truly means the teacher
  // finished the work in June, not merely that the task was due in June.
  const [
    { data: datedTasks,    error: e1 },
    { data: undatedTasks,  error: e2 },
    { data: doneInMonth,   error: e3 },
  ] = await Promise.all([
    queryClient
      .from('tasks')
      .select('id, status, due_date')
      .gte('due_date', monthStart)
      .lt('due_date', monthEnd)
      .limit(10000),
    queryClient
      .from('tasks')
      .select('id, status')
      .is('due_date', null)
      .gte('created_at', monthStartISO)
      .lt('created_at', monthEndISO)
      .limit(10000),
    queryClient
      .from('tasks')
      .select('id, bonus_points')
      .in('status', ['done', 'checked'])
      .gte('updated_at', monthStartISO)
      .lt('updated_at', monthEndISO)
      .limit(10000),
  ])
  if (e1) console.error('[team-analytics] datedTasks error:', e1)
  if (e2) console.error('[team-analytics] undatedTasks error:', e2)
  if (e3) console.error('[team-analytics] doneInMonth error:', e3)

  // Lookups: task_id → row
  const scheduledTaskById = new Map<string, { status: string; due_date: string | null }>()
  for (const t of (datedTasks || []))   scheduledTaskById.set(t.id, { status: t.status, due_date: t.due_date })
  for (const t of (undatedTasks || [])) scheduledTaskById.set(t.id, { status: t.status, due_date: null })

  const doneTaskById = new Map<string, { bonus_points: number | null }>()
  for (const t of (doneInMonth || [])) doneTaskById.set(t.id, { bonus_points: t.bonus_points })

  const scheduledTaskIds = Array.from(scheduledTaskById.keys())
  const doneTaskIds      = Array.from(doneTaskById.keys())

  // ── Fetch task assignees for both sets ───────────────────────────────────
  let scheduledTaskAssignees: { user_id: string; task_id: string }[] = []
  let doneTaskAssignees:      { user_id: string; task_id: string }[] = []

  await Promise.all([
    scheduledTaskIds.length > 0
      ? queryClient
          .from('task_assignees')
          .select('user_id, task_id')
          .in('user_id', memberIds)
          .in('task_id', scheduledTaskIds)
          .limit(10000)
          .then(({ data }) => { scheduledTaskAssignees = data || [] })
      : Promise.resolve(),
    doneTaskIds.length > 0
      ? queryClient
          .from('task_assignees')
          .select('user_id, task_id')
          .in('user_id', memberIds)
          .in('task_id', doneTaskIds)
          .limit(10000)
          .then(({ data }) => { doneTaskAssignees = data || [] })
      : Promise.resolve(),
  ])

  // ── Fetch subtasks ───────────────────────────────────────────────────────
  // Same two-set logic: scheduled (for total/overdue) vs done-in-month (for completed/bonus).
  const [
    { data: datedSubs,       error: e4 },
    { data: undatedSubs,     error: e5 },
    { data: doneSubsInMonth, error: e6 },
  ] = await Promise.all([
    queryClient
      .from('subtasks')
      .select('assignee_id, status, due_date')
      .in('assignee_id', memberIds)
      .gte('due_date', monthStart)
      .lt('due_date', monthEnd)
      .limit(10000),
    queryClient
      .from('subtasks')
      .select('assignee_id, status, due_date')
      .in('assignee_id', memberIds)
      .is('due_date', null)
      .gte('created_at', monthStartISO)
      .lt('created_at', monthEndISO)
      .limit(10000),
    queryClient
      .from('subtasks')
      .select('assignee_id, bonus_points')
      .in('assignee_id', memberIds)
      .in('status', ['done', 'checked'])
      .gte('updated_at', monthStartISO)
      .lt('updated_at', monthEndISO)
      .limit(10000),
  ])
  if (e4) console.error('[team-analytics] datedSubs error:', e4)
  if (e5) console.error('[team-analytics] undatedSubs error:', e5)
  if (e6) console.error('[team-analytics] doneSubsInMonth error:', e6)

  const scheduledSubs  = [...(datedSubs || []), ...(undatedSubs || [])]
  const doneSubs       = doneSubsInMonth || []

  // ── Aggregate per member ─────────────────────────────────────────────────
  // For overdue: past months use month-end as the cutoff; current month uses today.
  const today = new Date().toISOString().split('T')[0]
  const overdueThreshold = monthEnd <= today ? monthEnd : today

  type MStats = {
    completed:          number  // completions that occurred this month (updated_at)
    completedScheduled: number  // scheduled tasks that are done (for completionRate)
    bonus:              number  // bonus points earned this month
    overdue:            number
    total:              number  // tasks scheduled for this month
  }
  const statsMap = new Map<string, MStats>()
  const ensure = (uid: string) => {
    if (!statsMap.has(uid)) statsMap.set(uid, { completed: 0, completedScheduled: 0, bonus: 0, overdue: 0, total: 0 })
  }

  // Scheduled tasks → total / overdue / completedScheduled (for rate)
  for (const row of scheduledTaskAssignees) {
    const task = scheduledTaskById.get(row.task_id)
    if (!task) continue
    ensure(row.user_id)
    const s = statsMap.get(row.user_id)!
    s.total++
    const isDone = task.status === 'done' || task.status === 'checked'
    if (isDone) {
      s.completedScheduled++
    } else if (task.due_date && task.due_date < overdueThreshold) {
      s.overdue++
    }
  }

  // Done-in-month tasks → completed / bonus
  for (const row of doneTaskAssignees) {
    const task = doneTaskById.get(row.task_id)
    if (!task) continue
    ensure(row.user_id)
    const s = statsMap.get(row.user_id)!
    s.completed++
    s.bonus += task.bonus_points ?? 0
  }

  // Scheduled subtasks → total / overdue / completedScheduled
  for (const sub of scheduledSubs) {
    if (!sub.assignee_id) continue
    ensure(sub.assignee_id)
    const s = statsMap.get(sub.assignee_id)!
    s.total++
    const isDone = sub.status === 'done' || sub.status === 'checked'
    if (isDone) {
      s.completedScheduled++
    } else if (sub.due_date && sub.due_date < overdueThreshold) {
      s.overdue++
    }
  }

  // Done-in-month subtasks → completed / bonus
  for (const sub of doneSubs) {
    if (!sub.assignee_id) continue
    ensure(sub.assignee_id)
    const s = statsMap.get(sub.assignee_id)!
    s.completed++
    s.bonus += sub.bonus_points ?? 0
  }

  // ── Build per-member response ────────────────────────────────────────────
  const memberStats = (profiles ?? []).map((member: any) => {
    const s = statsMap.get(member.id) ?? { completed: 0, completedScheduled: 0, bonus: 0, overdue: 0, total: 0 }
    return {
      user: member,
      stats: {
        completed:      s.completed,
        bonus:          s.bonus,
        overdue:        s.overdue,
        total:          s.total,
        completionRate: s.total > 0 ? Math.round((s.completedScheduled / s.total) * 100) : 0,
      },
    }
  })

  const teamTotal          = memberStats.reduce((s: number, m: any) => s + m.stats.total, 0)
  const teamChecked        = memberStats.reduce((s: number, m: any) => s + m.stats.completed, 0)
  const teamCompletionRate = teamTotal > 0 ? Math.round((teamChecked / teamTotal) * 100) : 0

  return NextResponse.json({ members: memberStats, teamCompletionRate })
}
