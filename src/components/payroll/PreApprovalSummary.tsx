'use client'

import React from 'react'
import { TrendingUp, TrendingDown, Users, AlertTriangle, Check } from 'lucide-react'
import type { VarianceResult } from '@/lib/payroll/engine/variance'
import type { RunTotals } from '@/lib/payroll/runs'
import { inr, inrDelta, deltaColor, PUI } from './ui'

/**
 * What an approver has to see before the approve button does anything.
 *
 * Total payroll, month-on-month variance broken down by cause, the people whose
 * pay moved sharply, and the readiness counts. The waterfall is the answer to
 * "why did payroll go up ₹1.8L" — each band names a reason and lists the people
 * behind it, because a total with no attribution is exactly what sends an
 * accountant to Excel.
 *
 * Acknowledging is a recorded act: `variance_acknowledged_by` gates the move to
 * Approved, and recalculating clears it, since numbers that changed have not
 * been reviewed.
 */
export default function PreApprovalSummary({
  totals, variance, missing, newJoiners, exits, acknowledged, onAcknowledge, readOnly,
}: {
  totals: RunTotals
  variance: VarianceResult | null
  missing: { bank: number; pan: number; uan: number; ip: number }
  newJoiners: number
  exits: number
  acknowledged: boolean
  onAcknowledge: () => void
  readOnly: boolean
}) {
  const up = (variance?.delta ?? 0) >= 0

  return (
    <div className="space-y-3">
      {/* ── Headline ─────────────────────────────────────────────── */}
      <div className={`${PUI.card} p-4`}>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <Stat label="Total net pay" value={inr(totals.net)} />
          <Stat label="Gross earnings" value={inr(totals.gross)} />
          <Stat label="Employer cost" value={inr(totals.employerCost)} hint="Including PF, EPS, EDLI and ESI shares" />
          <Stat label="Employees" value={String(totals.lineCount)} />
        </div>

        {variance && (
          <div className="mt-4 pt-4 border-t border-[#F4F4F5] flex items-center gap-3">
            <div className={`p-1.5 rounded-lg ${up ? 'bg-emerald-50' : 'bg-rose-50'}`}>
              {up ? <TrendingUp size={15} className="text-emerald-600" /> : <TrendingDown size={15} className="text-rose-600" />}
            </div>
            <div className="flex-1">
              <p className="text-sm font-semibold text-[#27272A]">
                {inrDelta(variance.delta)}{' '}
                <span className="font-normal text-[#71717A]">
                  against last period ({variance.deltaPercent > 0 ? '+' : ''}{variance.deltaPercent}%)
                </span>
              </p>
              <p className="text-[11px] text-[#A1A1AA]">
                Headcount {variance.headcountPrevious} → {variance.headcountCurrent}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* ── Where the movement came from ─────────────────────────── */}
      {variance && variance.bands.length > 0 && (
        <div className={`${PUI.card} p-4`}>
          <h3 className={`${PUI.label} mb-3`}>Why payroll moved</h3>
          <div className="space-y-2">
            {variance.bands.map(band => {
              const width = Math.min(100, Math.abs(band.amount) / Math.max(1, Math.abs(variance.delta) || Math.abs(band.amount)) * 100)
              return (
                <details key={band.reason} className="group">
                  <summary className="flex items-center gap-3 cursor-pointer py-1 list-none">
                    <span className="text-xs text-[#3F3F46] w-40 flex-shrink-0">{band.label}</span>
                    <span className="flex-1 h-4 bg-[#FAFAFA] rounded overflow-hidden relative">
                      <span
                        className={`absolute inset-y-0 ${band.amount >= 0 ? 'left-1/2 bg-emerald-400' : 'right-1/2 bg-rose-400'}`}
                        style={{ width: `${width / 2}%` }}
                      />
                      <span className="absolute inset-y-0 left-1/2 w-px bg-[#E4E4E7]" />
                    </span>
                    <span className={`text-xs font-semibold tabular-nums w-24 text-right ${deltaColor(band.amount)}`}>
                      {inrDelta(band.amount)}
                    </span>
                    <span className="text-[10px] text-[#A1A1AA] w-8 text-right">{band.employees.length}</span>
                  </summary>
                  <div className="ml-40 pl-3 mt-1 mb-2 space-y-0.5 border-l border-[#F4F4F5]">
                    {band.employees.slice(0, 12).map(e => (
                      <div key={e.employeeId} className="flex items-baseline gap-2 text-[11px]">
                        <span className="text-[#52525B] flex-1 truncate">{e.employeeName}</span>
                        <span className={`tabular-nums font-medium ${deltaColor(e.amount)}`}>{inrDelta(e.amount)}</span>
                      </div>
                    ))}
                    {band.employees.length > 12 && (
                      <p className="text-[10px] text-[#A1A1AA]">and {band.employees.length - 12} more</p>
                    )}
                  </div>
                </details>
              )
            })}
          </div>
        </div>
      )}

      {/* ── Individuals who moved sharply ────────────────────────── */}
      {variance && variance.outliers.length > 0 && (
        <div className={`${PUI.card} p-4`}>
          <h3 className={`${PUI.label} mb-3`}>Unusual changes</h3>
          <div className="space-y-1.5">
            {variance.outliers.slice(0, 10).map(o => (
              <div key={o.employeeId} className="flex items-center gap-3 text-xs">
                <span className="flex-1 text-[#3F3F46] truncate">{o.employeeName}</span>
                <span className="text-[#A1A1AA] tabular-nums">{inr(o.previous)} → {inr(o.current)}</span>
                <span className={`font-semibold tabular-nums w-16 text-right ${deltaColor(o.delta)}`}>
                  {o.deltaPercent > 0 ? '+' : ''}{o.deltaPercent}%
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Readiness ────────────────────────────────────────────── */}
      <div className={`${PUI.card} p-4`}>
        <h3 className={`${PUI.label} mb-3`}>Before you approve</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <Readiness label="Missing bank details" count={missing.bank} blocking />
          <Readiness label="Missing PAN" count={missing.pan} />
          <Readiness label="Missing UAN" count={missing.uan} blocking />
          <Readiness label="Missing ESI IP number" count={missing.ip} blocking />
          <Readiness label="New joiners" count={newJoiners} neutral />
          <Readiness label="Exits" count={exits} neutral />
        </div>
      </div>

      {/* ── Acknowledgement ──────────────────────────────────────── */}
      {!readOnly && (
        <div className={`${PUI.card} p-4 flex items-center gap-3`}>
          {acknowledged ? (
            <>
              <Check size={16} className="text-emerald-600" />
              <p className="flex-1 text-xs text-[#52525B]">
                Variance reviewed. The run can now be approved.
              </p>
            </>
          ) : (
            <>
              <AlertTriangle size={16} className="text-amber-500" />
              <p className="flex-1 text-xs text-[#52525B]">
                Confirm you have read the totals and the variance above. Approval is blocked until you do, and
                recalculating the run clears this again.
              </p>
              <button onClick={onAcknowledge} className={PUI.darkBtn}>I have reviewed this</button>
            </>
          )}
        </div>
      )}
    </div>
  )
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <p className={PUI.label}>{label}</p>
      <p className="text-lg font-bold text-[#27272A] tabular-nums mt-0.5">{value}</p>
      {hint && <p className="text-[10px] text-[#A1A1AA] leading-tight mt-0.5">{hint}</p>}
    </div>
  )
}

function Readiness({ label, count, blocking, neutral }: { label: string; count: number; blocking?: boolean; neutral?: boolean }) {
  const tone = count === 0 || neutral ? 'text-[#27272A]' : blocking ? 'text-rose-600' : 'text-amber-600'
  return (
    <div className="flex items-baseline gap-2">
      <span className={`text-base font-bold tabular-nums ${tone}`}>{count}</span>
      <span className="text-[11px] text-[#71717A] leading-tight">{label}</span>
    </div>
  )
}
