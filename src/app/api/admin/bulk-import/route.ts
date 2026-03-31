import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

interface BulkUserInput {
  email: string
  full_name: string
  role: string
  grade?: number
  section?: string
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
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }
  const callerToken = authHeader.slice(7)
  const { data: { user: callerUser }, error: authError } = await adminClient.auth.getUser(callerToken)
  if (authError || !callerUser) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
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

  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '') ||
    request.headers.get('origin') ||
    supabaseUrl

  // Fetch existing profiles by email to decide create vs update
  const emails = users.map(u => u.email.toLowerCase().trim())
  const { data: existingProfiles } = await adminClient
    .from('profiles')
    .select('id, email')
    .in('email', emails)

  const existingEmailToId = new Map<string, string>()
  for (const p of existingProfiles || []) {
    existingEmailToId.set(p.email.toLowerCase(), p.id)
  }

  const results: { email: string; action: 'created' | 'updated' | 'error'; error?: string }[] = []

  for (const user of users) {
    const email = user.email.toLowerCase().trim()
    const existingId = existingEmailToId.get(email)

    try {
      if (existingId) {
        // Update existing profile — no invite email
        const { error } = await adminClient
          .from('profiles')
          .update({
            full_name: user.full_name.trim(),
            role: user.role,
            grade: user.role === 'student' && user.grade ? user.grade : null,
            section: user.role === 'student' && user.section ? user.section : null,
          })
          .eq('id', existingId)

        if (error) {
          results.push({ email, action: 'error', error: error.message })
        } else {
          results.push({ email, action: 'updated' })
        }
      } else {
        // New user — invite via email
        const { data: inviteData, error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(email, {
          data: { role: user.role, full_name: user.full_name },
          redirectTo: `${siteUrl}/update-password`,
        })

        if (inviteError) {
          results.push({ email, action: 'error', error: inviteError.message })
          continue
        }

        const newUserId = inviteData?.user?.id
        if (!newUserId) {
          results.push({ email, action: 'error', error: 'Failed to get user ID after invite' })
          continue
        }

        await adminClient.from('profiles').upsert({
          id: newUserId,
          email,
          full_name: user.full_name.trim(),
          role: user.role,
          grade: user.role === 'student' && user.grade ? user.grade : null,
          section: user.role === 'student' && user.section ? user.section : null,
        })

        results.push({ email, action: 'created' })
      }
    } catch (err) {
      results.push({ email, action: 'error', error: String(err) })
    }
  }

  const created = results.filter(r => r.action === 'created').length
  const updated = results.filter(r => r.action === 'updated').length
  const errors = results.filter(r => r.action === 'error')

  return NextResponse.json({ success: true, created, updated, errors })
}
