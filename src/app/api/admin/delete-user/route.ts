import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export async function DELETE(request: NextRequest) {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !anonKey) {
    return NextResponse.json({ success: false, error: 'Supabase not configured' }, { status: 500 })
  }

  // Use service role if available, otherwise fall back to anon key (profile-only deletion)
  const clientKey = serviceRoleKey || anonKey
  const adminClient = createClient(supabaseUrl, clientKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  // Verify caller is an authenticated admin
  const authHeader = request.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }

  // Verify the caller's token using the anon client (works regardless of service role)
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

  const { userId } = await request.json()
  if (!userId) return NextResponse.json({ success: false, error: 'userId is required' }, { status: 400 })

  // Prevent self-deletion
  if (userId === callerUser.id) {
    return NextResponse.json({ success: false, error: 'You cannot delete your own account' }, { status: 400 })
  }

  // Reassign records created by this user to the admin to satisfy NOT NULL
  // foreign key constraints on created_by/user_id columns before profile deletion.
  const reassignTables: { table: string; column: string }[] = [
    { table: 'classrooms', column: 'created_by' },
    { table: 'classroom_folders', column: 'created_by' },
    { table: 'classroom_files', column: 'created_by' },
    { table: 'classroom_assessments', column: 'created_by' },
    { table: 'tasks', column: 'created_by' },
    { table: 'task_comments', column: 'user_id' },
    { table: 'projects', column: 'created_by' },
    { table: 'announcements', column: 'created_by' },
  ]

  for (const { table, column } of reassignTables) {
    const { error } = await adminClient
      .from(table)
      .update({ [column]: callerUser.id })
      .eq(column, userId)
    if (error) {
      console.error(`Failed to reassign ${table}.${column}:`, error.message)
    }
  }

  // Nullify nullable FK references to this profile that have no ON DELETE action.
  // These columns reference profiles without CASCADE or SET NULL, so they must be
  // cleared before the profile row can be deleted.
  const nullifyTables: { table: string; column: string }[] = [
    { table: 'subtasks', column: 'assignee_id' },
    { table: 'subtasks', column: 'created_by' },
    { table: 'teams', column: 'coordinator_id' },
    { table: 'feedbacks', column: 'replied_by' },
  ]

  for (const { table, column } of nullifyTables) {
    const { error } = await adminClient
      .from(table)
      .update({ [column]: null })
      .eq(column, userId)
    if (error) {
      console.error(`Failed to nullify ${table}.${column}:`, error.message)
    }
  }

  // Delete profile row (foreign key constraints are now cleared)
  const { error: profileDeleteError } = await adminClient.from('profiles').delete().eq('id', userId)
  if (profileDeleteError) {
    return NextResponse.json({ success: false, error: `Failed to delete profile: ${profileDeleteError.message}` }, { status: 500 })
  }

  // Delete auth user if service role key is available
  if (serviceRoleKey) {
    const { error } = await adminClient.auth.admin.deleteUser(userId)
    if (error) {
      // Profile is already deleted; auth user removal failed — not critical
      console.error('Auth user deletion failed:', error.message)
    }
  }

  return NextResponse.json({ success: true })
}
