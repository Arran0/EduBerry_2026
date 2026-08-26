import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { syncStudentHomeroom, createHomeroomSyncCache } from '@/lib/homeroomAutoManage'

interface BulkUserInput {
  email: string
  full_name: string
  role: string
  is_non_teaching?: boolean
  grade?: number
  section?: string
  // Student fields
  admission_no?: string
  roll_no?: string
  date_of_birth?: string
  father_name?: string
  mother_name?: string
  guardian_name?: string
  phone?: string
  nationality?: string
  religion?: string
  category?: string
  blood_group?: string
  address?: string
  // Staff fields (CBSE extended)
  employee_id?: string
  designation?: string
  department?: string
  subjects_taught?: string
  employment_type?: string
  date_of_joining?: string
  date_of_retirement?: string
  date_of_confirmation?: string
  cbse_reg_no?: string
  qualification?: string
  ugc_net_qualified?: string
  teaching_diploma?: string
  teaching_experience_years?: string
  gender?: string
  alternate_phone?: string
  emergency_contact_name?: string
  emergency_contact?: string
  emergency_contact_relation?: string
  aadhaar_no?: string
  pan_no?: string
  epf_no?: string
  nps_no?: string
  bank_account_no?: string
  bank_name?: string
  ifsc_code?: string
}

const STAFF_ROLES = ['teacher', 'coordinator', 'principal', 'admin', 'driver']

// Default password used when the admin chooses to auto-confirm new accounts
// (skips the invite email and lets members sign in immediately).
const DEFAULT_AUTOCONFIRM_PASSWORD = 'mps2627'

function buildStudentDetail(studentId: string, user: BulkUserInput) {
  const detail = {
    admission_no: user.admission_no ?? null,
    roll_no: user.roll_no ?? null,
    date_of_birth: user.date_of_birth ?? null,
    father_name: user.father_name ?? null,
    mother_name: user.mother_name ?? null,
    guardian_name: user.guardian_name ?? null,
    phone: user.phone ?? null,
    nationality: user.nationality ?? null,
    religion: user.religion ?? null,
    category: user.category ?? null,
    blood_group: user.blood_group ?? null,
    address: user.address ?? null,
  }
  if (Object.values(detail).every(v => v === null)) return null
  return { student_id: studentId, ...detail }
}

function buildStaffDetail(staffId: string, user: BulkUserInput) {
  const detail = {
    employee_id: user.employee_id ?? null,
    designation: user.designation ?? null,
    department: user.department ?? null,
    subjects_taught: user.subjects_taught ?? null,
    employment_type: user.employment_type ?? null,
    date_of_joining: user.date_of_joining ?? null,
    date_of_retirement: user.date_of_retirement ?? null,
    date_of_confirmation: user.date_of_confirmation ?? null,
    cbse_reg_no: user.cbse_reg_no ?? null,
    qualification: user.qualification ?? null,
    ugc_net_qualified: user.ugc_net_qualified ?? null,
    teaching_diploma: user.teaching_diploma ?? null,
    teaching_experience_years: user.teaching_experience_years ?? null,
    date_of_birth: user.date_of_birth ?? null,
    gender: user.gender ?? null,
    nationality: user.nationality ?? null,
    religion: user.religion ?? null,
    category: user.category ?? null,
    blood_group: user.blood_group ?? null,
    phone: user.phone ?? null,
    alternate_phone: user.alternate_phone ?? null,
    emergency_contact_name: user.emergency_contact_name ?? null,
    emergency_contact: user.emergency_contact ?? null,
    emergency_contact_relation: user.emergency_contact_relation ?? null,
    address: user.address ?? null,
    aadhaar_no: user.aadhaar_no ?? null,
    pan_no: user.pan_no ?? null,
    epf_no: user.epf_no ?? null,
    nps_no: user.nps_no ?? null,
    bank_account_no: user.bank_account_no ?? null,
    bank_name: user.bank_name ?? null,
    ifsc_code: user.ifsc_code ?? null,
  }
  if (Object.values(detail).every(v => v === null)) return null
  return { staff_id: staffId, ...detail }
}

/** Runs async tasks with a bounded concurrency instead of one-at-a-time or all-at-once. */
async function runWithConcurrency<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++
      await fn(items[i])
    }
  })
  await Promise.all(workers)
}

const CHUNK_SIZE = 500
async function bulkUpsert(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  adminClient: SupabaseClient<any>,
  table: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rows: Record<string, any>[],
  onConflict: string
) {
  if (rows.length === 0) return
  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    await adminClient.from(table).upsert(rows.slice(i, i + CHUNK_SIZE), { onConflict })
  }
}

function isAlreadyRegisteredError(message: string | undefined): boolean {
  const m = (message || '').toLowerCase()
  return m.includes('already') && (m.includes('registered') || m.includes('exists'))
}

/**
 * Looks up an auth user by exact email via the GoTrue admin REST API
 * (not exposed by the supabase-js admin client). Used to recover from a
 * "user already registered" error on createUser — that error means an
 * auth account exists with no matching profiles row (e.g. left behind by
 * an earlier failed import), so we fetch its id and heal the missing
 * profile instead of reporting the same stale duplicate error forever.
 */
async function findAuthUserIdByEmail(supabaseUrl: string, serviceRoleKey: string, email: string): Promise<string | null> {
  try {
    const res = await fetch(`${supabaseUrl}/auth/v1/admin/users?filter=${encodeURIComponent(email)}`, {
      headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` },
    })
    if (!res.ok) return null
    const data = await res.json()
    const users: { id: string; email?: string }[] = data?.users ?? []
    const match = users.find(u => u.email?.toLowerCase() === email.toLowerCase())
    return match?.id ?? null
  } catch {
    return null
  }
}

export async function POST(request: NextRequest) {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL

  if (!serviceRoleKey || !supabaseUrl) {
    return NextResponse.json({ success: false, error: 'Server configuration error' }, { status: 500 })
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  // Verify caller is admin
  const authHeader = request.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return NextResponse.json({ success: false, error: 'Unauthorized: no session token sent' }, { status: 401 })
  }
  const callerToken = authHeader.slice(7)
  const { data: { user: callerUser }, error: authError } = await adminClient.auth.getUser(callerToken)
  if (authError || !callerUser) {
    console.error('bulk-import auth failed:', authError?.message)
    return NextResponse.json(
      { success: false, error: `Unauthorized: ${authError?.message || 'invalid or expired session'}` },
      { status: 401 }
    )
  }
  const { data: callerProfile } = await adminClient
    .from('profiles').select('role').eq('id', callerUser.id).single()
  if (!callerProfile || callerProfile.role !== 'admin') {
    return NextResponse.json({ success: false, error: 'Admin access required' }, { status: 403 })
  }

  const body = await request.json()
  const users: BulkUserInput[] = body.users
  if (!Array.isArray(users) || users.length === 0) {
    return NextResponse.json({ success: false, error: 'No users provided' }, { status: 400 })
  }

  // When autoConfirm is set, new members are created with a password and a
  // pre-confirmed email (no invite email). Otherwise we fall back to invites.
  const autoConfirm = body.autoConfirm === true
  const password =
    typeof body.password === 'string' && body.password.length > 0
      ? body.password
      : DEFAULT_AUTOCONFIRM_PASSWORD

  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '') ||
    request.headers.get('origin') ||
    supabaseUrl

  // Fetch existing profiles to decide create vs update. Matched in JS by
  // lowercased email rather than filtering with `.in('email', ...)` — that
  // filter compares case-sensitively, and some profiles have their email
  // stored with its original signup casing, so a case-sensitive match would
  // miss them and try to (re)create an account Supabase Auth already has,
  // failing with "already registered" instead of updating the existing row.
  const { data: existingProfiles } = await adminClient
    .from('profiles')
    .select('id, email, grade, section')

  const existingEmailToProfile = new Map<string, { id: string; grade: number | null; section: string | null }>()
  for (const p of existingProfiles || []) {
    if (!p.email) continue
    existingEmailToProfile.set(p.email.toLowerCase().trim(), {
      id: p.id,
      grade: p.grade ?? null,
      section: p.section ?? null,
    })
  }

  const results: { email: string; action: 'created' | 'updated' | 'error'; error?: string }[] = []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const studentDetailRows: Record<string, any>[] = []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const staffDetailRows: Record<string, any>[] = []

  // Computed once and reused for every row instead of re-querying per student.
  const homeroomCache = await createHomeroomSyncCache(adminClient)

  await runWithConcurrency(users, 8, async (user) => {
    const email = user.email.toLowerCase().trim()
    const existingProfile = existingEmailToProfile.get(email)
    const existingId = existingProfile?.id

    try {
      if (existingId) {
        // Update existing profile — no invite email
        const newGrade = user.role === 'student' && user.grade ? user.grade : null
        const newSection = user.role === 'student' && user.section ? user.section : null

        const { error } = await adminClient
          .from('profiles')
          .update({
            full_name: user.full_name.trim(),
            role: user.role,
            is_non_teaching: user.role === 'teacher' ? !!user.is_non_teaching : false,
            grade: newGrade,
            section: newSection,
          })
          .eq('id', existingId)

        if (error) {
          results.push({ email, action: 'error', error: error.message })
          return
        }

        // Sync homeroom if grade/section changed
        if (user.role === 'student') {
          const oldGrade = existingProfile.grade
          const oldSection = existingProfile.section
          if (newGrade !== oldGrade || newSection !== oldSection) {
            await syncStudentHomeroom(adminClient, existingId, newGrade, newSection, oldGrade, oldSection, homeroomCache)
          }
          const detail = buildStudentDetail(existingId, user)
          if (detail) studentDetailRows.push(detail)
        } else if (STAFF_ROLES.includes(user.role)) {
          const detail = buildStaffDetail(existingId, user)
          if (detail) staffDetailRows.push(detail)
        }
        results.push({ email, action: 'updated' })
      } else {
        // New user — either auto-confirm with a password, or send an invite email.
        let newUserId: string | undefined

        if (autoConfirm) {
          const { data: createData, error: createError } = await adminClient.auth.admin.createUser({
            email,
            password,
            email_confirm: true,
            user_metadata: { role: user.role, full_name: user.full_name },
          })

          if (createError) {
            if (isAlreadyRegisteredError(createError.message)) {
              newUserId = (await findAuthUserIdByEmail(supabaseUrl, serviceRoleKey, email)) ?? undefined
            }
            if (!newUserId) {
              results.push({ email, action: 'error', error: createError.message })
              return
            }
          } else {
            newUserId = createData?.user?.id
          }
        } else {
          const { data: inviteData, error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(email, {
            data: { role: user.role, full_name: user.full_name },
            redirectTo: `${siteUrl}/update-password`,
          })

          if (inviteError) {
            if (isAlreadyRegisteredError(inviteError.message)) {
              newUserId = (await findAuthUserIdByEmail(supabaseUrl, serviceRoleKey, email)) ?? undefined
            }
            if (!newUserId) {
              results.push({ email, action: 'error', error: inviteError.message })
              return
            }
          } else {
            newUserId = inviteData?.user?.id
          }
        }

        if (!newUserId) {
          results.push({ email, action: 'error', error: 'Failed to get user ID after creation' })
          return
        }

        const newGrade = user.role === 'student' && user.grade ? user.grade : null
        const newSection = user.role === 'student' && user.section ? user.section : null

        await adminClient.from('profiles').upsert({
          id: newUserId,
          email,
          full_name: user.full_name.trim(),
          role: user.role,
          is_non_teaching: user.role === 'teacher' ? !!user.is_non_teaching : false,
          grade: newGrade,
          section: newSection,
        })

        // Auto-manage homeroom when a student with grade+section is created
        if (user.role === 'student' && newGrade && newSection) {
          await syncStudentHomeroom(adminClient, newUserId, newGrade, newSection, undefined, undefined, homeroomCache)
        }
        if (user.role === 'student') {
          const detail = buildStudentDetail(newUserId, user)
          if (detail) studentDetailRows.push(detail)
        } else if (STAFF_ROLES.includes(user.role)) {
          const detail = buildStaffDetail(newUserId, user)
          if (detail) staffDetailRows.push(detail)
        }

        results.push({ email, action: 'created' })
      }
    } catch (err) {
      results.push({ email, action: 'error', error: String(err) })
    }
  })

  // Flush per-row detail records as a couple of bulk upserts instead of one call per row.
  await Promise.all([
    bulkUpsert(adminClient, 'student_details', studentDetailRows, 'student_id'),
    bulkUpsert(adminClient, 'staff_details', staffDetailRows, 'staff_id'),
  ])

  const created = results.filter(r => r.action === 'created').length
  const updated = results.filter(r => r.action === 'updated').length
  const errors = results.filter(r => r.action === 'error')

  return NextResponse.json({ success: true, created, updated, errors, autoConfirm })
}
