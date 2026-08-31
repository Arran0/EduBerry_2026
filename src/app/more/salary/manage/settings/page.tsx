'use client'

import React, { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { ArrowLeft, Check } from 'lucide-react'
import ProtectedLayout from '@/components/ProtectedLayout'
import BankPayoutSettings from '@/components/settings/BankPayoutSettings'
import {
  PayrollCalibration, DEFAULT_PAYROLL_CALIBRATION,
  fetchPayrollCalibration, savePayrollCalibration,
} from '@/lib/payroll'
import PayrollCalibrationFields from '@/components/salary/PayrollCalibrationFields'
import HiddenMembersSettings from '@/components/salary/HiddenMembersSettings'

// Staff salary payout settings. The bank connection form is the same component
// App Settings and Driver Payroll Settings mount, so there is one credential
// form in the product rather than three that drift apart. Only the payroll
// calibration below is specific to this screen.

export default function SalaryPayoutSettingsPage() {
  const [loading, setLoading] = useState(true)
  const [calibration, setCalibration] = useState<PayrollCalibration>(DEFAULT_PAYROLL_CALIBRATION)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setCalibration(await fetchPayrollCalibration())
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const saveCalibration = async () => {
    setSaving(true)
    const res = await savePayrollCalibration(calibration)
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
          How salaries reach staff bank accounts from your school&apos;s bank, and the default
          PF / ESI / LOP / bonus calibration used when running a pay cycle (each cycle can still
          override these for itself).
        </p>

        <BankPayoutSettings ctx="salary" />

        <div className="mt-5">
          <HiddenMembersSettings />
        </div>

        {!loading && (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 mt-5">
            <PayrollCalibrationFields calibration={calibration} onChange={setCalibration} />

            <button onClick={saveCalibration} disabled={saving}
              className="btn-primary text-sm mt-5 flex items-center gap-2 disabled:opacity-50">
              {saved ? <><Check size={15} /> Saved</> : saving ? 'Saving…' : 'Save calibration'}
            </button>
          </div>
        )}
      </div>
    </ProtectedLayout>
  )
}
