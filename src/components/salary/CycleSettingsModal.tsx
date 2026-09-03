'use client'

import React, { useState } from 'react'
import Link from 'next/link'
import { SlidersHorizontal, RotateCcw, Banknote, ExternalLink } from 'lucide-react'
import ModalShell from '@/components/ui/ModalShell'
import { PayrollCalibration } from '@/lib/payroll'
import CycleCalibrationCompact from '@/components/salary/CycleCalibrationCompact'
import BankPayoutSettings from '@/components/settings/BankPayoutSettings'

/**
 * Per-cycle PF/ESI/LOP/bonus override editor, with the payout settings that
 * govern how the cycle is actually disbursed on a second tab.
 *
 * The two tabs are not the same kind of thing, and the interface says so rather
 * than letting the layout imply otherwise. Cycle rules belong to this cycle:
 * saving them overrides the site-wide default for this month alone. Payout
 * settings are site-wide — one bank connection funds every cycle, staff and
 * driver alike — so editing them here changes every cycle, not just this one.
 * They are here because the question "will this cycle actually pay out?" gets
 * asked while looking at the cycle, and sending someone to Admin Space to
 * answer it is how a disbursement gets attempted with a half-configured bank.
 *
 * Sharp-edged and dense to match the sheet it opens over — see
 * `CycleCalibrationCompact` for why this doesn't reuse the settings page's
 * form. Whether the cycle is currently on its own rules or the site-wide
 * default is stated in the subtitle, because the fields look identical either
 * way and that is the first thing anyone opening this needs to know.
 */
export default function CycleSettingsModal({
  initial, hasOverride, periodLabel, ctx = 'salary', onClose, onSave,
}: {
  initial: PayrollCalibration
  hasOverride: boolean
  /** e.g. "June 2026" — names the cycle these rules apply to. */
  periodLabel?: string
  /** Which payout connection the payout tab shows. Staff cycles and driver payroll share it. */
  ctx?: 'salary' | 'driver'
  onClose: () => void
  onSave: (config: PayrollCalibration | null) => Promise<void> | void
}) {
  const [tab, setTab] = useState<'cycle' | 'payout'>('cycle')
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
      minHClass="sm:min-h-[34rem]"
      headerActions={
        <div className="flex items-center gap-0.5 bg-[#F4F4F5] border border-[#E4E4E7] p-0.5">
          {([['cycle', 'This cycle', SlidersHorizontal], ['payout', 'Payout', Banknote]] as const).map(([id, label, Icon]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-semibold transition-colors ${
                tab === id ? 'bg-[#27272A] text-white' : 'text-[#71717A] hover:text-[#27272A]'
              }`}
            >
              <Icon size={12} /> {label}
            </button>
          ))}
        </div>
      }
      footer={
        tab === 'cycle' ? (
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
        ) : (
          // The payout form saves itself; a second Save here would be a button
          // that looks like it does something and does not.
          <Link href="/admin/payroll-settings"
            className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-[#71717A] hover:text-[#27272A]">
            <ExternalLink size={12} /> Open Payroll Settings
          </Link>
        )
      }
    >
      {tab === 'cycle' ? (
        <CycleCalibrationCompact calibration={calibration} onChange={setCalibration} />
      ) : (
        <div>
          <div className="mb-2.5 px-2.5 py-2 bg-[#FBF6E9] border border-[#EFE3C4]">
            <p className="text-[11px] text-[#8A6D1F] leading-relaxed">
              <strong>These settings are site-wide.</strong> One bank connection funds every pay cycle, staff and
              driver alike — changing anything here affects all of them, not just {periodLabel ?? 'this cycle'}.
            </p>
          </div>
          <BankPayoutSettings ctx={ctx} />
        </div>
      )}
    </ModalShell>
  )
}
