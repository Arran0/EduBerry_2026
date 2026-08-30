import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { requireCapability, requireCaller } from '@/lib/fees/serverGuard'
import { auditFeeAction } from '@/lib/fees/audit'

// Issue a receipt for a payment, and read a student's receipt history.
//
// A receipt is a numbered document, not a rendering of a payment row. It gets
// its own table because the number has to be stable and allocated without
// collision — two clerks saving at the same moment must not land on the same
// one — and because cancelling has to leave both the cancellation and the
// replacement on the record. A school that can silently un-issue a receipt does
// not have receipts.
//
// `snapshot` freezes what was printed: the student's name, the fee head, the
// school's name at that moment. A receipt that re-renders from live data would
// change when a student is renamed or a fee head is edited, which is the one
// thing a receipt must never do.

export const runtime = 'nodejs'

interface Body {
  transaction_id?: string
  /** Who handed the money over, when that is not the account holder. */
  paid_by_name?: string
  paid_by_id?: string
}

export async function POST(request: NextRequest) {
  const guard = await requireCapability(request, 'record_payment')
  if (!guard.ok) return guard.response
  const { db, userId } = guard.actor

  let body: Body
  try { body = await request.json() } catch { return bad('Invalid request body') }
  if (!body.transaction_id) return bad('transaction_id is required')

  const { data: txn } = await db
    .from('fee_transactions')
    .select('id, direction, amount, source, fee_id, student_id, family_id, method, occurred_at')
    .eq('id', body.transaction_id)
    .maybeSingle()
  if (!txn) return NextResponse.json({ success: false, error: 'Payment not found' }, { status: 404 })
  if (txn.direction !== 'credit') return bad('Only a payment can be receipted.')

  // One live receipt per payment. A second one for the same money is a
  // duplicate that will eventually be produced twice at an audit.
  const { data: existing } = await db
    .from('fee_receipts')
    .select('id, receipt_no')
    .eq('transaction_id', txn.id)
    .eq('status', 'issued')
    .maybeSingle()
  if (existing) {
    return NextResponse.json({ success: true, already: true, receipt_id: existing.id, receipt_no: existing.receipt_no })
  }

  const snapshot = await buildSnapshot(db, txn)
  const { data: numbered, error: numErr } = await db
    .rpc('next_receipt_no', { p_year: snapshot.academic_year ?? null })
  if (numErr) {
    console.error('receipts: number allocation failed', numErr)
    return NextResponse.json({ success: false, error: 'Could not allocate a receipt number.' }, { status: 500 })
  }

  const { data: receipt, error } = await db.from('fee_receipts').insert({
    receipt_no: numbered as string,
    transaction_id: txn.id,
    source: txn.source,
    fee_id: txn.fee_id,
    student_id: txn.student_id,
    family_id: txn.family_id,
    paid_by_name: body.paid_by_name ?? snapshot.student_name,
    paid_by_id: body.paid_by_id ?? null,
    amount: txn.amount,
    method: txn.method,
    academic_year: snapshot.academic_year,
    issued_by: userId,
    snapshot,
  }).select('id, receipt_no').single()

  if (error) {
    console.error('receipts: insert failed', error)
    return NextResponse.json({ success: false, error: error.message }, { status: 400 })
  }

  await auditFeeAction(db, {
    actorId: userId, action: 'receipt.issue', entityType: 'fee_receipt', entityId: receipt.id,
    studentId: txn.student_id,
    summary: `Issued receipt ${receipt.receipt_no} for ₹${Number(txn.amount).toLocaleString('en-IN')}`,
    after: { receipt_no: receipt.receipt_no, amount: txn.amount },
    request,
  })

  return NextResponse.json({ success: true, receipt_id: receipt.id, receipt_no: receipt.receipt_no })
}

/** A student's receipts. A parent can read their own; staff can read anyone's. */
export async function GET(request: NextRequest) {
  const caller = await requireCaller(request)
  if (!caller.ok) return caller.response
  const { db, userId, role } = caller.actor

  const studentId = new URL(request.url).searchParams.get('student_id') ?? userId
  if (studentId !== userId && role !== 'admin') {
    // A linked payer may read their child's receipts.
    const { data: link } = await db
      .from('fee_family_members').select('family_id').eq('profile_id', userId).eq('role', 'payer')
    const familyIds = (link ?? []).map(l => l.family_id as string)
    const { data: child } = familyIds.length
      ? await db.from('fee_family_members').select('id')
          .eq('profile_id', studentId).eq('role', 'student').in('family_id', familyIds).maybeSingle()
      : { data: null }
    if (!child) return NextResponse.json({ success: false, error: 'Not yours to read' }, { status: 403 })
  }

  const { data, error } = await db
    .from('fee_receipts')
    .select('id, receipt_no, amount, method, academic_year, issued_at, status, cancelled_at, cancel_reason, replaces_id, replaced_by_id, paid_by_name, snapshot')
    .eq('student_id', studentId)
    .order('issued_at', { ascending: false })
    .limit(500)

  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  return NextResponse.json({ success: true, receipts: data ?? [] })
}

interface Txn {
  id: string; amount: number; source: string; fee_id: string | null
  student_id: string | null; family_id: string | null; method: string | null; occurred_at: string
}

/**
 * What the receipt says, frozen at issue. Re-rendering from live data later
 * would change a document somebody has already filed.
 */
async function buildSnapshot(
  db: Parameters<typeof auditFeeAction>[0],
  txn: Txn,
): Promise<Record<string, unknown> & { academic_year: string | null; student_name: string | null }> {
  const [studentRes, feeRes, brandingRes] = await Promise.all([
    txn.student_id
      ? db.from('profiles').select('full_name, email').eq('id', txn.student_id).maybeSingle()
      : Promise.resolve({ data: null }),
    txn.fee_id && txn.source === 'school'
      ? db.from('school_fees')
          .select('description, academic_year, amount, due_date, fee_head:fee_heads!fee_head_id(name)')
          .eq('id', txn.fee_id).maybeSingle()
      : Promise.resolve({ data: null }),
    db.from('site_settings').select('value').eq('key', 'branding').maybeSingle(),
  ])

  const student = studentRes.data as { full_name?: string; email?: string } | null
  const fee = feeRes.data as {
    description?: string; academic_year?: string; amount?: number; due_date?: string
    fee_head?: { name?: string } | { name?: string }[]
  } | null
  const branding = (brandingRes.data?.value ?? {}) as { schoolName?: string; logoUrl?: string }
  const head = Array.isArray(fee?.fee_head) ? fee?.fee_head[0] : fee?.fee_head

  const details = await studentDetails(db, txn.student_id)

  return {
    student_name: student?.full_name ?? null,
    admission_no: details?.admission_no ?? null,
    class_label: details?.class_label ?? null,
    fee_description: fee?.description ?? null,
    fee_head: head?.name ?? null,
    fee_amount: fee?.amount ?? null,
    academic_year: fee?.academic_year ?? null,
    school_name: branding.schoolName ?? 'School',
    school_logo: branding.logoUrl ?? null,
    received_on: txn.occurred_at,
    method: txn.method,
  }
}

async function studentDetails(
  db: Parameters<typeof auditFeeAction>[0],
  studentId: string | null,
): Promise<{ admission_no: string | null; class_label: string | null } | null> {
  if (!studentId) return null
  const [detailsRes, hrRes] = await Promise.all([
    db.from('student_details').select('admission_no').eq('student_id', studentId).maybeSingle(),
    db.from('homeroom_members')
      .select('homeroom:homerooms!homeroom_id(grade, section)')
      .eq('student_id', studentId).limit(1).maybeSingle(),
  ])
  const raw = (hrRes.data as { homeroom?: { grade?: number; section?: string } | { grade?: number; section?: string }[] } | null)?.homeroom
  const hr = Array.isArray(raw) ? raw[0] : raw
  return {
    admission_no: (detailsRes.data as { admission_no?: string } | null)?.admission_no ?? null,
    class_label: hr?.grade ? `${hr.grade}${hr.section ? `-${hr.section}` : ''}` : null,
  }
}

function bad(error: string) {
  return NextResponse.json({ success: false, error }, { status: 400 })
}
