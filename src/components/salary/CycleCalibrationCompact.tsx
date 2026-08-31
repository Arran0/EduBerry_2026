'use client'

import React from 'react'
import { Landmark, HeartPulse, CalendarX2, Sparkles, Plus, X } from 'lucide-react'
import { PayrollCalibration, LopRule, LopTier } from '@/lib/payroll'
import { SHARP } from '@/components/salary/adminUi'

/**
 * The PF / ESI / LOP / bonus calibration form, laid out for a popup rather
 * than a settings page.
 *
 * `PayrollCalibrationFields` is the page version: four full-width cards, a
 * paragraph of explanation above each one, generous padding. Opened as a modal
 * over the pay cycle sheet that runs to about three screens of scrolling, so
 * the rule someone came to change is never on screen next to the numbers it
 * governs.
 *
 * This one packs the same fields into roughly one screen: three small groups
 * across the top (PF, ESI, bonus — one or two inputs each), and the LOP rules,
 * which are the only genuinely tabular part, as an actual table. The prose is
 * demoted to `title` tooltips and one-line hints, since an admin reaching for
 * a per-cycle override already knows what PF is.
 *
 * Both forms edit the same `PayrollCalibration`, so whichever is open the
 * saved shape is identical.
 */
export default function CycleCalibrationCompact({ calibration, onChange }: {
  calibration: PayrollCalibration
  onChange: (c: PayrollCalibration) => void
}) {
  const { pf, esi, lop, bonus } = calibration

  return (
    <div className="space-y-2.5">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
        <Group icon={<Landmark size={12} />} title="PF"
          hint="On each person's own PF Basic wage, not their gross.">
          <Field label="Employee rate" suffix="%">
            <Num value={pf.rate * 100} step={0.1}
              onChange={v => onChange({ ...calibration, pf: { rate: v / 100 } })} />
          </Field>
        </Group>

        <Group icon={<HeartPulse size={12} />} title="ESI"
          hint="Applies at or under the ceiling; overridable per person.">
          <Field label="Rate" suffix="%">
            <Num value={esi.rate * 100} step={0.01}
              onChange={v => onChange({ ...calibration, esi: { ...esi, rate: v / 100 } })} />
          </Field>
          <Field label="Ceiling" suffix="₹/mo" title="Staff at or under this monthly wage are ESI-applicable.">
            <Num value={esi.wage_ceiling} step={500} width="w-20"
              onChange={v => onChange({ ...calibration, esi: { ...esi, wage_ceiling: v } })} />
          </Field>
        </Group>

        <Group icon={<Sparkles size={12} />} title="Task bonus"
          hint="Bonus points earned this month, converted on lock.">
          <div className="flex mb-1.5">
            {(['per_point', 'pool'] as const).map(mode => (
              <button key={mode}
                onClick={() => onChange({ ...calibration, bonus: { ...bonus, mode } })}
                className={`flex-1 text-[10px] font-semibold py-1 border transition-colors ${
                  bonus.mode === mode
                    ? 'bg-[#27272A] border-[#27272A] text-white'
                    : 'bg-white border-[#E4E4E7] text-[#71717A] hover:border-[#A1A1AA]'
                } ${mode === 'pool' ? '-ml-px' : ''}`}
              >
                {mode === 'per_point' ? '₹ per point' : 'Cash pool'}
              </button>
            ))}
          </div>
          {bonus.mode === 'per_point' ? (
            <Field label="Per point" suffix="₹">
              <Num value={bonus.per_point_value} step={1}
                onChange={v => onChange({ ...calibration, bonus: { ...bonus, per_point_value: v } })} />
            </Field>
          ) : (
            <Field label="Pool per cycle" suffix="₹">
              <Num value={bonus.pool_amount} step={500} width="w-24"
                onChange={v => onChange({ ...calibration, bonus: { ...bonus, pool_amount: v } })} />
            </Field>
          )}
        </Group>
      </div>

      <Group icon={<CalendarX2 size={12} />} title="Loss of pay"
        hint="A free monthly quota, then tiered rates — a later occurrence can cost more than the first.">
        <div className="overflow-x-auto -mx-2.5 px-2.5">
          <table className="w-full min-w-[380px] border-collapse">
            <thead>
              <tr className="border-b border-[#E4E4E7]">
                <th className={`${SHARP.label} text-left py-1 pr-2`}>Occurrence</th>
                <th className={`${SHARP.label} text-center py-1 px-1 w-16`}>Free/mo</th>
                <th className={`${SHARP.label} text-left py-1 pl-2`}>Tiers — next N occurrences cost D days each</th>
              </tr>
            </thead>
            <tbody>
              <LopRow label="Late arrivals" rule={lop.late}
                onChange={r => onChange({ ...calibration, lop: { ...lop, late: r } })} />
              <LopRow label="Leave days" rule={lop.leave}
                onChange={r => onChange({ ...calibration, lop: { ...lop, leave: r } })} />
              <LopRow label="Half days" rule={lop.halfDay}
                onChange={r => onChange({ ...calibration, lop: { ...lop, halfDay: r } })} />
            </tbody>
          </table>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5 mt-2.5 pt-2.5 border-t border-[#F4F4F5]">
          <Field label="Late grace" suffix="min"
            title="Arrivals within this many minutes of the cutoff aren't counted as Late.">
            <Num value={lop.lateGraceMinutes} step={1} integer
              onChange={v => onChange({ ...calibration, lop: { ...lop, lateGraceMinutes: v } })} />
          </Field>
          <Field label="Half-day grace" suffix="min"
            title="Checkouts within this many minutes of the checkout cutoff count as a normal day.">
            <Num value={lop.halfDayGraceMinutes} step={1} integer
              onChange={v => onChange({ ...calibration, lop: { ...lop, halfDayGraceMinutes: v } })} />
          </Field>
        </div>
      </Group>
    </div>
  )
}

function Group({ icon, title, hint, children }: {
  icon: React.ReactNode
  title: string
  hint: string
  children: React.ReactNode
}) {
  return (
    <div className="border border-[#E4E4E7] bg-white">
      <div className="flex items-center gap-1.5 px-2.5 py-1.5 bg-[#FAFAFA] border-b border-[#E4E4E7]">
        <span className="text-[#B8983C]">{icon}</span>
        <span className="text-[11px] font-bold text-[#18181B]">{title}</span>
      </div>
      <div className="px-2.5 py-2">
        <p className="text-[10px] text-[#A1A1AA] leading-snug mb-1.5">{hint}</p>
        {children}
      </div>
    </div>
  )
}

function Field({ label, suffix, title, children }: {
  label: string
  suffix?: string
  title?: string
  children: React.ReactNode
}) {
  return (
    <label title={title} className="flex items-center gap-2 py-0.5">
      <span className="text-[11px] text-[#71717A] flex-1 min-w-0 truncate">{label}</span>
      {children}
      {suffix && <span className="text-[10px] text-[#A1A1AA] w-8 flex-shrink-0">{suffix}</span>}
    </label>
  )
}

function Num({ value, step, onChange, width = 'w-16', integer = false }: {
  value: number
  step: number
  onChange: (n: number) => void
  width?: string
  /** Parse as an integer — minute counts and occurrence counts, not rates. */
  integer?: boolean
}) {
  return (
    <input
      type="number"
      min="0"
      step={step}
      value={value}
      onChange={e => onChange((integer ? parseInt(e.target.value, 10) : parseFloat(e.target.value)) || 0)}
      className={`${width} flex-shrink-0 border border-[#E4E4E7] px-1.5 py-1 text-[11px] text-right tabular-nums text-[#27272A] focus:outline-none focus:border-[#27272A] bg-white`}
    />
  )
}

function LopRow({ label, rule, onChange }: {
  label: string
  rule: LopRule
  onChange: (r: LopRule) => void
}) {
  return (
    <tr className="border-b border-[#F4F4F5] last:border-b-0 align-top">
      <td className="py-1.5 pr-2 text-[11px] font-semibold text-[#27272A] whitespace-nowrap">{label}</td>
      <td className="py-1.5 px-1 text-center">
        <input
          type="number" min="0" value={rule.free_count}
          onChange={e => onChange({ ...rule, free_count: parseInt(e.target.value, 10) || 0 })}
          className="w-12 border border-[#E4E4E7] px-1 py-1 text-[11px] text-center tabular-nums text-[#27272A] focus:outline-none focus:border-[#27272A] bg-white"
        />
      </td>
      <td className="py-1.5 pl-2">
        <div className="flex flex-wrap items-center gap-1">
          {rule.tiers.map((tier, i) => (
            <TierChip key={i} tier={tier}
              onChange={t => onChange({ ...rule, tiers: rule.tiers.map((x, xi) => (xi === i ? t : x)) })}
              onRemove={() => onChange({ ...rule, tiers: rule.tiers.filter((_, xi) => xi !== i) })}
            />
          ))}
          <button
            onClick={() => onChange({ ...rule, tiers: [...rule.tiers, { count: null, lop_days_each: 1 }] })}
            title="Add a tier"
            className="inline-flex items-center gap-0.5 border border-dashed border-[#D4D4D8] text-[#71717A] hover:text-[#27272A] hover:border-[#A1A1AA] px-1.5 py-1 text-[10px] font-semibold transition-colors"
          >
            <Plus size={10} /> Tier
          </button>
        </div>
      </td>
    </tr>
  )
}

/** One tier as a compact `N → D d` chip: blank N means "all remaining". */
function TierChip({ tier, onChange, onRemove }: {
  tier: LopTier
  onChange: (t: LopTier) => void
  onRemove: () => void
}) {
  return (
    <span className="inline-flex items-center border border-[#E4E4E7] bg-[#FAFAFA]"
      title="Next N occurrence(s) cost D day(s) of pay each. Leave N blank for every remaining occurrence.">
      <input
        type="number" min="0" step="1" value={tier.count ?? ''} placeholder="rest"
        onChange={e => onChange({ ...tier, count: e.target.value === '' ? null : parseInt(e.target.value, 10) || 0 })}
        className="w-11 bg-transparent px-1 py-1 text-[10px] text-center tabular-nums text-[#27272A] focus:outline-none placeholder:text-[#A1A1AA]"
      />
      <span className="text-[10px] text-[#A1A1AA]">→</span>
      <input
        type="number" min="0" step="0.5" value={tier.lop_days_each}
        onChange={e => onChange({ ...tier, lop_days_each: parseFloat(e.target.value) || 0 })}
        className="w-10 bg-transparent px-1 py-1 text-[10px] text-center tabular-nums text-[#27272A] focus:outline-none"
      />
      <span className="text-[10px] text-[#A1A1AA] pr-0.5">d</span>
      <button onClick={onRemove} aria-label={`Remove tier`}
        className="px-1 py-1 text-[#D4D4D8] hover:text-[#BE123C] transition-colors">
        <X size={10} />
      </button>
    </span>
  )
}
