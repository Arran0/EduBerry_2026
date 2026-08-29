'use client'

import React, { useState, useEffect, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { ArrowLeft, Plus, Wallet, ChevronRight } from 'lucide-react'
import ProtectedLayout from '@/components/ProtectedLayout'
import { useAuth } from '@/contexts/AuthContext'
import { supabase } from '@/lib/supabase'
import { PUI, inr } from '@/components/payroll/ui'
import {
  fetchLoanBalances, fetchAdvanceBalances, fetchLoanSchedule, fetchRepayments,
  createLoan, createAdvance, recordManualRepayment, setLoanStatus,
} from '@/lib/payroll/money'
import type { LoanBalanceRow, AdvanceBalanceRow } from '@/lib/payroll/money'
import { suggestedEmi } from '@/lib/payroll/engine/recoveries'

// Loans and advances. Outstanding is read from the derived views — nothing on
// this screen writes a balance, because there is no balance column to write.

export default function PayrollMoneyPage() {
  return <ProtectedLayout adminOnly><Money /></ProtectedLayout>
}

interface StaffLite { id: string; full_name: string }

function Money() {
  const { profile } = useAuth()
  const [loans, setLoans] = useState<LoanBalanceRow[]>([])
  const [advances, setAdvances] = useState<AdvanceBalanceRow[]>([])
  const [staff, setStaff] = useState<StaffLite[]>([])
  const [loading, setLoading] = useState(true)
  const [showNew, setShowNew] = useState<'loan' | 'advance' | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [schedule, setSchedule] = useState<Record<string, unknown>[]>([])
  const [repayments, setRepayments] = useState<Record<string, unknown>[]>([])

  const load = useCallback(async () => {
    setLoading(true)
    const [l, a, people] = await Promise.all([
      fetchLoanBalances(), fetchAdvanceBalances(),
      supabase.from('profiles').select('id, full_name')
        .in('role', ['teacher', 'coordinator', 'principal', 'driver']).eq('is_banned', false).order('full_name'),
    ])
    setLoans(l); setAdvances(a); setStaff((people.data ?? []) as StaffLite[])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const names = useMemo(() => Object.fromEntries(staff.map(s => [s.id, s.full_name])), [staff])

  const openLoan = async (id: string) => {
    if (open === id) { setOpen(null); return }
    setOpen(id)
    const [s, r] = await Promise.all([fetchLoanSchedule(id), fetchRepayments(id)])
    setSchedule(s as Record<string, unknown>[]); setRepayments(r as Record<string, unknown>[])
  }

  const totalOutstanding =
    loans.reduce((s, l) => s + Number(l.outstanding), 0) +
    advances.reduce((s, a) => s + Number(a.outstanding), 0)

  return (
    <div className="min-h-screen bg-[#FAFAFA]">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6">
        <Link href="/more/payroll" className="inline-flex items-center gap-1.5 text-sm text-[#71717A] hover:text-[#27272A] mb-4">
          <ArrowLeft size={16} /> Payroll
        </Link>

        <div className="flex items-start justify-between gap-3 mb-5">
          <div>
            <h1 className="font-display text-2xl font-bold text-[#27272A]">Loans &amp; advances</h1>
            <p className="text-sm text-[#71717A] mt-0.5">
              {inr(totalOutstanding)} outstanding across {loans.length + advances.length} account(s).
            </p>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setShowNew(showNew === 'advance' ? null : 'advance')} className={PUI.ghostBtn}>
              <Plus size={12} /> Advance
            </button>
            <button onClick={() => setShowNew(showNew === 'loan' ? null : 'loan')} className={PUI.darkBtn}>
              <Plus size={12} /> Loan
            </button>
          </div>
        </div>

        {showNew && (
          <NewForm kind={showNew} staff={staff} createdBy={profile?.id ?? ''}
            onDone={async () => { setShowNew(null); await load() }} />
        )}

        {loading ? <div className={`${PUI.card} h-40 animate-pulse`} /> : (
          <div className="space-y-2">
            {loans.map(l => (
              <div key={l.loan_id} className={PUI.card}>
                <button onClick={() => openLoan(l.loan_id)} className="w-full flex items-center gap-3 p-3.5 text-left">
                  <ChevronRight size={13} className={`text-[#A1A1AA] transition-transform ${open === l.loan_id ? 'rotate-90' : ''}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-[#27272A]">{names[l.employee_id] ?? l.employee_id}</p>
                    <p className="text-[11px] text-[#A1A1AA]">
                      {l.label} · {inr(Number(l.principal))} over {l.tenure_months} months
                      {l.interest_type !== 'none' && ` at ${l.interest_rate}% ${l.interest_type}`}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold text-[#27272A] tabular-nums">{inr(Number(l.outstanding))}</p>
                    <p className="text-[10px] text-[#A1A1AA]">outstanding</p>
                  </div>
                </button>
                {open === l.loan_id && (
                  <div className="border-t border-[#F4F4F5] p-3.5 grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <h4 className={`${PUI.label} mb-1.5`}>Schedule</h4>
                      <div className="max-h-48 overflow-y-auto space-y-0.5">
                        {schedule.map((s, i) => (
                          <div key={i} className="flex items-baseline justify-between text-[11px]">
                            <span className="text-[#A1A1AA] tabular-nums">{String(s.period)}</span>
                            <span className="text-[#52525B] tabular-nums">{inr(Number(s.emi_due))}</span>
                            <span className="text-[#A1A1AA] tabular-nums">{inr(Number(s.balance_after))}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div>
                      <h4 className={`${PUI.label} mb-1.5`}>Repaid</h4>
                      {repayments.length === 0 ? (
                        <p className="text-[11px] text-[#A1A1AA]">Nothing recovered yet.</p>
                      ) : (
                        <div className="max-h-48 overflow-y-auto space-y-0.5">
                          {repayments.map((r, i) => (
                            <div key={i} className="flex items-baseline justify-between text-[11px]">
                              <span className="text-[#A1A1AA] tabular-nums">{String(r.paid_on)}</span>
                              <span className="text-[#52525B] tabular-nums">{inr(Number(r.amount))}</span>
                              <span className="text-[10px] text-[#A1A1AA]">{r.run_id ? 'payroll' : 'manual'}</span>
                            </div>
                          ))}
                        </div>
                      )}
                      <div className="flex gap-1.5 mt-2">
                        <button onClick={async () => {
                          const amt = Number(prompt('Amount repaid outside payroll?') ?? 0)
                          if (amt > 0) {
                            await recordManualRepayment({ loanId: l.loan_id, amount: amt, note: 'Recorded by the payroll office', createdBy: profile?.id ?? '' })
                            await load(); await openLoan(l.loan_id)
                          }
                        }} className={PUI.ghostBtn}>Record repayment</button>
                        <button onClick={async () => {
                          await setLoanStatus(l.loan_id, l.status === 'on_hold' ? 'active' : 'on_hold')
                          await load()
                        }} className={PUI.ghostBtn}>{l.status === 'on_hold' ? 'Resume' : 'Hold'}</button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))}

            {advances.map(a => (
              <div key={a.advance_id} className={`${PUI.card} p-3.5 flex items-center gap-3`}>
                <Wallet size={14} className="text-[#A1A1AA]" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-[#27272A]">{names[a.employee_id] ?? a.employee_id}</p>
                  <p className="text-[11px] text-[#A1A1AA]">
                    {a.label} · {inr(Number(a.amount))} · {a.recovery_mode === 'single' ? 'one instalment' : `${inr(Number(a.emi_amount))} a month`}
                  </p>
                </div>
                <p className="text-sm font-bold text-[#27272A] tabular-nums">{inr(Number(a.outstanding))}</p>
              </div>
            ))}

            {loans.length === 0 && advances.length === 0 && (
              <div className={`${PUI.card} p-8 text-center text-sm text-[#71717A]`}>Nothing outstanding.</div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function NewForm({ kind, staff, createdBy, onDone }: {
  kind: 'loan' | 'advance'; staff: StaffLite[]; createdBy: string; onDone: () => Promise<void>
}) {
  const [employeeId, setEmployeeId] = useState(staff[0]?.id ?? '')
  const [label, setLabel] = useState(kind === 'loan' ? 'Staff loan' : 'Salary advance')
  const [amount, setAmount] = useState(0)
  const [rate, setRate] = useState(0)
  const [interestType, setInterestType] = useState<'none' | 'flat' | 'reducing'>('none')
  const [tenure, setTenure] = useState(12)
  const [mode, setMode] = useState<'single' | 'emi'>('single')
  const [emi, setEmi] = useState(0)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const period = new Date().toISOString().slice(0, 7)
  const suggested = useMemo(
    () => (kind === 'loan' && amount > 0 ? suggestedEmi(amount, rate, tenure, interestType) : 0),
    [kind, amount, rate, tenure, interestType],
  )

  const submit = async () => {
    setBusy(true); setErr(null)
    const res = kind === 'loan'
      ? await createLoan({ employeeId, label, principal: amount, interestRate: rate, interestType, tenureMonths: tenure, startPeriod: period, sanctionedBy: createdBy })
      : await createAdvance({ employeeId, label, amount, reason: null, recoveryMode: mode, emiAmount: emi, startPeriod: period, sanctionedBy: createdBy })
    setBusy(false)
    if (!res.success) { setErr(res.error ?? 'Could not save'); return }
    await onDone()
  }

  return (
    <div className={`${PUI.card} p-4 mb-4`}>
      <h2 className={`${PUI.label} mb-3`}>New {kind}</h2>
      <div className="flex flex-wrap items-end gap-2">
        <select value={employeeId} onChange={e => setEmployeeId(e.target.value)} className={`${PUI.input} w-44`}>
          {staff.map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}
        </select>
        <input value={label} onChange={e => setLabel(e.target.value)} className={`${PUI.input} w-40`} placeholder="Label" />
        <input type="number" value={amount} onChange={e => setAmount(Number(e.target.value))} className={`${PUI.input} w-28`} placeholder="Amount" />
        {kind === 'loan' ? (
          <>
            <select value={interestType} onChange={e => setInterestType(e.target.value as never)} className={`${PUI.input} w-32`}>
              <option value="none">No interest</option>
              <option value="flat">Flat</option>
              <option value="reducing">Reducing balance</option>
            </select>
            {interestType !== 'none' && (
              <input type="number" step={0.1} value={rate} onChange={e => setRate(Number(e.target.value))} className={`${PUI.input} w-20`} placeholder="% a year" />
            )}
            <input type="number" value={tenure} onChange={e => setTenure(Number(e.target.value))} className={`${PUI.input} w-20`} placeholder="Months" />
          </>
        ) : (
          <>
            <select value={mode} onChange={e => setMode(e.target.value as never)} className={`${PUI.input} w-40`}>
              <option value="single">Recover in one go</option>
              <option value="emi">Recover monthly</option>
            </select>
            {mode === 'emi' && (
              <input type="number" value={emi} onChange={e => setEmi(Number(e.target.value))} className={`${PUI.input} w-24`} placeholder="Monthly" />
            )}
          </>
        )}
        <button onClick={submit} disabled={busy || !employeeId || amount <= 0} className={PUI.darkBtn}>
          {busy ? 'Saving…' : 'Create'}
        </button>
      </div>
      {kind === 'loan' && suggested > 0 && (
        <p className="text-[11px] text-[#71717A] mt-2">
          Suggested instalment: <strong>{inr(suggested)}</strong> a month. The final instalment settles whatever is
          left, so the loan clears exactly within its tenure.
        </p>
      )}
      {err && <p className="text-xs text-rose-600 mt-2">{err}</p>}
    </div>
  )
}
