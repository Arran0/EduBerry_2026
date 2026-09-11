// ============================================================================
// Loans, advances, arrears and leave balances — data layer.
// ----------------------------------------------------------------------------
// Outstanding balances are read from the views, never from a column: they are
// principal less recorded repayments, so the balance and its history cannot
// drift apart. Nothing here writes an outstanding figure, because there is no
// outstanding figure to write.
// ============================================================================

import { supabase } from '@/lib/supabase'
import type { EngineLoan, EngineAdvance, EngineArrear } from './engine/types'
import { buildLoanSchedule, suggestedEmi } from './engine/recoveries'

type Result = { success: boolean; error?: string }

export interface LoanBalanceRow {
  loan_id: string; employee_id: string; label: string; principal: number
  emi_amount: number; interest_type: 'none' | 'flat' | 'reducing'; interest_rate: number
  tenure_months: number; start_period: string; status: string
  principal_repaid: number; interest_paid: number; outstanding: number
}

export interface AdvanceBalanceRow {
  advance_id: string; employee_id: string; label: string; amount: number
  emi_amount: number; recovery_mode: 'single' | 'emi'; start_period: string
  status: string; repaid: number; outstanding: number
}

export async function fetchLoanBalances(employeeId?: string): Promise<LoanBalanceRow[]> {
  let q = supabase.from('payroll_loan_balances').select('*')
  if (employeeId) q = q.eq('employee_id', employeeId)
  const { data, error } = await q
  if (error) { console.error('fetchLoanBalances failed:', error); return [] }
  return (data ?? []) as unknown as LoanBalanceRow[]
}

export async function fetchAdvanceBalances(employeeId?: string): Promise<AdvanceBalanceRow[]> {
  let q = supabase.from('payroll_advance_balances').select('*')
  if (employeeId) q = q.eq('employee_id', employeeId)
  const { data, error } = await q
  if (error) { console.error('fetchAdvanceBalances failed:', error); return [] }
  return (data ?? []) as unknown as AdvanceBalanceRow[]
}

export function toEngineLoan(r: LoanBalanceRow): EngineLoan {
  return {
    id: r.loan_id, label: r.label, principal: Number(r.principal),
    outstanding: Number(r.outstanding), emiAmount: Number(r.emi_amount),
    interestType: r.interest_type, interestRate: Number(r.interest_rate),
    tenureMonths: r.tenure_months, startPeriod: r.start_period,
    status: r.status as EngineLoan['status'],
  }
}

export function toEngineAdvance(r: AdvanceBalanceRow): EngineAdvance {
  return {
    id: r.advance_id, label: r.label, outstanding: Number(r.outstanding),
    recoveryMode: r.recovery_mode, emiAmount: Number(r.emi_amount),
    startPeriod: r.start_period, status: r.status as EngineAdvance['status'],
  }
}

/** Create a loan and write its amortisation schedule so the employee can see it up front. */
export async function createLoan(input: {
  employeeId: string; label: string; principal: number; interestRate: number
  interestType: 'none' | 'flat' | 'reducing'; tenureMonths: number
  startPeriod: string; emiAmount?: number; notes?: string; sanctionedBy: string
}): Promise<Result> {
  const emi = input.emiAmount && input.emiAmount > 0
    ? input.emiAmount
    : suggestedEmi(input.principal, input.interestRate, input.tenureMonths, input.interestType)

  const { data, error } = await supabase.from('payroll_loans').insert({
    employee_id: input.employeeId, label: input.label, principal: input.principal,
    interest_rate: input.interestRate, interest_type: input.interestType,
    emi_amount: emi, tenure_months: input.tenureMonths, start_period: input.startPeriod,
    notes: input.notes ?? null, sanctioned_by: input.sanctionedBy,
    sanctioned_on: new Date().toISOString().slice(0, 10),
  }).select('id').single()
  if (error || !data) { console.error('createLoan failed:', error); return { success: false, error: error?.message } }

  const schedule = buildLoanSchedule({
    principal: input.principal, interestRate: input.interestRate, interestType: input.interestType,
    tenureMonths: input.tenureMonths, emiAmount: emi, startPeriod: input.startPeriod,
  })
  const { error: sErr } = await supabase.from('payroll_loan_schedule').insert(
    schedule.map(s => ({
      loan_id: data.id, period: s.period, emi_due: s.emiDue,
      principal_part: s.principalPart, interest_part: s.interestPart, balance_after: s.balance,
    })),
  )
  if (sErr) console.error('createLoan schedule failed:', sErr)
  return { success: true }
}

export async function createAdvance(input: {
  employeeId: string; label: string; amount: number; reason: string | null
  recoveryMode: 'single' | 'emi'; emiAmount: number; startPeriod: string; sanctionedBy: string
}): Promise<Result> {
  const { error } = await supabase.from('payroll_advances').insert({
    employee_id: input.employeeId, label: input.label, amount: input.amount,
    reason: input.reason, recovery_mode: input.recoveryMode,
    emi_amount: input.recoveryMode === 'single' ? input.amount : input.emiAmount,
    start_period: input.startPeriod, sanctioned_by: input.sanctionedBy,
    sanctioned_on: new Date().toISOString().slice(0, 10),
  })
  if (error) { console.error('createAdvance failed:', error); return { success: false, error: error.message } }
  return { success: true }
}

/** A repayment made outside payroll — cash, or a transfer. `run_id` stays null. */
export async function recordManualRepayment(input: {
  loanId?: string; advanceId?: string; amount: number; note: string; createdBy: string
}): Promise<Result> {
  const { error } = await supabase.from('payroll_repayments').insert({
    loan_id: input.loanId ?? null, advance_id: input.advanceId ?? null,
    amount: input.amount, principal_part: input.amount, interest_part: 0,
    note: input.note, created_by: input.createdBy,
  })
  if (error) { console.error('recordManualRepayment failed:', error); return { success: false, error: error.message } }
  return { success: true }
}

export async function setLoanStatus(loanId: string, status: 'active' | 'on_hold' | 'closed' | 'written_off'): Promise<Result> {
  const { error } = await supabase.from('payroll_loans').update({ status }).eq('id', loanId)
  if (error) { console.error('setLoanStatus failed:', error); return { success: false, error: error.message } }
  return { success: true }
}

export async function fetchLoanSchedule(loanId: string) {
  const { data, error } = await supabase
    .from('payroll_loan_schedule').select('*').eq('loan_id', loanId).order('period')
  if (error) { console.error('fetchLoanSchedule failed:', error); return [] }
  return data ?? []
}

export async function fetchRepayments(loanId?: string, advanceId?: string) {
  let q = supabase.from('payroll_repayments')
    .select('id, loan_id, advance_id, run_id, amount, principal_part, interest_part, paid_on, note')
  if (loanId) q = q.eq('loan_id', loanId)
  if (advanceId) q = q.eq('advance_id', advanceId)
  const { data, error } = await q.order('paid_on', { ascending: false })
  if (error) { console.error('fetchRepayments failed:', error); return [] }
  return data ?? []
}

// ── Arrears ─────────────────────────────────────────────────────────────

export interface ArrearRow {
  id: string; employee_id: string; revision_id: string | null; label: string
  from_period: string; to_period: string; amount: number
  breakdown: EngineArrear['breakdown']
  status: 'pending' | 'scheduled' | 'paid' | 'cancelled'; run_id: string | null
}

export async function fetchArrears(employeeId?: string, status: string[] = ['pending', 'scheduled']): Promise<ArrearRow[]> {
  let q = supabase.from('payroll_arrears').select('*').in('status', status)
  if (employeeId) q = q.eq('employee_id', employeeId)
  const { data, error } = await q
  if (error) { console.error('fetchArrears failed:', error); return [] }
  return (data ?? []) as unknown as ArrearRow[]
}

export function toEngineArrear(r: ArrearRow): EngineArrear {
  return {
    id: r.id, amount: Number(r.amount), fromPeriod: r.from_period,
    toPeriod: r.to_period, label: r.label, breakdown: r.breakdown ?? [],
  }
}

// ── Leave balances ──────────────────────────────────────────────────────

export interface LeaveAvailableRow {
  employee_id: string; year: string; leave_type: string; available: number; encashable: boolean
}

export async function fetchLeaveAvailable(employeeId?: string, year?: string): Promise<LeaveAvailableRow[]> {
  let q = supabase.from('payroll_leave_available').select('*')
  if (employeeId) q = q.eq('employee_id', employeeId)
  if (year) q = q.eq('year', year)
  const { data, error } = await q
  if (error) { console.error('fetchLeaveAvailable failed:', error); return [] }
  return (data ?? []) as unknown as LeaveAvailableRow[]
}

