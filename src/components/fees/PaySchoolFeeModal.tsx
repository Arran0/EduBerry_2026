'use client'

import React, { useState, useEffect, useCallback, useRef } from 'react'
import { motion } from 'framer-motion'
import { X, CreditCard, QrCode, AlertCircle, CheckCircle2, Loader2, Smartphone, Info } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { formatINR } from '@/components/fees/FeeCollectionSummary'
import type { SchoolFee } from '@/lib/fees'
import {
  startPayment, openCheckout, waitForSettlement,
  type PaymentIntent, type PaySource,
} from '@/lib/fees/pay'

/**
 * Paying a fee.
 *
 * ── What changed and why ─────────────────────────────────────────────────────
 * This modal used to offer two things side by side: a Razorpay order, and a
 * "UPI QR" that was a static intent link to the school's own VPA, with the
 * office confirming receipt by hand. That second path had no gateway record of
 * the attempt, no automatic confirmation without a bank connection, and used a
 * P2P handle for merchant collection.
 *
 * Both are now Razorpay. Checkout offers UPI Intent natively on a phone (the
 * parent is handed to their UPI app and back); the QR is a dynamic Razorpay QR
 * for this exact amount, scannable from a second device. Either way the money
 * is confirmed by a webhook against an immutable ledger row.
 *
 * ── The one rule this component follows ──────────────────────────────────────
 * Checkout's success callback means the parent's browser thinks it worked. It
 * is not confirmation. So the modal moves to "waiting" and polls the fee's own
 * status, and it says exactly that to the parent instead of claiming success.
 * A payment that leaves a balance settles on 'partial' — still a success, and
 * the modal shows what remains rather than continuing to spin.
 */

interface PaySchoolFeeModalProps {
  fee: SchoolFee
  /** Outstanding balance to collect. Defaults to the full fee. */
  payable?: number
  source?: PaySource
  onClose: () => void
  onPaid: () => void
}

type Stage = 'loading' | 'choose' | 'waiting' | 'done' | 'unavailable'
type Tab = 'upi' | 'card'

export default function PaySchoolFeeModal({
  fee, payable, source = 'school', onClose, onPaid,
}: PaySchoolFeeModalProps) {
  const { profile } = useAuth()

  const [stage, setStage] = useState<Stage>('loading')
  const [tab, setTab] = useState<Tab>('upi')
  const [intent, setIntent] = useState<PaymentIntent | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [outcome, setOutcome] = useState<{ state: 'paid' | 'partial'; remaining: number } | null>(null)

  const abortRef = useRef<AbortController | null>(null)
  const dueNow = intent?.amount_rupees ?? payable ?? (Number(fee.amount) || 0)

  // One intent per open. Creating a fresh order each time the parent switches
  // tab would leave a trail of abandoned orders and, worse, let two live orders
  // for the same fee both be paid.
  const begin = useCallback(async () => {
    setStage('loading'); setError(null)
    const res = await startPayment(fee.id, { source, amount: payable })
    if (!res.success) {
      setError(res.error ?? 'Could not start the payment.')
      setStage('unavailable')
      return
    }
    setIntent(res)
    setTab(res.qr_image_url ? 'upi' : 'card')
    setStage('choose')
  }, [fee.id, source, payable])

  useEffect(() => { begin() }, [begin])

  useEffect(() => () => abortRef.current?.abort(), [])

  const startWaiting = useCallback(async () => {
    setStage('waiting')
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    const result = await waitForSettlement(fee.id, source, { signal: controller.signal })
    if (controller.signal.aborted) return

    if (result.settled && result.state !== 'pending') {
      const remaining = result.state === 'partial' ? Math.max(0, dueNow - (intent?.amount_rupees ?? dueNow)) : 0
      setOutcome({ state: result.state, remaining })
      setStage('done')
      setTimeout(onPaid, 2200)
    } else {
      // Not a failure. Bank settlement can lag, and telling a parent their
      // payment failed when it has not is the worst thing this screen can do.
      setStage('choose')
      setError('We have not seen your payment yet. If money has left your account it will appear here shortly — you do not need to pay again.')
    }
  }, [fee.id, source, dueNow, intent, onPaid])

  const payByCard = async () => {
    if (!intent) return
    setBusy(true); setError(null)
    const res = await openCheckout({
      intent,
      name: 'School fees',
      description: fee.description || 'School fee payment',
      prefill: { name: profile?.full_name, email: profile?.email },
      onDismiss: () => setBusy(false),
      onSubmitted: () => { setBusy(false); startWaiting() },
    })
    if (!res.ok) { setBusy(false); setError(res.error ?? 'Could not open the payment window.') }
  }

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4 bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 40, opacity: 0 }}
        transition={{ type: 'spring', damping: 25, stiffness: 300 }}
        className="bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl w-full sm:max-w-md max-h-[92dvh] sm:max-h-[88vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="w-10 h-1 bg-slate-200 rounded-full mx-auto mt-3 mb-1 sm:hidden" />
        <div className="sticky top-0 bg-white border-b border-slate-100 px-5 py-4 flex items-center justify-between z-10">
          <div className="min-w-0">
            <h2 className="font-bold text-slate-800">Pay fee</h2>
            <p className="text-xs text-slate-400 truncate">
              {formatINR(dueNow)} · {fee.description || 'School fee'}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="p-2 -mr-1 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg shrink-0"
          >
            <X size={16} />
          </button>
        </div>

        <div className="p-5">
          {stage === 'done' && outcome ? (
            <Settled outcome={outcome} />
          ) : stage === 'waiting' ? (
            <Waiting amount={dueNow} />
          ) : stage === 'loading' ? (
            <div className="py-10 text-center"><div className="spinner mx-auto" /></div>
          ) : stage === 'unavailable' ? (
            <Notice tone="warn">{error ?? 'Online payment is not available right now. Please contact the school office.'}</Notice>
          ) : (
            <>
              {intent?.paid ? (
                <div className="mb-4 text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-xl p-3 leading-relaxed">
                  {formatINR(intent.paid)} of {formatINR(intent.billed ?? 0)} already received.
                  You are paying the remaining <strong>{formatINR(dueNow)}</strong>.
                </div>
              ) : null}

              {intent?.qr_image_url && (
                <div className="flex gap-1.5 mb-4 p-1 bg-slate-100 rounded-xl">
                  <TabBtn active={tab === 'upi'} onClick={() => setTab('upi')} icon={<QrCode size={14} />} label="UPI" />
                  <TabBtn active={tab === 'card'} onClick={() => setTab('card')} icon={<CreditCard size={14} />} label="Card / Netbanking" />
                </div>
              )}

              {tab === 'upi' && intent?.qr_image_url ? (
                <div>
                  <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 flex flex-col items-center">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={intent.qr_image_url}
                      alt={`UPI QR code to pay ${formatINR(dueNow)}`}
                      className="w-44 h-44 rounded-lg bg-white"
                    />
                    <p className="text-xs text-slate-500 mt-3 text-center leading-relaxed">
                      Scan with any UPI app to pay <strong>{formatINR(dueNow)}</strong>
                    </p>
                    <p className="text-[10px] text-slate-400 mt-1">Ref: {intent.reference ?? fee.upi_reference}</p>
                  </div>

                  <button
                    onClick={payByCard}
                    disabled={busy}
                    className="w-full mt-3 text-sm font-semibold py-3 rounded-xl bg-slate-800 text-white hover:bg-slate-900 transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    {busy ? <Loader2 size={15} className="animate-spin" /> : <Smartphone size={15} />}
                    Pay on this phone instead
                  </button>

                  <button
                    onClick={startWaiting}
                    className="w-full mt-2 text-xs font-medium py-2.5 text-slate-500 hover:text-slate-700"
                  >
                    I&rsquo;ve paid — check now
                  </button>
                </div>
              ) : (
                <div>
                  <p className="text-sm text-slate-500 mb-4 leading-relaxed">
                    Pay securely by UPI, card, netbanking or wallet. On a phone you&rsquo;ll be handed
                    straight to your UPI app.
                  </p>
                  <button
                    onClick={payByCard}
                    disabled={busy}
                    className="w-full text-sm font-semibold py-3 rounded-xl bg-slate-800 text-white hover:bg-slate-900 transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    {busy ? <Loader2 size={15} className="animate-spin" /> : <CreditCard size={15} />}
                    Pay {formatINR(dueNow)}
                  </button>
                </div>
              )}

              {error && <div className="mt-4"><Notice tone="warn">{error}</Notice></div>}
            </>
          )}
        </div>
      </motion.div>
    </motion.div>
  )
}

function Waiting({ amount }: { amount: number }) {
  return (
    <div className="text-center py-8">
      <Loader2 size={36} className="text-slate-400 mx-auto mb-4 animate-spin" />
      <p className="text-sm font-medium text-slate-700">Confirming your payment of {formatINR(amount)}</p>
      <p className="text-xs text-slate-400 mt-2 leading-relaxed max-w-xs mx-auto">
        This confirms automatically once your bank tells us the money has arrived.
        Please don&rsquo;t pay again or close this until it does.
      </p>
    </div>
  )
}

function Settled({ outcome }: { outcome: { state: 'paid' | 'partial'; remaining: number } }) {
  return (
    <div className="text-center py-8">
      <CheckCircle2 size={44} className="text-emerald-600 mx-auto mb-3" />
      <p className="text-sm font-semibold text-slate-800">Payment received</p>
      <p className="text-xs text-slate-500 mt-2 leading-relaxed max-w-xs mx-auto">
        {outcome.state === 'paid'
          ? 'This fee is now fully paid. Your receipt is in Fee Receipts.'
          : `Thank you. ${formatINR(outcome.remaining)} is still outstanding on this fee.`}
      </p>
    </div>
  )
}

function Notice({ tone, children }: { tone: 'warn' | 'info'; children: React.ReactNode }) {
  const warn = tone === 'warn'
  return (
    <div className={`flex items-start gap-2 p-3 rounded-xl text-xs leading-relaxed ${
      warn ? 'bg-amber-50 border border-amber-200 text-amber-800' : 'bg-slate-50 border border-slate-200 text-slate-600'
    }`}>
      {warn ? <AlertCircle size={14} className="flex-shrink-0 mt-0.5" /> : <Info size={14} className="flex-shrink-0 mt-0.5" />}
      <span>{children}</span>
    </div>
  )
}

function TabBtn({ active, onClick, icon, label }: {
  active: boolean; onClick: () => void; icon: React.ReactNode; label: string
}) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 flex items-center justify-center gap-1.5 text-xs font-semibold py-2.5 rounded-lg transition-colors ${
        active ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500'
      }`}
    >
      {icon} {label}
    </button>
  )
}
