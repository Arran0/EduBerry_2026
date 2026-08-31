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

  const { userId, full_name, email, role, is_non_teaching, grade, section, display_role } = await request.json()
  if (!userId) return NextResponse.json({ success: false, error: 'userId is required' }, { status: 400 })

  // Snapshot old grade/section/email before applying updates (needed for homeroom sync + email diffing)
  const { data: oldProfile } = await adminClient
    .from('profiles')
    .select('role, grade, section, email')
    .eq('id', userId)
    .single()

  if (email !== undefined) {
    const trimmedEmail = String(email).trim()
    if (!trimmedEmail || !trimmedEmail.includes('@')) {
      return NextResponse.json({ success: false, error: 'Please enter a valid email address' }, { status: 400 })
    }
    if (trimmedEmail.toLowerCase() !== (oldProfile?.email ?? '').toLowerCase()) {
      if (!serviceRoleKey) {
        return NextResponse.json({ success: false, error: 'Server configuration error: changing email requires SUPABASE_SERVICE_ROLE_KEY' }, { status: 500 })
      }
      const { error: emailError } = await adminClient.auth.admin.updateUserById(userId, {
        email: trimmedEmail,
        email_confirm: true,
      })
      if (emailError) {
        return NextResponse.json({ success: false, error: emailError.message }, { status: 400 })
      }
    }
  }

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
  if (email !== undefined) updates.email = String(email).trim()
  if (role !== undefined) updates.role = role
  // Non-teaching is a display-only flag on 'teacher' accounts — clear it for any other role.
  if (role !== undefined && role !== 'teacher') updates.is_non_teaching = false
  else if (is_non_teaching !== undefined) updates.is_non_teaching = !!is_non_teaching
  updates.grade = grade ?? null
  updates.section = section ?? null
  if (display_role !== undefined) updates.display_role = display_role ? String(display_role).trim() || null : null

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
