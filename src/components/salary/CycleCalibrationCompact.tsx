'use client'

import React from 'react'
import { Landmark, HeartPulse, CalendarX2, Sparkles, Plus, X } from 'lucide-react'
import { PayrollCalibration, LopRule, LopTier } from '@/lib/payroll'
import { SX, UnitInput } from '@/components/salary/ui'

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
  const num = (v: string, integer = false) => (integer ? parseInt(v, 10) : parseFloat(v)) || 0

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Group icon={<Landmark size={14} />} title="PF"
          hint="Worked out on each person's PF Basic wage, not their gross pay.">
          <Field label="Employee rate">
            <UnitInput value={round(pf.rate * 100)} step={0.1} unit="%"
              onChange={v => onChange({ ...calibration, pf: { rate: num(v) / 100 } })} />
          </Field>
        </Group>

        <Group icon={<HeartPulse size={14} />} title="ESI"
          hint="Applies to anyone paid at or under the ceiling. Can be set per person.">
          <Field label="Rate">
            <UnitInput value={round(esi.rate * 100)} step={0.01} unit="%"
              onChange={v => onChange({ ...calibration, esi: { ...esi, rate: num(v) / 100 } })} />
          </Field>
          <Field label="Wage ceiling" title="People paid at or under this a month are covered by ESI.">
            <UnitInput value={esi.wage_ceiling} step={500} unit="₹" width="w-32"
              onChange={v => onChange({ ...calibration, esi: { ...esi, wage_ceiling: num(v) } })} />
          </Field>
        </Group>

        <Group icon={<Sparkles size={14} />} title="Task bonus"
          hint="The month's task points, turned into money when the cycle locks.">
          <div className="flex p-0.5 rounded-[10px] bg-slate-100 mb-2" role="radiogroup" aria-label="How the bonus is paid">
            {(['per_point', 'pool'] as const).map(mode => (
              <button key={mode} type="button" role="radio" aria-checked={bonus.mode === mode}
                onClick={() => onChange({ ...calibration, bonus: { ...bonus, mode } })}
                className={`flex-1 h-8 rounded-[8px] text-[12.5px] font-semibold transition ${
                  bonus.mode === mode ? 'bg-white text-slate-900 shadow-[0_1px_3px_rgba(15,23,42,.18)]' : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                {mode === 'per_point' ? 'Per point' : 'Shared pool'}
              </button>
            ))}
          </div>
          {bonus.mode === 'per_point' ? (
            <Field label="Each point">
              <UnitInput value={bonus.per_point_value} step={1} unit="₹"
                onChange={v => onChange({ ...calibration, bonus: { ...bonus, per_point_value: num(v) } })} />
            </Field>
          ) : (
            <Field label="Pool a cycle">
              <UnitInput value={bonus.pool_amount} step={500} unit="₹" width="w-32"
                onChange={v => onChange({ ...calibration, bonus: { ...bonus, pool_amount: num(v) } })} />
            </Field>
          )}
        </Group>
      </div>

      <Group icon={<CalendarX2 size={14} />} title="Loss of pay"
        hint="Each kind gets a number of free times a month. After that, each step below costs the stated days of pay each time, so later ones can cost more.">
        <div className="divide-y divide-[#EEEAE1] -mx-3.5">
          <LopRow label="Late arrivals" rule={lop.late}
            onChange={r => onChange({ ...calibration, lop: { ...lop, late: r } })} />
          <LopRow label="Leave days" rule={lop.leave}
            onChange={r => onChange({ ...calibration, lop: { ...lop, leave: r } })} />
          <LopRow label="Half days" rule={lop.halfDay}
            onChange={r => onChange({ ...calibration, lop: { ...lop, halfDay: r } })} />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 mt-1 pt-2 border-t border-[#EEEAE1]">
          <Field label="Late grace" title="Arriving within this many minutes of the cutoff does not count as late.">
            <UnitInput value={lop.lateGraceMinutes} step={1} integer unit="min"
              onChange={v => onChange({ ...calibration, lop: { ...lop, lateGraceMinutes: num(v, true) } })} />
          </Field>
          <Field label="Half-day grace" title="Leaving within this many minutes of the cutoff counts as a full day.">
            <UnitInput value={lop.halfDayGraceMinutes} step={1} integer unit="min"
              onChange={v => onChange({ ...calibration, lop: { ...lop, halfDayGraceMinutes: num(v, true) } })} />
          </Field>
        </div>
      </Group>
    </div>
  )
}

/** Percentages shown to two places, so 0.75% does not read as 0.7500000001. */
function round(n: number): number {
  return Math.round(n * 100) / 100
}

function Group({ icon, title, hint, children }: {
  icon: React.ReactNode
  title: string
  hint: string
  children: React.ReactNode
}) {
  return (
    <section className="fx-card min-w-0">
      <div className="flex items-center gap-2 px-3.5 pt-3">
        <span className="text-[#8B6F47] flex-shrink-0">{icon}</span>
        <h3 className="text-[13.5px] font-semibold text-slate-900">{title}</h3>
      </div>
      <div className="px-3.5 pb-3 pt-1">
        <p className="text-[12px] text-slate-500 leading-snug mb-2">{hint}</p>
        {children}
      </div>
    </section>
  )
}

function Field({ label, title, children }: {
  label: string
  title?: string
  children: React.ReactNode
}) {
  return (
    <label title={title} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-1">
      <span className="text-[13px] text-slate-700 min-w-0">{label}</span>
      {children}
    </label>
  )
}

function LopRow({ label, rule, onChange }: {
  label: string
  rule: LopRule
  onChange: (r: LopRule) => void
}) {
  return (
    <div className="px-3.5 py-2.5 grid grid-cols-1 sm:grid-cols-[8rem_auto_minmax(0,1fr)] items-start sm:items-center gap-x-4 gap-y-2">
      <span className="text-[13px] font-semibold text-slate-900">{label}</span>
      <label className="flex items-center gap-2">
        <span className="text-[12px] text-slate-500 whitespace-nowrap">Free a month</span>
        <UnitInput value={rule.free_count} step={1} integer width="w-20"
          onChange={v => onChange({ ...rule, free_count: parseInt(v, 10) || 0 })} />
      </label>
      <div className="flex flex-wrap items-center gap-1.5 min-w-0">
        {rule.tiers.map((tier, i) => (
          <TierChip key={i} tier={tier}
            onChange={t => onChange({ ...rule, tiers: rule.tiers.map((x, xi) => (xi === i ? t : x)) })}
            onRemove={() => onChange({ ...rule, tiers: rule.tiers.filter((_, xi) => xi !== i) })}
          />
        ))}
        <button
          type="button"
          onClick={() => onChange({ ...rule, tiers: [...rule.tiers, { count: null, lop_days_each: 1 }] })}
          className={`${SX.ghost} !h-8 border-dashed`}
        >
          <Plus size={13} /> Step
        </button>
      </div>
    </div>
  )
}

/**
 * One step as a capsule: "next N times cost D days each". A blank N means
 * every time after this.
 */
function TierChip({ tier, onChange, onRemove }: {
  tier: LopTier
  onChange: (t: LopTier) => void
  onRemove: () => void
}) {
  const box = 'w-12 h-7 rounded-[6px] bg-white border border-[#DDD8CC] px-1 text-[12px] text-center tabular-nums text-slate-900 focus:outline-none focus:border-[#B8983C] placeholder:text-slate-400'
  return (
    <span className="inline-flex items-center gap-1 h-9 pl-1 pr-0.5 rounded-full bg-[#F4F1E9] border border-[#E2DDD2]"
      title="The next N times each cost D days of pay. Leave N blank for every time after this.">
      <input
        type="number" min="0" step="1" value={tier.count ?? ''} placeholder="rest" aria-label="How many times"
        onChange={e => onChange({ ...tier, count: e.target.value === '' ? null : parseInt(e.target.value, 10) || 0 })}
        className={`${box} !rounded-full`}
      />
      <span className="text-[11.5px] text-slate-500">×</span>
      <input
        type="number" min="0" step="0.5" value={tier.lop_days_each} aria-label="Days of pay each"
        onChange={e => onChange({ ...tier, lop_days_each: parseFloat(e.target.value) || 0 })}
        className={`${box} !w-11`}
      />
      <span className="text-[11.5px] text-slate-500">days</span>
      <button type="button" onClick={onRemove} aria-label="Remove this step"
        className="w-7 h-7 rounded-full inline-flex items-center justify-center text-slate-400 hover:text-[#BE123C] hover:bg-white transition">
        <X size={13} />
      </button>
    </span>
  )
}
