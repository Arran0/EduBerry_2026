// Salary Sheet — the traditional department-wise payroll sheet: one row per
// employee with the attendance and statutory figures behind their net pay,
// and a blank Signature column for the paper copy kept on file. Splits into
// one sheet per staff category present in the rows handed in (Teaching Staff /
// Non-Teaching Staff / Drivers), plus a Summary sheet with the cycle's totals.
//
// Unlike the Salary Register (a condensed audit trail of basic/adjustments/net
// per employee), this mirrors the office's own working sheet — the one used to
// hand-verify PF, ESI, leave and advances before a cycle is paid out, and kept
// signed as the payment record.

import { SalaryCycle, formatPeriod } from '@/lib/salary'

export type SalarySheetCategory = 'teaching' | 'non_teaching' | 'driver'

export interface SalarySheetRow {
  category: SalarySheetCategory
  name: string
  designation: string
  payByCash: boolean
  baseAmount: number
  workingDays: number
  daysWorked: number
  leaveCount: number
  lateCount: number
  halfDayCount: number
  salaryPerDay: number
  pf: number
  esi: number
  advance: number
  extraOther: number
  net: number
}

const CATEGORY_ORDER: SalarySheetCategory[] = ['teaching', 'non_teaching', 'driver']
const CATEGORY_LABEL: Record<SalarySheetCategory, string> = {
  teaching: 'Teaching Staff',
  non_teaching: 'Non-Teaching Staff',
  driver: 'Drivers',
}

const HEADER = [
  'Sl No', 'Name', 'Designation', 'Salary', 'No. of Working Days', 'Days Worked',
  'Leave', 'Late (LOP)', 'Half Day (LOP)', 'Total Leave', 'Salary/Day', 'PF', 'ESI',
  'Advance', 'Extra/Other Salary', 'Amount in Rupees', 'Signature',
]

const COLS = [
  { wch: 5 }, { wch: 26 }, { wch: 16 }, { wch: 11 }, { wch: 10 }, { wch: 10 },
  { wch: 7 }, { wch: 9 }, { wch: 9 }, { wch: 9 }, { wch: 11 }, { wch: 9 }, { wch: 9 },
  { wch: 10 }, { wch: 13 }, { wch: 13 }, { wch: 14 },
]

function round(n: number): number {
  return Math.round(n * 100) / 100
}

function periodSlug(cycle: SalaryCycle): string {
  const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
  return `${months[(cycle.period_month ?? 1) - 1]}-${cycle.period_year}`
}

/** One category's AOA: title row, header, a row per employee, and a total row. */
function categoryAoa(periodLabel: string, categoryLabel: string, rows: SalarySheetRow[]): (string | number)[][] {
  const aoa: (string | number)[][] = [
    [`SALARY FOR ${periodLabel.toUpperCase()} - ${categoryLabel.toUpperCase()}`],
    [],
    HEADER,
  ]
  rows.forEach((r, i) => {
    const totalLeave = r.leaveCount + r.lateCount + r.halfDayCount
    aoa.push([
      i + 1, r.name, r.designation, r.baseAmount, r.workingDays, round(r.daysWorked),
      round(r.leaveCount), round(r.lateCount), round(r.halfDayCount), round(totalLeave),
      round(r.salaryPerDay), r.pf || '', r.esi || '', r.advance || '', r.extraOther || '',
      round(r.net), '',
    ])
  })
  const sum = (f: (r: SalarySheetRow) => number) => rows.reduce((s, r) => s + f(r), 0)
  aoa.push([])
  aoa.push([
    '', `TOTAL — ${rows.length} record${rows.length === 1 ? '' : 's'}`, '', sum(r => r.baseAmount),
    '', '', '', '', '', '', '', sum(r => r.pf), sum(r => r.esi), sum(r => r.advance),
    sum(r => r.extraOther), round(sum(r => r.net)), '',
  ])
  return aoa
}

/** Payment-details summary sheet — per-category and bank/cash totals, mirroring the office sheet's own TOTAL tab. */
function summaryAoa(periodLabel: string, rows: SalarySheetRow[]): (string | number)[][] {
  const aoa: (string | number)[][] = [
    [`SALARY FOR ${periodLabel.toUpperCase()} - SUMMARY`],
    [],
    ['Category', 'Staff Count', 'Salary', 'PF', 'ESI', 'Advance', 'Extra/Other', 'Amount in Rupees'],
  ]
  const totalsOf = (subset: SalarySheetRow[]) => ({
    count: subset.length,
    base: subset.reduce((s, r) => s + r.baseAmount, 0),
    pf: subset.reduce((s, r) => s + r.pf, 0),
    esi: subset.reduce((s, r) => s + r.esi, 0),
    advance: subset.reduce((s, r) => s + r.advance, 0),
    extra: subset.reduce((s, r) => s + r.extraOther, 0),
    net: subset.reduce((s, r) => s + r.net, 0),
  })
  for (const cat of CATEGORY_ORDER) {
    const subset = rows.filter(r => r.category === cat)
    if (subset.length === 0) continue
    const t = totalsOf(subset)
    aoa.push([CATEGORY_LABEL[cat], t.count, t.base, t.pf, t.esi, t.advance, t.extra, round(t.net)])
  }
  aoa.push([])
  const bank = totalsOf(rows.filter(r => !r.payByCash))
  const cash = totalsOf(rows.filter(r => r.payByCash))
  if (bank.count) aoa.push(['Paid via Bank', bank.count, bank.base, bank.pf, bank.esi, bank.advance, bank.extra, round(bank.net)])
  if (cash.count) aoa.push(['Paid by Cash', cash.count, cash.base, cash.pf, cash.esi, cash.advance, cash.extra, round(cash.net)])
  aoa.push([])
  const all = totalsOf(rows)
  aoa.push(['GRAND TOTAL', all.count, all.base, all.pf, all.esi, all.advance, all.extra, round(all.net)])
  return aoa
}

/**
 * Build and download the Salary Sheet workbook for whichever rows are passed
 * in — typically the cycle's currently filtered/searched set, so the office
 * can run this for one team or category at a time rather than the whole
 * cycle. Returns how many rows it wrote, for the caller's status message.
 */
export async function downloadSalarySheet(cycle: SalaryCycle, rows: SalarySheetRow[]): Promise<{ included: number; fileName: string }> {
  const XLSX = await import('xlsx')
  const period = formatPeriod(cycle.period_month, cycle.period_year)
  const wb = XLSX.utils.book_new()

  for (const cat of CATEGORY_ORDER) {
    const subset = rows.filter(r => r.category === cat)
    if (subset.length === 0) continue
    const ws = XLSX.utils.aoa_to_sheet(categoryAoa(period, CATEGORY_LABEL[cat], subset))
    ws['!cols'] = COLS
    ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: HEADER.length - 1 } }]
    XLSX.utils.book_append_sheet(wb, ws, CATEGORY_LABEL[cat])
  }

  const summaryWs = XLSX.utils.aoa_to_sheet(summaryAoa(period, rows))
  summaryWs['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 7 } }]
  XLSX.utils.book_append_sheet(wb, summaryWs, 'Summary')

  const fileName = `salary-sheet-${periodSlug(cycle)}.xlsx`
  XLSX.writeFile(wb, fileName)
  return { included: rows.length, fileName }
}
