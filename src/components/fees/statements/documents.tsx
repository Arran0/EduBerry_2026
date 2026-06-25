'use client'

import React from 'react'
import { View, Text } from '@react-pdf/renderer'
import type { SiteBranding } from '@/lib/pageConfig'
import { SchoolFee, SchoolFeePayment, LedgerEntry, METHOD_LABELS } from '@/lib/fees'
import { StatementShell, Table, Col, styles, pdfINR, fmtDate, StudentLike } from './StatementShell'

const STATUS_LABEL: Record<string, string> = {
  paid: 'Paid', partial: 'Partial', unpaid: 'Unpaid', cancelled: 'Cancelled',
}

function shortId(id: string): string { return id.replace(/-/g, '').slice(0, 10).toUpperCase() }
function feeName(f: SchoolFee): string { return f.description || f.fee_head?.name || 'School fee' }
function billed(fees: SchoolFee[]): number { return fees.filter(f => f.status !== 'cancelled').reduce((s, f) => s + (Number(f.amount) || 0), 0) }
function paidTotal(fees: SchoolFee[]): number { return fees.filter(f => f.status === 'paid').reduce((s, f) => s + (Number(f.amount) || 0), 0) }

function TotalRow({ label, value, flexLabel = 4, flexValue = 1 }: { label: string; value: string; flexLabel?: number; flexValue?: number }) {
  return (
    <View style={styles.tTotal}>
      <Text style={[{ flex: flexLabel }, styles.th]}>{label}</Text>
      <Text style={[{ flex: flexValue, textAlign: 'right' }, styles.th]}>{value}</Text>
    </View>
  )
}

// ── Fee Receipt ───────────────────────────────────────────────
export function FeeReceiptDoc({ branding, student, fee, payment }: {
  branding: SiteBranding; student?: StudentLike; fee: SchoolFee; payment?: SchoolFeePayment | null
}) {
  const amount = Number(payment?.amount ?? fee.amount) || 0
  const date = payment?.verified_at ?? fee.updated_at
  const method = payment ? (METHOD_LABELS[payment.method] ?? payment.method) : 'Recorded'
  const ref = payment?.upi_txn_ref || payment?.razorpay_payment_id || fee.upi_reference
  const fullyPaid = amount >= (Number(fee.amount) || 0)
  return (
    <StatementShell branding={branding} title="Fee Receipt" refNo={shortId(payment?.id ?? fee.id)} student={student} year={fee.academic_year ?? undefined} signatory="Receipts are valid without signature.">
      <Table
        cols={[
          { key: 'particulars', label: 'Particulars', flex: 4 },
          { key: 'method', label: 'Method', flex: 1.4 },
          { key: 'date', label: 'Date', flex: 1.6 },
          { key: 'amount', label: 'Amount', flex: 1.6, align: 'right' },
        ]}
        rows={[{ particulars: feeName(fee), method, date: fmtDate(date), amount: pdfINR(amount) }]}
      />
      <TotalRow label="Amount Paid" value={pdfINR(amount)} />
      <Text style={[styles.td, { marginTop: 14, color: '#71717A' }]}>Receipt No: {shortId(payment?.id ?? fee.id)}</Text>
      <Text style={[styles.td, { marginTop: 2, color: '#71717A' }]}>Reference (proof of payment): {ref}</Text>
      <Text style={[styles.td, { marginTop: 2, color: '#71717A' }]}>Status: {fullyPaid ? 'Paid in full' : `Part payment of ${pdfINR(Number(fee.amount) || 0)} billed`}</Text>
    </StatementShell>
  )
}

// ── Payment Certificate ───────────────────────────────────────
export function PaymentCertificateDoc({ branding, student, fee, payment }: {
  branding: SiteBranding; student?: StudentLike; fee: SchoolFee; payment?: SchoolFeePayment | null
}) {
  const amount = Number(payment?.amount ?? fee.amount) || 0
  const date = payment?.verified_at ?? fee.updated_at
  const method = payment ? (METHOD_LABELS[payment.method] ?? payment.method) : 'school records'
  const ref = payment?.upi_txn_ref || payment?.razorpay_payment_id || fee.upi_reference
  return (
    <StatementShell branding={branding} title="Payment Certificate" refNo={shortId(payment?.id ?? fee.id)} student={student} year={fee.academic_year ?? undefined} signatory="Authorised Signatory">
      <Text style={styles.para}>
        This is to certify that {pdfINR(amount)} has been received from {student?.full_name ?? 'the student'} towards
        “{feeName(fee)}” for the academic year {fee.academic_year ?? '—'}, paid via {method} on {fmtDate(date)}.
      </Text>
      <Text style={styles.para}>Transaction reference: {ref}.</Text>
      <Text style={[styles.para, { color: '#71717A' }]}>
        This certificate is issued for record / reimbursement purposes on the request of the payer.
      </Text>
      <View style={styles.stampRow}>
        <Text> </Text>
        <Text style={styles.sign}>For {branding.schoolName}</Text>
      </View>
    </StatementShell>
  )
}

// ── Student Fee Transcript / Statement ────────────────────────
export function FeeTranscriptDoc({ branding, student, year, fees }: {
  branding: SiteBranding; student?: StudentLike; year: string; fees: SchoolFee[]
}) {
  const cols: Col[] = [
    { key: 'date', label: 'Date', flex: 1.4 },
    { key: 'particulars', label: 'Particulars', flex: 4 },
    { key: 'status', label: 'Status', flex: 1.4 },
    { key: 'amount', label: 'Amount', flex: 1.6, align: 'right' },
  ]
  const rows = fees.map(f => ({
    date: fmtDate(f.due_date || f.created_at),
    particulars: feeName(f),
    status: STATUS_LABEL[f.status] ?? f.status,
    amount: pdfINR(Number(f.amount) || 0),
  }))
  const b = billed(fees), p = paidTotal(fees)
  return (
    <StatementShell branding={branding} title="Student Fee Statement" student={student} year={year}>
      <Table cols={cols} rows={rows} />
      <TotalRow label="Total Billed" value={pdfINR(b)} />
      <TotalRow label="Total Paid" value={pdfINR(p)} />
      <TotalRow label="Outstanding" value={pdfINR(b - p)} />
    </StatementShell>
  )
}

// ── Student Fee Ledger ────────────────────────────────────────
export function FeeLedgerDoc({ branding, student, year, entries }: {
  branding: SiteBranding; student?: StudentLike; year?: string; entries: LedgerEntry[]
}) {
  const cols: Col[] = [
    { key: 'date', label: 'Date', flex: 1.4 },
    { key: 'particulars', label: 'Particulars', flex: 3.4 },
    { key: 'debit', label: 'Debit', flex: 1.4, align: 'right' },
    { key: 'credit', label: 'Credit', flex: 1.4, align: 'right' },
    { key: 'balance', label: 'Balance', flex: 1.6, align: 'right' },
  ]
  const rows = entries.map(e => ({
    date: fmtDate(e.date),
    particulars: e.particulars,
    debit: e.debit ? pdfINR(e.debit) : '—',
    credit: e.credit ? pdfINR(e.credit) : '—',
    balance: pdfINR(e.balance),
  }))
  const closing = entries.length ? entries[entries.length - 1].balance : 0
  return (
    <StatementShell branding={branding} title="Student Fee Ledger" student={student} year={year}>
      <Table cols={cols} rows={rows} />
      <TotalRow label="Closing Balance (Outstanding)" value={pdfINR(closing)} />
    </StatementShell>
  )
}

// ── Outstanding Dues Statement ────────────────────────────────
export function OutstandingDuesDoc({ branding, student, year, fees }: {
  branding: SiteBranding; student?: StudentLike; year?: string; fees: SchoolFee[]
}) {
  const due = fees.filter(f => f.status === 'unpaid' || f.status === 'partial')
  const cols: Col[] = [
    { key: 'due', label: 'Due Date', flex: 1.6 },
    { key: 'particulars', label: 'Particulars', flex: 4 },
    { key: 'amount', label: 'Amount Due', flex: 1.8, align: 'right' },
  ]
  const rows = due.map(f => ({ due: fmtDate(f.due_date || f.created_at), particulars: feeName(f), amount: pdfINR(Number(f.amount) || 0) }))
  const total = due.reduce((s, f) => s + (Number(f.amount) || 0), 0)
  const noMsg = year ? 'No outstanding dues for this academic year.' : 'No outstanding dues across all years.'
  return (
    <StatementShell branding={branding} title="Outstanding Dues Statement" student={student} year={year} signatory="Please clear dues at the school office.">
      {rows.length ? <Table cols={cols} rows={rows} /> : <Text style={styles.para}>{noMsg}</Text>}
      {rows.length ? <TotalRow label="Total Outstanding" value={pdfINR(total)} /> : null}
    </StatementShell>
  )
}

// ── No-Due Certificate ────────────────────────────────────────
export function NoDueCertificateDoc({ branding, student, year }: {
  branding: SiteBranding; student?: StudentLike; year: string
}) {
  return (
    <StatementShell branding={branding} title="No Due Certificate" student={student} year={year} signatory="Authorised Signatory">
      <Text style={styles.para}>
        This is to certify that {student?.full_name ?? 'the student'} has cleared all fee dues payable to {branding.schoolName}
        {' '}for the academic year {year}. There are no outstanding fees against this student as on the date of issue.
      </Text>
      <Text style={[styles.para, { color: '#71717A' }]}>
        This certificate is issued on request and is valid as on the generation date noted below.
      </Text>
      <View style={styles.stampRow}>
        <Text> </Text>
        <Text style={styles.sign}>For {branding.schoolName}</Text>
      </View>
    </StatementShell>
  )
}

// ── Annual Fee Statement (per fee head) ───────────────────────
export function AnnualFeeStatementDoc({ branding, student, year, fees }: {
  branding: SiteBranding; student?: StudentLike; year: string; fees: SchoolFee[]
}) {
  const byHead = new Map<string, { billed: number; paid: number }>()
  for (const f of fees) {
    if (f.status === 'cancelled') continue
    const name = f.fee_head?.name || f.description || 'Other'
    const cur = byHead.get(name) ?? { billed: 0, paid: 0 }
    const amt = Number(f.amount) || 0
    cur.billed += amt
    if (f.status === 'paid') cur.paid += amt
    byHead.set(name, cur)
  }
  const cols: Col[] = [
    { key: 'head', label: 'Fee Head', flex: 3 },
    { key: 'billed', label: 'Billed', flex: 1.6, align: 'right' },
    { key: 'paid', label: 'Paid', flex: 1.6, align: 'right' },
    { key: 'due', label: 'Outstanding', flex: 1.8, align: 'right' },
  ]
  const rows = [...byHead.entries()].map(([head, v]) => ({
    head, billed: pdfINR(v.billed), paid: pdfINR(v.paid), due: pdfINR(v.billed - v.paid),
  }))
  const b = billed(fees), p = paidTotal(fees)
  return (
    <StatementShell branding={branding} title="Annual Fee Statement" student={student} year={year}>
      {rows.length ? <Table cols={cols} rows={rows} /> : <Text style={styles.para}>No fees recorded for this academic year.</Text>}
      <TotalRow label="Total Billed" value={pdfINR(b)} />
      <TotalRow label="Total Paid" value={pdfINR(p)} />
      <TotalRow label="Outstanding" value={pdfINR(b - p)} />
    </StatementShell>
  )
}
