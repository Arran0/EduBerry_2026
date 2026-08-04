'use client'

import React from 'react'
import { Landmark, HeartPulse, CalendarX2, Sparkles, Plus, Trash2 } from 'lucide-react'
import { PayrollCalibration, LopRule, LopTier } from '@/lib/payroll'

/**
 * The PF / ESI / LOP / bonus calibration form body — four self-contained
 * cards. Shared by the global settings page (site_settings default) and the
 * per-cycle "Cycle Settings" override modal, so the editing UI is identical
 * either way.
 */
export default function PayrollCalibrationFields({ calibration, onChange }: {
  calibration: PayrollCalibration
  onChange: (c: PayrollCalibration) => void
}) {
  return (
    <div className="space-y-5">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
        <div className="flex items-center gap-2 mb-4">
          <div className="p-1.5 bg-violet-100 rounded-lg"><Landmark size={16} className="text-violet-600" /></div>
          <h2 className="font-semibold text-slate-800">PF (Provident Fund)</h2>
        </div>
        <p className="text-xs text-slate-500 mb-4 leading-relaxed">
          PF is calculated on each staff member&apos;s own &quot;PF Basic&quot; wage (set per person in Base Salaries,
          not their gross salary) — <code>PF = PF Basic × rate</code>. Only staff marked PF-applicable get a deduction.
        </p>
        <label className="text-xs font-semibold text-slate-600 mb-1.5 block uppercase tracking-wide">Employee PF rate (%)</label>
        <input type="number" min="0" step="0.1" value={calibration.pf.rate * 100}
          onChange={e => onChange({ ...calibration, pf: { rate: (parseFloat(e.target.value) || 0) / 100 } })}
          className="w-32 border border-slate-200 rounded-xl px-3 py-2 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-violet-400/40 bg-white" />
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
        <div className="flex items-center gap-2 mb-4">
          <div className="p-1.5 bg-rose-100 rounded-lg"><HeartPulse size={16} className="text-rose-600" /></div>
          <h2 className="font-semibold text-slate-800">ESI</h2>
        </div>
        <p className="text-xs text-slate-500 mb-4 leading-relaxed">
          Applies automatically to staff at or under the wage ceiling (a per-person override is available in
          Base Salaries for the &quot;stays enrolled after crossing the ceiling&quot; exception).
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-semibold text-slate-600 mb-1.5 block uppercase tracking-wide">ESI rate (%)</label>
            <input type="number" min="0" step="0.01" value={calibration.esi.rate * 100}
              onChange={e => onChange({ ...calibration, esi: { ...calibration.esi, rate: (parseFloat(e.target.value) || 0) / 100 } })}
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-rose-400/40 bg-white" />
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-600 mb-1.5 block uppercase tracking-wide">Wage ceiling (₹/month)</label>
            <input type="number" min="0" step="500" value={calibration.esi.wage_ceiling}
              onChange={e => onChange({ ...calibration, esi: { ...calibration.esi, wage_ceiling: parseFloat(e.target.value) || 0 } })}
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-rose-400/40 bg-white" />
          </div>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
        <div className="flex items-center gap-2 mb-4">
          <div className="p-1.5 bg-orange-100 rounded-lg"><CalendarX2 size={16} className="text-orange-600" /></div>
          <h2 className="font-semibold text-slate-800">Loss of Pay (LOP)</h2>
        </div>
        <p className="text-xs text-slate-500 mb-4 leading-relaxed">
          A free quota of lates/leaves per month before any LOP applies, then tiered rates — e.g. make a
          2nd unauthorized leave cost more than the 1st by adding a second tier with a higher LOP value.
        </p>
        <div className="space-y-5">
          <LopRuleEditor label="Late arrivals" rule={calibration.lop.late}
            onChange={r => onChange({ ...calibration, lop: { ...calibration.lop, late: r } })} />
          <LopRuleEditor label="Leave days" rule={calibration.lop.leave}
            onChange={r => onChange({ ...calibration, lop: { ...calibration.lop, leave: r } })} />
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
        <div className="flex items-center gap-2 mb-4">
          <div className="p-1.5 bg-amber-100 rounded-lg"><Sparkles size={16} className="text-amber-600" /></div>
          <h2 className="font-semibold text-slate-800">Task bonus</h2>
        </div>
        <p className="text-xs text-slate-500 mb-4 leading-relaxed">
          Task-manager bonus points earned each month convert to a rupee bonus automatically when a cycle
          is closed — either a fixed rate per point, or a fixed cash pool split proportionally among
          everyone who earned points that month.
        </p>
        <div className="flex gap-2 mb-3">
          <button onClick={() => onChange({ ...calibration, bonus: { ...calibration.bonus, mode: 'per_point' } })}
            className={`flex-1 text-xs font-semibold px-3 py-2 rounded-xl border transition-colors ${
              calibration.bonus.mode === 'per_point' ? 'bg-amber-50 border-amber-300 text-amber-800' : 'bg-white border-slate-200 text-slate-500'
            }`}>₹ per point</button>
          <button onClick={() => onChange({ ...calibration, bonus: { ...calibration.bonus, mode: 'pool' } })}
            className={`flex-1 text-xs font-semibold px-3 py-2 rounded-xl border transition-colors ${
              calibration.bonus.mode === 'pool' ? 'bg-amber-50 border-amber-300 text-amber-800' : 'bg-white border-slate-200 text-slate-500'
            }`}>Cash pool split</button>
        </div>
        {calibration.bonus.mode === 'per_point' ? (
          <div>
            <label className="text-xs font-semibold text-slate-600 mb-1.5 block uppercase tracking-wide">₹ per bonus point</label>
            <input type="number" min="0" step="1" value={calibration.bonus.per_point_value}
              onChange={e => onChange({ ...calibration, bonus: { ...calibration.bonus, per_point_value: parseFloat(e.target.value) || 0 } })}
              className="w-40 border border-slate-200 rounded-xl px-3 py-2 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-amber-400/40 bg-white" />
          </div>
        ) : (
          <div>
            <label className="text-xs font-semibold text-slate-600 mb-1.5 block uppercase tracking-wide">₹ pool per cycle</label>
            <input type="number" min="0" step="500" value={calibration.bonus.pool_amount}
              onChange={e => onChange({ ...calibration, bonus: { ...calibration.bonus, pool_amount: parseFloat(e.target.value) || 0 } })}
              className="w-40 border border-slate-200 rounded-xl px-3 py-2 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-amber-400/40 bg-white" />
          </div>
        )}
      </div>
    </div>
  )
}

export function LopRuleEditor({ label, rule, onChange }: { label: string; rule: LopRule; onChange: (r: LopRule) => void }) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <p className="text-sm font-semibold text-slate-700 flex-1">{label}</p>
        <label className="text-xs text-slate-500">Free per month</label>
        <input type="number" min="0" value={rule.free_count}
          onChange={e => onChange({ ...rule, free_count: parseInt(e.target.value) || 0 })}
          className="w-16 border border-slate-200 rounded-lg px-2 py-1.5 text-xs text-center tabular-nums focus:outline-none focus:ring-2 focus:ring-orange-400/40 bg-white" />
      </div>
      <div className="space-y-1.5 pl-3 border-l-2 border-slate-100">
        {rule.tiers.map((tier, i) => (
          <TierRow key={i} tier={tier}
            onChange={t => onChange({ ...rule, tiers: rule.tiers.map((x, xi) => (xi === i ? t : x)) })}
            onRemove={() => onChange({ ...rule, tiers: rule.tiers.filter((_, xi) => xi !== i) })}
          />
        ))}
        <button onClick={() => onChange({ ...rule, tiers: [...rule.tiers, { count: null, lop_days_each: 1 }] })}
          className="text-xs font-semibold text-orange-600 hover:text-orange-700 flex items-center gap-1">
          <Plus size={12} /> Add tier
        </button>
      </div>
    </div>
  )
}

function TierRow({ tier, onChange, onRemove }: { tier: LopTier; onChange: (t: LopTier) => void; onRemove: () => void }) {
  return (
    <div className="flex items-center gap-1.5 text-xs text-slate-500">
      <span>Next</span>
      <input type="number" min="0" step="1" value={tier.count ?? ''} placeholder="rest"
        onChange={e => onChange({ ...tier, count: e.target.value === '' ? null : parseInt(e.target.value) || 0 })}
        className="w-16 border border-slate-200 rounded-lg px-2 py-1 text-xs text-center tabular-nums focus:outline-none focus:ring-2 focus:ring-orange-400/40 bg-white" />
      <span>occurrence(s) →</span>
      <input type="number" min="0" step="0.5" value={tier.lop_days_each}
        onChange={e => onChange({ ...tier, lop_days_each: parseFloat(e.target.value) || 0 })}
        className="w-16 border border-slate-200 rounded-lg px-2 py-1 text-xs text-center tabular-nums focus:outline-none focus:ring-2 focus:ring-orange-400/40 bg-white" />
      <span>day(s) LOP each</span>
      <button onClick={onRemove} className="ml-auto p-1 text-slate-300 hover:text-rose-500 transition-colors">
        <Trash2 size={13} />
      </button>
    </div>
  )
}
