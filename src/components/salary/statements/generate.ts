'use client'

import React from 'react'
import { fetchBranding } from '@/lib/pageConfig'
import { SalaryRecord, SalaryCycle, StaffBankAccount, formatPeriod } from '@/lib/salary'
import type { StatutoryConfig, EpfTotals, EsiTotals } from '@/lib/statutory'
import type { StaffLike } from './SalaryStatementShell'

export interface StatementSpec {
  element: React.ReactElement
  fileName: string
}

export async function downloadStatement(spec: StatementSpec): Promise<void> {
  const { pdf } = await import('@react-pdf/renderer')
  const blob = await pdf(spec.element).toBlob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = spec.fileName.endsWith('.pdf') ? spec.fileName : `${spec.fileName}.pdf`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

function slug(s?: string | null): string {
  return (s || 'staff').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'staff'
}

function periodSlug(cycle?: SalaryCycle | null): string {
  if (!cycle) return 'salary'
  const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
  return `${months[(cycle.period_month ?? 1) - 1]}-${cycle.period_year}`
}

export async function buildPayslip(
  record: SalaryRecord,
  staff?: StaffLike,
  bank?: StaffBankAccount | null,
): Promise<StatementSpec> {
  const [branding, { PayslipDoc }] = await Promise.all([fetchBranding(), import('./documents')])
  return {
    element: React.createElement(PayslipDoc, { branding, staff, record, bank }),
    fileName: `payslip-${slug(staff?.full_name)}-${periodSlug(record.cycle)}`,
  }
}

export async function buildSalaryRegister(
  cycle: SalaryCycle,
  records: SalaryRecord[],
): Promise<StatementSpec> {
  const [branding, { SalaryRegisterDoc }] = await Promise.all([fetchBranding(), import('./documents')])
  return {
    element: React.createElement(SalaryRegisterDoc, { branding, cycle, records }),
    fileName: `salary-register-${periodSlug(cycle)}`,
  }
}

export async function buildSalaryLedger(
  staff: StaffLike,
  records: SalaryRecord[],
  title?: string,
): Promise<StatementSpec> {
  const [branding, { SalaryLedgerDoc }] = await Promise.all([fetchBranding(), import('./documents')])
  return {
    element: React.createElement(SalaryLedgerDoc, { branding, staff, records, title }),
    fileName: `salary-register-${slug(staff.full_name)}`,
  }
}

export async function buildSalaryPaymentStatement(
  staff: StaffLike,
  year: number,
  records: SalaryRecord[],
): Promise<StatementSpec> {
  const [branding, { SalaryPaymentStatementDoc }] = await Promise.all([fetchBranding(), import('./documents')])
  return {
    element: React.createElement(SalaryPaymentStatementDoc, { branding, staff, year, records }),
    fileName: `salary-payment-statement-${slug(staff.full_name)}-${year}`,
  }
}

export async function buildForm16(
  staff: StaffLike,
  year: number,
  records: SalaryRecord[],
): Promise<StatementSpec> {
  const [branding, { Form16Doc }] = await Promise.all([fetchBranding(), import('./documents')])
  return {
    element: React.createElement(Form16Doc, { branding, staff, year, records }),
    fileName: `form-16-${slug(staff.full_name)}-${year}`,
  }
}

export async function buildSalaryCertificate(
  staff: StaffLike,
  baseAmount?: number,
): Promise<StatementSpec> {
  const [branding, { SalaryCertificateDoc }] = await Promise.all([fetchBranding(), import('./documents')])
  return {
    element: React.createElement(SalaryCertificateDoc, { branding, staff, baseAmount }),
    fileName: `salary-certificate-${slug(staff.full_name)}`,
  }
}

export async function buildAnnualStatement(
  staff: StaffLike,
  year: number,
  records: SalaryRecord[],
): Promise<StatementSpec> {
  const [branding, { AnnualSalaryStatementDoc }] = await Promise.all([fetchBranding(), import('./documents')])
  return {
    element: React.createElement(AnnualSalaryStatementDoc, { branding, staff, year, records }),
    fileName: `annual-salary-statement-${slug(staff.full_name)}-${year}`,
  }
}

export async function buildStatutoryRemittanceSummary(
  cycle: SalaryCycle,
  config: StatutoryConfig,
  epf: EpfTotals,
  esi: EsiTotals,
  exceptions: { name: string; reason: string }[],
): Promise<StatementSpec> {
  const [branding, { StatutoryRemittanceDoc }] = await Promise.all([fetchBranding(), import('./documents')])
  const period = formatPeriod(cycle.period_month, cycle.period_year)
  return {
    element: React.createElement(StatutoryRemittanceDoc, { branding, period, config, epf, esi, exceptions }),
    fileName: `epf-esi-remittance-summary-${periodSlug(cycle)}`,
  }
}

export async function buildBankTransferStatement(
  cycle: SalaryCycle,
  records: SalaryRecord[],
  bankMap: Record<string, StaffBankAccount>,
): Promise<StatementSpec> {
  const [branding, { BankTransferStatementDoc }] = await Promise.all([fetchBranding(), import('./documents')])
  return {
    element: React.createElement(BankTransferStatementDoc, { branding, cycle, records, bankMap }),
    fileName: `bank-transfer-statement-${periodSlug(cycle)}`,
  }
}
