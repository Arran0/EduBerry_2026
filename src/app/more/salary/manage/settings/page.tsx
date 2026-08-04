'use client'

import React, { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { ArrowLeft, Banknote, Check, ShieldCheck } from 'lucide-react'
import ProtectedLayout from '@/components/ProtectedLayout'
import { PayoutConfig, fetchPayoutConfig, savePayoutConfig } from '@/lib/salary'
import { PayoutSecrets, fetchPaymentSecrets, savePaymentSecrets } from '@/lib/paymentSecrets'
import { PayrollCalibration, DEFAULT_PAYROLL_CALIBRATION, fetchPayrollCalibration, savePayrollCalibration } from '@/lib/payroll'
import PayrollCalibrationFields from '@/components/salary/PayrollCalibrationFields'

export default function SalaryPayoutSettingsPage() {
  const [loading, setLoading] = useState(true)
  const [cfg, setCfg] = useState<PayoutConfig>({ enabled: false, provider: 'manual', key_id: '' })
  const [secrets, setSecrets] = useState<PayoutSecrets>({ key_secret: '', account_number: '', webhook_secret: '' })
  const [calibration, setCalibration] = useState<PayrollCalibration>(DEFAULT_PAYROLL_CALIBRATION)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const [c, s, cal] = await Promise.all([fetchPayoutConfig(), fetchPaymentSecrets('payout'), fetchPayrollCalibration()])
    setCfg(c)
    setSecrets({ key_secret: s.key_secret ?? '', account_number: s.account_number ?? '', webhook_secret: s.webhook_secret ?? '' })
    setCalibration(cal)
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const save = async () => {
    setSaving(true)
    const [res] = await Promise.all([
      savePayoutConfig(cfg),
      savePaymentSecrets('payout', { ...secrets }),
      savePayrollCalibration(calibration),
    ])
    setSaving(false)
    if (res.success) { setSaved(true); setTimeout(() => setSaved(false), 2000) }
  }

  return (
    <ProtectedLayout adminOnly>
      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6">
        <Link href="/admin/settings" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 mb-4">
          <ArrowLeft size={16} /> App Settings
        </Link>

        <h1 className="font-display text-2xl font-bold text-slate-800 mb-1">Payout Settings</h1>
        <p className="text-sm text-slate-500 mb-6">
          Configure how salaries are disbursed to staff bank accounts, and the default PF / ESI / LOP / bonus
          calibration used when running a pay cycle (each cycle can still override these for itself).
        </p>

        {loading ? (
          <div className="text-center py-12"><div className="spinner mx-auto mb-3" /></div>
        ) : (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 mb-5">
            <div className="flex items-center gap-2 mb-4">
              <div className="p-1.5 bg-emerald-100 rounded-lg"><Banknote size={16} className="text-emerald-600" /></div>
              <h2 className="font-semibold text-slate-800">Bank transfer provider</h2>
            </div>

            <p className="text-xs text-slate-500 mb-4 leading-relaxed">
              The app never moves money directly. When enabled, it calls a payout provider&apos;s bulk bank-transfer API
              (which the school authorizes against its own payout account) to disburse an approved cycle. When disabled,
              admins disburse manually and mark each record as paid.
            </p>

            <label className="flex items-center justify-between mb-4 cursor-pointer">
              <span className="text-sm text-slate-700">Enable automated payouts</span>
              <input type="checkbox" checked={cfg.enabled}
                onChange={e => setCfg({ ...cfg, enabled: e.target.checked })}
                className="w-5 h-5 accent-emerald-600" />
            </label>

            <label className="text-xs font-semibold text-slate-600 mb-1.5 block uppercase tracking-wide">Provider</label>
            <select value={cfg.provider} onChange={e => setCfg({ ...cfg, provider: e.target.value as PayoutConfig['provider'] })}
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400/40 bg-white mb-3">
              <option value="manual">Manual — export bank CSV / pay via portal, mark paid by hand</option>
              <option value="razorpayx">Automated — bank transfer via RazorpayX</option>
            </select>

            <label className="text-xs font-semibold text-slate-600 mb-1.5 block uppercase tracking-wide">Key ID (public)</label>
            <input value={cfg.key_id} onChange={e => setCfg({ ...cfg, key_id: e.target.value })}
              placeholder="e.g. rzp_live_xxxxxxxx"
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400/40 bg-white mb-3" />

            <label className="text-xs font-semibold text-slate-600 mb-1.5 block uppercase tracking-wide">Key Secret</label>
            <input type="password" autoComplete="off" value={secrets.key_secret}
              onChange={e => setSecrets({ ...secrets, key_secret: e.target.value })}
              placeholder="Provider API key secret"
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400/40 bg-white mb-3" />

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-slate-600 mb-1.5 block uppercase tracking-wide">Payout account number</label>
                <input value={secrets.account_number} onChange={e => setSecrets({ ...secrets, account_number: e.target.value })}
                  placeholder="School payout account"
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-emerald-400/40 bg-white" />
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-600 mb-1.5 block uppercase tracking-wide">Webhook Secret</label>
                <input type="password" autoComplete="off" value={secrets.webhook_secret}
                  onChange={e => setSecrets({ ...secrets, webhook_secret: e.target.value })}
                  placeholder="HMAC secret for payout webhook"
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400/40 bg-white" />
              </div>
            </div>

            <div className="flex items-start gap-2 mt-3 p-3 bg-emerald-50 border border-emerald-100 rounded-xl text-xs text-emerald-700">
              <ShieldCheck size={14} className="flex-shrink-0 mt-0.5" />
              <span>
                Secrets are stored admin-only (never readable by staff) and shared with driver payroll payouts.
                Point the provider&apos;s payout webhook at <code>/api/salary/payout/webhook</code>. The RazorpayX/Cashfree
                integrations are stubbed and fail closed until wired up in <code>src/lib/payoutProvider.ts</code>.
              </span>
            </div>
          </div>
        )}

        {!loading && (
          <PayrollCalibrationFields calibration={calibration} onChange={setCalibration} />
        )}

        {!loading && (
          <button onClick={save} disabled={saving}
            className="btn-primary text-sm mt-5 flex items-center gap-2 disabled:opacity-50">
            {saved ? <><Check size={15} /> Saved</> : saving ? 'Saving…' : 'Save settings'}
          </button>
        )}
      </div>
    </ProtectedLayout>
  )
}
