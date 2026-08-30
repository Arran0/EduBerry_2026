import { describe, expect, it, vi, beforeEach } from 'vitest'
import crypto from 'crypto'

// The webhook module is server-only, and its 'server-only' import throws
// outside a server component. Stub it before importing anything downstream.
vi.mock('server-only', () => ({}))

vi.mock('@/lib/serverSecrets', () => ({
  getPaymentSecrets: async () => ({ webhook_secret: TEST_SECRET, key_secret: 'sk_test' }),
}))

const TEST_SECRET = 'whsec_test_only_never_a_real_key'

// ── A fake database ─────────────────────────────────────────────────────────
// Enough of the PostgREST builder to exercise the two things this test exists
// for: the unique constraint on fee_webhook_events.event_id, and the unique
// constraint on fee_transactions.idempotency_key. Both are the real defences,
// so both are modelled as real constraint violations rather than as flags.

interface Row { [k: string]: unknown }

class FakeDb {
  tables: Record<string, Row[]> = {
    fee_webhook_events: [],
    fee_transactions: [],
    school_fee_payments: [],
    school_fees: [],
    bus_fees: [],
    bus_payments: [],
  }
  /** Unique columns per table, enforced on insert. */
  unique: Record<string, string[]> = {
    fee_webhook_events: ['event_id'],
    fee_transactions: ['idempotency_key'],
  }
  rpcCalls: { fn: string; args: unknown }[] = []

  from(table: string) { return new FakeQuery(this, table) }

  async rpc(fn: string, args: Record<string, unknown>) {
    this.rpcCalls.push({ fn, args })
    if (fn === 'apply_ledger_to_school_fee' || fn === 'apply_ledger_to_bus_fee') {
      const source = fn.includes('school') ? 'school' : 'bus'
      const feeTable = source === 'school' ? 'school_fees' : 'bus_fees'
      const fee = this.tables[feeTable].find(f => f.id === args.p_fee)
      if (!fee) return { data: null, error: null }
      const paid = this.paidFor(source, args.p_fee as string)
      const billed = Number(fee.amount) || 0
      const status = paid <= 0 ? 'unpaid' : paid >= billed ? 'paid' : 'partial'
      fee.status = status
      return { data: status, error: null }
    }
    if (fn === 'fee_paid_amount') {
      return { data: this.paidFor(args.p_source as string, args.p_fee as string), error: null }
    }
    return { data: null, error: null }
  }

  paidFor(source: string, feeId: string): number {
    return this.tables.fee_transactions
      .filter(t => t.source === source && t.fee_id === feeId)
      .reduce((s, t) => s + (t.direction === 'credit' ? Number(t.amount) : -Number(t.amount)), 0)
  }
}

class FakeQuery {
  private filters: [string, unknown][] = []
  private pending: Row[] | null = null
  private op: 'select' | 'insert' | 'update' = 'select'
  private patch: Row | null = null

  constructor(private db: FakeDb, private table: string) {}

  select() { return this }
  eq(col: string, val: unknown) { this.filters.push([col, val]); return this }
  neq(col: string, val: unknown) { this.filters.push([`!${col}`, val]); return this }

  insert(rows: Row | Row[]) {
    this.op = 'insert'
    this.pending = Array.isArray(rows) ? rows : [rows]
    return this
  }

  update(patch: Row) { this.op = 'update'; this.patch = patch; return this }

  private matches(r: Row): boolean {
    return this.filters.every(([col, val]) =>
      col.startsWith('!') ? r[col.slice(1)] !== val : r[col] === val,
    )
  }

  private run(): { data: Row[] | null; error: { code: string; message: string } | null } {
    const store = this.db.tables[this.table] ?? (this.db.tables[this.table] = [])

    if (this.op === 'insert') {
      const uniques = this.db.unique[this.table] ?? []
      for (const row of this.pending!) {
        for (const col of uniques) {
          if (row[col] !== undefined && store.some(e => e[col] === row[col])) {
            return { data: null, error: { code: '23505', message: `duplicate key value violates unique constraint on ${col}` } }
          }
        }
      }
      const withIds = this.pending!.map((r, i) => ({ id: r.id ?? `${this.table}-${store.length + i + 1}`, ...r }))
      store.push(...withIds)
      return { data: withIds, error: null }
    }

    if (this.op === 'update') {
      const hit = store.filter(r => this.matches(r))
      for (const r of hit) Object.assign(r, this.patch)
      return { data: hit, error: null }
    }

    return { data: store.filter(r => this.matches(r)), error: null }
  }

  async single() {
    const { data, error } = this.run()
    if (error) return { data: null, error }
    return { data: data?.[0] ?? null, error: data?.length ? null : { code: 'PGRST116', message: 'no rows' } }
  }

  async maybeSingle() {
    const { data, error } = this.run()
    return { data: data?.[0] ?? null, error }
  }

  then(resolve: (v: { data: Row[] | null; error: unknown }) => void) { resolve(this.run()) }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function signedRequest(body: unknown, opts: { eventId?: string; secret?: string } = {}) {
  const raw = JSON.stringify(body)
  const signature = crypto.createHmac('sha256', opts.secret ?? TEST_SECRET).update(raw).digest('hex')
  const headers = new Map<string, string>([['x-razorpay-signature', signature]])
  if (opts.eventId) headers.set('x-razorpay-event-id', opts.eventId)
  return {
    text: async () => raw,
    headers: { get: (k: string) => headers.get(k.toLowerCase()) ?? null },
  } as unknown as import('next/server').NextRequest
}

function capturedEvent(orderId: string, paymentId: string, amountPaise: number) {
  return {
    event: 'payment.captured',
    payload: { payment: { entity: { id: paymentId, order_id: orderId, amount: amountPaise, method: 'upi' } } },
  }
}

async function freshDb() {
  const db = new FakeDb()
  db.tables.school_fees.push({ id: 'fee-1', amount: 10000, status: 'unpaid', student_id: 'stu-1' })
  db.tables.school_fee_payments.push({
    id: 'att-1', fee_id: 'fee-1', status: 'pending', amount: 2000,
    payer_id: 'stu-1', razorpay_order_id: 'order_abc',
  })
  return db
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = any

describe('the webhook edge', () => {
  let mod: typeof import('./webhook')

  beforeEach(async () => {
    vi.resetModules()
    mod = await import('./webhook')
  })

  it('rejects a payload whose signature does not match', async () => {
    const db = await freshDb()
    const req = signedRequest(capturedEvent('order_abc', 'pay_1', 200000), { secret: 'the-wrong-secret' })
    const v = await mod.verifyAndRecordRazorpay(db as AnyDb, req)

    expect(v.ok).toBe(false)
    expect(v.status).toBe(400)
    // Still recorded, and marked unverified — a forged caller is worth a trace.
    expect(db.tables.fee_webhook_events).toHaveLength(1)
    expect(db.tables.fee_webhook_events[0].signature_verified).toBe(false)
  })

  it('records the raw event before doing any work', async () => {
    const db = await freshDb()
    const v = await mod.verifyAndRecordRazorpay(db as AnyDb, signedRequest(capturedEvent('order_abc', 'pay_1', 200000)))

    expect(v.ok).toBe(true)
    expect(db.tables.fee_webhook_events).toHaveLength(1)
    expect(db.tables.fee_webhook_events[0].payload).toBeTruthy()
    // Nothing has been credited yet — recording precedes processing.
    expect(db.tables.fee_transactions).toHaveLength(0)
  })

  it('treats a repeat delivery of the same event id as a duplicate', async () => {
    const db = await freshDb()
    const body = capturedEvent('order_abc', 'pay_1', 200000)

    const first = await mod.verifyAndRecordRazorpay(db as AnyDb, signedRequest(body, { eventId: 'evt_1' }))
    expect(first.duplicate).toBeFalsy()

    const second = await mod.verifyAndRecordRazorpay(db as AnyDb, signedRequest(body, { eventId: 'evt_1' }))
    expect(second.duplicate).toBe(true)
    expect(db.tables.fee_webhook_events).toHaveLength(1)
  })

  it('derives a stable event id when the provider sends none', async () => {
    const body = capturedEvent('order_abc', 'pay_1', 200000)
    const a = mod.deriveEventId('payment.captured', body.payload.payment.entity, JSON.stringify(body))
    const b = mod.deriveEventId('payment.captured', body.payload.payment.entity, JSON.stringify(body))
    expect(a).toBe(b)
    expect(a).toContain('pay_1')
  })

  it('credits once when the same capture is processed twice', async () => {
    const db = await freshDb()
    const body = capturedEvent('order_abc', 'pay_1', 200000)

    for (const _ of [1, 2]) {
      const v = await mod.verifyAndRecordRazorpay(db as AnyDb, signedRequest(body, { eventId: 'evt_1' }))
      if (!v.duplicate) await mod.dispatchRazorpayEvent(db as AnyDb, 'school', v)
    }

    expect(db.tables.fee_transactions).toHaveLength(1)
    expect(db.paidFor('school', 'fee-1')).toBe(2000)
  })

  it('still credits once if the delivery guard is bypassed entirely', async () => {
    // Two different event ids for the same payment — a dashboard replay, or two
    // routes racing. The ledger's own idempotency key is what has to hold here.
    const db = await freshDb()
    const body = capturedEvent('order_abc', 'pay_1', 200000)

    const a = await mod.verifyAndRecordRazorpay(db as AnyDb, signedRequest(body, { eventId: 'evt_1' }))
    await mod.dispatchRazorpayEvent(db as AnyDb, 'school', { ...a, eventId: 'shared' })

    const b = await mod.verifyAndRecordRazorpay(db as AnyDb, signedRequest(body, { eventId: 'evt_2' }))
    await mod.dispatchRazorpayEvent(db as AnyDb, 'school', { ...b, eventId: 'shared' })

    expect(db.tables.fee_webhook_events).toHaveLength(2)
    expect(db.tables.fee_transactions).toHaveLength(1)
  })

  // The defect this whole rewrite exists for.
  it('leaves a part-paid fee on partial, not paid', async () => {
    const db = await freshDb()
    const v = await mod.verifyAndRecordRazorpay(db as AnyDb, signedRequest(capturedEvent('order_abc', 'pay_1', 200000)))
    const result = await mod.dispatchRazorpayEvent(db as AnyDb, 'school', v)

    expect(result.handled).toBe(true)
    expect(db.tables.school_fees[0].status).toBe('partial')
    expect(result.detail.fee_status).toBe('partial')
  })

  it('marks a fee paid once the credits cover it', async () => {
    const db = await freshDb()
    db.tables.school_fee_payments.push({
      id: 'att-2', fee_id: 'fee-1', status: 'pending', amount: 8000,
      payer_id: 'stu-1', razorpay_order_id: 'order_def',
    })

    const first = await mod.verifyAndRecordRazorpay(db as AnyDb, signedRequest(capturedEvent('order_abc', 'pay_1', 200000), { eventId: 'e1' }))
    await mod.dispatchRazorpayEvent(db as AnyDb, 'school', first)
    const second = await mod.verifyAndRecordRazorpay(db as AnyDb, signedRequest(capturedEvent('order_def', 'pay_2', 800000), { eventId: 'e2' }))
    await mod.dispatchRazorpayEvent(db as AnyDb, 'school', second)

    expect(db.tables.school_fees[0].status).toBe('paid')
    expect(db.paidFor('school', 'fee-1')).toBe(10000)
  })

  it('credits the amount the gateway reports, not the amount we expected', async () => {
    const db = await freshDb()
    // The attempt expected ₹2,000; ₹1,500 actually arrived.
    const v = await mod.verifyAndRecordRazorpay(db as AnyDb, signedRequest(capturedEvent('order_abc', 'pay_1', 150000)))
    await mod.dispatchRazorpayEvent(db as AnyDb, 'school', v)

    expect(Number(db.tables.fee_transactions[0].amount)).toBe(1500)
    expect(db.tables.fee_transactions[0].note).toContain('1500')
  })

  it('ignores an order belonging to the other module without erroring', async () => {
    const db = await freshDb()
    const v = await mod.verifyAndRecordRazorpay(db as AnyDb, signedRequest(capturedEvent('order_from_bus', 'pay_9', 500000)))
    const result = await mod.dispatchRazorpayEvent(db as AnyDb, 'school', v)

    expect(result.handled).toBe(false)
    expect(result.detail.ignored).toBe('unknown order')
    expect(db.tables.fee_transactions).toHaveLength(0)
  })

  it('does not un-verify a captured payment when a failure arrives for the same order', async () => {
    const db = await freshDb()
    const captured = await mod.verifyAndRecordRazorpay(db as AnyDb, signedRequest(capturedEvent('order_abc', 'pay_1', 200000), { eventId: 'e1' }))
    await mod.dispatchRazorpayEvent(db as AnyDb, 'school', captured)

    const failedBody = {
      event: 'payment.failed',
      payload: { payment: { entity: { id: 'pay_1', order_id: 'order_abc', error_description: 'declined' } } },
    }
    const failed = await mod.verifyAndRecordRazorpay(db as AnyDb, signedRequest(failedBody, { eventId: 'e2' }))
    const result = await mod.dispatchRazorpayEvent(db as AnyDb, 'school', failed)

    expect(result.detail.ignored).toBe('already verified')
    expect(db.tables.school_fee_payments[0].status).toBe('verified')
    expect(db.tables.school_fees[0].status).toBe('partial')
  })

  it('does not act on order.paid, which arrives alongside payment.captured', async () => {
    const db = await freshDb()
    const body = { event: 'order.paid', payload: { order: { entity: { id: 'order_abc', amount: 200000 } } } }
    const v = await mod.verifyAndRecordRazorpay(db as AnyDb, signedRequest(body))
    const result = await mod.dispatchRazorpayEvent(db as AnyDb, 'school', v)

    expect(result.handled).toBe(false)
    expect(db.tables.fee_transactions).toHaveLength(0)
  })

  it('records a QR payment against the fee named in its notes', async () => {
    const db = await freshDb()
    const body = {
      event: 'qr_code.credited',
      payload: {
        payment: {
          entity: {
            id: 'pay_qr', amount: 350000, method: 'upi',
            notes: { fee_id: 'fee-1', source: 'school', payer_id: 'stu-1' },
            acquirer_data: { rrn: '123456789012' },
          },
        },
      },
    }
    const v = await mod.verifyAndRecordRazorpay(db as AnyDb, signedRequest(body))
    const result = await mod.dispatchRazorpayEvent(db as AnyDb, 'school', v)

    expect(result.handled).toBe(true)
    expect(Number(db.tables.fee_transactions[0].amount)).toBe(3500)
    expect(db.tables.fee_transactions[0].utr).toBe('123456789012')
    expect(db.tables.school_fees[0].status).toBe('partial')
  })

  it('writes a refund as a debit linked to the original credit', async () => {
    const db = await freshDb()
    const captured = await mod.verifyAndRecordRazorpay(db as AnyDb, signedRequest(capturedEvent('order_abc', 'pay_1', 200000), { eventId: 'e1' }))
    await mod.dispatchRazorpayEvent(db as AnyDb, 'school', captured)
    const original = db.tables.fee_transactions[0]

    const refundBody = {
      event: 'refund.processed',
      payload: { refund: { entity: { id: 'rfnd_1', payment_id: 'pay_1', amount: 50000 } } },
    }
    const refund = await mod.verifyAndRecordRazorpay(db as AnyDb, signedRequest(refundBody, { eventId: 'e2' }))
    const result = await mod.dispatchRazorpayEvent(db as AnyDb, 'school', refund)

    expect(result.handled).toBe(true)
    const debit = db.tables.fee_transactions.find(t => t.direction === 'debit')!
    expect(Number(debit.amount)).toBe(500)
    expect(debit.reverses_txn_id).toBe(original.id)
    // ₹2,000 in, ₹500 back out.
    expect(db.paidFor('school', 'fee-1')).toBe(1500)
  })
})
