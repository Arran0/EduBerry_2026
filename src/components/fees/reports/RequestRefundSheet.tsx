'use client'

// Asking for a refund.
//
// Only asking. The clerk who took the money is usually the one who notices it
// was too much, so this is guarded by `fees.collect` — but nothing moves until
// somebody with `fees.refund.approve`, and not the same person, signs it off,
// and then pays it out as a separate act.
//
// The sheet is blunt about the one thing that makes a refund a mistake: the
// family still owing money on other bills. It does not block it — a withdrawn
// student can be owed a deposit back while a term bill is open — but nobody
// should be able to say afterwards that they were not told.

import React, { useState } from 'react'
import { Loader2, Undo2 } from 'lucide-react'
import ModalShell from '@/components/ui/ModalShell'
import { ADMIN, fmtDate, inr } from '@/components/fees/ui'
import type { PaymentRow } from '@/lib/fees/invoices'
import { requestRefund } from '@/lib/fees/reports'

export default function RequestRefundSheet({
  studentId, studentName, yearId, payments, stillOwing, showAmounts, onClose, onDone,
}: {
  studentId: string
  studentName: string
  yearId: string
  payments: PaymentRow[]
  stillOwing: number
  showAmounts: boolean
  onClose: () => void
  onDone: () => void
}) {
  const [amount, setAmount] = useState<number | ''>('')
  const [reason, setReason] = useState('')
  const [against, setAgainst] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<{ warning: string | null } | null>(null)

  // Only a payment that actually cleared can be refunded — a reversed one has
  // already been undone, and a pending one has not arrived.
  const refundable = payments.filter(p => p.status === 'verified')

  if (done) {
    return (
      <ModalShell onClose={onDone} sharp size="sm" title="Sent for approval"
                  icon={<Undo2 size={15} />} iconClassName="bg-emerald-50 text-emerald-700">
        <p className="text-sm text-[#71717A] leading-relaxed">
          The request is in the refund queue on the Collection Center&rsquo;s Instruments tab.
          Nothing has left the school and the family&rsquo;s balance has not changed — that happens
          when somebody approves it and then pays it out.
        </p>
        {done.warning && (
          <p className="mt-3 text-xs text-[#8A6D1F] bg-[#FBF6E9] border border-[#EFE3C4] p-3">
            {done.warning}
          </p>
        )}
        <div className="flex justify-end mt-4">
          <button onClick={onDone} className={`${ADMIN.darkBtn} px-4`}>Done</button>
        </div>
      </ModalShell>
    )
  }

  return (
    <ModalShell
      onClose={onClose} sharp size="sm" title="Request a refund"
      subtitle={studentName}
      icon={<Undo2 size={15} />} iconClassName="bg-[#FBF6E9] text-[#8A6D1F]"
      footer={
        <div className="flex items-center justify-end gap-2">
          <button onClick={onClose} className={ADMIN.ghostBtn}>Cancel</button>
          <button
            onClick={async () => {
              if (!amount || amount <= 0) { setError('How much is going back?'); return }
              if (reason.trim().length < 3) { setError('Say why. It is money leaving the school.'); return }
              setBusy(true); setError(null)
              try {
                const r = await requestRefund({
                  student_id: studentId,
                  academic_year_id: yearId,
                  amount,
                  reason: reason.trim(),
                  source_payment_id: against || null,
                })
                setDone({ warning: r.warning })
              } catch (e) {
                setError(e instanceof Error ? e.message : 'The refund was not requested.')
              } finally { setBusy(false) }
            }}
            disabled={busy} className={`${ADMIN.darkBtn} px-4`}>
            {busy && <Loader2 size={13} className="animate-spin" />} Send for approval
          </button>
        </div>
      }
    >
      <div className="space-y-3">
        {stillOwing > 0 && (
          <div className="p-3 bg-[#FBF6E9] border border-[#EFE3C4]">
            <p className="text-xs text-[#7A5F16] leading-relaxed">
              This family still owes {inr(stillOwing, showAmounts)} on other bills. Refunding while
              a bill is open is sometimes right — a withdrawn student owed a deposit, say — but
              check it is what you mean.
            </p>
          </div>
        )}

        <label className="block">
          <span className={ADMIN.label}>Amount ₹</span>
          <input type="number" min={1} value={amount}
                 onChange={e => setAmount(e.target.value === '' ? '' : Number(e.target.value))}
                 className={`${ADMIN.inputPlain} mt-1`} autoFocus />
        </label>

        <label className="block">
          <span className={ADMIN.label}>Against which receipt</span>
          <select value={against} onChange={e => setAgainst(e.target.value)}
                  className={`${ADMIN.inputPlain} mt-1`}>
            <option value="">Not against a particular one</option>
            {refundable.map(p => (
              <option key={p.id} value={p.id}>
                {p.receipt_no ?? '—'} · {fmtDate(p.paid_on)} · {inr(p.amount, showAmounts)}
              </option>
            ))}
          </select>
          <p className="mt-1 text-[11px] text-[#A1A1AA] leading-snug">
            Naming the receipt lets whoever approves it check the refund against what was taken.
          </p>
        </label>

        <label className="block">
          <span className={ADMIN.label}>Why</span>
          <textarea value={reason} onChange={e => setReason(e.target.value)} rows={3}
                    placeholder="Paid twice for the second term; the second payment is being returned."
                    className={`${ADMIN.inputPlain} resize-none mt-1`} />
        </label>

        {error && <div className="p-3 bg-rose-50 border border-rose-200 text-xs text-rose-800">{error}</div>}
      </div>
    </ModalShell>
  )
}
