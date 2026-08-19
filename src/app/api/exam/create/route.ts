import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { getExamMode } from '@/lib/examScoring'
import type { ExamMode } from '@/lib/examScoring'
import type { CreateExamInput } from '@/lib/exam'

// Creates an exam (and optional audience) server-side with the service role,
// after verifying the caller is authenticated staff. This avoids any
// client-side RLS/session edge cases on the insert path.
// Requires SUPABASE_SERVICE_ROLE_KEY in the environment.

const STAFF = ['teacher', 'coordinator', 'principal', 'admin']

export async function POST(request: NextRequest) {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!serviceRoleKey || !supabaseUrl) {
    return NextResponse.json({ success: false, error: 'Server not configured: SUPABASE_SERVICE_ROLE_KEY missing' }, { status: 500 })
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const authHeader = request.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return NextResponse.json({ success: false, error: 'Unauthorized (no token)' }, { status: 401 })
  }
  const { data: { user }, error: authError } = await admin.auth.getUser(authHeader.slice(7))
  if (authError || !user) {
    return NextResponse.json({ success: false, error: 'Unauthorized (invalid session)' }, { status: 401 })
  }

  // Confirm the caller is staff.
  const { data: profile } = await admin.from('profiles').select('role').eq('id', user.id).single()
  if (!profile || !STAFF.includes(profile.role)) {
    return NextResponse.json({ success: false, error: 'Only staff can create exams' }, { status: 403 })
  }

  const body = await request.json().catch(() => ({}))
  const input = (body.input ?? {}) as CreateExamInput
  const audience = (body.audience ?? null) as { homeroomIds: string[]; userIds: string[] } | null
  if (!input.title || !input.title.trim()) {
    return NextResponse.json({ success: false, error: 'Title is required' }, { status: 400 })
  }

  const examMode = (getExamMode(input.exam_mode).id) as ExamMode

  const { data: exam, error: insErr } = await admin
    .from('exams')
    .insert({
      title: input.title.trim(),
      description: input.description ?? null,
      subject: input.subject ?? null,
      grade: input.grade ?? null,
      duration_minutes: input.duration_minutes ?? null,
      start_at: input.start_at ?? null,
      end_at: input.end_at ?? null,
      due_at: input.due_at ?? null,
      exam_mode: examMode,
      immediate_results: input.immediate_results ?? false,
      auto_close_at: input.auto_close_at ?? null,
      created_by: user.id,
    })
    .select()
    .single()

  if (insErr || !exam) {
    return NextResponse.json({ success: false, error: insErr?.message ?? 'Insert failed' }, { status: 500 })
  }

  // Optional participants.
  if (audience && (audience.homeroomIds?.length || audience.userIds?.length)) {
    const rows = [
      ...(audience.homeroomIds ?? []).map(homeroom_id => ({ exam_id: exam.id, homeroom_id })),
      ...(audience.userIds ?? []).map(user_id => ({ exam_id: exam.id, user_id })),
    ]
    if (rows.length) await admin.from('exam_audiences').insert(rows)
  }

  return NextResponse.json({ success: true, exam })
}
