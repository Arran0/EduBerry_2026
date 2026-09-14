'use client'

import React from 'react'
import { Text } from '@react-pdf/renderer'
import {
  CertContext, placeholderValues, fmtDate, numberToWordsDate, resolvePlaceholders,
} from '@/lib/certificates'
import { CertificateShell, CertTable, Field, certStyles, CertCol } from './CertificateShell'

// One component per certificate type, each composing CertificateShell. They read
// everything from the gathered CertContext (profile + student_details + homeroom
// + attendance + marks + fees + school profile) plus the type-specific inputs in
// ctx.extra collected by the Certificate modal.

type DocProps = { ctx: CertContext }

/** Shell props common to every document, derived from the context. */
function shellProps(ctx: CertContext) {
  return {
    branding: ctx.branding,
    school: ctx.school,
    certificateNo: ctx.certificate_no,
    issueDate: fmtDate(ctx.issue_date),
    qrDataUrl: ctx.qr_data_url,
    verifyUrl: ctx.verify_url,
  }
}

function studentName(ctx: CertContext): string {
  return ctx.profile?.full_name ?? ctx.extra.student_name ?? 'the student'
}

function classLabel(ctx: CertContext): string {
  const v = placeholderValues(ctx)
  return [v.class && `Class ${v.class}`, v.section].filter(Boolean).join(' - ') || '—'
}

// ── Transfer Certificate (full CBSE field grid) ───────────────
export function TransferCertificateDoc({ ctx }: DocProps) {
  const v = placeholderValues(ctx)
  const d = ctx.details
  const e = ctx.extra
  const att = ctx.attendance
  const fields: { label: string; value?: string }[] = [
    { label: 'Name of the Student', value: v.student_name },
    { label: "Mother's Name", value: v.mother_name },
    { label: "Father's / Guardian's Name", value: v.father_name || d?.guardian_name || '' },
    { label: 'Nationality', value: d?.nationality ?? '' },
    { label: 'Whether belongs to SC / ST / OBC', value: d?.category ?? '' },
    { label: 'Date of First Admission with Class', value: [fmtDate(d?.date_of_admission), d?.admission_class].filter(Boolean).join(', ') },
    { label: 'Date of Birth (in figures)', value: v.dob },
    { label: 'Date of Birth (in words)', value: numberToWordsDate(d?.date_of_birth) },
    { label: 'Class in which last studied', value: e.last_class || v.class },
    { label: 'School / Board Annual Examination last taken', value: e.last_exam || '' },
    { label: 'Whether failed, if so once / twice in the same class', value: e.failed || '' },
    { label: 'Subjects studied', value: e.subjects || '' },
    { label: 'Whether qualified for promotion to higher class', value: e.qualified_for_promotion || '' },
    { label: 'Month up to which fees paid', value: e.fees_paid_upto || '' },
    { label: 'Total number of working days', value: att.total_days ? String(att.total_days) : '' },
    { label: 'Total number of days present', value: att.total_days ? String(att.present) : '' },
    { label: 'Whether NCC Cadet / Boy Scout / Girl Guide', value: e.ncc || '' },
    { label: 'Games played / extra-curricular activities', value: e.activities || '' },
    { label: 'General conduct', value: e.conduct || '' },
    { label: 'Date of application for certificate', value: fmtDate(e.date_of_application) || fmtDate(ctx.issue_date) },
    { label: 'Date of issue of certificate', value: fmtDate(ctx.issue_date) },
    { label: 'Reason for leaving the school', value: e.reason_for_leaving || '' },
    { label: 'Any other remarks', value: e.remarks || '' },
    { label: 'Admission No.', value: v.admission_no },
    { label: 'Roll No.', value: v.roll_no },
  ]
  return (
    <CertificateShell {...shellProps(ctx)} title="Transfer Certificate">
      {fields.map((f, i) => (
        <Field key={i} no={i + 1} label={f.label} value={f.value} />
      ))}
    </CertificateShell>
  )
}

// ── Bonafide Certificate ──────────────────────────────────────
export function BonafideCertificateDoc({ ctx }: DocProps) {
  const v = placeholderValues(ctx)
  const purpose = ctx.extra.purpose
  return (
    <CertificateShell {...shellProps(ctx)} title="Bonafide Certificate">
      <Text style={certStyles.para}>
        This is to certify that {studentName(ctx)}
        {v.father_name ? `, son/daughter of ${v.father_name},` : ''} is a bonafide student of this
        school, studying in {classLabel(ctx)} during the academic year {ctx.academic_year}.
        {v.admission_no ? ` The admission number is ${v.admission_no}.` : ''}
        {v.dob ? ` As per our records, the date of birth is ${v.dob}.` : ''}
      </Text>
      <Text style={certStyles.para}>
        This certificate is issued {purpose ? `for the purpose of ${purpose}` : 'on request'} and is
        valid as on the date of issue.
      </Text>
    </CertificateShell>
  )
}

// ── Study Certificate ─────────────────────────────────────────
export function StudyCertificateDoc({ ctx }: DocProps) {
  const v = placeholderValues(ctx)
  const purpose = ctx.extra.purpose
  return (
    <CertificateShell {...shellProps(ctx)} title="Study Certificate">
      <Text style={certStyles.para}>
        This is to certify that {studentName(ctx)}
        {v.father_name ? `, son/daughter of ${v.father_name},` : ''} has been studying in this school
        in {classLabel(ctx)} during the academic year {ctx.academic_year}.
        {v.admission_no ? ` (Admission No: ${v.admission_no}.)` : ''}
      </Text>
      <Text style={certStyles.para}>
        To the best of our knowledge, the conduct and character of the student have been good.
        This certificate is issued {purpose ? `for the purpose of ${purpose}` : 'on request'}.
      </Text>
    </CertificateShell>
  )
}

// ── No-Due Certificate ────────────────────────────────────────
export function NoDueCertificateDoc({ ctx }: DocProps) {
  const v = placeholderValues(ctx)
  const dues = ctx.fees.filter(f => f.status === 'unpaid' || f.status === 'partial')
  const clear = dues.length === 0
  return (
    <CertificateShell {...shellProps(ctx)} title="No-Due Certificate">
      <Text style={certStyles.para}>
        This is to certify that {studentName(ctx)}
        {v.admission_no ? ` (Admission No: ${v.admission_no})` : ''}, studying in {classLabel(ctx)} during
        the academic year {ctx.academic_year}, {clear
          ? 'has no outstanding dues payable to the school as on the date of issue of this certificate.'
          : `has the following outstanding dues as on the date of issue of this certificate.`}
      </Text>
      {!clear && (
        <CertTable
          cols={[
            { key: 'particulars', label: 'Particulars', flex: 4 },
            { key: 'status', label: 'Status', flex: 1.4 },
          ]}
          rows={dues.map(f => ({
            particulars: f.description || f.fee_head?.name || 'School fee',
            status: f.status === 'partial' ? 'Partially paid' : 'Unpaid',
          }))}
        />
      )}
    </CertificateShell>
  )
}

// ── Attendance Certificate ────────────────────────────────────
export function AttendanceCertificateDoc({ ctx }: DocProps) {
  const att = ctx.attendance
  return (
    <CertificateShell {...shellProps(ctx)} title="Attendance Certificate">
      <Text style={certStyles.para}>
        This is to certify that {studentName(ctx)}, studying in {classLabel(ctx)}, has the following
        attendance record for the academic year {ctx.academic_year}.
      </Text>
      <CertTable
        cols={[
          { key: 'metric', label: 'Particulars', flex: 3 },
          { key: 'value', label: 'Value', flex: 1, align: 'right' },
        ]}
        rows={[
          { metric: 'Total working days', value: String(att.total_days) },
          { metric: 'Days present', value: String(att.present) },
          { metric: 'Days absent', value: String(att.absent) },
          { metric: 'Days on leave', value: String(att.on_leave) },
          { metric: 'Attendance percentage', value: `${att.present_pct}%` },
        ]}
      />
    </CertificateShell>
  )
}

// ── Marks-based documents (report card / mark statement / progress card) ──
const MARK_COLS: CertCol[] = [
  { key: 'subject', label: 'Subject / Course', flex: 3 },
  { key: 'assessment', label: 'Assessment', flex: 2.4 },
  { key: 'marks', label: 'Marks', flex: 1, align: 'right' },
  { key: 'max', label: 'Max', flex: 1, align: 'right' },
  { key: 'pct', label: '%', flex: 1, align: 'right' },
]

function markRows(ctx: CertContext): Record<string, string>[] {
  return ctx.marks.map(m => {
    const pct = m.marks != null && m.max_marks > 0 ? Math.round((m.marks / m.max_marks) * 100) : null
    return {
      subject: m.classroom_title,
      assessment: m.assessment_title,
      marks: m.marks != null ? String(m.marks) : '—',
      max: String(m.max_marks),
      pct: pct != null ? `${pct}%` : '—',
    }
  })
}

function MarksDoc({ ctx, title }: DocProps & { title: string }) {
  const rows = markRows(ctx)
  const totals = ctx.marks.reduce(
    (acc, m) => {
      if (m.marks != null) { acc.got += m.marks; acc.max += m.max_marks }
      return acc
    },
    { got: 0, max: 0 }
  )
  const overallPct = totals.max > 0 ? Math.round((totals.got / totals.max) * 100) : null
  return (
    <CertificateShell {...shellProps(ctx)} title={title}>
      <Text style={certStyles.para}>
        {studentName(ctx)} · {classLabel(ctx)} · Academic Year {ctx.academic_year}
      </Text>
      {rows.length ? (
        <CertTable cols={MARK_COLS} rows={rows} />
      ) : (
        <Text style={certStyles.para}>No assessment records are available for this student.</Text>
      )}
      {overallPct != null && (
        <Text style={[certStyles.para, { marginTop: 10, fontFamily: 'Times-Bold' }]}>
          Overall: {totals.got} / {totals.max} ({overallPct}%)
        </Text>
      )}
    </CertificateShell>
  )
}

export function ReportCardDoc({ ctx }: DocProps) { return <MarksDoc ctx={ctx} title="Report Card" /> }
export function MarkStatementDoc({ ctx }: DocProps) { return <MarksDoc ctx={ctx} title="Statement of Marks" /> }
export function ProgressCardDoc({ ctx }: DocProps) { return <MarksDoc ctx={ctx} title="Progress Card" /> }

// ── Subject-wise Analysis ─────────────────────────────────────
export function SubjectAnalysisDoc({ ctx }: DocProps) {
  const bySubject = new Map<string, { got: number; max: number; n: number }>()
  for (const m of ctx.marks) {
    if (m.marks == null || m.max_marks <= 0) continue
    const cur = bySubject.get(m.classroom_title) ?? { got: 0, max: 0, n: 0 }
    cur.got += m.marks; cur.max += m.max_marks; cur.n += 1
    bySubject.set(m.classroom_title, cur)
  }
  const rows = [...bySubject.entries()].map(([subject, s]) => ({
    subject,
    assessments: String(s.n),
    avg: `${Math.round((s.got / s.max) * 100)}%`,
  }))
  return (
    <CertificateShell {...shellProps(ctx)} title="Subject-wise Analysis">
      <Text style={certStyles.para}>
        {studentName(ctx)} · {classLabel(ctx)} · Academic Year {ctx.academic_year}
      </Text>
      {rows.length ? (
        <CertTable
          cols={[
            { key: 'subject', label: 'Subject / Course', flex: 3 },
            { key: 'assessments', label: 'Assessments', flex: 1.4, align: 'right' },
            { key: 'avg', label: 'Average %', flex: 1.4, align: 'right' },
          ]}
          rows={rows}
        />
      ) : (
        <Text style={certStyles.para}>No assessment records are available for this student.</Text>
      )}
    </CertificateShell>
  )
}

// ── Promotion Certificate ─────────────────────────────────────
export function PromotionCertificateDoc({ ctx }: DocProps) {
  const promotedTo = ctx.extra.promoted_to
  return (
    <CertificateShell {...shellProps(ctx)} title="Promotion Certificate">
      <Text style={certStyles.para}>
        This is to certify that {studentName(ctx)}, studying in {classLabel(ctx)} during the academic
        year {ctx.academic_year}, has been declared qualified and is hereby promoted
        {promotedTo ? ` to ${promotedTo}` : ' to the next higher class'}.
      </Text>
      <Text style={certStyles.para}>This certificate is issued on the basis of the results of the academic year.</Text>
    </CertificateShell>
  )
}

// ── Custom / Universal template ───────────────────────────────
export function CustomCertificateDoc({ ctx, title, body }: DocProps & { title: string; body: string }) {
  // The QR is rendered in the footer; drop any inline {{qr_code}} so the raw data
  // URL never leaks into body text.
  const resolved = resolvePlaceholders(body.replace(/\{\{\s*qr_code\s*\}\}/g, ''), ctx)
  const blocks = resolved.split(/\n{2,}/)
  return (
    <CertificateShell {...shellProps(ctx)} title={title || 'Certificate'}>
      {blocks.map((block, i) => (
        <Text key={i} style={certStyles.para}>{block.trim()}</Text>
      ))}
    </CertificateShell>
  )
}
