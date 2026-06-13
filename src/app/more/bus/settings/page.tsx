'use client'

import React, { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { ArrowLeft, CreditCard, QrCode, Check, Info, ShieldCheck } from 'lucide-react'
import ProtectedLayout from '@/components/ProtectedLayout'
import {
  RazorpayConfig, UpiConfig, SmartCollectConfig,
  fetchRazorpayConfig, saveRazorpayConfig, fetchUpiConfig, saveUpiConfig,
  fetchSmartCollectConfig, saveSmartCollectConfig,
} from '@/lib/bus'

export default function BusPaymentSettingsPage() {
  const [loading, setLoading] = useState(true)
  const [rzp, setRzp] = useState<RazorpayConfig>({ enabled: false, key_id: '' })
  const [upi, setUpi] = useState<UpiConfig>({ vpa: '', payee_name: '' })
  const [sc, setSc] = useState<SmartCollectConfig>({ enabled: false, mode: 'reference', provider_name: '' })
  const [savingRzp, setSavingRzp] = useState(false)
  const [savingUpi, setSavingUpi] = useState(false)
  const [savingSc, setSavingSc] = useState(false)
  const [savedRzp, setSavedRzp] = useState(false)
  const [savedUpi, setSavedUpi] = useState(false)
  const [savedSc, setSavedSc] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const [r, u, s] = await Promise.all([fetchRazorpayConfig(), fetchUpiConfig(), fetchSmartCollectConfig()])
    setRzp(r); setUpi(u); setSc(s)
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const saveRzp = async () => {
    setSavingRzp(true)
    const res = await saveRazorpayConfig(rzp)
    setSavingRzp(false)
    if (res.success) { setSavedRzp(true); setTimeout(() => setSavedRzp(false), 2000) }
  }
  const saveUpi = async () => {
    setSavingUpi(true)
    const res = await saveUpiConfig(upi)
    setSavingUpi(false)
    if (res.success) { setSavedUpi(true); setTimeout(() => setSavedUpi(false), 2000) }
  }
  const saveSc = async () => {
    setSavingSc(true)
    const res = await saveSmartCollectConfig(sc)
    setSavingSc(false)
    if (res.success) { setSavedSc(true); setTimeout(() => setSavedSc(false), 2000) }
  }

  return (
    <ProtectedLayout adminOnly>
      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6">
        <Link href="/more/bus" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 mb-4">
          <ArrowLeft size={16} /> Bus Manager
        </Link>

        <h1 className="font-display text-2xl font-bold text-slate-800 mb-1">Payment Settings</h1>
        <p className="text-sm text-slate-500 mb-6">Configure how passengers pay bus fees.</p>

        {loading ? (
          <div className="text-center py-12"><div className="spinner mx-auto mb-3" /></div>
        ) : (
          <div className="space-y-5">
            {/* Razorpay */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
              <div className="flex items-center gap-2 mb-4">
                <div className="p-1.5 bg-indigo-100 rounded-lg"><CreditCard size={16} className="text-indigo-600" /></div>
                <h2 className="font-semibold text-slate-800">Razorpay</h2>
              </div>

              <label className="flex items-center justify-between mb-4 cursor-pointer">
                <span className="text-sm text-slate-700">Enable Razorpay checkout for passengers</span>
                <input type="checkbox" checked={rzp.enabled}
                  onChange={e => setRzp({ ...rzp, enabled: e.target.checked })}
                  className="w-5 h-5 accent-indigo-600" />
              </label>

              <label className="text-xs font-semibold text-slate-600 mb-1.5 block uppercase tracking-wide">Key ID (public)</label>
              <input value={rzp.key_id} onChange={e => setRzp({ ...rzp, key_id: e.target.value })}
                placeholder="rzp_live_xxxxxxxx or rzp_test_xxxxxxxx"
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400/40 bg-white" />

              <div className="flex items-start gap-2 mt-3 p-3 bg-amber-50 border border-amber-100 rounded-xl text-xs text-amber-700">
                <Info size={14} className="flex-shrink-0 mt-0.5" />
                <span>
                  The <strong>Key Secret</strong> and <strong>Webhook Secret</strong> are never stored here — set them as
                  the server env vars <code>RAZORPAY_KEY_SECRET</code> and <code>RAZORPAY_WEBHOOK_SECRET</code>. Point a
                  Razorpay <em>payment.captured</em> webhook at <code>/api/bus/razorpay/webhook</code>.
                </span>
              </div>

              <button onClick={saveRzp} disabled={savingRzp}
                className="btn-primary text-sm mt-4 flex items-center gap-2 disabled:opacity-50">
                {savedRzp ? <><Check size={15} /> Saved</> : savingRzp ? 'Saving…' : 'Save Razorpay'}
              </button>
            </div>

            {/* UPI QR */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
              <div className="flex items-center gap-2 mb-4">
                <div className="p-1.5 bg-emerald-100 rounded-lg"><QrCode size={16} className="text-emerald-600" /></div>
                <h2 className="font-semibold text-slate-800">UPI QR (no gateway fee)</h2>
              </div>
              <p className="text-xs text-slate-500 mb-4 leading-relaxed">
                Passengers scan a UPI QR and pay you directly — bypassing the Razorpay cut. They then submit their UPI
                transaction reference, which you verify on the Fees dashboard.
              </p>

              <label className="text-xs font-semibold text-slate-600 mb-1.5 block uppercase tracking-wide">UPI ID (VPA)</label>
              <input value={upi.vpa} onChange={e => setUpi({ ...upi, vpa: e.target.value })}
                placeholder="schoolname@okhdfcbank"
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400/40 bg-white mb-3" />

              <label className="text-xs font-semibold text-slate-600 mb-1.5 block uppercase tracking-wide">Payee name</label>
              <input value={upi.payee_name} onChange={e => setUpi({ ...upi, payee_name: e.target.value })}
                placeholder="ABC School Transport"
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400/40 bg-white" />

              <button onClick={saveUpi} disabled={savingUpi}
                className="btn-primary text-sm mt-4 flex items-center gap-2 disabled:opacity-50">
                {savedUpi ? <><Check size={15} /> Saved</> : savingUpi ? 'Saving…' : 'Save UPI'}
              </button>
            </div>

            {/* Smart Collect — auto-reconciliation */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
              <div className="flex items-center gap-2 mb-4">
                <div className="p-1.5 bg-orange-100 rounded-lg"><ShieldCheck size={16} className="text-orange-600" /></div>
                <h2 className="font-semibold text-slate-800">Auto-reconciliation (Smart Collect)</h2>
              </div>
              <p className="text-xs text-slate-500 mb-4 leading-relaxed">
                Like NTU&apos;s PayNow: when enabled, your bank/PSP notifies the app the moment a UPI payment lands, and
                the fee is marked paid automatically — students never self-declare. Needs the UPI ID above and a bank/PSP
                that posts an incoming-payment webhook.
              </p>

              <label className="flex items-center justify-between mb-4 cursor-pointer">
                <span className="text-sm text-slate-700">Auto-confirm UPI payments via webhook</span>
                <input type="checkbox" checked={sc.enabled}
                  onChange={e => setSc({ ...sc, enabled: e.target.checked })}
                  className="w-5 h-5 accent-orange-600" />
              </label>

              <label className="text-xs font-semibold text-slate-600 mb-1.5 block uppercase tracking-wide">Matching mode</label>
              <select value={sc.mode} onChange={e => setSc({ ...sc, mode: e.target.value as SmartCollectConfig['mode'] })}
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400/40 bg-white mb-3">
                <option value="reference">Reference — one UPI ID, unique reference per fee</option>
                <option value="virtual_vpa">Virtual VPA — provider allots a unique VPA per fee</option>
              </select>

              <label className="text-xs font-semibold text-slate-600 mb-1.5 block uppercase tracking-wide">Provider name (label)</label>
              <input value={sc.provider_name} onChange={e => setSc({ ...sc, provider_name: e.target.value })}
                placeholder="e.g. ICICI Eazypay / Cashfree"
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400/40 bg-white" />

              <div className="flex items-start gap-2 mt-3 p-3 bg-amber-50 border border-amber-100 rounded-xl text-xs text-amber-700">
                <Info size={14} className="flex-shrink-0 mt-0.5" />
                <span>
                  Point your bank/PSP&apos;s payment-received webhook at <code>/api/bus/upi/webhook</code> and set the env var{' '}
                  <code>SMART_COLLECT_WEBHOOK_SECRET</code> to its HMAC secret. Virtual-VPA mode also needs{' '}
                  <code>SMART_COLLECT_BASE_URL</code> and <code>SMART_COLLECT_API_KEY</code>. The webhook field mapping
                  lives in <code>src/lib/smartCollect.ts</code> — adjust it to your provider&apos;s payload.
                </span>
              </div>

              <button onClick={saveSc} disabled={savingSc}
                className="btn-primary text-sm mt-4 flex items-center gap-2 disabled:opacity-50">
                {savedSc ? <><Check size={15} /> Saved</> : savingSc ? 'Saving…' : 'Save Smart Collect'}
              </button>
            </div>
          </div>
        )}
      </div>
    </ProtectedLayout>
  )
}
