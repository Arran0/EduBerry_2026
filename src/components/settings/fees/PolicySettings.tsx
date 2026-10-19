'use client'

// Part payments, grace days, allocation order and approval thresholds.
//
// Saving does not overwrite: fee_save_setting closes the current version and
// opens a new one, so a receipt printed last month can still be read against
// the rules that were live when it was printed.

import React, { useEffect, useState } from 'react'
import { Check, Loader2 } from 'lucide-react'
import { ADMIN } from '@/components/fees/ui'
import { FormGroup, FormRow, Loading, Notice, Switch } from '@/components/fees/shell'
import {
  DEFAULT_FEE_SETTINGS, fetchFeeSettings, saveFeeSetting,
  type ApprovalThresholdSettings, type GraceSettings, type PaymentRuleSettings,
} from '@/lib/fees/settings'

const NUM = `${ADMIN.inputPlain} !w-[132px] text-right tabular-nums`

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

  if (loading) return <Loading />

  return (
    <div className="space-y-5">
      <FormGroup
        title="Taking payment"
        note="What the counter and the online payment page will accept."
      >
        <FormRow label="Allow part payment"
                 hint="A family who can pay half today pays half today.">
          <Switch label="Allow part payment" checked={rules.partial_allowed}
                  onChange={v => setRules({ ...rules, partial_allowed: v })} />
        </FormRow>
        {rules.partial_allowed && (
          <FormRow label="Smallest part payment (₹)" hint="0 accepts any amount.">
            <input type="number" min={0} value={rules.min_partial_amount}
                   onChange={e => setRules({ ...rules, min_partial_amount: Number(e.target.value) || 0 })}
                   className={NUM} />
          </FormRow>
        )}
        <FormRow label="Accept more than the bill"
                 hint="A round ₹10,000 against a ₹9,750 bill is taken, not turned away.">
          <Switch label="Accept more than the bill" checked={rules.allow_overpayment}
                  onChange={v => setRules({ ...rules, allow_overpayment: v })} />
        </FormRow>
        {rules.allow_overpayment && (
          <FormRow label="Keep the extra as a credit"
                   hint="Applied to the student's next bill. Off means it is refunded instead.">
            <Switch label="Keep the extra as a credit" checked={rules.overpayment_becomes_credit}
                    onChange={v => setRules({ ...rules, overpayment_becomes_credit: v })} />
          </FormRow>
        )}
        <FormRow label="When one payment covers several bills" stack
                 hint="How an amount is split when it is not put against one bill. A payment taken on a bill always goes to that bill.">
          <select value={rules.allocation_order}
                  onChange={e => setRules({ ...rules, allocation_order: e.target.value as PaymentRuleSettings['allocation_order'] })}
                  className={`${ADMIN.inputPlain} sm:max-w-sm`}>
            <option value="oldest_due_first">Oldest bill first</option>
            <option value="newest_due_first">Newest bill first</option>
            <option value="manual">Ask the clerk each time</option>
          </select>
        </FormRow>
        <FormRow label="Backdating limit (days)"
                 hint="Only staff with the backdating permission can date a payment earlier at all.">
          <input type="number" min={0} max={365} value={rules.allow_backdated_days}
                 onChange={e => setRules({ ...rules, allow_backdated_days: Number(e.target.value) || 0 })}
                 className={NUM} />
        </FormRow>
      </FormGroup>

      <FormGroup title="Grace" note="No bill is overdue, and no late fee starts counting, until this many days after its due date.">
        <FormRow label="Grace days">
          <input type="number" min={0} max={90} value={grace.days}
                 onChange={e => setGrace({ days: Number(e.target.value) || 0 })}
                 className={NUM} />
        </FormRow>
      </FormGroup>

      <FormGroup title="Approval needed above"
                 note="Above these amounts the request waits for someone with the matching approve permission. 0 means every one waits.">
        <FormRow label="Discount (₹)">
          <input type="number" min={0} value={thresholds.discount}
                 onChange={e => setThresholds({ ...thresholds, discount: Number(e.target.value) || 0 })}
                 className={NUM} />
        </FormRow>
        <FormRow label="Waiver (₹)">
          <input type="number" min={0} value={thresholds.waiver}
                 onChange={e => setThresholds({ ...thresholds, waiver: Number(e.target.value) || 0 })}
                 className={NUM} />
        </FormRow>
        <FormRow label="Refund (₹)">
          <input type="number" min={0} value={thresholds.refund}
                 onChange={e => setThresholds({ ...thresholds, refund: Number(e.target.value) || 0 })}
                 className={NUM} />
        </FormRow>
      </FormGroup>

      {error && <Notice tone="error">{error}</Notice>}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <button onClick={() => void save()} disabled={saving} className={`${ADMIN.darkBtn} h-9`}>
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
          Save
        </button>
        {saved
          ? <span className="text-[12.5px] text-[#1F6B42] font-medium">Saved as a new version</span>
          : <span className="text-[12px] text-slate-500 leading-snug">Bills already issued keep the rules they were issued under.</span>}
      </div>
    </div>
  )
}
