'use client'

// ─────────────────────────────────────────────────────────────────────────────
// The Collect sheet.
//
// This is the screen a clerk uses with a parent standing in front of them, so
// it is built around two things: the amount is pre-filled with what is actually
// outstanding, and the split across bills is shown in words before anything is
// taken. A receipt that surprises the person paying is a dispute, and the
// counter is where disputes start.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useMemo, useState } from 'react'
import { AlertTriangle, Check, Loader2, Receipt } from 'lucide-react'
import ModalShell from '@/components/ui/ModalShell'
import { ADMIN, inr } from '@/components/fees/ui'
import { allocate, describeAllocation, validatePayment, type PayableInvoice } from '@/lib/fees/engine/allocate'
import { formatPaise, toPaise, toRupees } from '@/lib/fees/engine/money'
import { todayIn } from '@/lib/fees/engine/dates'
import {
  PAYMENT_METHODS, collectPayment, type CollectResult, type InvoiceRow, type PaymentMethod,
} from '@/lib/fees/invoices'
import type { PaymentRuleSettings } from '@/lib/fees/settings'

interface Props {
  onClose: () => void
  student: { id: string; full_name: string }
  academicYearId: string
  invoices: InvoiceRow[]
  rules: PaymentRuleSettings
  canBackdate: boolean
  showAmounts: boolean
  onCollected: (result: CollectResult) => void
}

export default function CollectSheet({
  onClose, student, academicYearId, invoices, rules,
  canBackdate, showAmounts, onCollected,
}: Props) {
  const today = todayIn()
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState<PaymentMethod>('cash')
  const [paidOn, setPaidOn] = useState(today)
  const [reference, setReference] = useState('')
  const [notes, setNotes] = useState('')
  const [cheque, setCheque] = useState({
    number: '', bank: '', branch: '', account_holder: '',
    instrument_date: today, is_postdated: false, present_on: '',
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const payable: PayableInvoice[] = useMemo(() => invoices
    .filter(i => (i.balance ?? 0) > 0)
    .map(i => ({
      id: i.id, number: i.number, dueDate: i.due_date,
      seq: i.seq, balance: toPaise(i.balance ?? 0),
    })), [invoices])

  const outstanding = useMemo(
    () => payable.reduce((a, i) => a + i.balance, 0), [payable])

  // Pre-filled with the full outstanding amount, because that is what most
  // people are paying and re-typing it is where a wrong figure creeps in.
  const entered = amount === '' ? outstanding : toPaise(Number(amount) || 0)

  const preview = useMemo(
    () => allocate(entered, payable, rules.allocation_order),
    [entered, payable, rules.allocation_order])

  const validation = useMemo(() => validatePayment(entered, outstanding, {
    partialAllowed: rules.partial_allowed,
    minPartialAmount: toPaise(rules.min_partial_amount),
    allowOverpayment: rules.allow_overpayment,
    allowBackdatedDays: rules.allow_backdated_days,
  }, { paidOn, today, canBackdate }), [entered, outstanding, rules, paidOn, today, canBackdate])

  const needsInstrument = method === 'cheque' || method === 'dd'
  const instrumentReady = !needsInstrument || cheque.number.trim().length > 0

  const submit = async () => {
    setBusy(true); setError(null)
    try {
      const result = await collectPayment({
        student_id: student.id,
        academic_year_id: academicYearId,
        amount: toRupees(entered),
        method,
        paid_on: paidOn === today ? undefined : paidOn,
        reference: reference.trim() || undefined,
        notes: notes.trim() || undefined,
        instrument: needsInstrument ? {
          kind: method === 'dd' ? 'dd' : 'cheque',
          number: cheque.number.trim(),
          bank: cheque.bank.trim() || undefined,
          branch: cheque.branch.trim() || undefined,
          account_holder: cheque.account_holder.trim() || undefined,
          instrument_date: cheque.instrument_date || undefined,
          is_postdated: cheque.is_postdated,
          present_on: cheque.is_postdated ? (cheque.present_on || undefined) : undefined,
        } : null,
      })
      onCollected(result)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not take that payment.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <ModalShell
      onClose={onClose}
      sharp
      size="lg"
      title={`Collect from ${student.full_name}`}
      subtitle="The receipt is issued the moment this is taken"
      icon={<Receipt size={16} />}
      iconClassName="bg-[#27272A] text-[#B8983C]"
    >
      <div className="space-y-4">
        <div className="bg-[#FAFAFA] border border-[#E4E4E7] rounded-lg px-4 py-3 flex items-baseline justify-between">
          <span className={ADMIN.label}>Outstanding</span>
          <span className="text-lg font-bold text-[#27272A]">
            {showAmounts ? formatPaise(outstanding) : '••••'}
          </span>
        </div>

        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <label className={`${ADMIN.label} block mb-1.5`}>Amount</label>
            <input
              type="number" min={0} inputMode="decimal"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              placeholder={showAmounts ? String(toRupees(outstanding)) : ''}
              className={`${ADMIN.inputPlain} text-lg font-semibold`}
              autoFocus
            />
            <p className="text-xs text-[#A1A1AA] mt-1">
              Leave it blank to take the full outstanding amount.
            </p>
          </div>
          <div>
            <label className={`${ADMIN.label} block mb-1.5`}>Method</label>
            <select value={method} onChange={e => setMethod(e.target.value as PaymentMethod)}
                    className={ADMIN.inputPlain}>
              {PAYMENT_METHODS.map(m => <option key={m.key} value={m.key}>{m.label}</option>)}
            </select>
          </div>
        </div>

        {needsInstrument && (
          <div className="border border-[#E4E4E7] rounded-lg p-3 space-y-3">
            <h4 className={ADMIN.label}>{method === 'dd' ? 'Demand draft' : 'Cheque'} details</h4>
            <div className="grid sm:grid-cols-2 gap-3">
              <input value={cheque.number} onChange={e => setCheque({ ...cheque, number: e.target.value })}
                     placeholder="Number" className={ADMIN.inputPlain} />
              <input value={cheque.bank} onChange={e => setCheque({ ...cheque, bank: e.target.value })}
                     placeholder="Bank" className={ADMIN.inputPlain} />
              <input value={cheque.branch} onChange={e => setCheque({ ...cheque, branch: e.target.value })}
                     placeholder="Branch" className={ADMIN.inputPlain} />
              <input value={cheque.account_holder}
                     onChange={e => setCheque({ ...cheque, account_holder: e.target.value })}
                     placeholder="Account holder" className={ADMIN.inputPlain} />
              <div>
                <label className={`${ADMIN.label} block mb-1`}>Dated</label>
                <input type="date" value={cheque.instrument_date}
                       onChange={e => setCheque({ ...cheque, instrument_date: e.target.value })}
                       className={ADMIN.inputPlain} />
              </div>
              <div>
                <label className={`${ADMIN.label} block mb-1`}>Post-dated</label>
                <select value={cheque.is_postdated ? 'yes' : 'no'}
                        onChange={e => setCheque({ ...cheque, is_postdated: e.target.value === 'yes' })}
                        className={ADMIN.inputPlain}>
                  <option value="no">No — banking it now</option>
                  <option value="yes">Yes — present later</option>
                </select>
              </div>
              {cheque.is_postdated && (
                <div className="sm:col-span-2">
                  <label className={`${ADMIN.label} block mb-1`}>Present on</label>
                  <input type="date" value={cheque.present_on}
                         onChange={e => setCheque({ ...cheque, present_on: e.target.value })}
                         className={`${ADMIN.inputPlain} max-w-[200px]`} />
                  <p className="text-xs text-amber-700 mt-1.5 flex items-start gap-1.5">
                    <AlertTriangle size={12} className="mt-0.5 flex-shrink-0" />
                    The bill stays unpaid until this cheque clears. A receipt is issued now, and
                    it will read &ldquo;not yet cleared&rdquo; if anyone scans it.
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <label className={`${ADMIN.label} block mb-1.5`}>Received on</label>
            <input type="date" value={paidOn} max={today}
                   disabled={!canBackdate}
                   onChange={e => setPaidOn(e.target.value)}
                   className={`${ADMIN.inputPlain} disabled:bg-[#FAFAFA] disabled:text-[#A1A1AA]`} />
            {!canBackdate && (
              <p className="text-xs text-[#A1A1AA] mt-1">
                Backdating needs a separate permission.
              </p>
            )}
          </div>
          <div>
            <label className={`${ADMIN.label} block mb-1.5`}>Reference</label>
            <input value={reference} onChange={e => setReference(e.target.value)}
                   placeholder="UTR, card slip, transaction id" className={ADMIN.inputPlain} />
          </div>
        </div>

        <div>
          <label className={`${ADMIN.label} block mb-1.5`}>Note</label>
          <input value={notes} onChange={e => setNotes(e.target.value)}
                 placeholder="Anything worth recording" className={ADMIN.inputPlain} />
        </div>

        {showAmounts && entered > 0 && (
          <div className="bg-[#FBF6E9] border border-[#EFE3C4] rounded-lg px-4 py-3">
            <div className="text-[10px] font-bold uppercase tracking-widest text-[#8A6D1F] mb-1">
              What this will do
            </div>
            <p className="text-sm text-[#8A6D1F] leading-relaxed">
              {describeAllocation(preview, formatPaise)}
            </p>
          </div>
        )}

        {!validation.ok && entered > 0 && (
          <div className="bg-rose-50 border border-rose-200 text-rose-700 text-sm px-4 py-3 rounded-lg flex items-start gap-2">
            <AlertTriangle size={15} className="mt-0.5 flex-shrink-0" />
            <span>{validation.reason}</span>
          </div>
        )}

        {error && (
          <div className="bg-rose-50 border border-rose-200 text-rose-700 text-sm px-4 py-3 rounded-lg">{error}</div>
        )}

        <div className="flex items-center gap-2 pt-1">
          <button
            onClick={() => void submit()}
            disabled={busy || !validation.ok || entered <= 0 || !instrumentReady}
            className={`${ADMIN.darkBtn} flex-1 py-2.5`}
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Receipt size={14} />}
            Collect {showAmounts && entered > 0 ? formatPaise(entered) : ''}
          </button>
          <button onClick={onClose} className={ADMIN.ghostBtn}>Cancel</button>
        </div>
      </div>
    </ModalShell>
  )
}

/** The confirmation, with the receipt number a clerk reads out or prints. */
export function CollectedReceipt({
  result, studentName, onPrint, onClose, showAmounts,
}: {
  result: CollectResult
  studentName: string
  onPrint: () => void
  onClose: () => void
  showAmounts: boolean
}) {
  return (
    <div className="text-center py-4 space-y-4">
      <div className="w-12 h-12 mx-auto rounded-full bg-emerald-50 border border-emerald-200 flex items-center justify-center">
        <Check size={22} className="text-emerald-600" />
      </div>
      <div>
        <p className="text-sm text-[#71717A]">Taken from {studentName}</p>
        <p className="text-xl font-bold text-[#27272A] font-mono mt-1">{result.receipt_no}</p>
        {result.status === 'pending' && (
          <p className="text-xs text-amber-700 mt-2 max-w-sm mx-auto">
            Held against an uncleared instrument. The bill stays open until it clears.
          </p>
        )}
        {showAmounts && result.credited > 0 && (
          <p className="text-xs text-[#71717A] mt-2">
            {inr(result.credited)} more than was outstanding — held as a credit for the next bill.
          </p>
        )}
      </div>
      <div className="flex gap-2 justify-center">
        <button onClick={onPrint} className={ADMIN.darkBtn}>Print receipt</button>
        <button onClick={onClose} className={ADMIN.ghostBtn}>Done</button>
      </div>
    </div>
  )
}
