'use client'

import React, { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { ArrowLeft, Check, Sparkles } from 'lucide-react'
import ProtectedLayout from '@/components/ProtectedLayout'
import BankPayoutSettings from '@/components/settings/BankPayoutSettings'
import { SalaryRates, DEFAULT_SALARY_RATES, fetchSalaryRates, saveSalaryRates } from '@/lib/salary'

// Staff salary payout settings. The bank connection form is the same component
// App Settings and Driver Payroll Settings mount, so there is one credential
// form in the product rather than three that drift apart. Only the salary
// recommendation rates are specific to this screen.

export default function SalaryPayoutSettingsPage() {
  const [loading, setLoading] = useState(true)
  const [rates, setRates] = useState<SalaryRates>(DEFAULT_SALARY_RATES)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setRates(await fetchSalaryRates())
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const saveRates = async () => {
    setSaving(true)
    const res = await saveSalaryRates(rates)
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
        <p className="text-sm text-slate-500 mb-6">How salaries reach staff bank accounts from your school&apos;s bank.</p>

        <BankPayoutSettings ctx="salary" />

        {!loading && (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 mt-5">
            <div className="flex items-center gap-2 mb-4">
              <div className="p-1.5 bg-amber-100 rounded-lg"><Sparkles size={16} className="text-amber-600" /></div>
              <h2 className="font-semibold text-slate-800">Recommendation rates</h2>
            </div>

            <p className="text-xs text-slate-500 mb-4 leading-relaxed">
              When reviewing a pay cycle, each staff record shows a suggested bonus (from task-manager
              bonus points earned that month) and penalty (from that month&apos;s absent days). These rates
              convert points and absent days into rupee amounts. The admin still applies each suggestion by hand.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-slate-600 mb-1.5 block uppercase tracking-wide">₹ per bonus point</label>
                <input type="number" min="0" step="1" value={rates.bonus_point_value}
                  onChange={e => setRates({ ...rates, bonus_point_value: parseFloat(e.target.value) || 0 })}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-amber-400/40 bg-white" />
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-600 mb-1.5 block uppercase tracking-wide">₹ penalty per absent day</label>
                <input type="number" min="0" step="1" value={rates.absent_penalty_per_day}
                  onChange={e => setRates({ ...rates, absent_penalty_per_day: parseFloat(e.target.value) || 0 })}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-amber-400/40 bg-white" />
              </div>
            </div>

            <button onClick={saveRates} disabled={saving}
              className="btn-primary text-sm mt-5 flex items-center gap-2 disabled:opacity-50">
              {saved ? <><Check size={15} /> Saved</> : saving ? 'Saving…' : 'Save rates'}
            </button>
          </div>
        )}
      </div>
    </ProtectedLayout>
  )
}
