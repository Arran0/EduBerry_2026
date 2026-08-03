'use client'

import React, { useState } from 'react'
import { SlidersHorizontal, RotateCcw } from 'lucide-react'
import ModalShell from '@/components/ui/ModalShell'
import { PayrollCalibration } from '@/lib/payroll'
import PayrollCalibrationFields from '@/components/salary/PayrollCalibrationFields'

/** Per-cycle PF/ESI/LOP/bonus override editor — same fields as the global settings page. */
export default function CycleSettingsModal({ initial, hasOverride, onClose, onSave }: {
  initial: PayrollCalibration
  hasOverride: boolean
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
      size="lg"
      title="Cycle settings"
      subtitle="Overrides the site-wide default for this cycle only"
      icon={<SlidersHorizontal size={16} />}
      iconClassName="bg-slate-800 text-white"
      footer={
        <div className="flex items-center gap-2">
          {hasOverride && (
            <button onClick={resetToDefault} disabled={saving}
              className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-700 disabled:opacity-50">
              <RotateCcw size={13} /> Use site default
            </button>
          )}
          <button onClick={save} disabled={saving} className="ml-auto btn-primary text-sm disabled:opacity-50">
            {saving ? 'Saving…' : 'Save for this cycle'}
          </button>
        </div>
      }
    >
      <PayrollCalibrationFields calibration={calibration} onChange={setCalibration} />
    </ModalShell>
  )
}
