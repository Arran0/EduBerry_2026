'use client'

import React from 'react'
import type { DocumentProps } from '@react-pdf/renderer'
import {
  CertType, CertContext, CertificateTemplate,
  buildCertContext, registerCertificate, placeholderValues, BuildContextOptions,
} from '@/lib/certificates'

// Download helpers mirroring the fee statements pattern: dynamically import
// @react-pdf/renderer (keeps it out of the page chunk), persist the issued
// certificate to the registry first (so it gets a number + QR target), build the
// verification QR, then render the matching document to a downloaded PDF.

async function render(element: React.ReactElement, fileName: string): Promise<void> {
  const { pdf } = await import('@react-pdf/renderer')
  const blob = await pdf(element as React.ReactElement<DocumentProps>).toBlob()
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

/** Build the context, register the certificate, and stamp the number + QR onto
 *  the context so any document can render them. Returns null if the registry
 *  insert fails (so the caller can surface an error instead of a broken PDF). */
async function issue(
  certType: CertType,
  studentId: string,
  opts: BuildContextOptions,
): Promise<CertContext | null> {
  const ctx = await buildCertContext(studentId, opts)

  const record = await registerCertificate({
    cert_type: certType,
    student_id: studentId,
    student_name: ctx.profile?.full_name ?? 'Student',
    academic_year: ctx.academic_year,
    data: { ...placeholderValues(ctx), ...ctx.extra },
  })
  if (!record) return null

  ctx.certificate_no = record.certificate_no
  ctx.issue_date = record.issue_date
  ctx.verify_url = `${window.location.origin}/verify/${encodeURIComponent(record.certificate_no)}`

  try {
    const QRCode = (await import('qrcode')).default
    ctx.qr_data_url = await QRCode.toDataURL(ctx.verify_url, { margin: 1, width: 240 })
  } catch (e) {
    console.error('QR generation failed:', e)
  }
  return ctx
}

const FILE_PREFIX: Record<CertType, string> = {
  transfer: 'transfer-certificate', bonafide: 'bonafide-certificate',
  study: 'study-certificate', no_due: 'no-due-certificate', attendance: 'attendance-certificate',
  progress_card: 'progress-card', report_card: 'report-card', mark_statement: 'mark-statement',
  subject_analysis: 'subject-analysis', promotion: 'promotion-certificate', custom: 'certificate',
}

/**
 * Generate and download a certificate of the given type for a student. The
 * Certificate modal calls this with the type, student id, and the collected
 * options (academic year, homeroom, and the type-specific `extra` inputs). For
 * `custom`, pass the chosen template.
 *
 * Returns the issued certificate number on success, or null on failure.
 */
export async function downloadCertificate(
  certType: CertType,
  studentId: string,
  opts: BuildContextOptions = {},
  template?: CertificateTemplate,
): Promise<string | null> {
  const ctx = await issue(certType, studentId, opts)
  if (!ctx) return null

  const docs = await import('./documents')
  const name = ctx.profile?.full_name
  const fileName = `${FILE_PREFIX[certType]}-${slug(name)}`

  let element: React.ReactElement
  switch (certType) {
    case 'transfer':         element = React.createElement(docs.TransferCertificateDoc, { ctx }); break
    case 'bonafide':         element = React.createElement(docs.BonafideCertificateDoc, { ctx }); break
    case 'study':            element = React.createElement(docs.StudyCertificateDoc, { ctx }); break
    case 'no_due':           element = React.createElement(docs.NoDueCertificateDoc, { ctx }); break
    case 'attendance':       element = React.createElement(docs.AttendanceCertificateDoc, { ctx }); break
    case 'progress_card':    element = React.createElement(docs.ProgressCardDoc, { ctx }); break
    case 'report_card':      element = React.createElement(docs.ReportCardDoc, { ctx }); break
    case 'mark_statement':   element = React.createElement(docs.MarkStatementDoc, { ctx }); break
    case 'subject_analysis': element = React.createElement(docs.SubjectAnalysisDoc, { ctx }); break
    case 'promotion':        element = React.createElement(docs.PromotionCertificateDoc, { ctx }); break
    case 'custom':
      element = React.createElement(docs.CustomCertificateDoc, {
        ctx,
        title: template?.title || template?.name || 'Certificate',
        body: template?.body ?? '',
      })
      break
    default:
      return null
  }

  await render(element, fileName)
  return ctx.certificate_no
}
