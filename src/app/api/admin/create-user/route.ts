import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { logAdminAction } from '@/lib/adminAudit'
import { syncStudentHomeroom } from '@/lib/homeroomAutoManage'
import { MIN_PASSWORD_LENGTH } from '@/lib/passwords'
import { isEmailConfigured, resolveSiteUrl, sendAccountEmail } from '@/lib/email/accountEmails'

// This route requires SUPABASE_SERVICE_ROLE_KEY in environment variables
// Get it from: Supabase Dashboard → Project Settings → API → service_role secret

export async function POST(request: NextRequest) {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL

  if (!serviceRoleKey || !supabaseUrl) {
    return NextResponse.json(
      { success: false, error: 'Server configuration error: SUPABASE_SERVICE_ROLE_KEY not set' },
      { status: 500 }
    )
  }

  // Create admin client with service role key
  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  // Verify the caller is an authenticated admin
  const authHeader = request.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }
  const callerToken = authHeader.slice(7)
  const { data: { user: callerUser }, error: authError } = await adminClient.auth.getUser(callerToken)
  if (authError || !callerUser) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }

  // Check caller role
  const { data: callerProfile } = await adminClient
    .from('profiles')
    .select('role')
    .eq('id', callerUser.id)
    .single()

  if (!callerProfile || callerProfile.role !== 'admin') {
    return NextResponse.json({ success: false, error: 'Admin access required' }, { status: 403 })
  }

  // Parse request body
  const body = await request.json()
  const { email, full_name, role, is_non_teaching, grade, section, autoConfirm, password } = body

  if (!email || !full_name || !role) {
    return NextResponse.json({ success: false, error: 'email, full_name, and role are required' }, { status: 400 })
  }

  if (autoConfirm && (!password || password.length < MIN_PASSWORD_LENGTH)) {
    return NextResponse.json({ success: false, error: `A password of at least ${MIN_PASSWORD_LENGTH} characters is required for auto-confirm` }, { status: 400 })
  }

  try {
    let newUserId: string | undefined
    let inviteLink: string | undefined
    let emailSent = false

    if (autoConfirm) {
      // Auto-confirm: create account with the given password, no invite email needed
      const { data: createData, error: createError } = await adminClient.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { role, full_name },
      })

      if (createError) {
        if (createError.message?.includes('already been registered') || createError.message?.includes('already exists')) {
          return NextResponse.json({ success: false, error: 'A user with this email already exists' }, { status: 409 })
        }
        return NextResponse.json({ success: false, error: createError.message }, { status: 400 })
      }

      newUserId = createData.user?.id
    } else if (isEmailConfigured()) {
      // Branded invite from the platform domain via Cloudflare (see src/lib/email).
      const result = await sendAccountEmail(adminClient, {
        email,
        kind: 'invite',
        siteUrl: resolveSiteUrl(request),
        metadata: { role, full_name },
        recipientName: full_name,
      })

      if (!result.user) {
        const message = result.sent ? 'Failed to create the account' : result.error
        if (/already (been )?registered|already exists/i.test(message)) {
          return NextResponse.json({ success: false, error: 'A user with this email already exists' }, { status: 409 })
        }
        return NextResponse.json({ success: false, error: message }, { status: 400 })
      }

      newUserId = result.user.id
      emailSent = result.sent
      // The account exists either way; when only the mail failed, hand the
      // admin the link so the person can still be onboarded.
      if (!result.sent) inviteLink = result.actionUrl
    } else {
      // The site's public URL for the redirect link in the invite email
      // (see resolveSiteUrl for the order it is picked in).
      const siteUrl = resolveSiteUrl(request)

      // Invite user by email — sends a password-setup / account-activation link
      const { data: inviteData, error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(email, {
        data: { role, full_name },
        redirectTo: `${siteUrl}/update-password`,
      })

      if (inviteError) {
        // If user already exists, return a clear error
        if (inviteError.message?.includes('already been registered')) {
          return NextResponse.json({ success: false, error: 'A user with this email already exists' }, { status: 409 })
        }

        // If rate limited, fall back to generating a link without sending email
        const isRateLimit =
          inviteError.message?.toLowerCase().includes('rate limit') ||
          inviteError.message?.toLowerCase().includes('email') ||
          inviteError.status === 429

        if (!isRateLimit) {
          return NextResponse.json({ success: false, error: inviteError.message }, { status: 400 })
        }

        // Generate invite link silently (no email sent)
        const { data: linkData, error: linkError } = await adminClient.auth.admin.generateLink({
          type: 'invite',
          email,
          options: {
            data: { role, full_name },
            redirectTo: `${siteUrl}/update-password`,
          },
        })

        if (linkError || !linkData) {
          return NextResponse.json({ success: false, error: linkError?.message || 'Failed to generate invite link' }, { status: 400 })
        }

        newUserId = linkData.user?.id
        inviteLink = linkData.properties?.action_link
      } else {
        newUserId = inviteData.user?.id
        emailSent = true
      }
    }

    if (!newUserId) {
      return NextResponse.json({ success: false, error: 'Failed to get user ID after invite' }, { status: 500 })
    }

    // Upsert profile with the correct role
    const { error: profileError } = await adminClient
      .from('profiles')
      .upsert({
        id: newUserId,
        email: email.toLowerCase().trim(),
        full_name: full_name.trim(),
        role,
        is_non_teaching: role === 'teacher' ? !!is_non_teaching : false,
        grade: grade ? parseInt(grade) : null,
        section: section || null,
      })

    if (profileError) {
      // handle_new_user() only ever creates a 'student' row (sign-up metadata
      // is caller-controlled), so the real role exists only if this write lands.
      console.error('Profile upsert failed:', profileError)
      return NextResponse.json(
        { success: false, error: `Account created but profile not saved: ${profileError.message}` },
        { status: 500 },
      )
    }

    // Auto-manage homeroom when a student with grade+section is created
    if (role === 'student' && grade && section) {
      await syncStudentHomeroom(adminClient, newUserId, parseInt(grade), section)
    }

    await logAdminAction(adminClient, request, {
      actorId: callerUser.id, action: 'user.create', targetId: newUserId,
      details: { email: email.toLowerCase().trim(), role, autoConfirm: !!autoConfirm },
    })

    return NextResponse.json({ success: true, userId: newUserId, inviteLink, emailSent, autoConfirm: !!autoConfirm })
  } catch (err) {
    console.error('Create user error:', err)
    return NextResponse.json({ success: false, error: 'Unexpected server error' }, { status: 500 })
  }
}
