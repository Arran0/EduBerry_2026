import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { syncStudentHomeroom } from '@/lib/homeroomAutoManage'

export async function PATCH(request: NextRequest) {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !anonKey) {
    return NextResponse.json({ success: false, error: 'Supabase not configured' }, { status: 500 })
  }

  const clientKey = serviceRoleKey || anonKey
  const adminClient = createClient(supabaseUrl, clientKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const authHeader = request.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }

  const anonClient = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { data: { user: callerUser }, error: authError } = await anonClient.auth.getUser(authHeader.slice(7))
  if (authError || !callerUser) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }

  const { data: callerProfile } = await adminClient.from('profiles').select('role').eq('id', callerUser.id).single()
  if (!callerProfile || callerProfile.role !== 'admin') {
    return NextResponse.json({ success: false, error: 'Admin access required' }, { status: 403 })
  }

  const { userId, full_name, role, grade, section } = await request.json()
  if (!userId) return NextResponse.json({ success: false, error: 'userId is required' }, { status: 400 })

  // Snapshot old grade/section before applying updates (needed for homeroom sync)
  const { data: oldProfile } = await adminClient
    .from('profiles')
    .select('role, grade, section')
    .eq('id', userId)
    .single()

  // Prevent demoting the last admin
  if (role && role !== 'admin') {
    const { data: targetProfile } = await adminClient.from('profiles').select('role').eq('id', userId).single()
    if (targetProfile?.role === 'admin') {
      const { data: otherAdmins } = await adminClient
        .from('profiles')
        .select('id')
        .eq('role', 'admin')
        .neq('id', userId)
        .limit(1)
      if (!otherAdmins || otherAdmins.length === 0) {
        return NextResponse.json(
          { success: false, error: 'Cannot remove the last admin. Assign another admin first.' },
          { status: 400 }
        )
      }
    }
  }

  const updates: Record<string, unknown> = {}
  if (full_name !== undefined) updates.full_name = full_name
  if (role !== undefined) updates.role = role
  updates.grade = grade ?? null
  updates.section = section ?? null

  const { error } = await adminClient.from('profiles').update(updates).eq('id', userId)
  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }

  // Sync homeroom membership when a student's grade or section changes
  const effectiveRole = role ?? oldProfile?.role
  if (effectiveRole === 'student') {
    const newGrade = grade != null ? Number(grade) : null
    const newSection = section ?? null
    const oldGrade = oldProfile?.grade ?? null
    const oldSection = oldProfile?.section ?? null
    const gradeChanged = newGrade !== oldGrade
    const sectionChanged = newSection !== oldSection
    if (gradeChanged || sectionChanged) {
      await syncStudentHomeroom(adminClient, userId, newGrade, newSection, oldGrade, oldSection)
    }
  }

  return NextResponse.json({ success: true })
}
