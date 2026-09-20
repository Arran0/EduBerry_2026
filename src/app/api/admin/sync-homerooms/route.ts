import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { getAcademicYear, getDefaultExpiryDate, expiryDateFor } from '@/lib/homeroomAutoManage'

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
    return NextResponse.json({ success: false, error: `Unauthorized: ${authError?.message ?? 'invalid token'}` }, { status: 401 })
  }
  const { data: callerProfile } = await adminClient
    .from('profiles').select('role').eq('id', callerUser.id).single()
  if (!callerProfile || callerProfile.role !== 'admin') {
    return NextResponse.json({ success: false, error: 'Admin access required' }, { status: 403 })
  }

  // ── Fetch all profiles, filter in JS ──────────────────────────────────────
  // We select role too so we can filter accurately without relying on
  // PostgREST null-check syntax (which varies across supabase-js versions).
  const { data: allProfiles, error: fetchError } = await adminClient
    .from('profiles')
    .select('id, role, grade, section')

  if (fetchError) {
    return NextResponse.json({ success: false, error: `Failed to fetch profiles: ${fetchError.message}` }, { status: 500 })
  }

  const profiles = allProfiles ?? []
  const allStudents = profiles.filter(p => p.role === 'student')
  const students = allStudents.filter(
    s => s.grade != null && s.section != null && String(s.section).trim() !== ''
  )

  // Rich diagnostics so the admin can see exactly what we found
  const diagnostic = {
    totalProfiles: profiles.length,
    studentProfiles: allStudents.length,
    studentsWithGradeAndSection: students.length,
    studentsWithoutGradeOrSection: allStudents.length - students.length,
  }

  if (students.length === 0) {
    return NextResponse.json({ success: true, total: 0, synced: 0, errors: [], diagnostic })
  }

  // ── Resolve expiry date ───────────────────────────────────────────────────
  const academicYear = getAcademicYear()
  let expiryDate = getDefaultExpiryDate(academicYear)

  // The table is `app_settings`; this read named a non-existent
  // `admin_settings` and discarded the error, so the admin-configured expiry
  // map was never applied and every synced homeroom got the default date.
  const { data: settingsRow, error: settingsError } = await adminClient
    .from('app_settings')
    .select('value')
    .eq('key', 'homeroom_expiry_dates')
    .maybeSingle()

  if (settingsError) console.error('sync-homerooms: app_settings lookup failed:', settingsError)

  const custom = expiryDateFor(settingsRow?.value, academicYear)
  if (custom) expiryDate = custom

  // ── Group students by grade+section ──────────────────────────────────────
  const groups = new Map<string, { grade: number; section: string; ids: string[] }>()
  for (const s of students) {
    const key = `${s.grade}|${s.section}`
    if (!groups.has(key)) {
      groups.set(key, { grade: Number(s.grade), section: String(s.section).trim(), ids: [] })
    }
    groups.get(key)!.ids.push(s.id)
  }

  // ── For each group, find-or-create homeroom then bulk-enrol students ──────
  let synced = 0
  const errors: string[] = []

  for (const group of groups.values()) {
    const { grade, section, ids } = group
    let homeroomId: string | null = null

    // 1. Try to find an existing homeroom for this grade+section+academic_year.
    //    Wrap in try/catch in case the academic_year column doesn't exist yet.
    try {
      const { data: existing } = await adminClient
        .from('homerooms')
        .select('id')
        .eq('grade', grade)
        .eq('section', section)
        .eq('academic_year', academicYear)
        .maybeSingle()
      homeroomId = existing?.id ?? null
    } catch {
      // academic_year column not present — fall through to grade+section lookup
    }

    // 2. Fall back to grade+section only (handles pre-migration homerooms too)
    if (!homeroomId) {
      const { data: existing } = await adminClient
        .from('homerooms')
        .select('id')
        .eq('grade', grade)
        .eq('section', section)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle()
      homeroomId = existing?.id ?? null
    }

    // 3. Create a new homeroom if none found
    if (!homeroomId) {
      const name = `Grade ${grade} Section ${section} (${academicYear})`

      // Try with academic_year+expiry_date first (post-migration schema)
      const { data: created, error: createErr } = await adminClient
        .from('homerooms')
        .insert({ name, grade, section, academic_year: academicYear, expiry_date: expiryDate })
        .select('id')
        .single()

      if (!createErr && created) {
        homeroomId = created.id
      } else {
        // Migration not run yet — insert without the new columns
        const { data: created2, error: createErr2 } = await adminClient
          .from('homerooms')
          .insert({ name, grade, section })
          .select('id')
          .single()

        if (createErr2 || !created2) {
          errors.push(`Grade ${grade} Section ${section}: ${createErr2?.message ?? 'insert failed'}`)
          continue
        }
        homeroomId = created2.id
      }
    }

    if (!homeroomId) {
      errors.push(`Grade ${grade} Section ${section}: could not find or create homeroom`)
      continue
    }

    // 4. Bulk-enrol all students into this homeroom (idempotent upsert)
    const memberRows = ids.map(studentId => ({ homeroom_id: homeroomId!, student_id: studentId }))
    const { error: enrollErr } = await adminClient
      .from('homeroom_members')
      .upsert(memberRows, { onConflict: 'homeroom_id,student_id', ignoreDuplicates: true })

    if (enrollErr) {
      errors.push(`Grade ${grade} Section ${section}: enrol failed — ${enrollErr.message}`)
    } else {
      synced += ids.length
    }
  }

  return NextResponse.json({ success: true, total: students.length, synced, errors, diagnostic })
}
