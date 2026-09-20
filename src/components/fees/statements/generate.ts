'use client'

import React from 'react'
import { fetchBranding } from '@/lib/pageConfig'
import { SchoolFee, SchoolFeePayment, fetchStudentLedger } from '@/lib/fees'
import type { StudentLike } from './StatementShell'

/** A ready-to-render PDF: the react-pdf element plus a suggested file name. */
export interface StatementSpec {
  element: React.ReactElement
  fileName: string
}

/** Render a built spec to a blob and trigger a browser download. react-pdf is
 *  dynamically imported so it never bloats the page chunk. */
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
  return (s || 'student').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'student'
}

// Each builder loads branding + the document components on demand and returns a
// spec the caller can preview (PDFViewer) and/or download.

export async function buildFeeReceipt(fee: SchoolFee, student?: StudentLike, payment?: SchoolFeePayment | null): Promise<StatementSpec> {
  const [branding, { FeeReceiptDoc }] = await Promise.all([fetchBranding(), import('./documents')])
  return { element: React.createElement(FeeReceiptDoc, { branding, student, fee, payment }), fileName: `fee-receipt-${slug(student?.full_name)}-${fee.upi_reference}` }
}

export async function buildTranscript(student: StudentLike | undefined, year: string, fees: SchoolFee[]): Promise<StatementSpec> {
  const [branding, { FeeTranscriptDoc }] = await Promise.all([fetchBranding(), import('./documents')])
  return { element: React.createElement(FeeTranscriptDoc, { branding, student, year, fees }), fileName: `fee-statement-${slug(student?.full_name)}-${year}` }
}

export async function buildLedger(studentId: string, student: StudentLike | undefined, year?: string): Promise<StatementSpec> {
  const [branding, { FeeLedgerDoc }, entries] = await Promise.all([
    fetchBranding(), import('./documents'), fetchStudentLedger(studentId, year),
  ])
  return { element: React.createElement(FeeLedgerDoc, { branding, student, year, entries }), fileName: `fee-ledger-${slug(student?.full_name)}${year ? `-${year}` : ''}` }
}

export async function buildOutstanding(student: StudentLike | undefined, year: string | undefined, fees: SchoolFee[]): Promise<StatementSpec> {
  const [branding, { OutstandingDuesDoc }] = await Promise.all([fetchBranding(), import('./documents')])
  return { element: React.createElement(OutstandingDuesDoc, { branding, student, year, fees }), fileName: `outstanding-dues-${slug(student?.full_name)}${year ? `-${year}` : ''}` }
}

export async function buildNoDue(student: StudentLike | undefined, year: string): Promise<StatementSpec> {
  const [branding, { NoDueCertificateDoc }] = await Promise.all([fetchBranding(), import('./documents')])
  return { element: React.createElement(NoDueCertificateDoc, { branding, student, year }), fileName: `no-due-certificate-${slug(student?.full_name)}-${year}` }
}

export async function buildAnnual(student: StudentLike | undefined, year: string, fees: SchoolFee[]): Promise<StatementSpec> {
  const [branding, { AnnualFeeStatementDoc }] = await Promise.all([fetchBranding(), import('./documents')])
  return { element: React.createElement(AnnualFeeStatementDoc, { branding, student, year, fees }), fileName: `annual-fee-statement-${slug(student?.full_name)}-${year}` }
}

/** A student has no dues for the year when nothing is unpaid or partial. */
export function hasNoDue(fees: SchoolFee[]): boolean {
  return !fees.some(f => f.status === 'unpaid' || f.status === 'partial')
}
