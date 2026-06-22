'use client'

import React from 'react'
import { View, Text } from '@react-pdf/renderer'
import type { SiteBranding } from '@/lib/pageConfig'
import { SalaryRecord, SalaryCycle, StaffBankAccount, salaryNet, formatPeriod, maskAccountNumber } from '@/lib/salary'
import { SalaryStatementShell, Table, Col, TotalRow, styles, pdfINR, fmtDate, StaffLike } from './SalaryStatementShell'

const STATUS_LABEL: Record<string, string> = {
  draft: 'Draft', approved: 'Approved', paid: 'Paid',
}

function shortId(id: string): string { return id.replace(/-/g, '').slice(0, 10).toUpperCase() }

function cycleLabel(r: SalaryRecord): string {
  return r.cycle ? formatPeriod(r.cycle.period_month, r.cycle.period_year) : '—'
}

function adjustments(r: SalaryRecord): number {
  return (r.items ?? []).reduce((s, i) => s + Number(i.amount || 0), 0)
}

// ── Payslip ───────────────────────────────────────────────────
export function PayslipDoc({ branding, staff, record, bank }: {
  branding: SiteBranding
  staff?: StaffLike
  record: SalaryRecord
  bank?: StaffBankAccount | null
}) {
  const items = record.items ?? []
  const net = salaryNet(record)
  const period = cycleLabel(record)
  const bonuses = items.filter(i => Number(i.amount) > 0)
  const deductions = items.filter(i => Number(i.amount) < 0)

  const earningsCols: Col[] = [
    { key: 'particulars', label: 'Earnings', flex: 4 },
    { key: 'amount', label: 'Amount', flex: 2, align: 'right' },
  ]
  const earningsRows = [
    { particulars: 'Basic Salary', amount: pdfINR(Number(record.base_amount)) },
    ...bonuses.map(i => ({ particulars: i.label, amount: pdfINR(Number(i.amount)) })),
  ]
  const deductionsCols: Col[] = [
    { key: 'particulars', label: 'Deductions', flex: 4 },
    { key: 'amount', label: 'Amount', flex: 2, align: 'right' },
  ]
  const deductionRows = deductions.map(i => ({
    particulars: i.label, amount: pdfINR(Math.abs(Number(i.amount))),
  }))

  const grossEarnings = Number(record.base_amount) + bonuses.reduce((s, i) => s + Number(i.amount), 0)
  const totalDeductions = Math.abs(deductions.reduce((s, i) => s + Number(i.amount), 0))

  return (
    <SalaryStatementShell branding={branding} title="Salary Slip" refNo={shortId(record.id)} staff={staff} period={period} signatory="Authorised Signatory">
      <Table cols={earningsCols} rows={earningsRows} />
      <TotalRow label="Gross Earnings" value={pdfINR(grossEarnings)} />

      {deductionRows.length > 0 && (
        <>
          <View style={{ marginTop: 10 }}>
            <Table cols={deductionsCols} rows={deductionRows} />
            <TotalRow label="Total Deductions" value={pdfINR(totalDeductions)} />
          </View>
        </>
      )}

      <View style={[styles.tTotal, { marginTop: 10, borderTopWidth: 2 }]}>
        <Text style={[{ flex: 4 }, styles.th, { fontSize: 11 }]}>NET PAY</Text>
        <Text style={[{ flex: 2, textAlign: 'right' }, styles.th, { fontSize: 11 }]}>{pdfINR(net)}</Text>
      </View>

      {bank && (
        <View style={{ marginTop: 14 }}>
          <Text style={[styles.td, { color: '#71717A', marginBottom: 2 }]}>Payment to: {bank.account_holder_name}</Text>
          <Text style={[styles.td, { color: '#71717A', marginBottom: 2 }]}>
            Account: {maskAccountNumber(bank.account_number)} · IFSC: {bank.ifsc}{bank.bank_name ? ` · ${bank.bank_name}` : ''}
          </Text>
        </View>
      )}

      <Text style={[styles.td, { color: '#71717A', marginTop: 6 }]}>
        Status: {STATUS_LABEL[record.status] ?? record.status}
        {record.payout_reference ? ` · Ref: ${record.payout_reference}` : ''}
      </Text>
    </SalaryStatementShell>
  )
}

// ── Salary Register ───────────────────────────────────────────
export function SalaryRegisterDoc({ branding, cycle, records }: {
  branding: SiteBranding
  cycle: SalaryCycle
  records: SalaryRecord[]
}) {
  const period = formatPeriod(cycle.period_month, cycle.period_year)
  const cols: Col[] = [
    { key: 'name', label: 'Employee', flex: 3 },
    { key: 'role', label: 'Role', flex: 1.6 },
    { key: 'base', label: 'Basic', flex: 1.6, align: 'right' },
    { key: 'adj', label: 'Adj.', flex: 1.4, align: 'right' },
    { key: 'net', label: 'Net Pay', flex: 1.8, align: 'right' },
    { key: 'status', label: 'Status', flex: 1.4 },
  ]
  const rows = records.map(r => {
    const adj = adjustments(r)
    return {
      name: r.staff?.full_name ?? '—',
      role: r.staff ? capitalize(r.staff.role) : '—',
      base: pdfINR(Number(r.base_amount)),
      adj: adj === 0 ? '—' : (adj > 0 ? '+' : '') + pdfINR(Math.abs(adj)).replace('Rs. ', '') + (adj < 0 ? ' (-)' : ''),
      net: pdfINR(salaryNet(r)),
      status: STATUS_LABEL[r.status] ?? r.status,
    }
  })
  const totalNet = records.reduce((s, r) => s + salaryNet(r), 0)
  const paidCount = records.filter(r => r.status === 'paid').length

  return (
    <SalaryStatementShell branding={branding} title="Salary Register" period={period} signatory="Authorised Signatory">
      <Table cols={cols} rows={rows} />
      <TotalRow label={`Total Payroll · ${paidCount}/${records.length} paid`} value={pdfINR(totalNet)} />
    </SalaryStatementShell>
  )
}

// ── Employee Salary Ledger ────────────────────────────────────
export function SalaryLedgerDoc({ branding, staff, records }: {
  branding: SiteBranding
  staff: StaffLike
  records: SalaryRecord[]
}) {
  const cols: Col[] = [
    { key: 'period', label: 'Period', flex: 2 },
    { key: 'base', label: 'Basic', flex: 1.8, align: 'right' },
    { key: 'adj', label: 'Adjustments', flex: 1.8, align: 'right' },
    { key: 'net', label: 'Net Pay', flex: 1.8, align: 'right' },
    { key: 'status', label: 'Status', flex: 1.4 },
  ]
  const rows = records.map(r => {
    const adj = adjustments(r)
    return {
      period: cycleLabel(r),
      base: pdfINR(Number(r.base_amount)),
      adj: adj === 0 ? '—' : (adj >= 0 ? '+' : '-') + pdfINR(Math.abs(adj)),
      net: pdfINR(salaryNet(r)),
      status: STATUS_LABEL[r.status] ?? r.status,
    }
  })
  const totalPaid = records.filter(r => r.status === 'paid').reduce((s, r) => s + salaryNet(r), 0)

  return (
    <SalaryStatementShell branding={branding} title="Employee Salary Ledger" staff={staff}>
      {rows.length ? <Table cols={cols} rows={rows} /> : <Text style={styles.para}>No salary records found.</Text>}
      <TotalRow label="Total Disbursed (Paid)" value={pdfINR(totalPaid)} />
    </SalaryStatementShell>
  )
}

// ── Salary Certificate ────────────────────────────────────────
export function SalaryCertificateDoc({ branding, staff, baseAmount }: {
  branding: SiteBranding
  staff: StaffLike
  baseAmount?: number
}) {
  const today = fmtDate(new Date().toISOString())
  return (
    <SalaryStatementShell branding={branding} title="Salary Certificate" staff={staff} signatory="Authorised Signatory">
      <Text style={styles.para}>
        This is to certify that {staff.full_name ?? 'the employee'}{staff.role ? `, ${capitalize(staff.role)},` : ','} is
        employed with {branding.schoolName}.
      </Text>
      {baseAmount != null && (
        <Text style={styles.para}>
          The employee&apos;s current monthly basic salary is {pdfINR(baseAmount)} (Rupees {amountInWords(baseAmount)} only).
        </Text>
      )}
      <Text style={styles.para}>
        This certificate is issued on {today} on the request of the employee, for the purpose of official use.
      </Text>
      <Text style={[styles.para, { color: '#71717A' }]}>
        This certificate is valid as on the date of issue. For any verification, please contact the school administration.
      </Text>
      <View style={styles.stampRow}>
        <Text> </Text>
        <Text style={styles.sign}>For {branding.schoolName}</Text>
      </View>
    </SalaryStatementShell>
  )
}

// ── Annual Salary Statement ───────────────────────────────────
export function AnnualSalaryStatementDoc({ branding, staff, year, records }: {
  branding: SiteBranding
  staff: StaffLike
  year: number
  records: SalaryRecord[]
}) {
  const filtered = records.filter(r => r.cycle?.period_year === year)
  const cols: Col[] = [
    { key: 'period', label: 'Month', flex: 2.2 },
    { key: 'base', label: 'Basic', flex: 1.8, align: 'right' },
    { key: 'adj', label: 'Adjustments', flex: 1.8, align: 'right' },
    { key: 'net', label: 'Net Pay', flex: 1.8, align: 'right' },
    { key: 'status', label: 'Status', flex: 1.4 },
  ]
  const rows = filtered.map(r => {
    const adj = adjustments(r)
    return {
      period: cycleLabel(r),
      base: pdfINR(Number(r.base_amount)),
      adj: adj === 0 ? '—' : (adj >= 0 ? '+' : '-') + pdfINR(Math.abs(adj)),
      net: pdfINR(salaryNet(r)),
      status: STATUS_LABEL[r.status] ?? r.status,
    }
  })
  const totalNet = filtered.reduce((s, r) => s + salaryNet(r), 0)
  const paidNet = filtered.filter(r => r.status === 'paid').reduce((s, r) => s + salaryNet(r), 0)

  return (
    <SalaryStatementShell branding={branding} title="Annual Salary Statement" staff={staff} period={`FY ${year}`}>
      {rows.length ? <Table cols={cols} rows={rows} /> : <Text style={styles.para}>No salary records for {year}.</Text>}
      <TotalRow label="Total Payable" value={pdfINR(totalNet)} flexLabel={5} flexValue={2} />
      <TotalRow label="Total Disbursed (Paid)" value={pdfINR(paidNet)} flexLabel={5} flexValue={2} />
    </SalaryStatementShell>
  )
}

// ── Bank Transfer Statement ───────────────────────────────────
export function BankTransferStatementDoc({ branding, cycle, records, bankMap }: {
  branding: SiteBranding
  cycle: SalaryCycle
  records: SalaryRecord[]
  bankMap: Record<string, StaffBankAccount>
}) {
  const period = formatPeriod(cycle.period_month, cycle.period_year)
  const cols: Col[] = [
    { key: 'name', label: 'Employee', flex: 2.4 },
    { key: 'account', label: 'Account No.', flex: 2 },
    { key: 'ifsc', label: 'IFSC', flex: 1.6 },
    { key: 'bank', label: 'Bank', flex: 1.8 },
    { key: 'amount', label: 'Net Pay', flex: 1.6, align: 'right' },
  ]
  const rows = records.map(r => {
    const bk = bankMap[r.staff_id]
    return {
      name: r.staff?.full_name ?? '—',
      account: bk ? maskAccountNumber(bk.account_number) : 'Not on file',
      ifsc: bk?.ifsc ?? '—',
      bank: bk?.bank_name ?? '—',
      amount: pdfINR(salaryNet(r)),
    }
  })
  const totalNet = records.reduce((s, r) => s + salaryNet(r), 0)
  const missingBank = records.filter(r => !bankMap[r.staff_id]).length

  return (
    <SalaryStatementShell branding={branding} title="Bank Transfer Statement" period={period} signatory="Authorised Signatory">
      <Table cols={cols} rows={rows} />
      <TotalRow label="Total Disbursement" value={pdfINR(totalNet)} />
      {missingBank > 0 && (
        <Text style={[styles.td, { color: '#EF4444', marginTop: 8 }]}>
          Note: {missingBank} staff member{missingBank > 1 ? 's' : ''} have no bank account on record.
        </Text>
      )}
    </SalaryStatementShell>
  )
}

// ── Helpers ───────────────────────────────────────────────────
function capitalize(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s
}

function amountInWords(n: number): string {
  const rounded = Math.round(n)
  if (rounded === 0) return 'Zero'
  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
    'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen']
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety']
  function below100(n: number): string {
    if (n < 20) return ones[n]
    return tens[Math.floor(n / 10)] + (n % 10 ? ' ' + ones[n % 10] : '')
  }
  function below1000(n: number): string {
    if (n < 100) return below100(n)
    return ones[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' ' + below100(n % 100) : '')
  }
  let result = ''
  if (rounded >= 100000) { result += below1000(Math.floor(rounded / 100000)) + ' Lakh '; n = rounded % 100000 }
  if (rounded % 100000 >= 1000) { result += below100(Math.floor((rounded % 100000) / 1000)) + ' Thousand '; n = rounded % 1000 }
  if (rounded % 1000 > 0) result += below1000(rounded % 1000)
  return result.trim() || 'Zero'
}
