'use client'

import React, { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { ArrowLeft, CreditCard, QrCode, Check, Info, ShieldCheck } from 'lucide-react'
import ProtectedLayout from '@/components/ProtectedLayout'
import {
  RazorpayConfig, UpiConfig, SmartCollectConfig,
  fetchRazorpayConfig, saveRazorpayConfig, fetchUpiConfig, saveUpiConfig,
  fetchSmartCollectConfig, saveSmartCollectConfig,
} from '@/lib/fees'
import {
  RazorpaySecrets, SmartCollectSecrets, fetchPaymentSecrets, savePaymentSecrets,
} from '@/lib/paymentSecrets'

export default function FeePaymentSettingsPage() {
  const [loading, setLoading] = useState(true)
  const [rzp, setRzp] = useState<RazorpayConfig>({ enabled: false, key_id: '' })
  const [rzpSecrets, setRzpSecrets] = useState<RazorpaySecrets>({ key_secret: '', webhook_secret: '' })
  const [upi, setUpi] = useState<UpiConfig>({ vpa: '', payee_name: '' })
  const [sc, setSc] = useState<SmartCollectConfig>({ enabled: false, mode: 'reference', provider_name: '' })
  const [scSecrets, setScSecrets] = useState<SmartCollectSecrets>({ base_url: '', api_key: '', webhook_secret: '' })
  const [savingRzp, setSavingRzp] = useState(false)
  const [savingUpi, setSavingUpi] = useState(false)
  const [savingSc, setSavingSc] = useState(false)
  const [savedRzp, setSavedRzp] = useState(false)
  const [savedUpi, setSavedUpi] = useState(false)
  const [savedSc, setSavedSc] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const [r, u, s, rSec, sSec] = await Promise.all([
      fetchRazorpayConfig(), fetchUpiConfig(), fetchSmartCollectConfig(),
      fetchPaymentSecrets('razorpay'), fetchPaymentSecrets('smart_collect'),
    ])
    setRzp(r); setUpi(u); setSc(s)
    setRzpSecrets({ key_secret: rSec.key_secret ?? '', webhook_secret: rSec.webhook_secret ?? '' })
    setScSecrets({ base_url: sSec.base_url ?? '', api_key: sSec.api_key ?? '', webhook_secret: sSec.webhook_secret ?? '' })
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const saveRzp = async () => {
    setSavingRzp(true)
    const [res] = await Promise.all([
      saveRazorpayConfig(rzp),
      savePaymentSecrets('razorpay', { ...rzpSecrets }),
    ])
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
    const [res] = await Promise.all([
      saveSmartCollectConfig(sc),
      savePaymentSecrets('smart_collect', { ...scSecrets }),
    ])
    setSavingSc(false)
    if (res.success) { setSavedSc(true); setTimeout(() => setSavedSc(false), 2000) }
  }

  const btnCls = 'text-sm font-semibold py-2 px-4 rounded-xl bg-slate-800 text-white hover:bg-slate-900 transition-colors disabled:opacity-50 flex items-center gap-2'

  return (
    <ProtectedLayout adminOnly>
      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6">
        <Link href="/more/fees" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 mb-4">
          <ArrowLeft size={16} /> Fee Manager
        </Link>

        <h1 className="font-display text-2xl font-bold text-slate-800 mb-1">Payment Settings</h1>
        <p className="text-sm text-slate-500 mb-2">Configure how students pay school fees.</p>
        <div className="flex items-start gap-2 mb-6 p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-600">
          <Info size={14} className="flex-shrink-0 mt-0.5" />
          <span>These settings are shared site-wide — the same Razorpay / UPI / bank configuration also powers the Bus module.</span>
        </div>

        {loading ? (
          <div className="text-center py-12"><div className="spinner mx-auto mb-3" /></div>
        ) : (
          <div className="space-y-5">
            {/* Razorpay */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
              <div className="flex items-center gap-2 mb-4">
                <div className="p-1.5 bg-slate-100 rounded-lg"><CreditCard size={16} className="text-slate-700" /></div>
                <h2 className="font-semibold text-slate-800">Razorpay</h2>
              </div>

              <label className="flex items-center justify-between mb-4 cursor-pointer">
                <span className="text-sm text-slate-700">Enable Razorpay checkout for students</span>
                <input type="checkbox" checked={rzp.enabled}
                  onChange={e => setRzp({ ...rzp, enabled: e.target.checked })}
                  className="w-5 h-5 accent-slate-700" />
              </label>

              <label className="text-xs font-semibold text-slate-600 mb-1.5 block uppercase tracking-wide">Key ID (public)</label>
              <input value={rzp.key_id} onChange={e => setRzp({ ...rzp, key_id: e.target.value })}
                placeholder="rzp_live_xxxxxxxx or rzp_test_xxxxxxxx"
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400/40 bg-white mb-3" />

              <label className="text-xs font-semibold text-slate-600 mb-1.5 block uppercase tracking-wide">Key Secret</label>
              <input type="password" autoComplete="off" value={rzpSecrets.key_secret}
                onChange={e => setRzpSecrets({ ...rzpSecrets, key_secret: e.target.value })}
                placeholder="Razorpay key secret"
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400/40 bg-white mb-3" />

              <label className="text-xs font-semibold text-slate-600 mb-1.5 block uppercase tracking-wide">Webhook Secret</label>
              <input type="password" autoComplete="off" value={rzpSecrets.webhook_secret}
                onChange={e => setRzpSecrets({ ...rzpSecrets, webhook_secret: e.target.value })}
                placeholder="HMAC secret for the payment.captured webhook"
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400/40 bg-white" />

              <div className="flex items-start gap-2 mt-3 p-3 bg-emerald-50 border border-emerald-100 rounded-xl text-xs text-emerald-700">
                <ShieldCheck size={14} className="flex-shrink-0 mt-0.5" />
                <span>
                  Secrets are stored admin-only (never readable by students) and shared with the Bus module. Point a
                  Razorpay <em>payment.captured</em> webhook at <code>/api/fees/razorpay/webhook</code> using the Webhook Secret above.
                </span>
              </div>

              <button onClick={saveRzp} disabled={savingRzp} className={`mt-4 ${btnCls}`}>
                {savedRzp ? <><Check size={15} /> Saved</> : savingRzp ? 'Saving…' : 'Save Razorpay'}
              </button>
            </div>

            {/* UPI QR */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
              <div className="flex items-center gap-2 mb-4">
                <div className="p-1.5 bg-slate-100 rounded-lg"><QrCode size={16} className="text-slate-700" /></div>
                <h2 className="font-semibold text-slate-800">UPI QR (no gateway fee)</h2>
              </div>
              <p className="text-xs text-slate-500 mb-4 leading-relaxed">
                Students scan a UPI QR and pay you directly — bypassing the Razorpay cut. Each fee carries a unique
                reference you verify on the Issued dashboard (or auto-confirm via Smart Collect below).
              </p>

              <label className="text-xs font-semibold text-slate-600 mb-1.5 block uppercase tracking-wide">UPI ID (VPA)</label>
              <input value={upi.vpa} onChange={e => setUpi({ ...upi, vpa: e.target.value })}
                placeholder="schoolname@okhdfcbank"
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400/40 bg-white mb-3" />

              <label className="text-xs font-semibold text-slate-600 mb-1.5 block uppercase tracking-wide">Payee name</label>
              <input value={upi.payee_name} onChange={e => setUpi({ ...upi, payee_name: e.target.value })}
                placeholder="ABC School"
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400/40 bg-white" />

              <button onClick={saveUpi} disabled={savingUpi} className={`mt-4 ${btnCls}`}>
                {savedUpi ? <><Check size={15} /> Saved</> : savingUpi ? 'Saving…' : 'Save UPI'}
              </button>
            </div>

            {/* Smart Collect — auto-reconciliation */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
              <div className="flex items-center gap-2 mb-4">
                <div className="p-1.5 bg-slate-100 rounded-lg"><ShieldCheck size={16} className="text-slate-700" /></div>
                <h2 className="font-semibold text-slate-800">Auto-reconciliation (Smart Collect)</h2>
              </div>
              <p className="text-xs text-slate-500 mb-4 leading-relaxed">
                When enabled, your bank/PSP notifies the app the moment a UPI payment lands, and the fee is marked paid
                automatically — students never self-declare. Needs the UPI ID above and a bank/PSP that posts an
                incoming-payment webhook.
              </p>

              <label className="flex items-center justify-between mb-4 cursor-pointer">
                <span className="text-sm text-slate-700">Auto-confirm UPI payments via webhook</span>
                <input type="checkbox" checked={sc.enabled}
                  onChange={e => setSc({ ...sc, enabled: e.target.checked })}
                  className="w-5 h-5 accent-slate-700" />
              </label>

              <label className="text-xs font-semibold text-slate-600 mb-1.5 block uppercase tracking-wide">Matching mode</label>
              <select value={sc.mode} onChange={e => setSc({ ...sc, mode: e.target.value as SmartCollectConfig['mode'] })}
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400/40 bg-white mb-3">
                <option value="reference">Reference — one UPI ID, unique reference per fee</option>
                <option value="virtual_vpa">Virtual VPA — provider allots a unique VPA per fee</option>
              </select>

              <label className="text-xs font-semibold text-slate-600 mb-1.5 block uppercase tracking-wide">Provider name (label)</label>
              <input value={sc.provider_name} onChange={e => setSc({ ...sc, provider_name: e.target.value })}
                placeholder="e.g. ICICI Eazypay / Cashfree"
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400/40 bg-white mb-3" />

              <label className="text-xs font-semibold text-slate-600 mb-1.5 block uppercase tracking-wide">Webhook Secret</label>
              <input type="password" autoComplete="off" value={scSecrets.webhook_secret}
                onChange={e => setScSecrets({ ...scSecrets, webhook_secret: e.target.value })}
                placeholder="HMAC secret for the incoming-payment webhook"
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400/40 bg-white mb-3" />

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-1">
                <div>
                  <label className="text-xs font-semibold text-slate-600 mb-1.5 block uppercase tracking-wide">API base URL <span className="text-slate-400 normal-case">(virtual-VPA)</span></label>
                  <input value={scSecrets.base_url} onChange={e => setScSecrets({ ...scSecrets, base_url: e.target.value })}
                    placeholder="https://api.provider.com"
                    className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400/40 bg-white" />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-600 mb-1.5 block uppercase tracking-wide">API key <span className="text-slate-400 normal-case">(virtual-VPA)</span></label>
                  <input type="password" autoComplete="off" value={scSecrets.api_key}
                    onChange={e => setScSecrets({ ...scSecrets, api_key: e.target.value })}
                    placeholder="Provider API key"
                    className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400/40 bg-white" />
                </div>
              </div>

              <div className="flex items-start gap-2 mt-3 p-3 bg-emerald-50 border border-emerald-100 rounded-xl text-xs text-emerald-700">
                <ShieldCheck size={14} className="flex-shrink-0 mt-0.5" />
                <span>
                  Point your bank/PSP&apos;s payment-received webhook at <code>/api/fees/upi/webhook</code>. The base URL and
                  API key are only needed for virtual-VPA mode. Secrets are stored admin-only. The webhook field mapping
                  lives in <code>src/lib/smartCollect.ts</code> — adjust it to your provider&apos;s payload.
                </span>
              </div>

              <button onClick={saveSc} disabled={savingSc} className={`mt-4 ${btnCls}`}>
                {savedSc ? <><Check size={15} /> Saved</> : savingSc ? 'Saving…' : 'Save Smart Collect'}
              </button>
            </div>
          </div>
        )}
      </div>
    </ProtectedLayout>
  )
}
