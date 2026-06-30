import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export async function POST(request: NextRequest) {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL

  if (!serviceRoleKey || !supabaseUrl) {
    return NextResponse.json(
      { success: false, error: 'Server configuration error: SUPABASE_SERVICE_ROLE_KEY not set' },
      { status: 500 }
    )
  }

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

  const { data: callerProfile } = await adminClient
    .from('profiles')
    .select('role')
    .eq('id', callerUser.id)
    .single()

  if (!callerProfile || callerProfile.role !== 'admin') {
    return NextResponse.json({ success: false, error: 'Admin access required' }, { status: 403 })
  }

  const body = await request.json()
  const { userId, password } = body

  if (!userId || !password) {
    return NextResponse.json({ success: false, error: 'userId and password are required' }, { status: 400 })
  }

  if (password.length < 6) {
    return NextResponse.json({ success: false, error: 'Password must be at least 6 characters' }, { status: 400 })
  }

  try {
    const { error } = await adminClient.auth.admin.updateUserById(userId, { password })

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 400 })
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('Set password error:', err)
    return NextResponse.json({ success: false, error: 'Unexpected server error' }, { status: 500 })
  }
}
