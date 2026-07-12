import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// profiles only has a self-only UPDATE RLS policy, so admin-driven changes to
// another staff member's flags must go through the service role here — a
// direct client-side update silently affects zero rows instead of erroring.
const ALLOWED_FIELDS = new Set(['attendance_hidden', 'geofence_exempt'])

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

  const { userId, field, value } = await request.json()
  if (!userId) return NextResponse.json({ success: false, error: 'userId is required' }, { status: 400 })
  if (!ALLOWED_FIELDS.has(field)) return NextResponse.json({ success: false, error: 'Invalid field' }, { status: 400 })
  if (typeof value !== 'boolean') return NextResponse.json({ success: false, error: 'value must be a boolean' }, { status: 400 })

  const { error } = await adminClient.from('profiles').update({ [field]: value }).eq('id', userId)
  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
