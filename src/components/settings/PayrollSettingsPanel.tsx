'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { Check } from 'lucide-react'
import BankPayoutSettings from '@/components/settings/BankPayoutSettings'
import HiddenMembersSettings from '@/components/salary/HiddenMembersSettings'
import CycleCalibrationCompact from '@/components/salary/CycleCalibrationCompact'
import { ADMIN } from '@/components/salary/adminUi'
import {
  PayrollCalibration, DEFAULT_PAYROLL_CALIBRATION,
  fetchPayrollCalibration, savePayrollCalibration,
} from '@/lib/payroll'

/**
 * Everything that shapes a pay cycle before one is opened, as a panel with no
 * page chrome of its own.
 *
 * It is a component rather than page markup because it is mounted twice: as
 * /admin/payroll-settings, and as the popup behind the Salary Manager's
 * settings button. "The same settings in both places" is a claim that only
 * stays true if there is one copy of them, so there is one.
 *
 * Two sections, and the split matters:
 *
 *   • Salary payout — how money physically leaves the school's bank. The form
 *     is the same component Driver Payroll Settings mounts, so there is one
 *     credential form in the product rather than several that drift.
 *   • Default cycle settings — the PF / ESI / LOP / bonus calibration a new
 *     cycle starts from. Deliberately the same compact form the cycle settings
 *     popup shows, because an admin who has learnt one has learnt the other,
 *     and a per-cycle override should be recognisably the same rules as the
 *     default it is departing from.
 */
export default function PayrollSettingsPanel() {
  const [loading, setLoading] = useState(true)
  const [calibration, setCalibration] = useState<PayrollCalibration>(DEFAULT_PAYROLL_CALIBRATION)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setCalibration(await fetchPayrollCalibration())
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const saveCalibration = async () => {
    setSaving(true); setError(null)
    const res = await savePayrollCalibration(calibration)
    setSaving(false)
    if (res.success) { setSaved(true); setTimeout(() => setSaved(false), 2000) }
    else setError(res.error ?? 'Could not save the calibration')
  }

  return (
    <div className="space-y-8">
      <section>
        <p className="text-[10px] font-bold uppercase tracking-widest text-[#B8983C] mb-1">Salary payout</p>
        <p className="text-xs text-[#71717A] mb-3 leading-relaxed">
          How salaries reach staff bank accounts from your school&apos;s own bank. Driver payroll shares this
          connection and is configured under Bus Finance in App Settings.
        </p>
        <BankPayoutSettings ctx="salary" />
        <div className="mt-4">
          <HiddenMembersSettings />
        </div>
      </section>

      <section>
        <p className="text-[10px] font-bold uppercase tracking-widest text-[#B8983C] mb-1">Default cycle settings</p>
        <p className="text-xs text-[#71717A] mb-3 leading-relaxed">
          What every new pay cycle starts from. These are the same rules the cycle settings popup edits — a
          cycle can still override them for itself, and one that does says so at the top of its sheet.
        </p>

        {loading ? (
          <div className={`${ADMIN.card} h-64 animate-pulse`} />
        ) : (
          <div className="bg-white border border-[#E4E4E7] p-3">
            <CycleCalibrationCompact calibration={calibration} onChange={setCalibration} />

            {error && <p className="text-xs text-rose-600 mt-3">{error}</p>}

            <div className="flex flex-wrap items-center gap-2 mt-3">
              <button onClick={saveCalibration} disabled={saving}
                className="inline-flex items-center justify-center gap-1.5 bg-[#27272A] hover:bg-[#18181B] text-white text-xs font-semibold px-4 py-2 transition-colors disabled:opacity-40">
                {saved ? <><Check size={13} /> Saved</> : saving ? 'Saving…' : 'Save defaults'}
              </button>
              <p className="text-[11px] text-[#A1A1AA]">
                Changing a default does not touch a cycle already running on its own override.
              </p>
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
