import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Set a school fee's status from the money actually received.
 *
 * SECURITY. Both payment webhooks used to do this instead:
 *
 *   await admin.from('school_fees').update({ status: 'paid' }).eq('id', feeId)
 *
 * — the fee was settled in full by the *arrival* of a payment, whatever it was
 * for. On the Razorpay path that is nearly safe, because the order amount is
 * fixed server-side and the gateway enforces it. On the UPI path it is not:
 * a push payment's amount is chosen by the payer, and the reference that
 * matches it to a bill is printed on the bill itself. A student could pay ₹1
 * against the `SCHFEE-…` reference on their own slip and have a ₹50,000 fee
 * marked paid.
 *
 * `recordOfflinePayment` — the same act, done at the counter — already
 * recomputed from the verified total, so the two paths disagreed about what
 * "paid" means. This is that same rule, in the one place both webhooks call.
 *
 * Takes a service-role client: webhooks have no user session.
 */
export async function settleSchoolFee(
  admin: SupabaseClient,
  feeId: string,
): Promise<'paid' | 'partial' | 'unpaid'> {
  const [{ data: fee }, { data: pays }] = await Promise.all([
    admin.from('school_fees').select('amount').eq('id', feeId).maybeSingle(),
    admin.from('school_fee_payments').select('amount').eq('fee_id', feeId).eq('status', 'verified'),
  ])

  const billed = Number(fee?.amount) || 0
  const paid = (pays ?? []).reduce((s, p) => s + (Number((p as { amount: unknown }).amount) || 0), 0)

  // A fee with nothing billed against it is settled by any payment at all;
  // anything else needs the money to cover it.
  const status = paid <= 0 ? 'unpaid' : paid >= billed ? 'paid' : 'partial'

  await admin.from('school_fees').update({ status }).eq('id', feeId)
  return status
}
