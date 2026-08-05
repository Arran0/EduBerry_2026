// Bank disbursement CSV — a generic bulk bank-transfer file the admin can upload
// to their bank's portal to pay an approved salary cycle. The columns are the
// common denominator across Indian bank bulk-upload formats; admins remap
// columns in their bank tool as needed.

import { SalaryRecord, SalaryCycle, StaffBankAccount, salaryNet, formatPeriod } from '@/lib/salary'

/** Escape a value for CSV (wrap in quotes, double embedded quotes). */
function csvCell(value: string | number): string {
  const s = String(value ?? '')
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** Serialize rows (first row = header) and trigger a client-side download. */
export function downloadCsv(fileName: string, rows: (string | number)[][]): void {
  const csv = rows.map(r => r.map(csvCell).join(',')).join('\r\n')
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName.endsWith('.csv') ? fileName : `${fileName}.csv`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

function periodSlug(cycle: SalaryCycle): string {
  const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
  return `${months[(cycle.period_month ?? 1) - 1]}-${cycle.period_year}`
}

/**
 * Build the bank bulk-transfer CSV for a cycle: one row per APPROVED record that
 * has a bank account on file. Returns the file name + count of included/skipped.
 * Column layout matches the bank's own bulk-upload template.
 */
export function buildBankDisbursementCsv(
  cycle: SalaryCycle,
  records: SalaryRecord[],
  bankMap: Record<string, StaffBankAccount>,
): { fileName: string; rows: (string | number)[][]; included: number; skipped: string[] } {
  const period = formatPeriod(cycle.period_month, cycle.period_year)
  const header = [
    'Sl No.', 'Beneficiary Account Number', 'Beneficiary Account Name', 'Beneficiary Bank Name',
    'IFSC Code', 'Amount', 'Remarks', 'Beneficiary Acc Type', 'Beneficiary LEI',
  ]
  const rows: (string | number)[][] = [header]
  const skipped: string[] = []
  let slNo = 0

  for (const r of records) {
    if (r.status !== 'approved') continue
    const bank = bankMap[r.staff_id]
    if (!bank) { skipped.push(r.staff?.full_name ?? r.staff_id); continue }
    slNo += 1
    rows.push([
      slNo,
      bank.account_number,
      bank.account_holder_name,
      bank.bank_name ?? '',
      bank.ifsc,
      salaryNet(r).toFixed(2),
      `Salary ${period} - ${r.staff?.full_name ?? ''}`.trim(),
      'Savings',
      '',
    ])
  }

  return {
    fileName: `salary-disbursement-${periodSlug(cycle)}`,
    rows,
    included: rows.length - 1,
    skipped,
  }
}
