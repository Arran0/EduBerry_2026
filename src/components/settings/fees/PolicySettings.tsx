'use client'

// Partial payments, grace days, allocation order and approval thresholds.
//
// Saving does not overwrite: fee_save_setting closes the current version and
// opens a new one, so a receipt printed last month can still be read against
// the rules that were live when it was printed.

import React, { useEffect, useState } from 'react'
import { Check, Info, Loader2 } from 'lucide-react'
import { ADMIN } from '@/components/fees/ui'
import {
  DEFAULT_FEE_SETTINGS, fetchFeeSettings, saveFeeSetting,
  type ApprovalThresholdSettings, type GraceSettings, type PaymentRuleSettings,
} from '@/lib/fees/settings'

export default function PolicySettings({ academicYearId }: { academicYearId: string | null }) {
  const [rules, setRules] = useState<PaymentRuleSettings>(DEFAULT_FEE_SETTINGS.payment_rules)
  const [grace, setGrace] = useState<GraceSettings>(DEFAULT_FEE_SETTINGS.grace)
  const [thresholds, setThresholds] = useState<ApprovalThresholdSettings>(DEFAULT_FEE_SETTINGS.approval_thresholds)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      setLoading(true)
      try {
        const s = await fetchFeeSettings(academicYearId)
        setRules(s.payment_rules)
        setGrace(s.grace)
        setThresholds(s.approval_thresholds)
      } finally {
        setLoading(false)
      }
    })()
  }, [academicYearId])

  const save = async () => {
    setSaving(true); setError(null)
    try {
      await Promise.all([
        saveFeeSetting('payment_rules', rules),
        saveFeeSetting('grace', grace),
        saveFeeSetting('approval_thresholds', thresholds),
      ])
      setSaved(true)
      setTimeout(() => setSaved(false), 2200)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save these settings.')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className={`${ADMIN.card} p-8 flex items-center justify-center gap-2 text-sm text-[#71717A]`}>
        <Loader2 size={16} className="animate-spin" /> Loading…
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className={`${ADMIN.card} p-5 space-y-5`}>
        <div>
          <h3 className="text-sm font-bold text-[#27272A]">Taking payment</h3>
          <p className="text-xs text-[#A1A1AA] mt-0.5">
            What the counter and the online payment page are allowed to accept.
          </p>
        </div>

        <Toggle
          checked={rules.partial_allowed}
          onChange={v => setRules({ ...rules, partial_allowed: v })}
          label="Allow part payment"
          help="A family who can pay half today pays half today. Refusing part payment is what turns a slow payer into a non-payer, so this is on unless the school has a reason."
        />

        {rules.partial_allowed && (
          <Field label="Smallest part payment (₹)" help="0 means any amount. Set it high enough that a ₹10 payment does not cost more to process than it collects.">
            <input
              type="number" min={0}
              value={rules.min_partial_amount}
              onChange={e => setRules({ ...rules, min_partial_amount: Number(e.target.value) || 0 })}
              className={`${ADMIN.inputPlain} max-w-[180px]`}
            />
          </Field>
        )}

        <Toggle
          checked={rules.allow_overpayment}
          onChange={v => setRules({ ...rules, allow_overpayment: v })}
          label="Accept more than the bill"
          help="A parent paying a round ₹10,000 against a ₹9,750 bill should not be turned away at the counter."
        />

        {rules.allow_overpayment && (
          <Toggle
            checked={rules.overpayment_becomes_credit}
            onChange={v => setRules({ ...rules, overpayment_becomes_credit: v })}
            label="Extra becomes a credit"
            help="The surplus is held against the student and applied to their next bill automatically. With this off it has to be refunded instead."
          />
        )}

        <Field
          label="When one payment covers several bills"
          help="How the counter splits an amount that does not exactly match one invoice."
        >
          <select
            value={rules.allocation_order}
            onChange={e => setRules({ ...rules, allocation_order: e.target.value as PaymentRuleSettings['allocation_order'] })}
            className={`${ADMIN.inputPlain} max-w-sm`}
          >
            <option value="oldest_due_first">Oldest bill first — clears the longest overdue</option>
            <option value="newest_due_first">Newest bill first</option>
            <option value="manual">Ask the clerk each time</option>
          </select>
        </Field>

        <Field
          label="How far back a payment may be dated (days)"
          help="Only staff who also hold the Backdate a payment permission can do this at all. This caps how far even they can reach, so a payment cannot be quietly moved into a closed month."
        >
          <input
            type="number" min={0} max={365}
            value={rules.allow_backdated_days}
            onChange={e => setRules({ ...rules, allow_backdated_days: Number(e.target.value) || 0 })}
            className={`${ADMIN.inputPlain} max-w-[180px]`}
          />
        </Field>
      </div>

      <div className={`${ADMIN.card} p-5 space-y-5`}>
        <div>
          <h3 className="text-sm font-bold text-[#27272A]">Grace</h3>
          <p className="text-xs text-[#A1A1AA] mt-0.5">
            How long after the due date a bill is still treated as on time.
          </p>
        </div>
        <Field label="Grace days" help="A bill is not overdue, and no late fee can start counting, until this many days after its due date.">
          <input
            type="number" min={0} max={90}
            value={grace.days}
            onChange={e => setGrace({ days: Number(e.target.value) || 0 })}
            className={`${ADMIN.inputPlain} max-w-[180px]`}
          />
        </Field>
      </div>

      <div className={`${ADMIN.card} p-5 space-y-5`}>
        <div>
          <h3 className="text-sm font-bold text-[#27272A]">Approval thresholds</h3>
          <p className="text-xs text-[#A1A1AA] mt-0.5">
            Above these amounts, the action waits for someone holding the matching
            approve permission. 0 means every one of them needs approval.
          </p>
        </div>
        <div className="grid sm:grid-cols-3 gap-4">
          <Field label="Discount over (₹)">
            <input type="number" min={0} value={thresholds.discount}
              onChange={e => setThresholds({ ...thresholds, discount: Number(e.target.value) || 0 })}
              className={ADMIN.inputPlain} />
          </Field>
          <Field label="Waiver over (₹)">
            <input type="number" min={0} value={thresholds.waiver}
              onChange={e => setThresholds({ ...thresholds, waiver: Number(e.target.value) || 0 })}
              className={ADMIN.inputPlain} />
          </Field>
          <Field label="Refund over (₹)">
            <input type="number" min={0} value={thresholds.refund}
              onChange={e => setThresholds({ ...thresholds, refund: Number(e.target.value) || 0 })}
              className={ADMIN.inputPlain} />
          </Field>
        </div>
        <p className="text-xs text-[#A1A1AA] flex items-start gap-1.5">
          <Info size={13} className="mt-0.5 flex-shrink-0" />
          Concessions, fines and late fees arrive in Round 3. These thresholds are
          stored now so they are already set when they do.
        </p>
      </div>

      {error && (
        <div className="bg-rose-50 border border-rose-200 text-rose-700 text-sm px-4 py-3 rounded-lg">{error}</div>
      )}

      <div className="flex items-center gap-3">
        <button onClick={() => void save()} disabled={saving} className={ADMIN.darkBtn}>
          {saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
          Save settings
        </button>
        {saved && <span className="text-xs text-emerald-600 font-medium">Saved as a new version</span>}
        <span className="text-xs text-[#A1A1AA]">
          Changing a rule today does not rewrite what a bill issued last month was governed by.
        </span>
      </div>
    </div>
  )
}

function Field({
  label, help, children,
}: { label: string; help?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className={`${ADMIN.label} block mb-1.5`}>{label}</label>
      {children}
      {help && <p className="text-xs text-[#A1A1AA] mt-1.5 max-w-2xl">{help}</p>}
    </div>
  )
}

function Toggle({
  checked, onChange, label, help,
}: { checked: boolean; onChange: (v: boolean) => void; label: string; help: string }) {
  return (
    <div className="flex items-start gap-3">
      <button
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`mt-0.5 w-9 h-5 rounded-full flex-shrink-0 transition-colors relative ${
          checked ? 'bg-[#27272A]' : 'bg-[#E4E4E7]'
        }`}
      >
        <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-transform ${
          checked ? 'translate-x-[18px]' : 'translate-x-0.5'
        }`} />
      </button>
      <div>
        <div className="text-sm font-medium text-[#27272A]">{label}</div>
        <p className="text-xs text-[#A1A1AA] mt-0.5 max-w-2xl">{help}</p>
      </div>
    </div>
  )
}
