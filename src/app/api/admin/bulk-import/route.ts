import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { syncStudentHomeroom } from '@/lib/homeroomAutoManage'

interface BulkUserInput {
  email: string
  full_name: string
  role: string
  grade?: number
  section?: string
}

// Default password used when the admin chooses to auto-confirm new accounts
// (skips the invite email and lets members sign in immediately).
const DEFAULT_AUTOCONFIRM_PASSWORD = 'mps2627'

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

  // Fetch existing profiles by email to decide create vs update
  const emails = users.map(u => u.email.toLowerCase().trim())
  const { data: existingProfiles } = await adminClient
    .from('profiles')
    .select('id, email, grade, section')
    .in('email', emails)

  const existingEmailToProfile = new Map<string, { id: string; grade: number | null; section: string | null }>()
  for (const p of existingProfiles || []) {
    existingEmailToProfile.set(p.email.toLowerCase(), {
      id: p.id,
      grade: p.grade ?? null,
      section: p.section ?? null,
    })
  }

  const results: { email: string; action: 'created' | 'updated' | 'error'; error?: string }[] = []

  for (const user of users) {
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
            grade: newGrade,
            section: newSection,
          })
          .eq('id', existingId)

        if (error) {
          results.push({ email, action: 'error', error: error.message })
        } else {
          // Sync homeroom if grade/section changed
          if (user.role === 'student') {
            const oldGrade = existingProfile.grade
            const oldSection = existingProfile.section
            if (newGrade !== oldGrade || newSection !== oldSection) {
              await syncStudentHomeroom(adminClient, existingId, newGrade, newSection, oldGrade, oldSection)
            }
          }
          results.push({ email, action: 'updated' })
        }
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
            results.push({ email, action: 'error', error: createError.message })
            continue
          }
          newUserId = createData?.user?.id
        } else {
          const { data: inviteData, error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(email, {
            data: { role: user.role, full_name: user.full_name },
            redirectTo: `${siteUrl}/update-password`,
          })

          if (inviteError) {
            results.push({ email, action: 'error', error: inviteError.message })
            continue
          }
          newUserId = inviteData?.user?.id
        }

        if (!newUserId) {
          results.push({ email, action: 'error', error: 'Failed to get user ID after creation' })
          continue
        }

        const newGrade = user.role === 'student' && user.grade ? user.grade : null
        const newSection = user.role === 'student' && user.section ? user.section : null

        await adminClient.from('profiles').upsert({
          id: newUserId,
          email,
          full_name: user.full_name.trim(),
          role: user.role,
          grade: newGrade,
          section: newSection,
        })

        // Auto-manage homeroom when a student with grade+section is created
        if (user.role === 'student' && newGrade && newSection) {
          await syncStudentHomeroom(adminClient, newUserId, newGrade, newSection)
        }

        results.push({ email, action: 'created' })
      }
    } catch (err) {
      results.push({ email, action: 'error', error: String(err) })
    }
  }

  const created = results.filter(r => r.action === 'created').length
  const updated = results.filter(r => r.action === 'updated').length
  const errors = results.filter(r => r.action === 'error')

  return NextResponse.json({ success: true, created, updated, errors, autoConfirm })
}
