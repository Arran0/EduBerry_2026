import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { syncStudentHomeroom } from '@/lib/homeroomAutoManage'

/**
 * POST /api/admin/sync-homerooms
 *
 * Backfill: iterates every student with grade+section set and ensures they
 * are enrolled in the correct academic-year homeroom.  Safe to run multiple
 * times — syncStudentHomeroom is idempotent (upsert on conflict).
 *
 * Returns counts of students processed, homerooms created, and any errors.
 */
export async function POST(request: NextRequest) {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!serviceRoleKey || !supabaseUrl || !anonKey) {
    return NextResponse.json({ success: false, error: 'Server not configured' }, { status: 500 })
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  // Verify caller is admin
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
  const { data: callerProfile } = await adminClient
    .from('profiles')
    .select('role')
    .eq('id', callerUser.id)
    .single()
  if (!callerProfile || callerProfile.role !== 'admin') {
    return NextResponse.json({ success: false, error: 'Admin access required' }, { status: 403 })
  }

  // Fetch all students, then filter for those with grade+section set.
  // Filtering in JS avoids PostgREST null-check edge cases.
  const { data: allStudents, error: fetchError } = await adminClient
    .from('profiles')
    .select('id, grade, section')
    .eq('role', 'student')

  if (fetchError) {
    return NextResponse.json({ success: false, error: fetchError.message }, { status: 500 })
  }

  const students = (allStudents ?? []).filter(
    s => s.grade != null && s.section != null && s.section !== ''
  )

  const results: { id: string; error?: string }[] = []

  for (const student of students ?? []) {
    try {
      await syncStudentHomeroom(adminClient, student.id, student.grade, student.section)
      results.push({ id: student.id })
    } catch (err) {
      results.push({ id: student.id, error: String(err) })
    }
  }

  const synced = results.filter(r => !r.error).length
  const errors = results.filter(r => r.error)

  return NextResponse.json({ success: true, total: results.length, synced, errors })
}
