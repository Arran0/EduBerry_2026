// Bank disbursement CSV — a generic bulk bank-transfer file the admin can upload
// to their bank's portal to pay an approved salary cycle. The columns are the
// common denominator across Indian bank bulk-upload formats; admins remap
// columns in their bank tool as needed.

import { SalaryRecord, SalaryCycle, StaffBankAccount, salaryNet, formatPeriod, recordPersonId, recordPersonName } from '@/lib/salary'

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
 * Build the bank bulk-transfer CSV for a cycle.
 *
 * `records` is whatever subset the caller wants paid — the whole cycle, or
 * just the rows currently surviving the sheet's search/filter, since a school
 * routinely releases one team or one department at a time rather than the
 * whole payroll in a single upload.
 *
 * Only APPROVED rows go in the file. A locked cycle approves every row, so in
 * practice this drops the ones already `paid` (re-uploading those would pay
 * them twice) and everything in an unlocked cycle. Both reasons come back
 * separately from "no bank account on file", because they need different
 * fixes and a single lumped "skipped" count sends people hunting in the wrong
 * place.
 */
export interface BankCsvResult {
  fileName: string
  rows: (string | number)[][]
  included: number
  /** Named rows dropped for want of a bank account. */
  missingBank: string[]
  /** Rows dropped because they are not approved (already paid, or still draft). */
  notApproved: number
  /** Rows dropped because they're marked paid by cash for this cycle. */
  cash: number
}

export function buildBankDisbursementCsv(
  cycle: SalaryCycle,
  records: SalaryRecord[],
  bankMap: Record<string, StaffBankAccount>,
): BankCsvResult {
  const period = formatPeriod(cycle.period_month, cycle.period_year)
  const header = [
    'Sl No.', 'Beneficiary Account Number', 'Beneficiary Account Name', 'Beneficiary Bank Name',
    'IFSC Code', 'Amount', 'Remarks', 'Beneficiary Acc Type', 'Beneficiary LEI',
  ]
  const rows: (string | number)[][] = [header]
  const missingBank: string[] = []
  let notApproved = 0
  let cash = 0
  let slNo = 0

  for (const r of records) {
    if (r.pay_by_cash) { cash += 1; continue }
    if (r.status !== 'approved') { notApproved += 1; continue }
    const bank = bankMap[recordPersonId(r)]
    if (!bank) { missingBank.push(recordPersonName(r) || recordPersonId(r)); continue }
    slNo += 1
    rows.push([
      slNo,
      bank.account_number,
      bank.account_holder_name,
      bank.bank_name ?? '',
      bank.ifsc,
      salaryNet(r).toFixed(2),
      `Salary ${period} - ${recordPersonName(r)}`.trim(),
      'Savings',
      '',
    ])
  }

  return {
    fileName: `salary-disbursement-${periodSlug(cycle)}`,
    rows,
    included: rows.length - 1,
    missingBank,
    notApproved,
    cash,
  }
}
