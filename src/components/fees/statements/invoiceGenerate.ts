'use client'

// Builders for the Round 2 documents. react-pdf and qrcode are both imported
// on demand so neither reaches the page chunk — the same rule the existing
// statement builders follow.

import React from 'react'
import { fetchBranding } from '@/lib/pageConfig'
import type { StatementSpec } from './generate'
import type { StudentLike } from './StatementShell'
import type { InvoiceDocData, ReceiptDocData } from './invoiceDocs'

function slug(s?: string | null): string {
  return (s || 'student').trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'student'
}

/** Where a scanned QR lands. Absolute, because it is printed on paper. */
export function verifyUrl(token: string): string {
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  return `${origin}/verify/receipt/${token}`
}

async function qrFor(token: string): Promise<string | null> {
  try {
    const QRCode = (await import('qrcode')).default
    return await QRCode.toDataURL(verifyUrl(token), { width: 240, margin: 1 })
  } catch {
    // A missing QR must not stop a receipt printing at the counter; the number
    // on it is still the school's record.
    return null
  }
}

export async function buildInvoice(
  invoice: InvoiceDocData & { verify_token: string },
  student: StudentLike | undefined,
  yearCode: string,
): Promise<StatementSpec> {
  const [branding, docs, qr] = await Promise.all([
    fetchBranding(), import('./invoiceDocs'), qrFor(invoice.verify_token),
  ])
  return {
    element: React.createElement(docs.InvoiceDoc, {
      branding, student, yearCode,
      invoice: { ...invoice, qr, verifyUrl: verifyUrl(invoice.verify_token) },
    }),
    fileName: `invoice-${slug(student?.full_name)}-${invoice.number.replace(/\//g, '-')}`,
  }
}

export async function buildReceipt(
  receipt: ReceiptDocData & { verify_token: string },
  student: StudentLike | undefined,
  yearCode: string,
  thermal = false,
): Promise<StatementSpec> {
  const [branding, docs, qr] = await Promise.all([
    fetchBranding(), import('./invoiceDocs'), qrFor(receipt.verify_token),
  ])
  const data = { ...receipt, qr, verifyUrl: verifyUrl(receipt.verify_token) }
  return {
    element: thermal
      ? React.createElement(docs.ThermalReceiptDoc, { branding, student, receipt: data })
      : React.createElement(docs.ReceiptDoc, { branding, student, receipt: data, yearCode }),
    fileName: `receipt-${slug(student?.full_name)}-${receipt.receipt_no.replace(/\//g, '-')}`,
  }
}

/**
 * Send a document straight to the printer rather than downloading it.
 *
 * The counter wants paper, not a file in Downloads to find and open. The blob
 * is opened in a hidden iframe and printed from there, which is the only way to
 * do this without a popup blocker eating it.
 */
export async function printSpec(spec: StatementSpec): Promise<void> {
  const { pdf } = await import('@react-pdf/renderer')
  const blob = await pdf(spec.element).toBlob()
  const url = URL.createObjectURL(blob)

  const frame = document.createElement('iframe')
  frame.style.position = 'fixed'
  frame.style.right = '0'
  frame.style.bottom = '0'
  frame.style.width = '0'
  frame.style.height = '0'
  frame.style.border = '0'
  frame.src = url

  frame.onload = () => {
    try {
      frame.contentWindow?.focus()
      frame.contentWindow?.print()
    } catch {
      // Some browsers refuse to print a cross-origin-ish blob frame; fall back
      // to opening it so the clerk can still press Ctrl-P.
      window.open(url, '_blank')
    }
    // Give the print dialog time to take its own copy before revoking.
    setTimeout(() => { frame.remove(); URL.revokeObjectURL(url) }, 60_000)
  }

  document.body.appendChild(frame)
}
