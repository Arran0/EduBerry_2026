'use client'

import React, { useState } from 'react'
import { SlidersHorizontal, RotateCcw, Loader2 } from 'lucide-react'
import ModalShell from '@/components/ui/ModalShell'
import { Btn, SALARY_ICON } from '@/components/salary/ui'
import { PayrollCalibration } from '@/lib/payroll'
import CycleCalibrationCompact from '@/components/salary/CycleCalibrationCompact'

/**
 * Per-cycle PF/ESI/LOP/bonus override editor.
 *
 * Only this cycle's rules. The payout connection is site-wide — one bank funds
 * every cycle, staff and driver alike — so it lives with the other site-wide
 * settings, behind the Salary Manager's own settings button, and not in a popup
 * whose every other control applies to one month.
 *
 * Sharp-edged and dense to match the sheet it opens over — see
 * `CycleCalibrationCompact` for why this doesn't reuse the settings page's
 * form. Whether the cycle is currently on its own rules or the site-wide
 * default is stated in the subtitle, because the fields look identical either
 * way and that is the first thing anyone opening this needs to know.
 */
export default function CycleSettingsModal({ initial, hasOverride, periodLabel, onClose, onSave }: {
  initial: PayrollCalibration
  hasOverride: boolean
  /** e.g. "June 2026" — names the cycle these rules apply to. */
  periodLabel?: string
  onClose: () => void
  onSave: (config: PayrollCalibration | null) => Promise<void> | void
}) {
  const [calibration, setCalibration] = useState<PayrollCalibration>(initial)
  const [saving, setSaving] = useState(false)

  const save = async () => {
    setSaving(true)
    await onSave(calibration)
    setSaving(false)
  }

  const resetToDefault = async () => {
    setSaving(true)
    await onSave(null)
    setSaving(false)
  }

  return (
    <ModalShell
      onClose={onClose}
      size="xl"
      sharp
      title={periodLabel ? `Rules for ${periodLabel}` : 'Cycle rules'}
      subtitle={hasOverride ? 'This cycle has its own rules' : 'Following the school-wide rules'}
      icon={<SlidersHorizontal size={16} />}
      iconClassName={SALARY_ICON}
      footer={
        <div className="flex flex-wrap items-center gap-2">
          {hasOverride && (
            <Btn tone="ghost" onClick={resetToDefault} disabled={saving}
              title="Drop this cycle's own rules and follow the school-wide ones again">
              <RotateCcw size={13} /> Use school rules
            </Btn>
          )}
          <Btn tone="dark" onClick={save} disabled={saving} className="ml-auto">
            {saving && <Loader2 size={13} className="animate-spin" />}
            {saving ? 'Saving…' : 'Save for this cycle'}
          </Btn>
        </div>
      }
    >
      <CycleCalibrationCompact calibration={calibration} onChange={setCalibration} />
    </ModalShell>
  )
}
