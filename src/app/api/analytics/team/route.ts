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

  // Use service role if available (bypasses RLS), otherwise fall back to anon
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

  // ── Fetch team members based on role ────────────────────────────────────────
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

  // ── Fetch all profiles for those member IDs ──────────────────────────────
  const { data: profiles } = await queryClient
    .from('profiles')
    .select('*')
    .in('id', memberIds)

  // ── Fetch all task assignments for those members ──────────────────────────
  const { data: assignees } = await queryClient
    .from('task_assignees')
    .select('task_id, user_id')
    .in('user_id', memberIds)

  const taskIds = [...new Set((assignees || []).map((a: { task_id: string }) => a.task_id))]

  // ── Fetch those tasks ─────────────────────────────────────────────────────
  let tasks: any[] = []
  if (taskIds.length > 0) {
    const { data } = await queryClient
      .from('tasks')
      .select('id, status, due_date, created_at, is_overdue, bonus_points')
      .in('id', taskIds)
    tasks = data || []
  }

  // Map task_id → task data
  const taskMap = new Map<string, any>(tasks.map(t => [t.id, t]))

  // Build: userId → list of tasks assigned to them
  const userTaskMap = new Map<string, any[]>()
  ;(assignees || []).forEach((a: { task_id: string; user_id: string }) => {
    const task = taskMap.get(a.task_id)
    if (!task) return
    if (!userTaskMap.has(a.user_id)) userTaskMap.set(a.user_id, [])
    userTaskMap.get(a.user_id)!.push(task)
  })

  // ── Fetch all subtasks for those members ─────────────────────────────────
  const { data: allSubtasks } = await queryClient
    .from('subtasks')
    .select('assignee_id, status, due_date, created_at, bonus_points')
    .in('assignee_id', memberIds)

  // Group subtasks by assignee
  const userSubtaskMap = new Map<string, any[]>()
  ;(allSubtasks || []).forEach((s: any) => {
    if (!userSubtaskMap.has(s.assignee_id)) userSubtaskMap.set(s.assignee_id, [])
    userSubtaskMap.get(s.assignee_id)!.push(s)
  })

  // ── Calculate stats per member ────────────────────────────────────────────
  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0]
  const monthStartISO = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
  const todayStr = now.toISOString().split('T')[0]

  const memberStats = (profiles || []).map((member: any) => {
    const memberTasks = userTaskMap.get(member.id) || []
    const monthTasks = memberTasks.filter((t: any) => {
      if (t.due_date) return t.due_date >= monthStart
      return t.created_at >= monthStartISO
    })

    const memberSubtasks = userSubtaskMap.get(member.id) || []
    const monthSubtasks = memberSubtasks.filter((s: any) => {
      if (s.due_date) return s.due_date >= monthStart
      return s.created_at >= monthStartISO
    })

    const allItems = [
      ...monthTasks.map((t: any) => ({
        status: t.status,
        bonus_points: t.bonus_points || 0,
        is_overdue: !!(t.due_date && t.due_date < todayStr && t.status !== 'checked' && t.status !== 'done'),
      })),
      ...monthSubtasks.map((s: any) => ({
        status: s.status,
        bonus_points: s.bonus_points || 0,
        is_overdue: !!(s.due_date && s.due_date < todayStr && s.status !== 'checked' && s.status !== 'done'),
      })),
    ]

    // Count 'done' AND 'checked' as completed (done = self-reported, checked = supervisor-verified)
    const completed = allItems.filter(t => t.status === 'done' || t.status === 'checked').length
    const bonus = allItems
      .filter(t => t.status === 'done' || t.status === 'checked')
      .reduce((sum: number, t: any) => sum + (t.bonus_points || 0), 0)
    const overdue = allItems.filter(t => t.is_overdue).length
    const total = allItems.length

    return {
      user: member,
      stats: {
        completed,
        bonus,
        overdue,
        total,
        completionRate: total > 0 ? Math.round((completed / total) * 100) : 0,
      },
    }
  })

  const teamTotal = memberStats.reduce((s: number, m: any) => s + m.stats.total, 0)
  const teamChecked = memberStats.reduce((s: number, m: any) => s + m.stats.completed, 0)
  const teamCompletionRate = teamTotal > 0 ? Math.round((teamChecked / teamTotal) * 100) : 0

  return NextResponse.json({ members: memberStats, teamCompletionRate })
}
