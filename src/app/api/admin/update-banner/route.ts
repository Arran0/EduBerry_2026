import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export async function POST(request: NextRequest) {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL

  if (!serviceRoleKey || !supabaseUrl) {
    return NextResponse.json({ success: false, error: 'Server configuration error' }, { status: 500 })
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  // Verify caller is an authenticated admin
  const authHeader = request.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }
  const token = authHeader.slice(7)
  const { data: { user }, error: authError } = await adminClient.auth.getUser(token)
  if (authError || !user) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }

  const { data: callerProfile } = await adminClient
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (!callerProfile || callerProfile.role !== 'admin') {
    return NextResponse.json({ success: false, error: 'Admin access required' }, { status: 403 })
  }

  // Parse the multipart form — get the file
  const formData = await request.formData()
  const file = formData.get('file') as File | null
  if (!file) {
    return NextResponse.json({ success: false, error: 'No file provided' }, { status: 400 })
  }

  const ext = file.name.split('.').pop() ?? 'jpg'
  const path = `site/profile_banner.${ext}`
  const arrayBuffer = await file.arrayBuffer()
  const buffer = Buffer.from(arrayBuffer)

  // Upload with service role — bypasses storage RLS entirely
  const { error: uploadError } = await adminClient.storage
    .from('classroom-files')
    .upload(path, buffer, {
      contentType: file.type || 'image/jpeg',
      upsert: true,
    })

  if (uploadError) {
    return NextResponse.json({ success: false, error: uploadError.message }, { status: 500 })
  }

  const { data: urlData } = adminClient.storage.from('classroom-files').getPublicUrl(path)
  const url = `${urlData.publicUrl}?t=${Date.now()}`

  // Upsert to site_settings with service role — bypasses table RLS
  const { error: upsertError } = await adminClient
    .from('site_settings')
    .upsert({ key: 'profile_banner', value: url }, { onConflict: 'key' })

  if (upsertError) {
    return NextResponse.json({ success: false, error: upsertError.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, url })
}
