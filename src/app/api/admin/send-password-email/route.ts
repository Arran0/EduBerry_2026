import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { logAdminAction } from '@/lib/adminAudit'
import { adminClient as makeAdminClient, callerUserId } from '@/lib/serverAuth'
import { isEmailConfigured, resolveSiteUrl, sendAccountEmail } from '@/lib/email/accountEmails'

// Admin action from the student / staff profile managers: email the person a
// one-time link to set (never signed in) or reset their password. The admin
// never sees or chooses the password, unlike /api/admin/reset-password.

export async function POST(request: NextRequest) {
  const adminClient = makeAdminClient()
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!adminClient || !supabaseUrl) {
    return NextResponse.json(
      { success: false, error: 'Server configuration error: SUPABASE_SERVICE_ROLE_KEY not set' },
      { status: 500 },
    )
  }

  const callerId = await callerUserId(adminClient, request)
  if (!callerId) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })

  const { data: callerProfile } = await adminClient
    .from('profiles')
    .select('role')
    .eq('id', callerId)
    .single()
  if (!callerProfile || callerProfile.role !== 'admin') {
    return NextResponse.json({ success: false, error: 'Admin access required' }, { status: 403 })
  }

  const body = await request.json().catch(() => ({}))
  const userId = typeof body.userId === 'string' ? body.userId : ''
  if (!userId) return NextResponse.json({ success: false, error: 'userId is required' }, { status: 400 })

  const { data: target, error: targetError } = await adminClient.auth.admin.getUserById(userId)
  const email = target?.user?.email
  if (targetError || !email) {
    return NextResponse.json({ success: false, error: 'This account has no email address' }, { status: 404 })
  }

  const siteUrl = resolveSiteUrl(request, supabaseUrl)
  const neverSignedIn = !target.user.last_sign_in_at

  if (isEmailConfigured()) {
    const result = await sendAccountEmail(adminClient, {
      email,
      kind: 'recovery',
      template: neverSignedIn ? 'invite' : 'recovery',
      siteUrl,
      recipientName: target.user.user_metadata?.full_name as string | undefined,
    })
    if (!result.sent) {
      return NextResponse.json({ success: false, error: result.error, link: result.actionUrl }, { status: 502 })
    }
  } else {
    // Not set up for Cloudflare yet: Supabase Auth's own mailer, as before.
    const { error } = await adminClient.auth.resetPasswordForEmail(email, { redirectTo: `${siteUrl}/update-password` })
    if (error) return NextResponse.json({ success: false, error: error.message }, { status: 400 })
  }

  await logAdminAction(adminClient, request, {
    actorId: callerId, action: 'user.password_email', targetId: userId,
    details: { setup: neverSignedIn },
  })

  return NextResponse.json({ success: true, email })
}
