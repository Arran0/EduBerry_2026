'use client'

import React, { useState } from 'react'
import { SlidersHorizontal, RotateCcw } from 'lucide-react'
import ModalShell from '@/components/ui/ModalShell'
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
      title="Cycle settings"
      subtitle={`${periodLabel ? `${periodLabel} · ` : ''}${
        hasOverride ? 'On its own rules' : 'Following the site-wide default'
      }`}
      icon={<SlidersHorizontal size={16} />}
      iconClassName="bg-[#27272A] text-white"
      bodyClassName="!px-3 !py-3 bg-[#FAFAFA]"
      footer={
        <div className="flex items-center gap-2">
          {hasOverride && (
            <button onClick={resetToDefault} disabled={saving}
              title="Discard this cycle's own rules and follow the site-wide default again"
              className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-[#71717A] hover:text-[#27272A] disabled:opacity-40">
              <RotateCcw size={12} /> Use site default
            </button>
          )}
          <button onClick={save} disabled={saving}
            className="ml-auto inline-flex items-center justify-center bg-[#27272A] hover:bg-[#18181B] text-white text-xs font-semibold px-4 py-2 transition-colors disabled:opacity-40">
            {saving ? 'Saving…' : 'Save for this cycle'}
          </button>
        </div>
      }
    >
      <CycleCalibrationCompact calibration={calibration} onChange={setCalibration} />
    </ModalShell>
  )
}
