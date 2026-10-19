'use client'

// ─────────────────────────────────────────────────────────────────────────────
// One bill, and taking money against it.
//
// Opened from a row on the Bills tab and from a bill on a student's fee
// profile. Everything about the bill is here — what it charges, what has come
// in against it and how, what is still owed — and so is the counter: the
// amount is filled in with what this bill still owes, and what is recorded is
// put against this bill, not spread across the family's others.
//
// Cheques are cleared from here too. There is no separate cheque screen: a
// bill paid by cheque shows the cheque, and the cheque's next step is a button
// on it.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  AlertTriangle, Ban, Check, Download, FileText, Loader2, Printer, Receipt, RotateCcw, UserRound,
} from 'lucide-react'
import ModalShell from '@/components/ui/ModalShell'
import { useAcademicYear } from '@/contexts/AcademicYearContext'
import { useFeePermissions } from '@/hooks/useFeePermissions'
import { ADMIN, CHIP, FEE_ICON, fmtDate, inr } from '@/components/fees/ui'
import { Notice, Segmented } from '@/components/fees/shell'
import { DocNo } from '@/components/fees/glass'
import { gradeLabel } from '@/lib/grades'
import { todayIn } from '@/lib/fees/engine/dates'
import { formatPaise, toPaise, toRupees } from '@/lib/fees/engine/money'
import { validatePayment } from '@/lib/fees/engine/allocate'
import { DEFAULT_FEE_SETTINGS, fetchFeeSettings, type PaymentRuleSettings } from '@/lib/fees/settings'
import {
  cancelInvoice, collectPayment, reversePayment, transitionInstrument,
  type CollectResult, type PaymentMethod,
} from '@/lib/fees/invoices'
import {
  MODE_LABEL, billState, fetchBillDetail, modeOf,
  type BillDetail, type BillPayment, type PayState, type Timing,
} from '@/lib/fees/bills'
import { buildInvoice, buildReceipt, printSpec } from '@/components/fees/statements/invoiceGenerate'
import { downloadStatement } from '@/components/fees/statements/generate'

// ── The chips every bill wears ─────────────────────────────────────────────

const PAY_TONE: Record<PayState, string> = {
  unpaid:    'bg-slate-100 text-slate-700',
  partial:   'bg-[#FBF1D6] text-[#7A5D12]',
  paid:      'bg-[#E6F2EA] text-[#1F6B42]',
  carried:   'bg-[#E9EEFA] text-[#3A5490]',
  cancelled: 'bg-zinc-200/80 text-zinc-600',
}
const PAY_TEXT: Record<PayState, string> = {
  unpaid: 'Unpaid', partial: 'Partly paid', paid: 'Paid', carried: 'Carried forward', cancelled: 'Cancelled',
}

export function BillChips({ pay, timing, className = '' }: { pay: PayState; timing: Timing; className?: string }) {
  return (
    <span className={`inline-flex flex-wrap items-center gap-1 ${className}`}>
      <span className={`${CHIP} ${PAY_TONE[pay]}`}>{PAY_TEXT[pay]}</span>
      {timing === 'overdue' && <span className={`${CHIP} bg-[#FBE7E7] text-[#A93232]`}>Overdue</span>}
      {timing === 'late' && <span className={`${CHIP} bg-[#FCEBDD] text-[#93501A]`}>Paid late</span>}
    </span>
  )
}

// ── The sheet ──────────────────────────────────────────────────────────────

export default function BillSheet({
  invoiceId, onClose, onChanged, showProfileLink = true,
}: {
  invoiceId: string
  onClose: () => void
  /** Told whenever money moved or the bill changed. */
  onChanged?: () => void
  /** Off when the sheet is opened from the profile it would link to. */
  showProfileLink?: boolean
}) {
  const { years } = useAcademicYear()
  const perms = useFeePermissions()
  const [detail, setDetail] = useState<BillDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [rules, setRules] = useState<PaymentRuleSettings>(DEFAULT_FEE_SETTINGS.payment_rules)
  const [taken, setTaken] = useState<CollectResult | null>(null)
  const [reversing, setReversing] = useState<BillPayment | null>(null)
  const [bouncing, setBouncing] = useState<BillPayment | null>(null)
  const [cancelling, setCancelling] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)

  const showAmounts = !perms.amountsHidden
  const today = todayIn()

  const load = useCallback(async () => {
    setError(null)
    try {
      const d = await fetchBillDetail(invoiceId)
      setDetail(d)
      if (!d) setError('This bill could not be found.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not open this bill.')
    } finally {
      setLoading(false)
    }
  }, [invoiceId])

  useEffect(() => { void load() }, [load])

  const yearId = detail?.invoice.academic_year_id
  useEffect(() => {
    if (!yearId) return
    fetchFeeSettings(yearId).then(s => setRules(s.payment_rules)).catch(() => undefined)
  }, [yearId])

  const changed = useCallback(async () => {
    await load()
    onChanged?.()
  }, [load, onChanged])

  const yearCode = years.find(y => y.id === yearId)?.code ?? ''

  const state = useMemo(() => {
    if (!detail) return null
    const lastPaid = detail.payments.filter(p => p.status === 'verified')
      .map(p => p.paid_on).sort().at(-1) ?? null
    return billState(detail.invoice, detail.lines, lastPaid, today)
  }, [detail, today])

  const printReceipt = async (p: BillPayment, thermal: boolean) => {
    if (!detail || !p.receipt_no) return
    setBusy(`${thermal ? 'print' : 'pdf'}-${p.id}`)
    try {
      const spec = await buildReceipt({
        receipt_no: p.receipt_no, paid_on: p.paid_on, method: p.method, amount: p.amount ?? 0,
        reference: p.reference, status: p.status, against: p.against,
        verify_token: p.receipt_hash ?? p.id,
      }, detail.student, yearCode, thermal)
      if (thermal) await printSpec(spec); else await downloadStatement(spec)
    } finally {
      setBusy(null)
    }
  }

  const downloadBill = async () => {
    if (!detail) return
    const inv = detail.invoice
    setBusy('bill')
    try {
      const spec = await buildInvoice({
        number: inv.number, issue_date: inv.issue_date, due_date: inv.due_date,
        gross: inv.gross ?? 0, discount_total: inv.discount_total ?? 0,
        late_fee_total: inv.late_fee_total ?? 0, fine_total: inv.fine_total ?? 0,
        net: inv.net ?? 0, paid: inv.paid ?? 0, balance: inv.balance ?? 0,
        status: inv.status,
        lines: detail.lines.map(l => ({ label: l.label, amount: l.amount, kind: l.kind })),
        verify_token: inv.verify_token,
      }, detail.student, yearCode)
      await downloadStatement(spec)
    } finally {
      setBusy(null)
    }
  }

  const moveCheque = async (p: BillPayment, to: 'deposited' | 'cleared') => {
    if (!p.instrument) return
    setBusy(`chq-${p.id}`)
    setError(null)
    try {
      await transitionInstrument(p.instrument.id, to)
      await changed()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update that cheque.')
    } finally {
      setBusy(null)
    }
  }

  const inv = detail?.invoice
  const student = detail?.student
  const livePayments = detail?.payments.filter(p => p.status !== 'reversed' && p.status !== 'failed') ?? []
  const canCollect = perms.can('fees.collect') && !!state && (state.pay === 'unpaid' || state.pay === 'partial')
  const canCancel = perms.can('fees.invoice.cancel') && !!inv && !!state
    && state.pay !== 'cancelled' && state.pay !== 'carried' && livePayments.length === 0

  const subtitle = student
    ? [student.full_name,
       student.grade === null ? null : `${gradeLabel(student.grade)}${student.section ? ` ${student.section}` : ''}`,
       student.admission_no ? `Adm. ${student.admission_no}` : null].filter(Boolean).join(' · ')
    : undefined

  return (
    <>
      <ModalShell
        onClose={onClose}
        sharp
        size="xl"
        title={inv?.number ?? 'Bill'}
        subtitle={subtitle}
        icon={<Receipt size={17} />}
        iconClassName={FEE_ICON}
        minHClass="sm:min-h-[30rem]"
        bodyClassName="!px-0 !py-0"
      >
        {loading ? (
          <div className="py-20 flex justify-center"><Loader2 className="animate-spin text-slate-400" /></div>
        ) : !detail || !inv || !state ? (
          <div className="p-4"><Notice tone="error">{error ?? 'This bill could not be opened.'}</Notice></div>
        ) : (
          <div className="divide-y divide-[#EEEAE1]">
            {/* ── Where the bill stands ─────────────────────────────────── */}
            <div className="px-4 sm:px-5 py-4 flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
              <div className="min-w-0 space-y-1.5">
                <BillChips pay={state.pay} timing={state.timing} />
                <p className="text-[13px] text-slate-600 leading-snug">
                  Due {fmtDate(inv.due_date)}
                  <span className="text-slate-400"> · </span>
                  issued {fmtDate(inv.issue_date)}
                </p>
                {inv.cancelled_reason && (
                  <p className="text-[12.5px] text-[#962C2C] leading-snug">Cancelled: {inv.cancelled_reason}</p>
                )}
              </div>
              <div className="text-right">
                <p className="text-[12px] text-slate-500">
                  {state.pay === 'paid' ? 'Paid in full'
                    : state.pay === 'carried' ? 'Moved to the next session'
                    : state.pay === 'cancelled' ? 'Billed' : 'Still owed'}
                </p>
                <p className={`font-display text-[1.75rem] leading-tight font-bold tabular-nums ${
                  state.pay === 'cancelled' ? 'text-slate-400 line-through' : state.timing === 'overdue' ? 'text-[#A93232]' : 'text-slate-900'}`}>
                  {inr(state.pay === 'paid' || state.pay === 'cancelled' || state.pay === 'carried' ? inv.net : inv.balance, showAmounts)}
                </p>
              </div>
            </div>

            {error && <div className="px-4 sm:px-5 pt-3"><Notice tone="error">{error}</Notice></div>}

            {/* ── What it charges ───────────────────────────────────────── */}
            <section className="px-4 sm:px-5 py-3.5">
              <h3 className="text-[13px] font-semibold text-slate-900 mb-1.5">Charges</h3>
              <div className="divide-y divide-[#F2EEE6]">
                {detail.lines.map(l => (
                  <div key={l.id} className="flex items-baseline justify-between gap-3 py-1.5">
                    <span className={`text-[13px] leading-snug break-words min-w-0 ${l.amount < 0 ? 'text-[#1F6B42]' : 'text-slate-700'}`}>
                      {l.label}
                    </span>
                    <span className={`text-[13px] tabular-nums flex-shrink-0 ${l.amount < 0 ? 'text-[#1F6B42]' : 'text-slate-900'}`}>
                      {l.amount < 0 && showAmounts ? '−' : ''}{inr(Math.abs(l.amount), showAmounts)}
                    </span>
                  </div>
                ))}
              </div>
              <dl className="mt-2.5 grid grid-cols-3 border border-[#EEEAE1] divide-x divide-[#EEEAE1] bg-[#FBFAF6]">
                {[
                  { label: 'Billed', value: inv.net, tone: 'text-slate-900' },
                  { label: 'Received', value: inv.paid, tone: 'text-[#1F6B42]' },
                  { label: 'Owing', value: inv.balance, tone: (inv.balance ?? 0) > 0 && state.pay !== 'cancelled' ? 'text-[#8A6A12]' : 'text-slate-900' },
                ].map(x => (
                  <div key={x.label} className="px-2.5 sm:px-3 py-2 min-w-0">
                    <dt className="text-[11.5px] text-slate-500">{x.label}</dt>
                    <dd className={`text-[14px] sm:text-[15px] font-bold tabular-nums leading-tight break-words ${x.tone}`}>
                      {state.pay === 'cancelled' && x.label === 'Owing' ? '—' : inr(x.value, showAmounts)}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>

            {/* ── What came in ──────────────────────────────────────────── */}
            {detail.payments.length > 0 && (
              <section className="px-4 sm:px-5 py-3.5">
                <h3 className="text-[13px] font-semibold text-slate-900 mb-1">Payments</h3>
                <div className="divide-y divide-[#F2EEE6]">
                  {detail.payments.map(p => (
                    <PaymentLine
                      key={p.id} p={p} showAmounts={showAmounts} busy={busy}
                      canPrint={perms.can('fees.receipt.print')}
                      canReverse={perms.can('fees.payment.reverse')}
                      canCheque={perms.can('fees.instrument.manage')}
                      onPrint={thermal => void printReceipt(p, thermal)}
                      onReverse={() => setReversing(p)}
                      onCheque={to => to === 'bounced' ? setBouncing(p) : void moveCheque(p, to)}
                    />
                  ))}
                </div>
              </section>
            )}

            {/* ── Taking money ──────────────────────────────────────────── */}
            {taken ? (
              <TakenPanel
                result={taken}
                showAmounts={showAmounts}
                onPrint={thermal => {
                  const p = detail.payments.find(x => x.id === taken.payment_id)
                  if (p) void printReceipt(p, thermal)
                }}
                onDone={() => setTaken(null)}
              />
            ) : canCollect ? (
              <RecordPayment
                key={`${inv.id}-${inv.balance}`}
                invoiceId={inv.id}
                studentId={inv.student_id}
                yearId={inv.academic_year_id}
                balance={inv.balance}
                rules={rules}
                today={today}
                canBackdate={perms.can('fees.collect.backdate')}
                showAmounts={showAmounts}
                onTaken={async result => { setTaken(result); await changed() }}
              />
            ) : null}

            {/* ── The bill itself ───────────────────────────────────────── */}
            <div className="px-4 sm:px-5 py-3 flex flex-wrap items-center gap-2">
              <button onClick={() => void downloadBill()} disabled={busy === 'bill'} className={ADMIN.ghostBtn}>
                {busy === 'bill' ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />} Download bill
              </button>
              {showProfileLink && student && (
                <Link href={`/more/fees/students/${student.id}`} className={ADMIN.ghostBtn}>
                  <UserRound size={14} /> Fee profile
                </Link>
              )}
              {canCancel && (
                <button onClick={() => setCancelling(true)}
                        className={`${ADMIN.ghostBtn} sm:ml-auto hover:!text-[#A93232] hover:!border-[#EFC8C8]`}>
                  <Ban size={14} /> Cancel bill
                </button>
              )}
            </div>
          </div>
        )}
      </ModalShell>

      {reversing && (
        <ReasonDialog
          title="Reverse this payment"
          warning={`${reversing.receipt_no ?? 'This receipt'} for ${inr(reversing.amount, showAmounts)} will be marked reversed. The bills it paid reopen, and the receipt's QR will say it was cancelled. Nothing is deleted.`}
          question="Why is it being reversed?"
          placeholder="Cash did not tally at the end of the day"
          action="Reverse payment"
          icon={<RotateCcw size={14} />}
          onClose={() => setReversing(null)}
          onSubmit={async reason => { await reversePayment(reversing.id, reason); setReversing(null); await changed() }}
        />
      )}

      {cancelling && inv && (
        <ReasonDialog
          title={`Cancel ${inv.number}`}
          warning={`This bill for ${inr(inv.net, showAmounts)} stops counting towards what the family owes. It is kept, not deleted, and its QR will say it was cancelled.`}
          question="Why?"
          placeholder="Issued in error — the student had already left"
          action="Cancel the bill"
          icon={<Ban size={14} />}
          onClose={() => setCancelling(false)}
          onSubmit={async reason => { await cancelInvoice(inv.id, reason); setCancelling(false); await changed() }}
        />
      )}

      {bouncing?.instrument && (
        <BounceDialog
          payment={bouncing}
          showAmounts={showAmounts}
          onClose={() => setBouncing(null)}
          onSubmit={async (note, charge) => {
            await transitionInstrument(bouncing.instrument!.id, 'bounced', note, charge)
            setBouncing(null)
            await changed()
          }}
        />
      )}
    </>
  )
}

// ── A payment against the bill ────────────────────────────────────────────

const INSTRUMENT_TEXT: Record<string, string> = {
  received: 'Cheque in hand', deposited: 'At the bank', cleared: 'Cleared', bounced: 'Bounced', cancelled: 'Cancelled',
}

function PaymentLine({
  p, showAmounts, busy, canPrint, canReverse, canCheque, onPrint, onReverse, onCheque,
}: {
  p: BillPayment
  showAmounts: boolean
  busy: string | null
  canPrint: boolean
  canReverse: boolean
  canCheque: boolean
  onPrint: (thermal: boolean) => void
  onReverse: () => void
  onCheque: (to: 'deposited' | 'cleared' | 'bounced') => void
}) {
  const reversed = p.status === 'reversed'
  const ins = p.instrument
  const split = p.amount !== null && Math.abs((p.amount ?? 0) - p.allocated) > 0.009
  const chequeOpen = ins && (ins.status === 'received' || ins.status === 'deposited')
  return (
    <div className="py-2.5">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5">
        <div className="min-w-0 flex-1 basis-[180px]">
          <p className="text-[13px] font-semibold text-slate-900 break-words">
            {p.receipt_no ? <DocNo value={p.receipt_no} /> : 'Receipt pending'}
          </p>
          <p className="text-[12px] text-slate-500 leading-snug break-words">
            {fmtDate(p.paid_on)} · {MODE_LABEL[modeOf(p.method)]}
            {ins ? ` ${ins.number}${ins.bank ? `, ${ins.bank}` : ''}` : ''}
            {p.reference ? ` · ${p.reference}` : ''}
          </p>
          <span className="mt-1 inline-flex flex-wrap gap-1">
            {reversed && <span className={`${CHIP} bg-[#FBE7E7] text-[#A93232]`}>Reversed</span>}
            {ins && <span className={`${CHIP} ${ins.status === 'cleared' ? 'bg-[#E6F2EA] text-[#1F6B42]'
              : ins.status === 'bounced' ? 'bg-[#FBE7E7] text-[#A93232]' : 'bg-[#FBF1D6] text-[#7A5D12]'}`}>
              {INSTRUMENT_TEXT[ins.status] ?? ins.status}
              {ins.is_postdated && ins.present_on && ins.status === 'received' ? ` · present ${fmtDate(ins.present_on)}` : ''}
            </span>}
          </span>
          {p.reversal_reason && <p className="text-[12px] text-[#962C2C] mt-1">Reversed: {p.reversal_reason}</p>}
        </div>
        <div className="text-right">
          <p className={`text-[14px] font-bold tabular-nums ${reversed ? 'text-slate-400 line-through' : 'text-slate-900'}`}>
            {inr(p.allocated, showAmounts)}
          </p>
          {split && showAmounts && (
            <p className="text-[11.5px] text-slate-500">of {inr(p.amount, true)} received</p>
          )}
        </div>
      </div>

      {(canPrint || (canReverse && p.status === 'verified') || (canCheque && chequeOpen)) && !reversed && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {canPrint && p.receipt_no && (
            <>
              <button onClick={() => onPrint(true)} disabled={busy === `print-${p.id}`} className={`${ADMIN.ghostBtn} !h-7 !px-2.5 !text-[12px]`}>
                {busy === `print-${p.id}` ? <Loader2 size={13} className="animate-spin" /> : <Printer size={13} />} Print
              </button>
              <button onClick={() => onPrint(false)} disabled={busy === `pdf-${p.id}`} className={`${ADMIN.ghostBtn} !h-7 !px-2.5 !text-[12px]`}>
                {busy === `pdf-${p.id}` ? <Loader2 size={13} className="animate-spin" /> : <FileText size={13} />} A4 receipt
              </button>
            </>
          )}
          {canCheque && chequeOpen && (
            busy === `chq-${p.id}` ? <Loader2 size={14} className="animate-spin text-slate-400 mx-2" /> : (
              <>
                {ins!.status === 'received' && (
                  <button onClick={() => onCheque('deposited')} className={`${ADMIN.ghostBtn} !h-7 !px-2.5 !text-[12px]`}>Deposited</button>
                )}
                <button onClick={() => onCheque('cleared')} className={`${ADMIN.darkBtn} !h-7 !px-2.5 !text-[12px]`}>
                  <Check size={13} /> Cleared
                </button>
                <button onClick={() => onCheque('bounced')}
                        className={`${ADMIN.ghostBtn} !h-7 !px-2.5 !text-[12px] hover:!text-[#A93232]`}>Bounced</button>
              </>
            )
          )}
          {canReverse && p.status === 'verified' && (
            <button onClick={onReverse}
                    className={`${ADMIN.ghostBtn} !h-7 !px-2.5 !text-[12px] sm:ml-auto hover:!text-[#A93232] hover:!border-[#EFC8C8]`}>
              <RotateCcw size={13} /> Reverse
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ── Recording a payment ───────────────────────────────────────────────────

type ModeKey = 'cash' | 'upi' | 'cheque' | 'bank_transfer' | 'other'

const MODE_OPTIONS: { key: ModeKey; label: string }[] = [
  { key: 'cash', label: 'Cash' },
  { key: 'upi', label: 'UPI' },
  { key: 'cheque', label: 'Cheque' },
  { key: 'bank_transfer', label: 'Bank transfer' },
  { key: 'other', label: 'Other' },
]

function RecordPayment({
  invoiceId, studentId, yearId, balance, rules, today, canBackdate, showAmounts, onTaken,
}: {
  invoiceId: string
  studentId: string
  yearId: string
  /** null when amounts are hidden from this account. */
  balance: number | null
  rules: PaymentRuleSettings
  today: string
  canBackdate: boolean
  showAmounts: boolean
  onTaken: (r: CollectResult) => void | Promise<void>
}) {
  const [amount, setAmount] = useState(balance !== null && showAmounts ? String(balance) : '')
  const [mode, setMode] = useState<ModeKey>('cash')
  const [instrumentKind, setInstrumentKind] = useState<'cheque' | 'dd'>('cheque')
  const [other, setOther] = useState<'card' | 'wallet'>('card')
  const [paidOn, setPaidOn] = useState(today)
  const [reference, setReference] = useState('')
  const [notes, setNotes] = useState('')
  const [cheque, setCheque] = useState({ number: '', bank: '', instrument_date: today, is_postdated: false, present_on: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const method: PaymentMethod = mode === 'cheque' ? instrumentKind : mode === 'other' ? other : mode
  const entered = toPaise(Number(amount) || 0)
  const owed = balance === null ? null : toPaise(balance)

  const validation = useMemo(() => validatePayment(entered, owed ?? entered, {
    partialAllowed: rules.partial_allowed,
    minPartialAmount: toPaise(rules.min_partial_amount),
    allowOverpayment: rules.allow_overpayment,
    allowBackdatedDays: rules.allow_backdated_days,
  }, { paidOn, today, canBackdate }), [entered, owed, rules, paidOn, today, canBackdate])

  const needsInstrument = mode === 'cheque'
  const ready = validation.ok && entered > 0 && (!needsInstrument || cheque.number.trim().length > 0)
  const extra = owed !== null && entered > owed ? entered - owed : 0

  const submit = async () => {
    setBusy(true); setError(null)
    try {
      const rupees = toRupees(entered)
      const result = await collectPayment({
        student_id: studentId,
        academic_year_id: yearId,
        amount: rupees,
        method,
        // Against this bill, never more than it owes. Anything over becomes a
        // credit (the database does that). Without a visible balance the
        // database splits it the usual way.
        allocations: balance === null ? undefined : [{ invoice_id: invoiceId, amount: Math.min(rupees, balance) }],
        paid_on: paidOn === today ? undefined : paidOn,
        reference: reference.trim() || undefined,
        notes: notes.trim() || undefined,
        instrument: needsInstrument ? {
          kind: instrumentKind,
          number: cheque.number.trim(),
          bank: cheque.bank.trim() || undefined,
          instrument_date: cheque.instrument_date || undefined,
          is_postdated: cheque.is_postdated,
          present_on: cheque.is_postdated ? (cheque.present_on || undefined) : undefined,
        } : null,
      })
      await onTaken(result)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That payment was not recorded.')
    } finally {
      setBusy(false)
    }
  }

  const field = 'block'
  const label = 'block text-[12px] font-medium text-slate-500 mb-1'

  return (
    <section className="px-4 sm:px-5 py-4 bg-[#FBFAF6]">
      <h3 className="text-[13px] font-semibold text-slate-900">Record a payment</h3>
      <p className="text-[12px] text-slate-500 mb-3">Put against this bill. The receipt is numbered the moment it is saved.</p>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className={field}>
          <span className={label}>Amount (₹)</span>
          <input type="number" inputMode="decimal" min={0} value={amount} onChange={e => setAmount(e.target.value)}
                 className={`${ADMIN.inputPlain} !text-[16px] font-semibold tabular-nums`} />
        </label>
        <label className={field}>
          <span className={label}>Received on</span>
          <input type="date" value={paidOn} max={today} disabled={!canBackdate}
                 onChange={e => setPaidOn(e.target.value)} className={ADMIN.inputPlain} />
        </label>
        <div className="sm:col-span-2">
          <span className={label}>Paid by</span>
          {/* A grid of capsules rather than one switch, so five choices still
              read in full on the narrowest phone. */}
          <div role="radiogroup" aria-label="Paid by" className="grid grid-cols-3 sm:grid-cols-5 gap-1.5">
            {MODE_OPTIONS.map(o => {
              const on = o.key === mode
              return (
                <button key={o.key} type="button" role="radio" aria-checked={on} onClick={() => setMode(o.key)}
                        className={`h-9 rounded-full px-2 text-[12.5px] font-semibold whitespace-nowrap transition active:scale-[0.97] ${
                          on ? 'text-white bg-gradient-to-b from-[#3D3B40] to-[#27272A] shadow-[inset_0_1px_0_rgba(255,255,255,.16)]'
                             : 'bg-white border border-[#E2DDD2] text-slate-700 hover:border-[#CFC8B8]'}`}>
                  {o.key === 'bank_transfer'
                    ? <><span className="min-[400px]:hidden">Bank</span><span className="max-[399px]:hidden">{o.label}</span></>
                    : o.label}
                </button>
              )
            })}
          </div>
        </div>

        {mode === 'cheque' && (
          <>
            <div className="sm:col-span-2">
              <Segmented<'cheque' | 'dd'> size="sm" value={instrumentKind} onChange={setInstrumentKind}
                options={[{ key: 'cheque', label: 'Cheque' }, { key: 'dd', label: 'Demand draft' }]} />
            </div>
            <label className={field}>
              <span className={label}>{instrumentKind === 'dd' ? 'Draft number' : 'Cheque number'}</span>
              <input value={cheque.number} onChange={e => setCheque({ ...cheque, number: e.target.value })}
                     className={ADMIN.inputPlain} inputMode="numeric" />
            </label>
            <label className={field}>
              <span className={label}>Bank</span>
              <input value={cheque.bank} onChange={e => setCheque({ ...cheque, bank: e.target.value })}
                     className={ADMIN.inputPlain} />
            </label>
            <label className={field}>
              <span className={label}>Dated</span>
              <input type="date" value={cheque.instrument_date}
                     onChange={e => setCheque({ ...cheque, instrument_date: e.target.value })} className={ADMIN.inputPlain} />
            </label>
            <label className={`${field} flex items-end`}>
              <span className="flex items-center gap-2.5 h-9">
                <input type="checkbox" checked={cheque.is_postdated}
                       onChange={e => setCheque({ ...cheque, is_postdated: e.target.checked })}
                       className="w-4 h-4 accent-[#27272A]" />
                <span className="text-[13px] text-slate-700">Post-dated — present it later</span>
              </span>
            </label>
            {cheque.is_postdated && (
              <label className={`${field} sm:col-span-2`}>
                <span className={label}>Present on</span>
                <input type="date" value={cheque.present_on}
                       onChange={e => setCheque({ ...cheque, present_on: e.target.value })}
                       className={`${ADMIN.inputPlain} sm:max-w-[220px]`} />
                <span className="block text-[12px] text-[#7A5D12] mt-1">
                  The bill stays unpaid until the cheque clears. The receipt says so if anyone scans it.
                </span>
              </label>
            )}
          </>
        )}

        {mode === 'other' && (
          <label className={field}>
            <span className={label}>Method</span>
            <select value={other} onChange={e => setOther(e.target.value as 'card' | 'wallet')} className={ADMIN.inputPlain}>
              <option value="card">Card</option>
              <option value="wallet">Wallet</option>
            </select>
          </label>
        )}

        {mode !== 'cash' && (
          <label className={`${field} ${mode === 'other' ? '' : 'sm:col-span-2'}`}>
            <span className={label}>Reference</span>
            <input value={reference} onChange={e => setReference(e.target.value)}
                   placeholder={mode === 'upi' ? 'UPI transaction ID' : mode === 'bank_transfer' ? 'UTR number' : 'Slip or transaction ID'}
                   className={ADMIN.inputPlain} />
          </label>
        )}

        <label className={`${field} sm:col-span-2`}>
          <span className={label}>Note</span>
          <input value={notes} onChange={e => setNotes(e.target.value)} className={ADMIN.inputPlain} />
        </label>
      </div>

      {!canBackdate && (
        <p className="text-[12px] text-slate-500 mt-2">Changing the date needs the backdating permission.</p>
      )}
      {!validation.ok && entered > 0 && (
        <p className="mt-3 text-[12.5px] text-[#962C2C] flex items-start gap-1.5">
          <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" /> {validation.reason}
        </p>
      )}
      {validation.ok && extra > 0 && (
        <p className="mt-3 text-[12.5px] text-[#7A5D12]">
          {formatPaise(extra)} more than this bill owes — kept as a credit for the student&rsquo;s next bill.
        </p>
      )}
      {error && <p className="mt-3 text-[12.5px] text-[#962C2C]">{error}</p>}

      <button onClick={() => void submit()} disabled={busy || !ready} className={`${ADMIN.goldBtn} mt-4 w-full sm:w-auto !h-10 !px-5 !text-[13.5px]`}>
        {busy ? <Loader2 size={15} className="animate-spin" /> : <Receipt size={15} />}
        {busy ? 'Recording' : `Record ${entered > 0 && showAmounts ? formatPaise(entered) : 'payment'}`}
      </button>
    </section>
  )
}

function TakenPanel({ result, showAmounts, onPrint, onDone }: {
  result: CollectResult
  showAmounts: boolean
  onPrint: (thermal: boolean) => void
  onDone: () => void
}) {
  return (
    <section className="px-4 sm:px-5 py-5 bg-[#F1F8F3] text-center">
      <div className="w-11 h-11 mx-auto rounded-full bg-white border border-[#C6E3D2] flex items-center justify-center">
        <Check size={20} className="text-[#1F6B42]" />
      </div>
      <p className="mt-2 text-[13px] text-slate-600">Payment recorded</p>
      <p className="text-[17px] font-bold text-slate-900 break-words">{result.receipt_no}</p>
      {result.status === 'pending' && (
        <p className="text-[12.5px] text-[#7A5D12] mt-1.5 max-w-sm mx-auto">
          Held against an uncleared cheque. The bill stays open until it clears.
        </p>
      )}
      {showAmounts && result.credited > 0 && (
        <p className="text-[12.5px] text-slate-600 mt-1.5">{inr(result.credited)} kept as a credit for the next bill.</p>
      )}
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        <button onClick={() => onPrint(true)} className={ADMIN.darkBtn}><Printer size={14} /> Print receipt</button>
        <button onClick={() => onPrint(false)} className={ADMIN.ghostBtn}><FileText size={14} /> A4 receipt</button>
        <button onClick={onDone} className={ADMIN.ghostBtn}>Done</button>
      </div>
    </section>
  )
}

// ── Confirmations ─────────────────────────────────────────────────────────

function ReasonDialog({
  title, warning, question, placeholder, action, icon, onClose, onSubmit,
}: {
  title: string
  warning: string
  question: string
  placeholder: string
  action: string
  icon: React.ReactNode
  onClose: () => void
  onSubmit: (reason: string) => Promise<void>
}) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const go = async () => {
    setBusy(true); setError(null)
    try { await onSubmit(reason.trim()) }
    catch (e) { setError(e instanceof Error ? e.message : 'That did not work.') }
    finally { setBusy(false) }
  }

  return (
    <ModalShell onClose={onClose} sharp size="md" title={title} icon={icon} iconClassName={FEE_ICON} zClass="z-[60]">
      <div className="space-y-3.5">
        <Notice tone="warn">{warning}</Notice>
        <label className="block">
          <span className="block text-[12px] font-medium text-slate-500 mb-1">{question}</span>
          <textarea value={reason} onChange={e => setReason(e.target.value)} rows={3} autoFocus
                    placeholder={placeholder} className={`${ADMIN.inputPlain} resize-none`} />
          <span className="block text-[12px] text-slate-500 mt-1">Kept on the record with your name and the time.</span>
        </label>
        {error && <Notice tone="error">{error}</Notice>}
        <div className="flex flex-wrap justify-end gap-2">
          <button onClick={onClose} className={ADMIN.ghostBtn}>Keep it</button>
          <button onClick={() => void go()} disabled={busy || reason.trim().length < 3} className={ADMIN.darkBtn}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : icon} {action}
          </button>
        </div>
      </div>
    </ModalShell>
  )
}

function BounceDialog({ payment, showAmounts, onClose, onSubmit }: {
  payment: BillPayment
  showAmounts: boolean
  onClose: () => void
  onSubmit: (note: string, charge: number) => Promise<void>
}) {
  const [note, setNote] = useState('')
  const [charge, setCharge] = useState('0')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const go = async () => {
    setBusy(true); setError(null)
    try { await onSubmit(note.trim(), Number(charge) || 0) }
    catch (e) { setError(e instanceof Error ? e.message : 'That did not work.') }
    finally { setBusy(false) }
  }

  return (
    <ModalShell onClose={onClose} sharp size="md" title="Cheque bounced" icon={<AlertTriangle size={16} />}
                iconClassName={FEE_ICON} zClass="z-[60]">
      <div className="space-y-3.5">
        <Notice tone="warn">
          {payment.instrument?.number ? `Cheque ${payment.instrument.number}` : 'The cheque'} for {inr(payment.amount, showAmounts)} is
          marked bounced and the bill reopens. A bank charge entered here is added to the family&rsquo;s account.
        </Notice>
        <label className="block">
          <span className="block text-[12px] font-medium text-slate-500 mb-1">Bank charge to pass on (₹)</span>
          <input type="number" min={0} value={charge} onChange={e => setCharge(e.target.value)}
                 className={`${ADMIN.inputPlain} sm:max-w-[200px]`} />
        </label>
        <label className="block">
          <span className="block text-[12px] font-medium text-slate-500 mb-1">What the bank said</span>
          <input value={note} onChange={e => setNote(e.target.value)} placeholder="Insufficient funds"
                 className={ADMIN.inputPlain} />
        </label>
        {error && <Notice tone="error">{error}</Notice>}
        <div className="flex flex-wrap justify-end gap-2">
          <button onClick={onClose} className={ADMIN.ghostBtn}>Back</button>
          <button onClick={() => void go()} disabled={busy} className={ADMIN.darkBtn}>
            {busy && <Loader2 size={14} className="animate-spin" />} Mark bounced
          </button>
        </div>
      </div>
    </ModalShell>
  )
}
