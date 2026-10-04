'use client'

// ─────────────────────────────────────────────────────────────────────────────
// The late-fee rule builder.
//
// A late fee is the one thing in this module that takes money from a family
// without anybody pressing a button, so the builder is deliberately loud. Every
// keystroke re-runs the same engine the nightly sweep runs — not an
// approximation of it, `computeLateFee` itself — against a sample bill, and
// shows what it would cost at a week, a month and three months late.
//
// `validateRule` supplies the red boxes. Errors block Save; warnings do not,
// because a school may genuinely want an aggressive rule, but it should see the
// number first.
//
// One thing the form cannot do is set the day the rule starts charging. That
// only ever comes from `fee_set_late_fee_rule_enabled`, which stamps today. A
// form field there would let somebody switch a rule on "from April" in October
// and back-charge a whole term overnight.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useMemo, useState } from 'react'
import { AlertTriangle, Info, Loader2, Save, X } from 'lucide-react'
import ModalShell from '@/components/ui/ModalShell'
import { ADMIN } from '@/components/fees/ui'
import { computeLateFee, validateRule, type LateFeeRule } from '@/lib/fees/engine/latefee'
import { toPaise, formatPaise } from '@/lib/fees/engine/money'
import { addDays, todayIn } from '@/lib/fees/engine/dates'
import { saveLateFeeRule, toEngineRule, type LateFeeRuleRow } from '@/lib/fees/charges'

export interface ScopeOption { id: string; label: string; kind: 'group' | 'structure' | 'installment' }

/** A blank rule, in the shape the form edits (rupees, not paise). */
function blank(yearId: string): Partial<LateFeeRuleRow> & { academic_year_id: string; name: string } {
  return {
    academic_year_id: yearId,
    name: '',
    scope: 'all',
    scope_id: null,
    grace_days: 7,
    charge_type: 'flat',
    rate: 50,
    frequency: 'weekly',
    basis: 'unpaid',
    cap_amount: 1000,
    cap_percent: null,
    notes: null,
  }
}

export default function LateFeeRuleBuilder({
  yearId, rule, scopes, sampleBillRupees, onClose, onSaved,
}: {
  yearId: string
  /** Null to build a new rule. */
  rule: LateFeeRuleRow | null
  scopes: ScopeOption[]
  /** A real bill from this school, so the sample is not a made-up number. */
  sampleBillRupees: number
  onClose: () => void
  onSaved: (row: LateFeeRuleRow) => void
}) {
  const [form, setForm] = useState(() => (rule ? { ...rule } : blank(yearId)))
  const [sample, setSample] = useState(sampleBillRupees)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const set = <K extends keyof LateFeeRuleRow>(key: K, value: LateFeeRuleRow[K]) =>
    setForm(f => ({ ...f, [key]: value }))

  // The engine shape. `enabled` is forced true here so the preview shows what
  // the rule *will* do once it is switched on — a disabled rule computes zero,
  // which would make every sample read ₹0 and teach the reader nothing.
  const engineRule: LateFeeRule = useMemo(() => toEngineRule({
    ...(form as LateFeeRuleRow),
    id: form.id ?? 'preview',
    enabled: true,
    enabled_from: null,
  }), [form])

  const sampleBill = toPaise(sample || 0)
  const warnings = useMemo(
    () => validateRule(engineRule, sampleBill), [engineRule, sampleBill])
  const blocking = warnings.filter(w => w.level === 'error')

  // A due date far enough back that every horizon below is real, then the same
  // computation the sweep does at each one.
  const today = todayIn()
  const horizons = useMemo(() => {
    const due = addDays(today, -400)
    return [7, 30, 90, 365].map(d => ({
      days: d,
      result: computeLateFee(engineRule, sampleBill, due, addDays(due, d + engineRule.graceDays)),
    }))
  }, [engineRule, sampleBill, today])

  const submit = async () => {
    if (blocking.length > 0) return
    if (!form.name?.trim()) { setError('Give the rule a name staff will recognise.'); return }
    setSaving(true)
    setError(null)
    try {
      const saved = await saveLateFeeRule({
        ...(form as LateFeeRuleRow),
        academic_year_id: yearId,
        name: form.name.trim(),
        rate: Number(form.rate) || 0,
        grace_days: Number(form.grace_days) || 0,
        cap_amount: form.cap_amount === null || form.cap_amount === undefined
          ? null : Number(form.cap_amount),
        cap_percent: form.cap_percent === null || form.cap_percent === undefined
          ? null : Number(form.cap_percent),
        scope_id: form.scope === 'all' ? null : (form.scope_id ?? null),
      })
      onSaved(saved)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the rule.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <ModalShell
      onClose={onClose}
      sharp
      size="lg"
      minHClass="sm:min-h-[34rem]"
      title={rule ? 'Edit late-fee rule' : 'New late-fee rule'}
      subtitle="Nothing is charged until you switch the rule on, and never for days before that."
      icon={<AlertTriangle size={15} />}
      iconClassName="bg-[#FAF3DF] text-[#7A6220]"
      footer={
        <div className="flex items-center justify-between gap-3">
          <span className="text-[11px] text-[#8C8878]">
            {blocking.length > 0
              ? 'Fix the errors above to save.'
              : rule?.enabled
                ? 'This rule is live — saving changes what it charges from tonight.'
                : 'Saved rules start switched off.'}
          </span>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className={ADMIN.ghostBtn}>Cancel</button>
            <button onClick={() => void submit()}
                    disabled={saving || blocking.length > 0}
                    className={`${ADMIN.darkBtn} px-4`}>
              {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
              Save rule
            </button>
          </div>
        </div>
      }
    >
      <div className="grid md:grid-cols-2 gap-5">
        {/* ── The form ─────────────────────────────────────────────── */}
        <div className="space-y-3">
          <Field label="Name">
            <input value={form.name ?? ''} onChange={e => set('name', e.target.value)}
                   placeholder="Weekly late fee, term bills"
                   className={ADMIN.inputPlain} />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Applies to">
              <select value={form.scope ?? 'all'}
                      onChange={e => { set('scope', e.target.value as LateFeeRuleRow['scope']); set('scope_id', null) }}
                      className={ADMIN.inputPlain}>
                <option value="all">Every bill</option>
                <option value="group">One fee group</option>
                <option value="structure">One structure</option>
                <option value="installment">One installment</option>
              </select>
            </Field>
            <Field label="Which one">
              <select value={form.scope_id ?? ''}
                      disabled={form.scope === 'all'}
                      onChange={e => set('scope_id', e.target.value || null)}
                      className={`${ADMIN.inputPlain} disabled:bg-[#FAF8F2] disabled:text-[#8C8878]`}>
                <option value="">{form.scope === 'all' ? '—' : 'Choose…'}</option>
                {scopes.filter(s => s.kind === form.scope).map(s => (
                  <option key={s.id} value={s.id}>{s.label}</option>
                ))}
              </select>
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Grace days" hint="Days after the due date before anything is charged.">
              <input type="number" min={0} value={form.grace_days ?? 0}
                     onChange={e => set('grace_days', Number(e.target.value))}
                     className={ADMIN.inputPlain} />
            </Field>
            <Field label="Charged on">
              <select value={form.basis ?? 'unpaid'}
                      onChange={e => set('basis', e.target.value as LateFeeRuleRow['basis'])}
                      className={ADMIN.inputPlain}>
                <option value="unpaid">What is still unpaid</option>
                <option value="whole">The whole bill</option>
              </select>
            </Field>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <Field label="Type">
              <select value={form.charge_type ?? 'flat'}
                      onChange={e => set('charge_type', e.target.value as LateFeeRuleRow['charge_type'])}
                      className={ADMIN.inputPlain}>
                <option value="flat">Flat ₹</option>
                <option value="percent">Percent</option>
              </select>
            </Field>
            <Field label={form.charge_type === 'percent' ? 'Rate %' : 'Amount ₹'}>
              <input type="number" min={0} step="0.01" value={form.rate ?? 0}
                     onChange={e => set('rate', Number(e.target.value))}
                     className={ADMIN.inputPlain} />
            </Field>
            <Field label="How often">
              <select value={form.frequency ?? 'once'}
                      onChange={e => set('frequency', e.target.value as LateFeeRuleRow['frequency'])}
                      className={ADMIN.inputPlain}>
                <option value="once">Once</option>
                <option value="daily">Every day</option>
                <option value="weekly">Every week</option>
                <option value="monthly">Every month</option>
              </select>
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Cap ₹" hint="Leave blank for no rupee cap.">
              <input type="number" min={0} value={form.cap_amount ?? ''}
                     onChange={e => set('cap_amount', e.target.value === '' ? null : Number(e.target.value))}
                     placeholder="—" className={ADMIN.inputPlain} />
            </Field>
            <Field label="Cap % of bill" hint="Whichever cap bites first wins.">
              <input type="number" min={0} step="0.01" value={form.cap_percent ?? ''}
                     onChange={e => set('cap_percent', e.target.value === '' ? null : Number(e.target.value))}
                     placeholder="—" className={ADMIN.inputPlain} />
            </Field>
          </div>

          <Field label="Note" hint="Shown to whoever reads the rule later, not to parents.">
            <input value={form.notes ?? ''} onChange={e => set('notes', e.target.value || null)}
                   className={ADMIN.inputPlain} />
          </Field>
        </div>

        {/* ── The live sample ──────────────────────────────────────── */}
        <div className="space-y-3">
          <div className="bg-[#FAF8F2] border border-[#E3DFD3] p-3">
            <div className="flex items-center justify-between gap-2">
              <span className={ADMIN.label}>On a sample bill of</span>
              <div className="flex items-center gap-1">
                <span className="text-[12.5px] text-[#6B675A]">₹</span>
                <input type="number" min={0} value={sample}
                       onChange={e => setSample(Number(e.target.value))}
                       className="w-28 bg-white border border-[#E3DFD3] px-2 py-1 text-[12.5px] text-right
                                  text-[#18181B] focus:outline-none focus:border-[#27272A]" />
              </div>
            </div>
            <table className="w-full mt-3 text-[12.5px]">
              <tbody>
                {horizons.map(h => (
                  <tr key={h.days} className="border-t border-[#E3DFD3] first:border-0">
                    <td className="py-1.5 text-[#6B675A]">
                      {h.days === 365 ? 'A year late' : `${h.days} days late`}
                    </td>
                    <td className="py-1.5 text-right font-semibold text-[#18181B]">
                      {formatPaise(h.result.amount)}
                      {h.result.cappedBy && (
                        <span className="ml-1.5 text-[9px] font-bold uppercase tracking-[0.08em]
                                         text-[#7A6220]">capped</span>
                      )}
                    </td>
                    <td className="py-1.5 pl-3 text-right text-[11px] text-[#8C8878] w-24">
                      {sample > 0 ? `${Math.round((h.result.amount / toPaise(sample)) * 100)}% of bill` : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-[11px] text-[#8C8878] leading-relaxed">
              {horizons[1]?.result.why}
            </p>
          </div>

          {warnings.length === 0 ? (
            <div className="flex items-start gap-2 p-3 bg-[#EAF5EE] border border-[#C6E3D2]">
              <Info size={13} className="text-[#1F6B42] mt-0.5 flex-shrink-0" />
              <p className="text-[11px] text-[#1F6B42] leading-relaxed">
                Nothing to flag. The sample above is what a family would actually be charged.
              </p>
            </div>
          ) : warnings.map((w, i) => (
            <div key={i} className={`flex items-start gap-2 p-3 border ${
              w.level === 'error'
                ? 'bg-[#FCECEC] border-[#EFCCCC]'
                : 'bg-[#FAF3DF] border-[#E7D9AE]'}`}>
              <AlertTriangle size={13} className={`mt-0.5 flex-shrink-0 ${
                w.level === 'error' ? 'text-[#A93232]' : 'text-[#7A6220]'}`} />
              <p className={`text-[11px] leading-relaxed ${
                w.level === 'error' ? 'text-[#A93232]' : 'text-[#7A6220]'}`}>
                {w.message}
              </p>
            </div>
          ))}

          {error && (
            <div className="flex items-start gap-2 p-3 bg-[#FCECEC] border border-[#EFCCCC]">
              <X size={13} className="text-[#A93232] mt-0.5 flex-shrink-0" />
              <p className="text-[11px] text-[#A93232]">{error}</p>
            </div>
          )}
        </div>
      </div>
    </ModalShell>
  )
}

function Field({
  label, hint, children,
}: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className={ADMIN.label}>{label}</span>
      <div className="mt-1">{children}</div>
      {hint && <p className="mt-1 text-[11px] text-[#8C8878] leading-snug">{hint}</p>}
    </label>
  )
}
