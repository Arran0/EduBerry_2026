'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { motion } from 'framer-motion'
import { X, CreditCard, QrCode, AlertCircle, CheckCircle2, Loader2 } from 'lucide-react'
import QRCode from 'qrcode'
import { useAuth } from '@/contexts/AuthContext'
import { formatINR } from '@/components/bus/FeeCollectionSummary'
import {
  BusFee, RazorpayConfig, UpiConfig,
  fetchRazorpayConfig, fetchUpiConfig, buildUpiLink, createRazorpayOrder, recordUpiClaim,
} from '@/lib/bus'

interface PayFeeModalProps {
  fee: BusFee
  onClose: () => void
  onPaid: () => void
}

type Tab = 'razorpay' | 'upi'

// Minimal shape of the Razorpay checkout global we use.
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

export default function PayFeeModal({ fee, onClose, onPaid }: PayFeeModalProps) {
  const { profile } = useAuth()
  const [loading, setLoading] = useState(true)
  const [rzp, setRzp] = useState<RazorpayConfig>({ enabled: false, key_id: '' })
  const [upi, setUpi] = useState<UpiConfig>({ vpa: '', payee_name: '' })
  const [tab, setTab] = useState<Tab>('upi')
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)
  const [txnRef, setTxnRef] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  const upiConfigured = !!upi.vpa
  const razorpayConfigured = rzp.enabled

  const load = useCallback(async () => {
    setLoading(true)
    const [r, u] = await Promise.all([fetchRazorpayConfig(), fetchUpiConfig()])
    setRzp(r); setUpi(u)
    setTab(r.enabled ? 'razorpay' : 'upi')
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  // Generate the UPI QR whenever UPI is the active, configured method.
  useEffect(() => {
    if (tab !== 'upi' || !upiConfigured) { setQrDataUrl(null); return }
    const link = buildUpiLink({
      vpa: upi.vpa,
      payeeName: upi.payee_name || 'School Transport',
      amount: Number(fee.amount),
      note: fee.upi_reference,
    })
    QRCode.toDataURL(link, { width: 240, margin: 1 })
      .then(setQrDataUrl)
      .catch(e => { console.error('QR generation failed:', e); setError('Could not render QR code') })
  }, [tab, upiConfigured, upi.vpa, upi.payee_name, fee.amount, fee.upi_reference])

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
      name: upi.payee_name || 'Bus Fee',
      description: fee.description || 'Bus fee payment',
      prefill: { name: profile?.full_name, email: profile?.email },
      theme: { color: '#f97316' },
      handler: () => {
        // Razorpay confirmed capture client-side; the webhook does the
        // authoritative verification and flips the fee to paid.
        setDone('Payment received! It will show as paid once confirmed (usually seconds).')
        setTimeout(onPaid, 1800)
      },
      modal: { ondismiss: () => setBusy(false) },
    })
    checkout.open()
    setBusy(false)
  }

  const submitUpiClaim = async () => {
    if (!txnRef.trim()) { setError('Enter your UPI transaction reference'); return }
    setBusy(true); setError(null)
    const result = await recordUpiClaim(fee.id, Number(fee.amount), txnRef.trim())
    setBusy(false)
    if (!result.success) { setError(result.error ?? 'Could not submit'); return }
    setDone('Submitted! The school will verify your payment shortly.')
    setTimeout(onPaid, 1800)
  }

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-sm max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-white rounded-t-2xl border-b border-slate-100 px-5 py-4 flex items-center justify-between z-10">
          <div>
            <h2 className="font-bold text-slate-800">Pay bus fee</h2>
            <p className="text-xs text-slate-400">{formatINR(fee.amount)} · {fee.description || 'Bus fee'}</p>
          </div>
          <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg">
            <X size={16} />
          </button>
        </div>

        <div className="p-5">
          {done ? (
            <div className="text-center py-6">
              <CheckCircle2 size={44} className="text-emerald-500 mx-auto mb-3" />
              <p className="text-sm text-slate-700 leading-relaxed">{done}</p>
            </div>
          ) : loading ? (
            <div className="text-center py-8"><div className="spinner mx-auto" /></div>
          ) : !razorpayConfigured && !upiConfigured ? (
            <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-100 rounded-xl text-xs text-amber-700">
              <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
              No payment method is set up yet. Please contact the school office.
            </div>
          ) : (
            <>
              {/* Tabs (only if both available) */}
              {razorpayConfigured && upiConfigured && (
                <div className="flex gap-1.5 mb-4 p-1 bg-slate-100 rounded-xl">
                  <TabBtn active={tab === 'razorpay'} onClick={() => setTab('razorpay')} icon={<CreditCard size={14} />} label="Card / Netbanking" />
                  <TabBtn active={tab === 'upi'} onClick={() => setTab('upi')} icon={<QrCode size={14} />} label="UPI QR" />
                </div>
              )}

              {tab === 'razorpay' && razorpayConfigured ? (
                <div>
                  <p className="text-sm text-slate-500 mb-4 leading-relaxed">
                    Pay securely via Razorpay — UPI, cards, netbanking, and wallets.
                  </p>
                  <button onClick={payRazorpay} disabled={busy}
                    className="w-full btn-primary text-sm flex items-center justify-center gap-2 disabled:opacity-50">
                    {busy ? <Loader2 size={15} className="animate-spin" /> : <CreditCard size={15} />}
                    Pay {formatINR(fee.amount)}
                  </button>
                </div>
              ) : upiConfigured ? (
                <div>
                  <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 flex flex-col items-center">
                    {qrDataUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={qrDataUrl} alt="UPI QR code" className="w-44 h-44" />
                    ) : (
                      <div className="w-44 h-44 flex items-center justify-center"><div className="spinner" /></div>
                    )}
                    <p className="text-xs text-slate-500 mt-3 text-center">
                      Scan with any UPI app to pay <strong>{formatINR(fee.amount)}</strong> to{' '}
                      <strong>{upi.vpa}</strong>
                    </p>
                    <p className="text-[10px] text-slate-400 mt-1">Ref: {fee.upi_reference}</p>
                  </div>

                  <label className="text-xs font-semibold text-slate-600 mb-1.5 mt-4 block uppercase tracking-wide">
                    After paying, enter your UPI reference
                  </label>
                  <input value={txnRef} onChange={e => setTxnRef(e.target.value)}
                    placeholder="e.g. 4156XXXXXXX12"
                    className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400/40 bg-white" />
                  <button onClick={submitUpiClaim} disabled={busy || !txnRef.trim()}
                    className="w-full btn-primary text-sm mt-3 flex items-center justify-center gap-2 disabled:opacity-50">
                    {busy ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />}
                    I&apos;ve paid
                  </button>
                </div>
              ) : null}

              {error && (
                <div className="flex items-center gap-2 p-3 mt-4 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-xs">
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
      className={`flex-1 flex items-center justify-center gap-1.5 text-xs font-semibold py-2 rounded-lg transition-colors ${
        active ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500'
      }`}>
      {icon} {label}
    </button>
  )
}
