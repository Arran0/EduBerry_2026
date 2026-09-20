import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { requireFeePermission } from '@/lib/fees/serverGuard'

/** Create fee profiles in bulk, with the same preview-then-commit shape. */
export async function POST(request: NextRequest) {
  const guard = await requireFeePermission(request, 'fees.profile.create')
  if (!guard.ok) return guard.response

  let body: { academic_year_id?: string; student_ids?: string[]; fee_group_id?: string; commit?: boolean }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ success: false, error: 'Bad request body' }, { status: 400 })
  }

  if (!body.academic_year_id) {
    return NextResponse.json({ success: false, error: 'Which academic session?' }, { status: 400 })
  }

  const { data, error } = await guard.db.rpc('fee_create_profiles', {
    p_year: body.academic_year_id,
    p_student_ids: body.student_ids ?? null,
    p_group: body.fee_group_id ?? null,
    p_commit: body.commit === true,
  })
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 400 })

  return NextResponse.json({ success: true, ...data })
}
