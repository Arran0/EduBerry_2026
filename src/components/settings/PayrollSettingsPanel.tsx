'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { Check } from 'lucide-react'
import BankPayoutSettings from '@/components/settings/BankPayoutSettings'
import { SettingsGlass } from '@/components/settings/primitives'
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
 * It is a component rather than page markup: it is the popup behind the
 * Salary page's banner Settings button (/admin/payroll-settings redirects
 * there), with no page chrome of its own.
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
    <div className="space-y-6">
      <section>
        <h3 className="text-[15px] font-semibold text-slate-900 leading-snug">Salary payout</h3>
        <p className="text-[12.5px] text-slate-500 mt-0.5 mb-3 leading-relaxed">
          How salaries leave the school&apos;s bank. Driver payroll uses the same connection; its own options are
          under Bus Finance in App Settings.
        </p>
        <SettingsGlass>
          <BankPayoutSettings ctx="salary" />
        </SettingsGlass>
      </section>

      <section>
        <HiddenMembersSettings />
      </section>

      <section>
        <h3 className="text-[15px] font-semibold text-slate-900 leading-snug">Rules for new cycles</h3>
        <p className="text-[12.5px] text-slate-500 mt-0.5 mb-3 leading-relaxed">
          Every new pay cycle starts with these. A cycle can set its own from its Rules button, and the sheet says
          when it has.
        </p>

        {loading ? (
          <div className={`${ADMIN.card} h-64 animate-pulse`} />
        ) : (
          <>
            <CycleCalibrationCompact calibration={calibration} onChange={setCalibration} />

            {error && <p className="text-[12.5px] text-[#A93232] mt-3">{error}</p>}

            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 mt-3">
              <button onClick={saveCalibration} disabled={saving} className={ADMIN.darkBtn}>
                {saved ? <><Check size={13} /> Saved</> : saving ? 'Saving…' : 'Save rules'}
              </button>
              <p className="text-[12px] text-slate-500 leading-snug">
                Cycles that already have their own rules keep them.
              </p>
            </div>
          </>
        )}
      </section>
    </div>
  )
}
