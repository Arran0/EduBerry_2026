'use client'

import React, { useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, FlaskConical, TrendingUp } from 'lucide-react'
import ProtectedLayout from '@/components/ProtectedLayout'
import { PUI, inr, inrDelta, deltaColor } from '@/components/payroll/ui'
import { simulate, type SimulationResult } from '@/lib/payroll/runs'

// Salary simulation. Runs the real engine against real people and writes
// nothing — so a projection and the run it predicts cannot disagree, which is
// the difference between this and a spreadsheet somebody re-derives by hand
// every time a rule changes.

export default function SimulatePage() {
  return <ProtectedLayout adminOnly><Simulate /></ProtectedLayout>
}

function Simulate() {
  const now = new Date()
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [year, setYear] = useState(now.getFullYear())
  const [category, setCategory] = useState('')
  const [component, setComponent] = useState('ANCHOR')
  const [kind, setKind] = useState<'percent' | 'amount'>('percent')
  const [value, setValue] = useState(5)
  const [result, setResult] = useState<SimulationResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const run = async () => {
    setBusy(true); setErr(null); setResult(null)
    const res = await simulate({
      periodMonth: month, periodYear: year,
      scope: category ? { categories: [category] } : {},
      change: { kind, component, value },
    })
    setBusy(false)
    if (!res.success || !res.result) { setErr(res.error ?? 'Could not run the simulation'); return }
    setResult(res.result)
  }

  return (
    <div className="min-h-screen bg-[#FAFAFA]">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6">
        <Link href="/more/payroll" className="inline-flex items-center gap-1.5 text-sm text-[#71717A] hover:text-[#27272A] mb-4">
          <ArrowLeft size={16} /> Payroll
        </Link>

        <h1 className="font-display text-2xl font-bold text-[#27272A]">Simulate a change</h1>
        <p className="text-sm text-[#71717A] mt-0.5 mb-5 max-w-2xl">
          What a revision would actually cost, computed by the same engine that runs payroll — including its knock-on
          effect on PF, ESI and tax, which is where a back-of-envelope estimate usually goes wrong.
        </p>

        <div className={`${PUI.card} p-4 mb-4`}>
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <label className={PUI.label}>Give</label>
              <select value={category} onChange={e => setCategory(e.target.value)} className={`${PUI.input} mt-1 w-44`}>
                <option value="">everyone</option>
                <option value="teaching">teaching staff</option>
                <option value="non_teaching">non-teaching staff</option>
                <option value="transport">transport staff</option>
                <option value="support">support staff</option>
              </select>
            </div>
            <div>
              <label className={PUI.label}>a</label>
              <div className="flex gap-1 mt-1">
                <input type="number" value={value} onChange={e => setValue(Number(e.target.value))} className={`${PUI.input} w-20`} />
                <select value={kind} onChange={e => setKind(e.target.value as never)} className={`${PUI.input} w-24`}>
                  <option value="percent">%</option>
                  <option value="amount">₹</option>
                </select>
              </div>
            </div>
            <div>
              <label className={PUI.label}>rise on</label>
              <select value={component} onChange={e => setComponent(e.target.value)} className={`${PUI.input} mt-1 w-36`}>
                <option value="ANCHOR">the whole salary</option>
                <option value="BASIC">Basic only</option>
                <option value="HRA">HRA only</option>
                <option value="DA">DA only</option>
              </select>
            </div>
            <div>
              <label className={PUI.label}>priced on</label>
              <div className="flex gap-1 mt-1">
                <select value={month} onChange={e => setMonth(Number(e.target.value))} className={`${PUI.input} w-32`}>
                  {Array.from({ length: 12 }, (_, i) => i + 1).map(m => (
                    <option key={m} value={m}>{new Date(2000, m - 1, 1).toLocaleString('en-IN', { month: 'long' })}</option>
                  ))}
                </select>
                <input type="number" value={year} onChange={e => setYear(Number(e.target.value))} className={`${PUI.input} w-24`} />
              </div>
            </div>
            <button onClick={run} disabled={busy} className={PUI.darkBtn}>
              <FlaskConical size={13} /> {busy ? 'Running…' : 'Run'}
            </button>
          </div>
          {err && <p className="text-xs text-rose-600 mt-2">{err}</p>}
        </div>

        {result && (
          <>
            <div className={`${PUI.card} p-4 mb-3`}>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <Stat label="Employees" value={String(result.employeeCount)} />
                <Stat label="Net pay a month" value={inrDelta(result.netDelta)} tone={result.netDelta} />
                <Stat label="Employer cost a month" value={inrDelta(result.employerCostDelta)} tone={result.employerCostDelta} />
                <Stat label="A year" value={inrDelta(result.annualisedDelta)} tone={result.annualisedDelta} />
              </div>
              <div className="grid grid-cols-3 gap-4 mt-4 pt-4 border-t border-[#F4F4F5]">
                <Stat label="PF" value={inrDelta(result.pfDelta)} small />
                <Stat label="ESI" value={inrDelta(result.esiDelta)} small />
                <Stat label="TDS" value={inrDelta(result.tdsDelta)} small />
              </div>
              <p className="text-[11px] text-[#A1A1AA] mt-3 leading-relaxed">
                {inr(result.baseTotalNet)} → {inr(result.newTotalNet)} in net pay. The employer-cost figure is the one
                to budget against: it carries the PF, EPS, EDLI and ESI shares the school pays on top.
              </p>
            </div>

            <div className={`${PUI.card} divide-y divide-[#F4F4F5]`}>
              {result.perEmployee.map(e => (
                <div key={e.employeeId} className="p-3 flex items-center gap-3 text-xs">
                  <span className="flex-1 text-[#3F3F46] truncate">{e.name}</span>
                  <span className="text-[#A1A1AA] tabular-nums">{inr(e.before)} → {inr(e.after)}</span>
                  <span className={`font-semibold tabular-nums w-20 text-right ${deltaColor(e.delta)}`}>
                    {inrDelta(e.delta)}
                  </span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function Stat({ label, value, tone, small }: { label: string; value: string; tone?: number; small?: boolean }) {
  return (
    <div>
      <p className={PUI.label}>{label}</p>
      <p className={`${small ? 'text-sm' : 'text-lg'} font-bold tabular-nums mt-0.5 ${tone !== undefined ? deltaColor(tone) : 'text-[#27272A]'}`}>
        {value}
      </p>
    </div>
  )
}
