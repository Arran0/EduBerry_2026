import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { logAdminAction } from '@/lib/adminAudit'
import { MIN_PASSWORD_LENGTH } from '@/lib/passwords'

// Provisions (or links) a smart board login account for a homeroom.
// A smart board is an auto-confirmed account with role 'smartboard' that lives
// in exactly one homeroom. It is NEVER added to homeroom_members, so it stays
// out of attendance mark sheets and student leaderboards.
//
// Requires SUPABASE_SERVICE_ROLE_KEY in environment variables.

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

  // Verify the caller is an authenticated admin.
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
  const { homeroomId, email, full_name, password } = body

  if (!homeroomId || !email || !full_name || !password) {
    return NextResponse.json(
      { success: false, error: 'homeroomId, email, full_name, and password are required' },
      { status: 400 }
    )
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return NextResponse.json(
      { success: false, error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` },
      { status: 400 }
    )
  }

  // Confirm the homeroom exists and doesn't already have a board.
  const { data: homeroom, error: hrError } = await adminClient
    .from('homerooms')
    .select('id, name, smartboard_id, grade, section')
    .eq('id', homeroomId)
    .single()

  if (hrError || !homeroom) {
    return NextResponse.json({ success: false, error: 'Homeroom not found' }, { status: 404 })
  }
  if (homeroom.smartboard_id) {
    return NextResponse.json(
      { success: false, error: 'This homeroom already has a smart board account' },
      { status: 409 }
    )
  }

  try {
    // Auto-confirm: a board is a kiosk login, so it never needs an invite email.
    const { data: createData, error: createError } = await adminClient.auth.admin.createUser({
      email: email.toLowerCase().trim(),
      password,
      email_confirm: true,
      user_metadata: { role: 'smartboard', full_name: full_name.trim() },
    })

    if (createError) {
      if (createError.message?.includes('already been registered') || createError.message?.includes('already exists')) {
        return NextResponse.json({ success: false, error: 'A user with this email already exists' }, { status: 409 })
      }
      return NextResponse.json({ success: false, error: createError.message }, { status: 400 })
    }

    const newUserId = createData.user?.id
    if (!newUserId) {
      return NextResponse.json({ success: false, error: 'Failed to create account' }, { status: 500 })
    }

    const { error: profileError } = await adminClient
      .from('profiles')
      .upsert({
        id: newUserId,
        email: email.toLowerCase().trim(),
        full_name: full_name.trim(),
        role: 'smartboard',
        // Inherit the homeroom's grade/section so the board auto-enrols into
        // future classrooms created for that grade/section.
        grade: homeroom.grade ?? null,
        section: homeroom.section ?? null,
      })

    if (profileError) {
      // handle_new_user() creates the row as 'student'; without this write the
      // board would sign in as a student.
      console.error('Smart board profile upsert failed:', profileError)
      return NextResponse.json(
        { success: false, error: `Account created but profile not saved: ${profileError.message}` },
        { status: 500 },
      )
    }

    // Link the board to its homeroom.
    const { error: linkError } = await adminClient
      .from('homerooms')
      .update({ smartboard_id: newUserId })
      .eq('id', homeroomId)

    if (linkError) {
      console.error('Smart board homeroom link failed:', linkError)
      return NextResponse.json({ success: false, error: 'Account created but failed to link homeroom' }, { status: 500 })
    }

    await logAdminAction(adminClient, request, {
      actorId: callerUser.id, action: 'smartboard.create', targetId: newUserId, details: { homeroomId },
    })

    return NextResponse.json({ success: true, userId: newUserId })
  } catch (err) {
    console.error('Create smart board error:', err)
    return NextResponse.json({ success: false, error: 'Unexpected server error' }, { status: 500 })
  }
}

// Unlinks and deletes a homeroom's smart board account.
export async function DELETE(request: NextRequest) {
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
  const { homeroomId } = body
  if (!homeroomId) {
    return NextResponse.json({ success: false, error: 'homeroomId is required' }, { status: 400 })
  }

  const { data: homeroom } = await adminClient
    .from('homerooms')
    .select('smartboard_id')
    .eq('id', homeroomId)
    .single()

  const smartboardId = homeroom?.smartboard_id
  if (!smartboardId) {
    return NextResponse.json({ success: true })
  }

  // Unlink first (ON DELETE SET NULL would also handle this, but be explicit).
  await adminClient.from('homerooms').update({ smartboard_id: null }).eq('id', homeroomId)

  // Remove the account's classroom memberships, then delete the auth user.
  await adminClient.from('classroom_members').delete().eq('user_id', smartboardId)
  const { error: delError } = await adminClient.auth.admin.deleteUser(smartboardId)
  if (delError) {
    console.error('Failed to delete smart board auth user:', delError)
    // Profile may be cleaned up by cascade; report best-effort success.
  }

  await logAdminAction(adminClient, request, {
    actorId: callerUser.id, action: 'smartboard.delete', targetId: smartboardId, details: { homeroomId },
  })

  return NextResponse.json({ success: true })
}
