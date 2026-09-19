'use client'

import React, { useState, useEffect, useCallback, useRef } from 'react'
import { motion } from 'framer-motion'
import { X, CreditCard, QrCode, AlertCircle, CheckCircle2, Loader2, ShieldCheck } from 'lucide-react'
import QRCode from 'qrcode'
import { useAuth } from '@/contexts/AuthContext'
import { formatINR } from '@/components/fees/FeeCollectionSummary'
import {
  SchoolFee, RazorpayConfig, UpiConfig,
  fetchRazorpayConfig, fetchUpiConfig,
  buildUpiLink, createRazorpayOrder, startUpiCollect, fetchFeeStatus,
} from '@/lib/fees'
import { fetchCollectStatus } from '@/lib/bankConfig'

interface PaySchoolFeeModalProps {
  fee: SchoolFee
  /** Outstanding balance to collect — defaults to the full fee. For a partially
   *  paid fee this is the remaining amount, matching what the server charges. */
  payable?: number
  onClose: () => void
  onPaid: () => void
}

type Tab = 'razorpay' | 'upi'

interface RazorpayCheckout { open(): void }
interface RazorpayWindow extends Window {
  Razorpay?: new (options: Record<string, unknown>) => RazorpayCheckout
}

function loadRazorpayScript(): Promise<boolean> {
  return new Promise(resolve => {
    if ((window as RazorpayWindow).Razorpay) return resolve(true)
    const s = document.createElement('script')
    s.src = 'https://checkout.razorpay.com/v1/checkout.js'
    s.onload = () => resolve(true)
    s.onerror = () => resolve(false)
    document.body.appendChild(s)
  })
}

export default function PaySchoolFeeModal({ fee, payable, onClose, onPaid }: PaySchoolFeeModalProps) {
  const { profile } = useAuth()
  // The amount actually due now (remaining balance for partial fees).
  const dueNow = payable ?? (Number(fee.amount) || 0)
  const [loading, setLoading] = useState(true)
  const [rzp, setRzp] = useState<RazorpayConfig>({ enabled: false, key_id: '' })
  const [upi, setUpi] = useState<UpiConfig>({ vpa: '', payee_name: '' })
  // Resolved from the direct bank collection config, falling back to the
  // legacy Smart Collect one — see fetchCollectStatus.
  const [autoCollect, setAutoCollect] = useState(false)
  const [tab, setTab] = useState<Tab>('upi')
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)
  const [collecting, setCollecting] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const upiConfigured = !!upi.vpa
  const autoUpi = autoCollect && upiConfigured          // bank auto-reconciliation
  const razorpayConfigured = rzp.enabled

  const load = useCallback(async () => {
    setLoading(true)
    const [r, u, s] = await Promise.all([fetchRazorpayConfig(), fetchUpiConfig(), fetchCollectStatus()])
    setRzp(r); setUpi(u); setAutoCollect(s.enabled)
    setTab((s.enabled && u.vpa) || !r.enabled ? 'upi' : 'razorpay')
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const stopPolling = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
  }, [])

  const renderQr = useCallback(async (vpa: string, payee: string, reference: string) => {
    const link = buildUpiLink({ vpa, payeeName: payee || 'School Fees', amount: dueNow, note: reference })
    try { setQrDataUrl(await QRCode.toDataURL(link, { width: 240, margin: 1 })) }
    catch (e) { console.error('QR generation failed:', e); setError('Could not render QR code') }
  }, [dueNow])

  // Build the UPI QR + (for auto mode) begin polling for confirmation.
  useEffect(() => {
    if (loading || tab !== 'upi' || !upiConfigured || done) return
    let active = true

    const begin = async () => {
      if (autoUpi) {
        setCollecting(true); setError(null)
        const collect = await startUpiCollect(fee.id)
        setCollecting(false)
        if (!active) return
        if (!collect.success || !collect.vpa || !collect.reference) {
          setError(collect.error ?? 'Could not start UPI payment'); return
        }
        await renderQr(collect.vpa, collect.payee_name ?? upi.payee_name, collect.reference)
        // Poll until the bank webhook flips the fee to paid.
        stopPolling()
        pollRef.current = setInterval(async () => {
          const status = await fetchFeeStatus(fee.id)
          if (status === 'paid') {
            stopPolling()
            setDone('Payment received and confirmed!')
            setTimeout(onPaid, 1600)
          }
        }, 4000)
      } else {
        // Manual mode: show the QR; the office confirms receipt — no self-declare.
        await renderQr(upi.vpa, upi.payee_name, fee.upi_reference)
      }
    }
    begin()

    return () => { active = false; stopPolling() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, tab, upiConfigured, autoUpi, done, fee.id])

  useEffect(() => stopPolling, [stopPolling])

  const payRazorpay = async () => {
    setBusy(true); setError(null)
    const ok = await loadRazorpayScript()
    if (!ok) { setBusy(false); setError('Could not load Razorpay. Check your connection.'); return }
    const order = await createRazorpayOrder(fee.id)
    if (!order.success || !order.order_id || !order.key_id) {
      setBusy(false); setError(order.error ?? 'Could not start payment'); return
    }
    const Ctor = (window as RazorpayWindow).Razorpay
    if (!Ctor) { setBusy(false); setError('Razorpay unavailable'); return }
    const checkout = new Ctor({
      key: order.key_id,
      order_id: order.order_id,
      amount: order.amount,
      currency: 'INR',
      name: upi.payee_name || 'School Fees',
      description: fee.description || 'School fee payment',
      prefill: { name: profile?.full_name, email: profile?.email },
      theme: { color: '#334155' },
      handler: () => { setDone('Payment received! It will show as paid once confirmed.'); setTimeout(onPaid, 1800) },
      modal: { ondismiss: () => setBusy(false) },
    })
    checkout.open()
    setBusy(false)
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
        className="bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl w-full sm:max-w-2xl max-h-[92dvh] sm:max-h-[88vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="w-10 h-1 bg-slate-200 rounded-full mx-auto mt-3 mb-1 sm:hidden" />
        <div className="sticky top-0 bg-white border-b border-slate-100 px-5 py-4 flex items-center justify-between z-10">
          <div>
            <h2 className="font-bold text-slate-800">Pay fee</h2>
            <p className="text-xs text-slate-400">{formatINR(dueNow)} · {fee.description || 'School fee'}</p>
          </div>
          <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 ">
            <X size={16} />
          </button>
        </div>

        <div className="p-5">
          {done ? (
            <div className="text-center py-6">
              <CheckCircle2 size={44} className="text-slate-700 mx-auto mb-3" />
              <p className="text-sm text-slate-700 leading-relaxed">{done}</p>
            </div>
          ) : loading ? (
            <div className="text-center py-8"><div className="spinner mx-auto" /></div>
          ) : !razorpayConfigured && !upiConfigured ? (
            <div className="flex items-start gap-2 p-3 bg-slate-50 border border-slate-200 text-xs text-slate-600">
              <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
              No payment method is set up yet. Please contact the school office.
            </div>
          ) : (
            <>
              {razorpayConfigured && upiConfigured && (
                <div className="flex gap-1.5 mb-4 p-1 bg-slate-100 ">
                  <TabBtn active={tab === 'upi'} onClick={() => setTab('upi')} icon={<QrCode size={14} />} label="UPI QR" />
                  <TabBtn active={tab === 'razorpay'} onClick={() => setTab('razorpay')} icon={<CreditCard size={14} />} label="Card / Netbanking" />
                </div>
              )}

              {tab === 'razorpay' && razorpayConfigured ? (
                <div>
                  <p className="text-sm text-slate-500 mb-4 leading-relaxed">Pay securely via Razorpay — UPI, cards, netbanking, and wallets.</p>
                  <button onClick={payRazorpay} disabled={busy}
                    className="w-full text-sm font-semibold py-2.5 bg-slate-800 text-white hover:bg-slate-900 transition-colors flex items-center justify-center gap-2 disabled:opacity-50">
                    {busy ? <Loader2 size={15} className="animate-spin" /> : <CreditCard size={15} />}
                    Pay {formatINR(dueNow)}
                  </button>
                </div>
              ) : upiConfigured ? (
                <div>
                  <div className="bg-slate-50 border border-slate-200 p-4 flex flex-col items-center">
                    {collecting || !qrDataUrl ? (
                      <div className="w-44 h-44 flex items-center justify-center"><div className="spinner" /></div>
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={qrDataUrl} alt="UPI QR code" className="w-44 h-44" />
                    )}
                    <p className="text-xs text-slate-500 mt-3 text-center">
                      Scan with any UPI app to pay <strong>{formatINR(dueNow)}</strong> to <strong>{upi.vpa}</strong>
                    </p>
                    <p className="text-[10px] text-slate-400 mt-1">Ref: {fee.upi_reference}</p>
                  </div>

                  {autoUpi ? (
                    <div className="mt-4 flex items-center justify-center gap-2 text-sm text-slate-600">
                      <Loader2 size={15} className="animate-spin text-slate-500" />
                      Waiting for your payment… this confirms automatically.
                    </div>
                  ) : (
                    <div className="mt-4 flex items-start gap-2 p-3 bg-slate-50 border border-slate-200 text-xs text-slate-600">
                      <ShieldCheck size={14} className="flex-shrink-0 mt-0.5" />
                      After you pay, the school office confirms receipt against this reference — no need to do anything else here.
                    </div>
                  )}
                </div>
              ) : null}

              {error && (
                <div className="flex items-center gap-2 p-3 mt-4 bg-[#FCECEC] border border-[#EFCCCC] text-[#A93232] text-xs">
                  <AlertCircle size={14} className="flex-shrink-0" /> {error}
                </div>
              )}
            </>
          )}
        </div>
      </motion.div>
    </motion.div>
  )
}

function TabBtn({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button onClick={onClick}
      className={`flex-1 flex items-center justify-center gap-1.5 text-xs font-semibold py-2 transition-colors ${
        active ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500'
      }`}>
      {icon} {label}
    </button>
  )
}
