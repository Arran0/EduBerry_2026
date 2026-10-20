import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { logAdminAction } from '@/lib/adminAudit'

export async function POST(request: NextRequest) {
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

  const { userId, ban } = await request.json()
  if (!userId) return NextResponse.json({ success: false, error: 'userId is required' }, { status: 400 })
  if (typeof ban !== 'boolean') return NextResponse.json({ success: false, error: 'ban must be a boolean' }, { status: 400 })

  if (userId === callerUser.id) {
    return NextResponse.json({ success: false, error: 'You cannot ban your own account' }, { status: 400 })
  }

  const { error: updateError } = await adminClient
    .from('profiles')
    .update({ is_banned: ban, banned_at: ban ? new Date().toISOString() : null })
    .eq('id', userId)
  if (updateError) {
    return NextResponse.json({ success: false, error: updateError.message }, { status: 500 })
  }

  // Block/unblock at the Supabase auth layer so the user cannot sign in while banned.
  // ban_duration '876600h' ≈ 100 years (effectively permanent until unbanned).
  if (serviceRoleKey) {
    const { error: banError } = await adminClient.auth.admin.updateUserById(userId, {
      ban_duration: ban ? '876600h' : 'none',
    })
    if (banError) {
      console.error('Auth ban update failed:', banError.message)
    }
  }

  await logAdminAction(adminClient, request, {
    actorId: callerUser.id, action: ban ? 'user.ban' : 'user.unban', targetId: userId,
  })

  return NextResponse.json({ success: true })
}
