'use client'

// One bill, opened from the student's list: what it is made of, what has been
// paid against it, and the two things a family does with a bill — keep a copy
// and pay what is left.

import React from 'react'
import { Download, FileText, Receipt, Sparkles } from 'lucide-react'
import ModalShell from '@/components/ui/ModalShell'
import { ADMIN, CHIP, FEE_ICON, fmtDate, inr } from '@/components/fees/ui'
import { DocNo } from '@/components/fees/glass'
import type { InvoiceLineRow, InvoiceRow, PaymentRow } from '@/lib/fees/invoices'
import { METHOD_WORD, dueWords, isOpen, type Allocation } from './studentFees'

const TONE_CHIP = {
  late: `${CHIP} bg-[#FBE7E7] text-[#A93232]`,
  soon: `${CHIP} bg-[#FBF1D6] text-[#7A5D12]`,
  later: `${CHIP} bg-slate-100 text-slate-600`,
  done: `${CHIP} bg-[#E6F2EA] text-[#1F6B42]`,
}

const SAVING = new Set(['discount', 'scholarship', 'waiver'])

export default function StudentBillSheet({
  invoice, lines, payments, allocations, today, canPay, onPay, onDownloadBill, onDownloadReceipt, onClose,
}: {
  invoice: InvoiceRow
  lines: InvoiceLineRow[]
  payments: PaymentRow[]
  allocations: Allocation[]
  today: string
  canPay: boolean
  onPay: () => void
  onDownloadBill: () => void
  onDownloadReceipt: (p: PaymentRow) => void
  onClose: () => void
}) {
  const due = dueWords(invoice, today)
  const open = isOpen(invoice)
  const against = allocations.filter(a => a.invoice_id === invoice.id)
  const cancelled = invoice.status === 'cancelled'

  return (
    <ModalShell
      onClose={onClose}
      sharp
      size="lg"
      title={<DocNo value={invoice.number} />}
      subtitle={`Issued ${fmtDate(invoice.issue_date)} · due ${fmtDate(invoice.due_date)}`}
      icon={<FileText size={17} />}
      iconClassName={FEE_ICON}
      footer={
        <div className="flex flex-wrap items-center justify-end gap-2">
          <button type="button" onClick={onDownloadBill} className={ADMIN.ghostBtn}>
            <Download size={14} /> Download bill
          </button>
          {open && (
            <button type="button" onClick={onPay} disabled={!canPay} className={`${ADMIN.goldBtn} !h-9 !px-4`}>
              Pay {inr(invoice.balance)}
            </button>
          )}
        </div>
      }
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-[12px] text-slate-500">{open ? 'Left to pay' : cancelled ? 'Nothing is owed on this bill' : 'Paid in full'}</p>
            <p className="font-display text-[1.9rem] font-bold leading-none tabular-nums text-slate-900 mt-1">
              {inr(open ? invoice.balance : invoice.net)}
            </p>
          </div>
          <span className={TONE_CHIP[due.tone]}>{due.text}</span>
        </div>

        <section className="fx-card">
          <h3 className="px-3.5 pt-3 pb-1.5 text-[13.5px] font-semibold text-slate-900">What this bill is for</h3>
          <div className="divide-y divide-[#F0ECE3]">
            {lines.map(l => {
              const saving = SAVING.has(l.kind) || l.amount < 0
              return (
                <div key={l.id} className="flex items-start justify-between gap-3 px-3.5 py-2">
                  <span className={`text-[13.5px] leading-snug min-w-0 break-words ${saving ? 'text-[#1F6B42]' : 'text-slate-700'}`}>
                    {saving && <Sparkles size={12} className="inline mr-1.5 -mt-0.5" />}
                    {l.label}
                    {l.kind === 'late_fee' && !/late/i.test(l.label) && <span className="text-slate-400"> · late fee</span>}
                  </span>
                  <span className={`text-[13.5px] tabular-nums font-medium whitespace-nowrap ${saving ? 'text-[#1F6B42]' : 'text-slate-900'}`}>
                    {saving ? `− ${inr(Math.abs(l.amount))}` : inr(l.amount)}
                  </span>
                </div>
              )
            })}
          </div>
          <div className="border-t border-[#EEEAE1] bg-[#FBFAF6] px-3.5 py-2.5 space-y-1">
            <Total label="Bill total" value={inr(invoice.net)} />
            {(invoice.paid ?? 0) > 0 && <Total label="Paid so far" value={`− ${inr(invoice.paid)}`} tone="good" />}
            {open && <Total label="Left to pay" value={inr(invoice.balance)} strong />}
          </div>
        </section>

        {against.length > 0 && (
          <section className="fx-card">
            <h3 className="px-3.5 pt-3 pb-1.5 text-[13.5px] font-semibold text-slate-900">Payments on this bill</h3>
            <div className="divide-y divide-[#F0ECE3]">
              {against.map(a => {
                const p = payments.find(x => x.id === a.payment_id)
                if (!p) return null
                const reversed = p.status === 'reversed'
                return (
                  <div key={a.payment_id} className="flex items-center gap-3 px-3.5 py-2">
                    <Receipt size={15} className="text-[#8B6F47] flex-shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className={`text-[13.5px] leading-snug ${reversed ? 'line-through text-slate-400' : 'text-slate-900'}`}>
                        {inr(a.amount)} · {METHOD_WORD[p.method] ?? p.method}
                      </p>
                      <p className="text-[11.5px] text-slate-500">
                        {fmtDate(p.paid_on)}{p.receipt_no ? ` · ${p.receipt_no}` : ''}{reversed ? ' · reversed' : ''}
                      </p>
                    </div>
                    {p.status === 'verified' && p.receipt_no && (
                      <button type="button" onClick={() => onDownloadReceipt(p)} className={ADMIN.onDarkBtn}>
                        <Download size={12} /> Receipt
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          </section>
        )}

        {cancelled && invoice.cancelled_reason && (
          <p className="text-[12.5px] text-slate-500">Cancelled: {invoice.cancelled_reason}</p>
        )}
      </div>
    </ModalShell>
  )
}

function Total({ label, value, tone, strong }: { label: string; value: string; tone?: 'good'; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className={`text-[12.5px] ${strong ? 'font-semibold text-slate-900' : 'text-slate-500'}`}>{label}</span>
      <span className={`tabular-nums ${strong ? 'text-[15px] font-bold text-slate-900' : 'text-[13px] font-medium'} ${
        tone === 'good' ? 'text-[#1F6B42]' : strong ? '' : 'text-slate-700'}`}>{value}</span>
    </div>
  )
}
