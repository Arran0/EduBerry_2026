'use client'

import React from 'react'
import { fetchBranding } from '@/lib/pageConfig'
import { SchoolFee, SchoolFeePayment, fetchStudentLedger } from '@/lib/fees'
import type { StudentLike } from './StatementShell'

/** Build a PDF blob from a react-pdf element and trigger a browser download.
 *  react-pdf is dynamically imported so it never bloats the page chunk. */
async function render(element: React.ReactElement, fileName: string): Promise<void> {
  const { pdf } = await import('@react-pdf/renderer')
  const blob = await pdf(element).toBlob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName.endsWith('.pdf') ? fileName : `${fileName}.pdf`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

function slug(s?: string | null): string {
  return (s || 'student').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'student'
}

// Each generator loads branding + the document components on demand.

export async function downloadFeeReceipt(fee: SchoolFee, student?: StudentLike, payment?: SchoolFeePayment | null) {
  const [branding, { FeeReceiptDoc }] = await Promise.all([fetchBranding(), import('./documents')])
  await render(React.createElement(FeeReceiptDoc, { branding, student, fee, payment }), `fee-receipt-${slug(student?.full_name)}-${fee.upi_reference}`)
}

export async function downloadPaymentCertificate(fee: SchoolFee, student?: StudentLike, payment?: SchoolFeePayment | null) {
  const [branding, { PaymentCertificateDoc }] = await Promise.all([fetchBranding(), import('./documents')])
  await render(React.createElement(PaymentCertificateDoc, { branding, student, fee, payment }), `payment-certificate-${slug(student?.full_name)}`)
}

export async function downloadTranscript(student: StudentLike | undefined, year: string, fees: SchoolFee[]) {
  const [branding, { FeeTranscriptDoc }] = await Promise.all([fetchBranding(), import('./documents')])
  await render(React.createElement(FeeTranscriptDoc, { branding, student, year, fees }), `fee-statement-${slug(student?.full_name)}-${year}`)
}

export async function downloadLedger(studentId: string, student: StudentLike | undefined, year: string) {
  const [branding, { FeeLedgerDoc }, entries] = await Promise.all([
    fetchBranding(), import('./documents'), fetchStudentLedger(studentId, year),
  ])
  await render(React.createElement(FeeLedgerDoc, { branding, student, year, entries }), `fee-ledger-${slug(student?.full_name)}-${year}`)
}

export async function downloadOutstanding(student: StudentLike | undefined, year: string, fees: SchoolFee[]) {
  const [branding, { OutstandingDuesDoc }] = await Promise.all([fetchBranding(), import('./documents')])
  await render(React.createElement(OutstandingDuesDoc, { branding, student, year, fees }), `outstanding-dues-${slug(student?.full_name)}-${year}`)
}

export async function downloadNoDue(student: StudentLike | undefined, year: string) {
  const [branding, { NoDueCertificateDoc }] = await Promise.all([fetchBranding(), import('./documents')])
  await render(React.createElement(NoDueCertificateDoc, { branding, student, year }), `no-due-certificate-${slug(student?.full_name)}-${year}`)
}

export async function downloadAnnual(student: StudentLike | undefined, year: string, fees: SchoolFee[]) {
  const [branding, { AnnualFeeStatementDoc }] = await Promise.all([fetchBranding(), import('./documents')])
  await render(React.createElement(AnnualFeeStatementDoc, { branding, student, year, fees }), `annual-fee-statement-${slug(student?.full_name)}-${year}`)
}

/** A student has no dues for the year when nothing is unpaid or partial. */
export function hasNoDue(fees: SchoolFee[]): boolean {
  return !fees.some(f => f.status === 'unpaid' || f.status === 'partial')
}
