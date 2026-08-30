import type { NextRequest } from 'next/server'
import { handleBankCredit } from '@/app/api/fees/bank/webhook/route'

// Bank credit reconciliation for BUS fees. Replaces /api/bus/upi/webhook.
//
// Identical in every respect to the school route except which tables it matches
// against, so it delegates rather than repeating the logic — the two copies
// drifting apart is how the school webhook ended up with a UTR idempotency
// guard the bus one never had. See the school route for the full rationale,
// including why a bank-credit ingest survived the removal of the Smart Collect
// initiation flow.
//
// Point your bank's payment-received webhook at POST /api/bus/bank/webhook.
// Registering both this and /api/fees/bank/webhook is fine: each ignores the
// other's references by prefix.

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  return handleBankCredit(request, {
    source: 'bus',
    feeTable: 'bus_fees',
    studentCol: 'passenger_id',
    prefix: 'BUSFEE-',
  })
}
