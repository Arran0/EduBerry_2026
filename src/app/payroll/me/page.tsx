'use client'

import React, { useState, useEffect, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { ArrowLeft, FileText, Landmark, Receipt, ChevronRight, CalendarDays } from 'lucide-react'
import ProtectedLayout from '@/components/ProtectedLayout'
import { useAuth } from '@/contexts/AuthContext'
import { supabase } from '@/lib/supabase'
import { PUI, inr } from '@/components/payroll/ui'
import { ExplainTree } from '@/components/payroll/WhyPanel'
import DayGrid from '@/components/payroll/DayGrid'
import { fetchLoanBalances, fetchAdvanceBalances, fetchLeaveAvailable } from '@/lib/payroll/money'
import type { LoanBalanceRow, AdvanceBalanceRow, LeaveAvailableRow } from '@/lib/payroll/money'
import { splitComponents, runPeriodLabel } from '@/lib/payroll/runs'
import type { RunLineRow } from '@/lib/payroll/rows'
import type { ExplainNode, DayVerdict } from '@/lib/payroll/engine/types'

// Employee self-service.
//
// The employee sees exactly what the payroll office sees for their own line —
// the same stored trace, the same day grid. Row-level security limits this to
// their own rows and only on runs that are locked: a draft figure is not a
// payslip, and showing one starts a conversation about a number that has not
// been approved and may still move.

type Tab = 'payslips' | 'statutory' | 'money' | 'history'

export default function MyPayrollPage() {
  return <ProtectedLayout staffOnly><MyPayroll /></ProtectedLayout>
}

interface MyLine extends RunLineRow {
  run?: { period_month: number; period_year: number; status: string; pay_date: string | null }
}

function MyPayroll() {
  const { profile } = useAuth()
  const employeeId = profile?.id ?? ''
  const [tab, setTab] = useState<Tab>('payslips')
  const [lines, setLines] = useState<MyLine[]>([])
  const [loans, setLoans] = useState<LoanBalanceRow[]>([])
  const [advances, setAdvances] = useState<AdvanceBalanceRow[]>([])
  const [leave, setLeave] = useState<LeaveAvailableRow[]>([])
  const [loading, setLoading] = useState(true)
  const [openLine, setOpenLine] = useState<string | null>(null)
  const [dayGrid, setDayGrid] = useState<{ days: DayVerdict[]; rate: number } | null>(null)

  const load = useCallback(async () => {
    if (!employeeId) return
    setLoading(true)
    const [linesRes, l, a, lv] = await Promise.all([
      supabase.from('payroll_run_lines')
        .select(`
          id, run_id, employee_id, gross_earnings, total_deductions, employer_contributions,
          employer_cost, net_pay, payable_days, paid_days, lop_days, inputs, trace,
          payout_status, payout_reference, structure_id, policy_group_id, calendar_id,
          run:payroll_runs!inner(period_month, period_year, status, pay_date),
          components:payroll_line_components(id, line_id, run_id, component_code, name, kind, amount, full_amount, sequence, computed_from)
        `)
        .eq('employee_id', employeeId),
      fetchLoanBalances(employeeId),
      fetchAdvanceBalances(employeeId),
      fetchLeaveAvailable(employeeId),
    ])
    const rows = ((linesRes.data ?? []) as unknown as MyLine[])
      .sort((x, y) =>
        (y.run?.period_year ?? 0) - (x.run?.period_year ?? 0) ||
        (y.run?.period_month ?? 0) - (x.run?.period_month ?? 0))
    setLines(rows); setLoans(l); setAdvances(a); setLeave(lv)
    setLoading(false)
  }, [employeeId])

  useEffect(() => { load() }, [load])

  const latest = lines[0]
  const fyStart = useMemo(() => {
    const now = new Date()
    return now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1
  }, [])

  /** Year-to-date across the current financial year. */
  const ytd = useMemo(() => {
    const inFy = lines.filter(l => {
      const y = l.run?.period_year ?? 0, m = l.run?.period_month ?? 0
      return (y === fyStart && m >= 4) || (y === fyStart + 1 && m <= 3)
    })
    const total = (code: string) => inFy.reduce(
      (s, l) => s + (l.components ?? []).filter(c => c.component_code === code).reduce((t, c) => t + Number(c.amount), 0), 0)
    return {
      gross: inFy.reduce((s, l) => s + Number(l.gross_earnings), 0),
      net: inFy.reduce((s, l) => s + Number(l.net_pay), 0),
      pf: total('PF'), esi: total('ESI'), tds: total('TDS'), pt: total('PT'),
      months: inFy.length,
    }
  }, [lines, fyStart])

  const outstanding =
    loans.reduce((s, l) => s + Number(l.outstanding), 0) +
    advances.reduce((s, a) => s + Number(a.outstanding), 0)

  return (
    <div className="min-h-screen bg-[#FAFAFA]">
      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6">
        <Link href="/more" className="inline-flex items-center gap-1.5 text-sm text-[#71717A] hover:text-[#27272A] mb-4">
          <ArrowLeft size={16} /> More
        </Link>

        <h1 className="font-display text-2xl font-bold text-[#27272A]">My salary</h1>
        <p className="text-sm text-[#71717A] mt-0.5 mb-5">
          Every figure opens into the workings behind it.
        </p>

        {latest && (
          <div className={`${PUI.card} p-4 mb-4`}>
            <p className={PUI.label}>Latest net pay</p>
            <p className="text-2xl font-bold text-[#27272A] tabular-nums mt-0.5">{inr(Number(latest.net_pay))}</p>
            <p className="text-xs text-[#71717A]">
              {latest.run && runPeriodLabel(latest.run)}
              {Number(latest.lop_days) > 0 && (
                <span className="text-rose-600"> · {Number(latest.lop_days)} day(s) loss of pay</span>
              )}
            </p>
          </div>
        )}

        <div className="flex items-center gap-1 mb-4 border-b border-[#E4E4E7]">
          {([['payslips', 'Payslips'], ['statutory', 'PF, ESI & tax'], ['money', 'Loans'], ['history', 'History']] as [Tab, string][]).map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)}
              className={`px-3 py-2 text-xs font-semibold border-b-2 -mb-px transition-colors ${
                tab === k ? 'border-[#27272A] text-[#27272A]' : 'border-transparent text-[#A1A1AA] hover:text-[#71717A]'}`}>
              {l}
            </button>
          ))}
        </div>

        {loading ? (
          <div className={`${PUI.card} h-40 animate-pulse`} />
        ) : tab === 'payslips' ? (
          lines.length === 0 ? (
            <div className={`${PUI.card} p-8 text-center text-sm text-[#71717A]`}>
              No payslips yet. They appear here once a payroll run is locked.
            </div>
          ) : (
            <div className="space-y-2">
              {lines.map(l => {
                const open = openLine === l.id
                const { earnings, deductions, employer } = splitComponents(l.components ?? [])
                const days = (l.inputs?.attendanceDays ?? []) as DayVerdict[]
                const perDay = Number(l.payable_days) > 0 ? Number(l.gross_earnings) / Number(l.payable_days) : 0
                return (
                  <div key={l.id} className={PUI.card}>
                    <button onClick={() => setOpenLine(open ? null : l.id)} className="w-full flex items-center gap-3 p-3.5 text-left">
                      <ChevronRight size={13} className={`text-[#A1A1AA] transition-transform ${open ? 'rotate-90' : ''}`} />
                      <div className="flex-1">
                        <p className="text-sm font-semibold text-[#27272A]">{l.run && runPeriodLabel(l.run)}</p>
                        <p className="text-[11px] text-[#A1A1AA]">
                          {Number(l.paid_days)} of {Number(l.payable_days)} days paid
                        </p>
                      </div>
                      <span className="text-sm font-bold text-[#27272A] tabular-nums">{inr(Number(l.net_pay))}</span>
                    </button>

                    {open && (
                      <div className="border-t border-[#F4F4F5] p-3.5 space-y-4">
                        <Section title="Earnings" rows={earnings} />
                        <Section title="Deductions" rows={deductions} negative />
                        {employer.length > 0 && <Section title="Your employer also contributed" rows={employer} muted />}

                        {days.length > 0 && (
                          <button onClick={() => setDayGrid({ days, rate: perDay })} className={PUI.ghostBtn}>
                            <CalendarDays size={12} /> See every day of this month
                          </button>
                        )}

                        {l.trace && (
                          <details>
                            <summary className="text-[11px] font-semibold text-[#71717A] cursor-pointer hover:text-[#27272A]">
                              Show the full workings
                            </summary>
                            <div className="mt-2 pt-2 border-t border-[#F4F4F5]">
                              <ExplainTree trace={l.trace as unknown as ExplainNode} />
                            </div>
                          </details>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )
        ) : tab === 'statutory' ? (
          <div className="space-y-3">
            <div className={`${PUI.card} p-4`}>
              <h3 className={`${PUI.label} mb-3`}>This financial year ({fyStart}–{String(fyStart + 1).slice(2)})</h3>
              <div className="grid grid-cols-2 gap-4">
                <Stat label="Gross paid" value={inr(ytd.gross)} />
                <Stat label="Net received" value={inr(ytd.net)} />
                <Stat label="Provident Fund" value={inr(ytd.pf)} icon={<Landmark size={12} />} />
                <Stat label="ESI" value={inr(ytd.esi)} />
                <Stat label="Income tax deducted" value={inr(ytd.tds)} icon={<Receipt size={12} />} />
                <Stat label="Professional Tax" value={inr(ytd.pt)} />
              </div>
              <p className="text-[11px] text-[#A1A1AA] mt-3 leading-relaxed">
                Across {ytd.months} month{ytd.months === 1 ? '' : 's'} of locked payroll.
              </p>
            </div>

            <div className={`${PUI.card} p-4`}>
              <h3 className={`${PUI.label} mb-2`}>Tax declaration</h3>
              <p className="text-xs text-[#71717A] leading-relaxed mb-3">
                Declaring your investments and rent reduces the tax deducted each month. Your school&apos;s payroll
                office verifies what you submit.
              </p>
              <Link href="/payroll/me/declaration" className={PUI.darkBtn}>
                <FileText size={12} /> Open my declaration
              </Link>
            </div>
          </div>
        ) : tab === 'money' ? (
          <div className="space-y-3">
            <div className={`${PUI.card} p-4`}>
              <p className={PUI.label}>Total outstanding</p>
              <p className="text-xl font-bold text-[#27272A] tabular-nums mt-0.5">{inr(outstanding)}</p>
            </div>

            {loans.length === 0 && advances.length === 0 ? (
              <div className={`${PUI.card} p-8 text-center text-sm text-[#71717A]`}>
                You have no loans or advances outstanding.
              </div>
            ) : (
              <>
                {loans.map(l => (
                  <div key={l.loan_id} className={`${PUI.card} p-4`}>
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="text-sm font-semibold text-[#27272A]">{l.label}</p>
                      <p className="text-sm font-bold text-[#27272A] tabular-nums">{inr(Number(l.outstanding))}</p>
                    </div>
                    <p className="text-[11px] text-[#71717A] mt-0.5">
                      {inr(Number(l.principal))} borrowed · {inr(Number(l.emi_amount))} a month
                      {l.interest_type !== 'none' && ` · ${l.interest_rate}% ${l.interest_type}`}
                    </p>
                    <div className="mt-2 h-1.5 bg-[#F4F4F5] rounded-full overflow-hidden">
                      <div className="h-full bg-[#27272A]" style={{
                        width: `${Math.min(100, (Number(l.principal_repaid) / Math.max(1, Number(l.principal))) * 100)}%`,
                      }} />
                    </div>
                    <p className="text-[10px] text-[#A1A1AA] mt-1">
                      {inr(Number(l.principal_repaid))} repaid
                      {Number(l.interest_paid) > 0 && `, ${inr(Number(l.interest_paid))} interest`}
                    </p>
                  </div>
                ))}
                {advances.map(a => (
                  <div key={a.advance_id} className={`${PUI.card} p-4 flex items-baseline justify-between gap-2`}>
                    <div>
                      <p className="text-sm font-semibold text-[#27272A]">{a.label}</p>
                      <p className="text-[11px] text-[#71717A]">
                        Advance of {inr(Number(a.amount))}, {a.recovery_mode === 'single' ? 'recovered in one go' : `${inr(Number(a.emi_amount))} a month`}
                      </p>
                    </div>
                    <p className="text-sm font-bold text-[#27272A] tabular-nums">{inr(Number(a.outstanding))}</p>
                  </div>
                ))}
              </>
            )}

            {leave.length > 0 && (
              <div className={`${PUI.card} p-4`}>
                <h3 className={`${PUI.label} mb-2`}>Leave balance</h3>
                {leave.map(lv => (
                  <div key={`${lv.year}-${lv.leave_type}`} className="flex items-baseline justify-between text-xs py-0.5">
                    <span className="text-[#52525B] capitalize">{lv.leave_type.replace('_', ' ')}</span>
                    <span className="tabular-nums font-medium text-[#27272A]">
                      {lv.available} day{Number(lv.available) === 1 ? '' : 's'}
                      {lv.encashable && <span className="text-[10px] text-emerald-600 ml-1.5">encashable</span>}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className={`${PUI.card} p-4`}>
            <h3 className={`${PUI.label} mb-3`}>Salary history</h3>
            {lines.length === 0 ? (
              <p className="text-xs text-[#71717A]">Nothing yet.</p>
            ) : (
              <div className="space-y-1">
                {lines.map(l => (
                  <div key={l.id} className="flex items-baseline justify-between gap-2 py-1.5 border-b border-[#F4F4F5] last:border-0">
                    <span className="text-xs text-[#52525B]">{l.run && runPeriodLabel(l.run)}</span>
                    <span className="text-xs text-[#A1A1AA] tabular-nums">{inr(Number(l.gross_earnings))} gross</span>
                    <span className="text-xs font-semibold text-[#27272A] tabular-nums w-20 text-right">
                      {inr(Number(l.net_pay))}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {dayGrid && (
        <DayGrid days={dayGrid.days} employeeName={profile?.full_name ?? 'You'}
          perDayRate={dayGrid.rate} onClose={() => setDayGrid(null)} />
      )}
    </div>
  )
}

function Section({ title, rows, negative, muted }: {
  title: string
  rows: { id: string; name: string; amount: number }[]
  negative?: boolean; muted?: boolean
}) {
  if (rows.length === 0) return null
  const total = rows.reduce((s, r) => s + Number(r.amount), 0)
  return (
    <div>
      <h4 className={`${PUI.label} mb-1.5`}>{title}</h4>
      <div className="space-y-0.5">
        {rows.map(r => (
          <div key={r.id} className="flex items-baseline justify-between gap-2 text-xs">
            <span className={muted ? 'text-[#A1A1AA]' : 'text-[#52525B]'}>{r.name}</span>
            <span className={`tabular-nums font-medium ${muted ? 'text-[#A1A1AA]' : negative ? 'text-rose-600' : 'text-[#27272A]'}`}>
              {negative ? '−' : ''}{inr(Number(r.amount))}
            </span>
          </div>
        ))}
        <div className="flex items-baseline justify-between gap-2 text-xs pt-1 mt-1 border-t border-[#F4F4F5]">
          <span className="font-semibold text-[#27272A]">Total</span>
          <span className={`tabular-nums font-bold ${negative ? 'text-rose-600' : 'text-[#27272A]'}`}>
            {negative ? '−' : ''}{inr(total)}
          </span>
        </div>
      </div>
    </div>
  )
}

function Stat({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
  return (
    <div>
      <p className={`${PUI.label} flex items-center gap-1`}>{icon}{label}</p>
      <p className="text-base font-bold text-[#27272A] tabular-nums mt-0.5">{value}</p>
    </div>
  )
}
