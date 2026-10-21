'use client'

// Paying, from "here is what you are about to pay" to "here is your receipt".
//
// Every state a payment can be in has its own screen, because the worst thing
// a payment page can do is leave someone unsure whether their money went. So:
// cancelled says nothing was taken; failed says why and offers another go;
// a slow bank says the money is safe and where the receipt will appear.

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { Check, CreditCard, Download, Landmark, Loader2, ShieldCheck, Smartphone, Wallet } from 'lucide-react'
import ModalShell from '@/components/ui/ModalShell'
import { ADMIN, FEE_ICON, fmtDate, inr } from '@/components/fees/ui'
import { Notice } from '@/components/fees/shell'
import { DocNo } from '@/components/fees/glass'
import type { InvoiceRow } from '@/lib/fees/invoices'
import { createOnlineOrder, openCheckout, verifyOnlinePayment } from '@/lib/fees/online'

type Phase =
  | { kind: 'review'; note?: { tone: 'info' | 'error'; text: string } }
  | { kind: 'opening' }
  | { kind: 'confirming'; orderId: string; paymentId: string; slow: boolean }
  | { kind: 'paid'; receiptNo: string | null; paymentId: string | null; amount: number }
  | { kind: 'review_needed'; paymentId: string; amount: number }

const POLL_MS = 3000
const POLL_LIMIT = 20

export default function PaySheet({
  bills: picked, school, onClose, onPaid, onDownloadReceipt,
}: {
  bills: InvoiceRow[]
  school: string
  onClose: () => void
  /** Called once a receipt exists, so the page can reload behind the sheet. */
  onPaid: () => void
  onDownloadReceipt: (paymentId: string) => Promise<void>
}) {
  // Held as they were when the sheet opened: the page reloads behind it once
  // the money lands, and the sheet must keep showing what was paid.
  const [bills] = useState(picked)
  const [phase, setPhase] = useState<Phase>({ kind: 'review' })
  const [downloading, setDownloading] = useState(false)
  const total = bills.reduce((s, b) => s + (b.balance ?? 0), 0)
  const reduce = useReducedMotion()
  const polls = useRef(0)

  const landed = useCallback((r: { status: string; receipt_no?: string | null; payment_id?: string | null }, amount: number, paymentId: string) => {
    if (r.status === 'paid') {
      setPhase({ kind: 'paid', receiptNo: r.receipt_no ?? null, paymentId: r.payment_id ?? null, amount })
      onPaid()
      return true
    }
    if (r.status === 'review') {
      setPhase({ kind: 'review_needed', paymentId, amount })
      onPaid()
      return true
    }
    return false
  }, [onPaid])

  const pay = async () => {
    setPhase({ kind: 'opening' })
    let order
    try {
      order = await createOnlineOrder(bills.map(b => b.id))
    } catch (e) {
      setPhase({ kind: 'review', note: { tone: 'error', text: (e as Error).message } })
      return
    }
    const amount = order.amount / 100
    const outcome = await openCheckout(order, {
      school,
      description: order.bills.length === 1 ? `Fee bill ${order.bills[0]}` : `${order.bills.length} fee bills`,
    })
    if (outcome.kind === 'dismissed') {
      setPhase({ kind: 'review', note: { tone: 'info', text: 'Payment cancelled. No money was taken.' } })
      return
    }
    if (outcome.kind === 'failed') {
      setPhase({ kind: 'review', note: { tone: 'error', text: `${outcome.reason} No money was taken — you can try again.` } })
      return
    }
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = outcome.response
    setPhase({ kind: 'confirming', orderId: razorpay_order_id, paymentId: razorpay_payment_id, slow: false })
    polls.current = 0
    try {
      const r = await verifyOnlinePayment({ order_id: razorpay_order_id, payment_id: razorpay_payment_id, signature: razorpay_signature })
      landed(r, amount, razorpay_payment_id)
    } catch {
      // Keep asking below; the webhook settles it even if this call failed.
    }
  }

  // While the bank confirms, ask again every few seconds. After a minute the
  // sheet says so plainly instead of spinning for ever.
  useEffect(() => {
    if (phase.kind !== 'confirming') return
    const t = window.setTimeout(async () => {
      polls.current += 1
      try {
        const r = await verifyOnlinePayment({ order_id: phase.orderId })
        if (landed(r, total, phase.paymentId)) return
      } catch { /* try again */ }
      setPhase(p => p.kind === 'confirming' ? { ...p, slow: polls.current >= POLL_LIMIT } : p)
    }, POLL_MS)
    return () => window.clearTimeout(t)
  }, [phase, landed, total])

  const busy = phase.kind === 'opening' || (phase.kind === 'confirming' && !phase.slow)

  return (
    <ModalShell
      onClose={busy ? () => {} : onClose}
      sharp
      size="md"
      title={phase.kind === 'paid' ? 'Payment received' : 'Pay fees'}
      subtitle={phase.kind === 'paid' ? school : `${bills.length} bill${bills.length === 1 ? '' : 's'} · ${inr(total)}`}
      icon={<Wallet size={17} />}
      iconClassName={FEE_ICON}
      footer={<Footer phase={phase} total={total} downloading={downloading} onPay={() => void pay()} onClose={onClose}
                      onDownload={async id => { setDownloading(true); try { await onDownloadReceipt(id) } finally { setDownloading(false) } }} />}
    >
      {phase.kind === 'review' && (
        <div className="space-y-4">
          {phase.note && <Notice tone={phase.note.tone}>{phase.note.text}</Notice>}
          <section className="fx-card">
            <div className="divide-y divide-[#F0ECE3]">
              {bills.map(b => (
                <div key={b.id} className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                  <div className="min-w-0">
                    <p className="text-[13.5px] font-medium text-slate-900 leading-snug break-words"><DocNo value={b.number} /></p>
                    <p className="text-[11.5px] text-slate-500">Due {fmtDate(b.due_date)}</p>
                  </div>
                  <span className="text-[13.5px] font-semibold tabular-nums text-slate-900">{inr(b.balance)}</span>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between gap-3 px-3.5 py-3 border-t border-[#EEEAE1] bg-[#FBFAF6]">
              <span className="text-[13.5px] font-semibold text-slate-900">You pay</span>
              <span className="font-display text-[1.5rem] font-bold tabular-nums text-slate-900 leading-none">{inr(total)}</span>
            </div>
          </section>

          <div>
            <p className="text-[12.5px] text-slate-500 mb-2">Choose how to pay in the next step</p>
            <div className="grid grid-cols-3 gap-2">
              {[
                { icon: Smartphone, label: 'UPI' },
                { icon: CreditCard, label: 'Card' },
                { icon: Landmark, label: 'Net banking' },
              ].map(m => (
                <div key={m.label} className="fx-tile flex flex-col items-center gap-1.5 py-3 text-center">
                  <m.icon size={17} className="text-[#8B6F47]" />
                  <span className="text-[12px] font-medium text-slate-700">{m.label}</span>
                </div>
              ))}
            </div>
          </div>

          <p className="flex items-start gap-2 text-[12px] text-slate-500 leading-relaxed">
            <ShieldCheck size={15} className="text-[#1F6B42] flex-shrink-0 mt-px" />
            Payments go through Razorpay straight to the school’s account. Your receipt is made the moment the payment is confirmed.
          </p>
        </div>
      )}

      {phase.kind === 'opening' && (
        <Waiting title="Opening the payment window" text="Finish the payment in the window that opens. Keep this page open." />
      )}

      {phase.kind === 'confirming' && !phase.slow && (
        <Waiting title="Confirming with the bank" text="This usually takes a few seconds. Please don’t close this page." />
      )}

      {phase.kind === 'confirming' && phase.slow && (
        <div className="space-y-3 py-2">
          <Notice tone="warn">
            The bank is taking longer than usual. If money has left your account it is safe: your receipt will appear
            under Receipts as soon as the bank confirms, usually within a few minutes.
          </Notice>
          <p className="text-[12.5px] text-slate-500">
            Payment ID <span className="font-medium text-slate-700 break-all">{phase.paymentId}</span> — quote it to the office if no receipt appears today.
          </p>
        </div>
      )}

      {phase.kind === 'review_needed' && (
        <div className="space-y-3 py-2">
          <Notice tone="warn">
            Your payment of {inr(phase.amount)} reached the school, but the office needs to match it to your bills
            before the receipt is made. You don’t need to pay again.
          </Notice>
          <p className="text-[12.5px] text-slate-500">
            Payment ID <span className="font-medium text-slate-700 break-all">{phase.paymentId}</span>
          </p>
        </div>
      )}

      {phase.kind === 'paid' && (
        <div className="py-4 text-center">
          <motion.div
            initial={reduce ? false : { scale: 0.6, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 380, damping: 22 }}
            className="mx-auto w-16 h-16 rounded-full flex items-center justify-center text-white
                       bg-gradient-to-b from-[#34A853] to-[#1F6B42] shadow-[inset_0_1px_0_rgba(255,255,255,.3),0_12px_24px_-12px_rgba(31,107,66,.8)]"
          >
            <Check size={30} strokeWidth={3} />
          </motion.div>
          <p className="font-display text-[2rem] font-bold tabular-nums text-slate-900 mt-4 leading-none">{inr(phase.amount)}</p>
          <p className="text-[13.5px] text-slate-600 mt-2">Paid to {school}</p>
          {phase.receiptNo && (
            <p className="text-[12.5px] text-slate-500 mt-1">Receipt <DocNo value={phase.receiptNo} /></p>
          )}
        </div>
      )}
    </ModalShell>
  )
}

function Waiting({ title, text }: { title: string; text: string }) {
  return (
    <div className="py-10 text-center" role="status" aria-live="polite">
      <Loader2 className="animate-spin text-[#8B6F47] mx-auto" size={26} />
      <p className="text-[14px] font-semibold text-slate-900 mt-4">{title}</p>
      <p className="text-[12.5px] text-slate-500 mt-1 max-w-xs mx-auto leading-relaxed">{text}</p>
    </div>
  )
}

function Footer({ phase, total, downloading, onPay, onClose, onDownload }: {
  phase: Phase
  total: number
  downloading: boolean
  onPay: () => void
  onClose: () => void
  onDownload: (paymentId: string) => void
}) {
  if (phase.kind === 'review') {
    return (
      <button type="button" onClick={onPay} disabled={total <= 0} className={`${ADMIN.goldBtn} w-full !h-11 !text-[14px]`}>
        {phase.note?.tone === 'error' ? 'Try again' : 'Pay'} {inr(total)}
      </button>
    )
  }
  if (phase.kind === 'paid') {
    return (
      <div className="flex gap-2">
        {phase.paymentId && (
          <button type="button" onClick={() => onDownload(phase.paymentId!)} disabled={downloading}
                  className={`${ADMIN.ghostBtn} flex-1 !h-10`}>
            {downloading ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />} Download receipt
          </button>
        )}
        <button type="button" onClick={onClose} className={`${ADMIN.darkBtn} flex-1 !h-10`}>Done</button>
      </div>
    )
  }
  if ((phase.kind === 'confirming' && phase.slow) || phase.kind === 'review_needed') {
    return <button type="button" onClick={onClose} className={`${ADMIN.darkBtn} w-full !h-10`}>Close</button>
  }
  return null
}
