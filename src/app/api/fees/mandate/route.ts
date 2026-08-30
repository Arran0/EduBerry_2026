import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import Razorpay from 'razorpay'
import { getPaymentSecrets } from '@/lib/serverSecrets'
import { requireCaller, requireFeeAdmin } from '@/lib/fees/serverGuard'
import { auditFeeAction } from '@/lib/fees/audit'

// UPI Autopay / eMandate registration for recurring fees.
//
// ── Status: scaffolding, and deliberately labelled as such ───────────────────
// The route is complete and the schema behind it is real, but the registration
// path CANNOT be verified without live Razorpay credentials — UPI Autopay needs
// a subscription-enabled account and there is no sandbox that mints a real
// mandate. Nothing here has been exercised against a live gateway, and the
// round summary says so rather than implying otherwise.
//
// What is already load-bearing: a successful debit arrives as an ordinary
// payment.captured webhook, so it reconciles through the same idempotent path
// and the same immutable ledger as every other payment. The money side is not
// mandate-specific, which is the point of having built the ledger first.
//
// ── Consent ─────────────────────────────────────────────────────────────────
// A mandate is a standing authorisation over a minor's fees, so:
//   • only the payer or an admin may create one, and the cap is explicit
//   • the payer can always read and cancel it (RLS in fees_v2_mandates.sql)
//   • cancelling is a status change with a reason, never a delete
// max_amount is the ceiling the parent authorised, which is not the amount
// charged. A fee revision within the cap needs no new mandate; one above it
// does — that protection is the whole reason a cap exists.

export const runtime = 'nodejs'

interface CreateBody {
  student_id?: string
  fee_head_id?: string | null
  max_amount?: number
  frequency?: 'monthly' | 'quarterly' | 'term' | 'annual'
  start_date?: string
  end_date?: string | null
}

/** Register a mandate. Returns a Razorpay subscription the parent authorises. */
export async function POST(request: NextRequest) {
  const caller = await requireCaller(request)
  if (!caller.ok) return caller.response
  const { db, userId, role } = caller.actor

  let body: CreateBody
  try { body = await request.json() } catch { return bad('Invalid request body') }

  const studentId = body.student_id
  if (!studentId) return bad('student_id is required')

  // A parent may set up a mandate for their own child; an admin for anyone.
  if (role !== 'admin' && studentId !== userId) {
    const { data: link } = await db
      .from('fee_family_members').select('family_id').eq('profile_id', userId).eq('role', 'payer')
    const familyIds = (link ?? []).map(l => l.family_id as string)
    const { data: child } = familyIds.length
      ? await db.from('fee_family_members').select('id')
          .eq('profile_id', studentId).eq('role', 'student').in('family_id', familyIds).maybeSingle()
      : { data: null }
    if (!child) return NextResponse.json({ success: false, error: 'This is not your child.' }, { status: 403 })
  }

  const maxAmount = Number(body.max_amount)
  if (!Number.isFinite(maxAmount) || maxAmount <= 0) {
    return bad('A mandate needs a maximum amount — the ceiling you are authorising.')
  }
  const frequency = body.frequency ?? 'monthly'
  const startDate = body.start_date ?? new Date().toISOString().slice(0, 10)

  const secrets = await getPaymentSecrets(db, 'razorpay')
  const keyId = process.env.RAZORPAY_KEY_ID ?? await storedKeyId(db)
  if (!keyId || !secrets.key_secret) {
    return NextResponse.json({
      success: false,
      error: 'Auto-pay is not set up. It needs a subscription-enabled Razorpay account — please contact the school office.',
    }, { status: 503 })
  }

  // Reserve the row first, so a gateway call that succeeds but whose response
  // we lose still leaves a record to reconcile against.
  const { data: mandate, error: insertErr } = await db.from('fee_mandates').insert({
    student_id: studentId,
    payer_id: userId,
    fee_head_id: body.fee_head_id ?? null,
    provider: 'razorpay',
    max_amount: maxAmount,
    frequency,
    start_date: startDate,
    end_date: body.end_date ?? null,
    status: 'pending',
    created_by: userId,
  }).select('id').single()

  if (insertErr) {
    if (insertErr.code === '23505') {
      return NextResponse.json(
        { success: false, error: 'An auto-pay authorisation for this fee already exists. Cancel it before creating another.' },
        { status: 409 },
      )
    }
    console.error('mandate: insert failed', insertErr)
    return NextResponse.json({ success: false, error: insertErr.message }, { status: 400 })
  }

  try {
    const razorpay = new Razorpay({ key_id: keyId, key_secret: secrets.key_secret })
    const plan = await razorpay.plans.create({
      period: frequency === 'annual' ? 'yearly' : frequency === 'quarterly' ? 'monthly' : 'monthly',
      interval: frequency === 'quarterly' ? 3 : 1,
      item: {
        name: 'School fees',
        amount: Math.round(maxAmount * 100),
        currency: 'INR',
      },
    })

    const subscription = await razorpay.subscriptions.create({
      plan_id: plan.id,
      // Razorpay requires a bounded count; twelve cycles is a school year for a
      // monthly mandate and is renewed rather than left open-ended.
      total_count: frequency === 'monthly' ? 12 : frequency === 'quarterly' ? 4 : 1,
      customer_notify: 1,
      notes: { mandate_id: mandate.id, student_id: studentId, payer_id: userId },
    })

    await db.from('fee_mandates').update({
      provider_plan_id: plan.id,
      provider_sub_id: subscription.id,
    }).eq('id', mandate.id)

    await auditFeeAction(db, {
      actorId: userId, action: 'mandate.create', entityType: 'fee_family', entityId: mandate.id,
      studentId,
      summary: `Auto-pay authorised up to ₹${maxAmount.toLocaleString('en-IN')} ${frequency}`,
      after: { max_amount: maxAmount, frequency, subscription_id: subscription.id },
      request,
    })

    return NextResponse.json({
      success: true,
      mandate_id: mandate.id,
      subscription_id: subscription.id,
      // The parent completes authorisation here. Until they do, the mandate
      // stays 'pending' and nothing is ever debited.
      authorisation_url: (subscription as unknown as { short_url?: string }).short_url ?? null,
    })
  } catch (e) {
    console.error('mandate: gateway registration failed', e)
    await db.from('fee_mandates').update({
      status: 'failed',
      failure_reason: 'The gateway could not create the auto-pay authorisation.',
    }).eq('id', mandate.id)
    return NextResponse.json({
      success: false,
      error: 'Could not set up auto-pay. This needs a subscription-enabled Razorpay account.',
    }, { status: 502 })
  }
}

/** Cancel a mandate. A parent may always end their own authorisation. */
export async function DELETE(request: NextRequest) {
  const caller = await requireCaller(request)
  if (!caller.ok) return caller.response
  const { db, userId, role } = caller.actor

  const mandateId = new URL(request.url).searchParams.get('id')
  if (!mandateId) return bad('id is required')

  const { data: mandate } = await db
    .from('fee_mandates')
    .select('id, student_id, payer_id, provider_sub_id, status')
    .eq('id', mandateId)
    .maybeSingle()
  if (!mandate) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 })

  if (role !== 'admin' && mandate.payer_id !== userId && mandate.student_id !== userId) {
    return NextResponse.json({ success: false, error: 'This is not your authorisation.' }, { status: 403 })
  }
  if (mandate.status === 'cancelled') return NextResponse.json({ success: true, already: true })

  // Cancel at the gateway first. Marking it cancelled here while the gateway
  // keeps debiting is the one outcome that must not happen.
  if (mandate.provider_sub_id) {
    const secrets = await getPaymentSecrets(db, 'razorpay')
    const keyId = process.env.RAZORPAY_KEY_ID ?? await storedKeyId(db)
    if (keyId && secrets.key_secret) {
      try {
        const razorpay = new Razorpay({ key_id: keyId, key_secret: secrets.key_secret })
        await razorpay.subscriptions.cancel(mandate.provider_sub_id, false)
      } catch (e) {
        console.error('mandate: gateway cancel failed', e)
        return NextResponse.json({
          success: false,
          error: 'Could not cancel the authorisation at the gateway. Please try again — nothing has been changed.',
        }, { status: 502 })
      }
    }
  }

  await db.from('fee_mandates').update({
    status: 'cancelled',
    cancelled_at: new Date().toISOString(),
    cancelled_by: userId,
    cancel_reason: new URL(request.url).searchParams.get('reason') ?? null,
  }).eq('id', mandateId)

  await auditFeeAction(db, {
    actorId: userId, action: 'mandate.cancel', entityType: 'fee_family', entityId: mandateId,
    studentId: mandate.student_id,
    summary: 'Auto-pay authorisation cancelled',
    before: { status: mandate.status }, after: { status: 'cancelled' },
    request,
  })

  return NextResponse.json({ success: true })
}

/** Admin view of every mandate, for the settings screen. */
export async function GET(request: NextRequest) {
  const guard = await requireFeeAdmin(request)
  if (!guard.ok) return guard.response
  const { data, error } = await guard.actor.db
    .from('fee_mandates')
    .select('id, student_id, payer_id, fee_head_id, max_amount, frequency, start_date, end_date, status, authorised_at, last_debit_at, next_debit_on')
    .order('created_at', { ascending: false })
    .limit(500)
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  return NextResponse.json({ success: true, mandates: data ?? [] })
}

async function storedKeyId(db: SupabaseClient): Promise<string | undefined> {
  const { data } = await db.from('site_settings').select('value').eq('key', 'razorpay_config').maybeSingle()
  return (data?.value as { key_id?: string } | null)?.key_id
}

function bad(error: string) {
  return NextResponse.json({ success: false, error }, { status: 400 })
}
