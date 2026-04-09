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

  // Use service role if available (bypasses RLS), otherwise fall back to anon.
  // The get_monthly_member_stats function is SECURITY DEFINER so it works either way.
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
  const now = new Date()
  const monthStart    = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0]
  const monthStartISO = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()

  // ── Fetch member profiles (one row per member, always < 1000) ────────────
  const { data: profiles } = await queryClient
    .from('profiles')
    .select('*')
    .in('id', memberIds)

  // ── Fetch stats via RPC ──────────────────────────────────────────────────
  // get_monthly_member_stats does the task_assignees JOIN + subtasks query
  // entirely inside Postgres and returns ONE aggregated row per member.
  // Result set size == number of members with tasks this month — never
  // close to Supabase's 1000-row default limit regardless of school size.
  const { data: statsRows } = await queryClient.rpc('get_monthly_member_stats', {
    p_member_ids:     memberIds,
    p_month_start:    monthStart,
    p_month_start_ts: monthStartISO,
  })

  // Build a quick lookup: user_id → stats
  const statsMap = new Map<string, { completed: number; bonus: number; overdue: number; total: number }>()
  for (const row of (statsRows ?? [])) {
    statsMap.set(row.user_id, {
      completed: Number(row.completed),
      bonus:     Number(row.bonus),
      overdue:   Number(row.overdue),
      total:     Number(row.total),
    })
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
