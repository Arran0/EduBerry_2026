import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { logAdminAction } from '@/lib/adminAudit'
import { deleteUserAccountServerSide } from '@/lib/adminAccountDeletion'

/**
 * Converts an existing staff account into a support staff entry: copies the
 * fields support_staff actually has, then removes the account entirely
 * (auth user + profile) via the same procedure "delete user" uses. Support
 * staff never have a login (see supabase-migrations/add_support_staff.sql),
 * so this is a one-way move — there is no "convert back" that would recreate
 * an auth user and an email address nobody supplied.
 *
 * Requires the service role key specifically (unlike delete-user, which can
 * fall back to a profile-only delete): converting to support staff promises
 * the account is gone, and a leftover login would defeat that promise.
 */
export async function POST(request: NextRequest) {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!serviceRoleKey || !supabaseUrl || !anonKey) {
    return NextResponse.json(
      { success: false, error: 'Server configuration error: SUPABASE_SERVICE_ROLE_KEY not set' },
      { status: 500 },
    )
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
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

  const { userId } = await request.json()
  if (!userId) return NextResponse.json({ success: false, error: 'userId is required' }, { status: 400 })

  if (userId === callerUser.id) {
    return NextResponse.json({ success: false, error: 'You cannot convert your own account' }, { status: 400 })
  }

  const [{ data: profile, error: profileError }, { data: details }] = await Promise.all([
    adminClient.from('profiles').select('full_name').eq('id', userId).single(),
    adminClient.from('staff_details').select('*').eq('staff_id', userId).maybeSingle(),
  ])
  if (profileError || !profile) {
    return NextResponse.json({ success: false, error: 'Staff profile not found' }, { status: 404 })
  }

  // Only the fields support_staff actually has — the rest of staff_details
  // (subjects taught, CBSE reg. no, qualifications, EPF/NPS…) describes
  // things a support role doesn't have, so it is deliberately left behind
  // rather than forced into columns that don't fit its meaning.
  const { error: insertError, data: inserted } = await adminClient
    .from('support_staff')
    .insert({
      full_name: profile.full_name,
      employee_id: details?.employee_id ?? null,
      designation: details?.designation ?? null,
      department: details?.department ?? null,
      employment_type: details?.employment_type ?? null,
      date_of_joining: details?.date_of_joining ?? null,
      phone: details?.phone ?? null,
      alternate_phone: details?.alternate_phone ?? null,
      emergency_contact_name: details?.emergency_contact_name ?? null,
      emergency_contact: details?.emergency_contact ?? null,
      address: details?.address ?? null,
      date_of_birth: details?.date_of_birth ?? null,
      gender: details?.gender ?? null,
      blood_group: details?.blood_group ?? null,
      aadhaar_no: details?.aadhaar_no ?? null,
      pan_no: details?.pan_no ?? null,
      bank_account_no: details?.bank_account_no ?? null,
      bank_name: details?.bank_name ?? null,
      ifsc_code: details?.ifsc_code ?? null,
      created_by: callerUser.id,
    })
    .select('id')
    .single()

  if (insertError || !inserted) {
    return NextResponse.json({ success: false, error: insertError?.message || 'Failed to create support staff record' }, { status: 500 })
  }

  const deletion = await deleteUserAccountServerSide(adminClient, userId, callerUser.id, serviceRoleKey)
  if (!deletion.success) {
    // Roll back the insert — a half-done conversion (both the account and a
    // support_staff row existing) would be worse than the conversion simply
    // not happening.
    await adminClient.from('support_staff').delete().eq('id', inserted.id)
    return NextResponse.json({ success: false, error: deletion.error || 'Failed to remove the account' }, { status: 500 })
  }

  await logAdminAction(adminClient, request, {
    actorId: callerUser.id, action: 'user.convert_to_support', targetId: userId,
    details: { supportStaffId: inserted.id },
  })

  return NextResponse.json({ success: true, supportStaffId: inserted.id })
}
