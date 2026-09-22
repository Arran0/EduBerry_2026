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
// The form was ten fields in three unlabelled grids: a name, then a 2-up, then
// another 2-up, then a 3-up, then another 2-up. Everything was on screen and
// nothing was grouped, so reading it meant reading all of it. It is now four
// numbered steps in the order the decision is actually made — who it applies
// to, when it starts, how much, and where it stops — with the whole rule
// written out as one English sentence at the top, which is the thing a reader
// is really trying to assemble in their head.
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

const SCOPE_LABEL: Record<NonNullable<LateFeeRuleRow['scope']>, string> = {
  all: 'Every bill',
  group: 'One fee group',
  structure: 'One structure',
  installment: 'One installment',
}

const FREQUENCY_LABEL: Record<LateFeeRuleRow['frequency'], string> = {
  once: 'Once only',
  daily: 'Every day',
  weekly: 'Every week',
  monthly: 'Every month',
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

  /** The whole rule as one sentence, which is what the reader is assembling. */
  const sentence = useMemo(() => {
    const amount = form.charge_type === 'percent'
      ? `${Number(form.rate) || 0}% of ${form.basis === 'whole' ? 'the whole bill' : 'what is still unpaid'}`
      : `₹${Number(form.rate) || 0}`
    const when = form.frequency === 'once'
      ? 'once'
      : `every ${String(form.frequency ?? 'weekly').replace('ly', '')}`
    const grace = Number(form.grace_days) || 0
    const after = grace === 0
      ? 'from the day after it is due'
      : `once it is ${grace} day${grace === 1 ? '' : 's'} past due`
    const where = form.scope === 'all'
      ? 'every bill'
      : scopes.find(s => s.id === form.scope_id)?.label
        ?? `one ${form.scope}`
    const caps: string[] = []
    if (form.cap_amount !== null && form.cap_amount !== undefined) caps.push(`₹${form.cap_amount}`)
    if (form.cap_percent !== null && form.cap_percent !== undefined) caps.push(`${form.cap_percent}% of the bill`)
    const cap = caps.length === 0
      ? ', and it never stops growing'
      : `, never more than ${caps.join(' or ')}`
    return `${amount}, ${when}, ${after}, on ${where}${cap}.`
  }, [form, scopes])

  const submit = async () => {
    if (blocking.length > 0) return
    if (!form.name?.trim()) { setError('Give the rule a name staff will recognise.'); return }
    if (form.scope !== 'all' && !form.scope_id) {
      setError(`Choose which ${form.scope} this applies to.`)
      return
    }
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
      size="2xl"
      minHClass="sm:min-h-[34rem]"
      title={rule ? 'Edit late-fee rule' : 'New late-fee rule'}
      subtitle="Nothing is charged until you switch the rule on, and never for days before that."
      icon={<AlertTriangle size={15} />}
      iconClassName="bg-[#FAF3DF] text-[#7A6220]"
      bodyClassName="bg-[#FDFCF9] !px-3 sm:!px-4 !py-3"
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
      {/* ── The rule, in one sentence ──────────────────────────────────── */}
      <div className="bg-[#27272A] px-3 py-2.5 mb-3">
        <span className="text-[9.5px] font-bold uppercase tracking-[0.12em] text-[#8C8878]">
          This rule charges
        </span>
        <p className="text-[13px] text-white leading-snug mt-1">{sentence}</p>
      </div>

      <div className="grid lg:grid-cols-[1fr_20rem] gap-3 items-start">
        {/* ── The four steps ───────────────────────────────────────────── */}
        <div className="space-y-2.5">
          <Step n={1} title="What it is, and what it covers">
            <div className="space-y-2.5">
              <Field label="Name" hint="What staff will see in the list and on the bill line.">
                <input value={form.name ?? ''} onChange={e => set('name', e.target.value)}
                       placeholder="Weekly late fee, term bills"
                       className={ADMIN.inputPlain} autoFocus />
              </Field>

              <div>
                <span className={ADMIN.label}>Applies to</span>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-1 mt-1">
                  {(Object.keys(SCOPE_LABEL) as (keyof typeof SCOPE_LABEL)[]).map(k => (
                    <Segment key={k}
                             on={(form.scope ?? 'all') === k}
                             onClick={() => { set('scope', k); set('scope_id', null) }}>
                      {SCOPE_LABEL[k]}
                    </Segment>
                  ))}
                </div>
                {form.scope && form.scope !== 'all' && (
                  <select value={form.scope_id ?? ''}
                          onChange={e => set('scope_id', e.target.value || null)}
                          className={`${ADMIN.inputPlain} mt-1.5`}>
                    <option value="">Choose which one…</option>
                    {scopes.filter(s => s.kind === form.scope).map(s => (
                      <option key={s.id} value={s.id}>{s.label}</option>
                    ))}
                  </select>
                )}
                {form.scope && form.scope !== 'all'
                  && scopes.filter(s => s.kind === form.scope).length === 0 && (
                  <p className="mt-1 text-[11px] text-[#7A6220]">
                    Nothing of that kind exists in this session yet.
                  </p>
                )}
              </div>
            </div>
          </Step>

          <Step n={2} title="When the charging starts">
            <div className="grid sm:grid-cols-2 gap-3">
              <Field label="Grace days" hint="Days after the due date before anything is charged.">
                <input type="number" min={0} value={form.grace_days ?? 0}
                       onChange={e => set('grace_days', Number(e.target.value))}
                       className={ADMIN.inputPlain} />
              </Field>
              <div>
                <span className={ADMIN.label}>Charged on</span>
                <div className="grid grid-cols-2 gap-1 mt-1">
                  <Segment on={(form.basis ?? 'unpaid') === 'unpaid'}
                           onClick={() => set('basis', 'unpaid')}>
                    Still unpaid
                  </Segment>
                  <Segment on={form.basis === 'whole'} onClick={() => set('basis', 'whole')}>
                    The whole bill
                  </Segment>
                </div>
                <p className="mt-1 text-[11px] text-[#8C8878] leading-snug">
                  {form.basis === 'whole'
                    ? 'A part payment does not shrink the late fee.'
                    : 'Paying part of the bill shrinks the late fee with it.'}
                </p>
              </div>
            </div>
          </Step>

          <Step n={3} title="How much, and how often">
            <div className="space-y-2.5">
              <div className="grid sm:grid-cols-[9rem_1fr] gap-3">
                <div>
                  <span className={ADMIN.label}>Charge</span>
                  <div className="grid grid-cols-2 gap-1 mt-1">
                    <Segment on={(form.charge_type ?? 'flat') === 'flat'}
                             onClick={() => set('charge_type', 'flat')}>Flat ₹</Segment>
                    <Segment on={form.charge_type === 'percent'}
                             onClick={() => set('charge_type', 'percent')}>Percent</Segment>
                  </div>
                </div>
                <Field label={form.charge_type === 'percent' ? 'Rate %' : 'Amount ₹'}>
                  <input type="number" min={0} step="0.01" value={form.rate ?? 0}
                         onChange={e => set('rate', Number(e.target.value))}
                         className={ADMIN.inputPlain} />
                </Field>
              </div>
              <div>
                <span className={ADMIN.label}>How often</span>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-1 mt-1">
                  {(Object.keys(FREQUENCY_LABEL) as (keyof typeof FREQUENCY_LABEL)[]).map(k => (
                    <Segment key={k} on={(form.frequency ?? 'weekly') === k}
                             onClick={() => set('frequency', k)}>
                      {FREQUENCY_LABEL[k]}
                    </Segment>
                  ))}
                </div>
              </div>
            </div>
          </Step>

          <Step n={4} title="Where it stops">
            <div className="grid sm:grid-cols-2 gap-3">
              <Field label="Never more than ₹" hint="Blank for no rupee ceiling.">
                <input type="number" min={0} value={form.cap_amount ?? ''}
                       onChange={e => set('cap_amount', e.target.value === '' ? null : Number(e.target.value))}
                       placeholder="No ceiling" className={ADMIN.inputPlain} />
              </Field>
              <Field label="Never more than % of bill" hint="Whichever ceiling bites first wins.">
                <input type="number" min={0} step="0.01" value={form.cap_percent ?? ''}
                       onChange={e => set('cap_percent', e.target.value === '' ? null : Number(e.target.value))}
                       placeholder="No ceiling" className={ADMIN.inputPlain} />
              </Field>
            </div>
          </Step>

          <Field label="Note" hint="Shown to whoever reads the rule later, not to parents.">
            <input value={form.notes ?? ''} onChange={e => set('notes', e.target.value || null)}
                   className={ADMIN.inputPlain} />
          </Field>
        </div>

        {/* ── The live sample ──────────────────────────────────────────── */}
        <div className="space-y-2.5 lg:sticky lg:top-0">
          <div className="bg-white border border-[#E3DFD3] p-3">
            <div className="flex items-center justify-between gap-2">
              <span className={ADMIN.label}>On a sample bill of</span>
              <div className="flex items-center gap-1">
                <span className="text-sm text-[#6B675A]">₹</span>
                <input type="number" min={0} value={sample}
                       onChange={e => setSample(Number(e.target.value))}
                       className="w-24 bg-white border border-[#E3DFD3] px-2 py-1 text-sm text-right
                                  text-[#18181B] focus:outline-none focus:border-[#27272A]" />
              </div>
            </div>
            <table className="w-full mt-2.5 text-sm">
              <tbody>
                {horizons.map(h => (
                  <tr key={h.days} className="border-t border-[#F0ECE2] first:border-0">
                    <td className="py-1.5 text-[#6B675A] text-[12px]">
                      {h.days === 365 ? 'A year late' : `${h.days} days late`}
                    </td>
                    <td className="py-1.5 text-right font-semibold text-[#18181B]">
                      {formatPaise(h.result.amount)}
                      {h.result.cappedBy && (
                        <span className="ml-1.5 text-[10px] font-bold uppercase tracking-wider
                                         text-[#7A6220]">capped</span>
                      )}
                    </td>
                    <td className="py-1.5 pl-2 text-right text-[10.5px] text-[#8C8878] w-20">
                      {sample > 0 ? `${Math.round((h.result.amount / toPaise(sample)) * 100)}%` : ''}
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
              <p className="text-xs text-[#1F6B42] leading-relaxed">
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
              <p className={`text-xs leading-relaxed ${
                w.level === 'error' ? 'text-[#A93232]' : 'text-[#7A6220]'}`}>
                {w.message}
              </p>
            </div>
          ))}

          {error && (
            <div className="flex items-start gap-2 p-3 bg-[#FCECEC] border border-[#EFCCCC]">
              <X size={13} className="text-[#A93232] mt-0.5 flex-shrink-0" />
              <p className="text-xs text-[#A93232]">{error}</p>
            </div>
          )}
        </div>
      </div>
    </ModalShell>
  )
}

/** One numbered step of the form, on its own card so the groups are visible. */
function Step({
  n, title, children,
}: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="bg-white border border-[#E3DFD3]">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-[#F0ECE2] bg-[#FAF8F2]">
        <span className="w-[18px] h-[18px] bg-[#27272A] text-white text-[10px] font-bold
                         flex items-center justify-center flex-shrink-0">{n}</span>
        <h3 className="text-[10.5px] font-bold uppercase tracking-[0.1em] text-[#3F3F46]">{title}</h3>
      </div>
      <div className="p-3">{children}</div>
    </section>
  )
}

function Segment({
  on, onClick, children,
}: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-2 py-[7px] text-[10.5px] font-bold uppercase tracking-[0.06em] leading-none
                  border transition-colors truncate ${
        on ? 'bg-[#27272A] text-white border-[#27272A]'
           : 'bg-white text-[#6B675A] border-[#E3DFD3] hover:border-[#C9C4B4] hover:text-[#18181B]'
      }`}
    >
      {children}
    </button>
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
