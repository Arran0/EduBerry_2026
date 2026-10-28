import { supabase, UserProfile } from './supabase'
import { SiteBranding, fetchBranding } from './pageConfig'
import { SchoolProfile, fetchSchoolProfile } from './schoolProfile'
import { StudentDetails, fetchStudentDetails } from './studentDetails'
import { Homeroom, fetchHomeromsForStudent } from './homerooms'
import { AttendanceSummary, fetchAttendanceSummary } from './attendance'
import { StudentMarkWithContext, fetchMarksForStudent } from './classrooms'
import { SchoolFee, fetchFeesForStudent, currentAcademicYear } from './fees'
import { PROFILE_COLUMNS } from './profileColumns'

// ============================================
// Certificate Generation Engine — data layer
// --------------------------------------------
// Gathers everything a certificate/template can reference (CertContext), persists
// every issued document to the `certificates` registry (so the public QR
// verification page is immutable), and resolves {{placeholders}} for the
// universal/custom template engine. PDF rendering lives in
// src/components/certificates/.
// ============================================

// ---- Certificate types & metadata -------------------------------------------

export type CertType =
  | 'transfer' | 'bonafide' | 'study' | 'no_due' | 'attendance'
  | 'progress_card' | 'report_card' | 'mark_statement' | 'subject_analysis'
  | 'promotion' | 'custom'

/** A type-specific input the Certificate modal collects before generating. */
export interface CertInputField {
  key: string
  label: string
  type: 'text' | 'textarea' | 'select' | 'boolean'
  options?: string[]
  placeholder?: string
}

export interface CertTypeMeta {
  type: CertType
  label: string
  icon: string          // lucide-react icon name
  description: string
  /** Extra fields the operator fills in; merged into CertContext.extra. */
  inputs: CertInputField[]
}

const PURPOSE: CertInputField = {
  key: 'purpose', label: 'Purpose', type: 'text',
  placeholder: 'e.g. bank account opening, scholarship, passport',
}

export const CERT_TYPES: CertTypeMeta[] = [
  {
    type: 'transfer', label: 'Transfer Certificate', icon: 'FileBadge',
    description: 'CBSE TC with the full prescribed field grid.',
    inputs: [
      { key: 'reason_for_leaving', label: 'Reason for leaving', type: 'text' },
      { key: 'last_class', label: 'Class in which last studied', type: 'text' },
      { key: 'conduct', label: 'Conduct', type: 'select', options: ['Excellent', 'Very Good', 'Good', 'Satisfactory'] },
      { key: 'qualified_for_promotion', label: 'Qualified for promotion', type: 'select', options: ['Yes', 'No'] },
      { key: 'fees_paid_upto', label: 'Fees paid up to', type: 'text', placeholder: 'e.g. March 2026' },
      { key: 'date_of_leaving', label: 'Date of leaving', type: 'text', placeholder: 'YYYY-MM-DD' },
    ],
  },
  {
    type: 'bonafide', label: 'Bonafide Certificate', icon: 'BadgeCheck',
    description: 'Certifies the student is bonafide of the school.',
    inputs: [PURPOSE],
  },
  {
    type: 'study', label: 'Study Certificate', icon: 'GraduationCap',
    description: 'Certifies the period and class of study.',
    inputs: [PURPOSE],
  },
  {
    type: 'no_due', label: 'No-Due Certificate', icon: 'CheckCircle2',
    description: 'Certifies the student has no outstanding dues.',
    inputs: [],
  },
  {
    type: 'attendance', label: 'Attendance Certificate', icon: 'CalendarCheck',
    description: 'Working days / present / percentage for the year.',
    inputs: [],
  },
  {
    type: 'progress_card', label: 'Progress Card', icon: 'LineChart',
    description: 'Consolidated progress across assessments.',
    inputs: [],
  },
  {
    type: 'report_card', label: 'Report Card', icon: 'ClipboardList',
    description: 'Marks report for the academic year.',
    inputs: [],
  },
  {
    type: 'mark_statement', label: 'Mark Statement', icon: 'FileText',
    description: 'Statement of marks obtained.',
    inputs: [],
  },
  {
    type: 'subject_analysis', label: 'Subject-wise Analysis', icon: 'BarChart3',
    description: 'Per-subject performance breakdown.',
    inputs: [],
  },
  {
    type: 'promotion', label: 'Promotion Certificate', icon: 'ArrowUpCircle',
    description: 'Certifies promotion to the next class.',
    inputs: [
      { key: 'promoted_to', label: 'Promoted to class', type: 'text' },
    ],
  },
  {
    type: 'custom', label: 'Custom / Universal', icon: 'Wand2',
    description: 'Render any saved template with {{placeholders}}.',
    inputs: [],
  },
]

export const CERT_TYPE_BY_KEY: Record<CertType, CertTypeMeta> =
  Object.fromEntries(CERT_TYPES.map(c => [c.type, c])) as Record<CertType, CertTypeMeta>

const CERT_PREFIX: Record<CertType, string> = {
  transfer: 'TC', bonafide: 'BC', study: 'SC', no_due: 'ND', attendance: 'AC',
  progress_card: 'PG', report_card: 'RC', mark_statement: 'MS',
  subject_analysis: 'SA', promotion: 'PR', custom: 'CC',
}

// ---- Certificate context -----------------------------------------------------

export interface CertContext {
  branding: SiteBranding
  school: SchoolProfile
  profile: UserProfile | null
  details: StudentDetails | null
  homerooms: Homeroom[]
  homeroom: Homeroom | null
  attendance: AttendanceSummary
  marks: StudentMarkWithContext[]
  fees: SchoolFee[]
  academic_year: string
  issue_date: string            // 'YYYY-MM-DD'
  certificate_no: string        // filled by registerCertificate
  verify_url: string            // public /verify/<no> URL the QR encodes
  qr_data_url: string           // PNG data URL of the QR (set by the generator)
  /** Type-specific inputs collected from the Certificate modal. */
  extra: Record<string, string>
}

export interface BuildContextOptions {
  academicYear?: string
  homeroomId?: string
  extra?: Record<string, string>
}

/** Gather every data source a certificate can reference, in parallel. */
export async function buildCertContext(
  studentId: string,
  opts: BuildContextOptions = {}
): Promise<CertContext> {
  const [branding, school, profileRes, details, homerooms, attendance, marks, fees] =
    await Promise.all([
      fetchBranding(),
      fetchSchoolProfile(),
      supabase.from('profiles').select(PROFILE_COLUMNS).eq('id', studentId).maybeSingle(),
      fetchStudentDetails(studentId),
      fetchHomeromsForStudent(studentId),
      fetchAttendanceSummary(studentId, opts.homeroomId),
      fetchMarksForStudent(studentId),
      fetchFeesForStudent(studentId, opts.academicYear),
    ])

  const profile = (profileRes.data as UserProfile) ?? null
  const homeroom = opts.homeroomId
    ? homerooms.find(h => h.id === opts.homeroomId) ?? homerooms[0] ?? null
    : homerooms[0] ?? null
  const academic_year = opts.academicYear ?? homeroom?.academic_year ?? currentAcademicYear()

  return {
    branding, school, profile, details, homerooms, homeroom,
    attendance, marks, fees,
    academic_year,
    issue_date: todayISO(),
    certificate_no: '',
    verify_url: '',
    qr_data_url: '',
    extra: opts.extra ?? {},
  }
}

// ---- Certificate registry ----------------------------------------------------

export interface CertificateRecord {
  id: string
  certificate_no: string
  cert_type: CertType
  student_id: string | null
  student_name: string
  academic_year: string | null
  data: Record<string, unknown>
  issued_by: string | null
  issue_date: string
  status: 'active' | 'revoked'
  created_at: string
  updated_at: string
}

function randomCertId(): string {
  // 6 chars, unambiguous base32 (no 0/O/1/I) — collision-safe with the UNIQUE
  // constraint catching the rare clash.
  const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'
  let out = ''
  for (let i = 0; i < 6; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)]
  return out
}

/** URL-safe, human-readable certificate number, e.g. "TC-2026-27-7K3MQ9". The
 *  academic year keeps its internal hyphen; the whole string stays a single URL
 *  path segment so it drops straight into /verify/<no>. */
export function generateCertificateNo(type: CertType, academicYear: string): string {
  return `${CERT_PREFIX[type]}-${academicYear}-${randomCertId()}`
}

export interface RegisterCertificateInput {
  cert_type: CertType
  student_id: string
  student_name: string
  academic_year?: string | null
  data: Record<string, unknown>
  issue_date?: string
}

/** Insert an issued certificate and return the saved row (so the QR can encode
 *  its certificate_no). Staff INSERT RLS allows this directly from the client. */
export async function registerCertificate(
  input: RegisterCertificateInput
): Promise<CertificateRecord | null> {
  const { data: { user } } = await supabase.auth.getUser()
  const year = input.academic_year ?? currentAcademicYear()
  const certificate_no = generateCertificateNo(input.cert_type, year)

  const { data, error } = await supabase
    .from('certificates')
    .insert({
      certificate_no,
      cert_type: input.cert_type,
      student_id: input.student_id,
      student_name: input.student_name,
      academic_year: input.academic_year ?? null,
      data: input.data,
      issued_by: user?.id ?? null,
      issue_date: input.issue_date ?? todayISO(),
      status: 'active',
    })
    .select('*')
    .single()

  if (error) { console.error('registerCertificate failed:', error); return null }
  return data as CertificateRecord
}

/** Recently issued certificates for a student (registry view in the UI). */
export async function fetchCertificatesForStudent(studentId: string): Promise<CertificateRecord[]> {
  const { data, error } = await supabase
    .from('certificates')
    .select('*')
    .eq('student_id', studentId)
    .order('created_at', { ascending: false })
  if (error) { console.error('fetchCertificatesForStudent failed:', error); return [] }
  return (data as CertificateRecord[]) ?? []
}

// ---- Custom templates (universal engine) ------------------------------------

export interface CertificateTemplate {
  id: string
  name: string
  cert_type: string
  title: string | null
  body: string
  created_by: string | null
  created_at: string
  updated_at: string
}

export async function fetchTemplates(): Promise<CertificateTemplate[]> {
  const { data, error } = await supabase
    .from('certificate_templates')
    .select('*')
    .order('name', { ascending: true })
  if (error) { console.error('fetchTemplates failed:', error); return [] }
  return (data as CertificateTemplate[]) ?? []
}

export async function saveTemplate(
  input: { id?: string; name: string; title?: string | null; body: string }
): Promise<{ success: boolean; id?: string; error?: string }> {
  const { data: { user } } = await supabase.auth.getUser()
  if (input.id) {
    const { error } = await supabase
      .from('certificate_templates')
      .update({ name: input.name, title: input.title ?? null, body: input.body })
      .eq('id', input.id)
    if (error) { console.error('saveTemplate(update) failed:', error); return { success: false, error: error.message } }
    return { success: true, id: input.id }
  }
  const { data, error } = await supabase
    .from('certificate_templates')
    .insert({ name: input.name, title: input.title ?? null, body: input.body, cert_type: 'custom', created_by: user?.id })
    .select('id')
    .single()
  if (error) { console.error('saveTemplate(insert) failed:', error); return { success: false, error: error.message } }
  return { success: true, id: data.id }
}

export async function deleteTemplate(id: string): Promise<{ success: boolean; error?: string }> {
  const { error } = await supabase.from('certificate_templates').delete().eq('id', id)
  if (error) { console.error('deleteTemplate failed:', error); return { success: false, error: error.message } }
  return { success: true }
}

// ---- Placeholder engine ------------------------------------------------------

/** The exact placeholder set the universal engine supports, with labels for the
 *  template editor's insert palette. {{qr_code}} resolves to the QR data URL. */
export const PLACEHOLDERS: { token: string; label: string }[] = [
  { token: '{{student_name}}', label: 'Student name' },
  { token: '{{admission_no}}', label: 'Admission no' },
  { token: '{{class}}', label: 'Class / grade' },
  { token: '{{section}}', label: 'Section' },
  { token: '{{roll_no}}', label: 'Roll no' },
  { token: '{{dob}}', label: 'Date of birth' },
  { token: '{{father_name}}', label: "Father's name" },
  { token: '{{mother_name}}', label: "Mother's name" },
  { token: '{{academic_year}}', label: 'Academic year' },
  { token: '{{attendance_percentage}}', label: 'Attendance %' },
  { token: '{{issue_date}}', label: 'Issue date' },
  { token: '{{principal_name}}', label: 'Principal name' },
  { token: '{{school_name}}', label: 'School name' },
  { token: '{{school_affiliation_no}}', label: 'Affiliation no' },
  { token: '{{certificate_no}}', label: 'Certificate no' },
  { token: '{{qr_code}}', label: 'QR code (verification)' },
]

/** Flat string map of every placeholder value for a given context. */
export function placeholderValues(ctx: CertContext): Record<string, string> {
  const d = ctx.details
  const p = ctx.profile
  const s = ctx.school
  return {
    student_name: p?.full_name ?? ctx.extra.student_name ?? '',
    admission_no: d?.admission_no ?? '',
    class: String(ctx.homeroom?.grade ?? p?.grade ?? ''),
    section: ctx.homeroom?.section ?? p?.section ?? '',
    roll_no: d?.roll_no ?? '',
    dob: fmtDate(d?.date_of_birth),
    father_name: d?.father_name ?? '',
    mother_name: d?.mother_name ?? '',
    academic_year: ctx.academic_year,
    attendance_percentage: `${ctx.attendance.present_pct}%`,
    issue_date: fmtDate(ctx.issue_date),
    principal_name: s.principal_name ?? '',
    school_name: ctx.branding.schoolName ?? '',
    school_affiliation_no: s.affiliation_no ?? '',
    certificate_no: ctx.certificate_no,
    qr_code: ctx.qr_data_url ?? '',
  }
}

/** Substitute {{token}} occurrences in a template body. Unknown tokens are left
 *  untouched so authoring mistakes are visible rather than silently dropped. */
export function resolvePlaceholders(body: string, ctx: CertContext): string {
  const vals = placeholderValues(ctx)
  return body.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key: string) =>
    key in vals ? vals[key] : match
  )
}

// ---- Date helpers ------------------------------------------------------------

function todayISO(): string {
  return new Date().toISOString().split('T')[0]
}

/** Human date, e.g. "15 Aug 2010". Empty string for null/invalid input. */
export function fmtDate(date?: string | null): string {
  if (!date) return ''
  const d = new Date(date)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

const ONES = [
  '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
  'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen',
  'Seventeen', 'Eighteen', 'Nineteen',
]
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety']

/** Whole number 0–9999 in words (sufficient for day + year). */
function numToWords(n: number): string {
  if (n < 20) return ONES[n]
  if (n < 100) return (TENS[Math.floor(n / 10)] + (n % 10 ? ' ' + ONES[n % 10] : '')).trim()
  if (n < 1000) return (ONES[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' ' + numToWords(n % 100) : '')).trim()
  const th = Math.floor(n / 1000)
  return (numToWords(th) + ' Thousand' + (n % 1000 ? ' ' + numToWords(n % 1000) : '')).trim()
}

const ORDINALS: Record<number, string> = {
  1: 'First', 2: 'Second', 3: 'Third', 5: 'Fifth', 8: 'Eighth', 9: 'Ninth', 12: 'Twelfth',
}
function dayOrdinal(day: number): string {
  if (ORDINALS[day]) return ORDINALS[day]
  if (day < 20) return ONES[day] + 'th'
  const tens = TENS[Math.floor(day / 10)]
  const unit = day % 10
  if (unit === 0) return tens.replace(/y$/, 'ieth')
  if (ORDINALS[unit]) return `${tens}-${ORDINALS[unit]}`
  return `${tens}-${ONES[unit]}th`
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

/** A date spelled out for CBSE "Date of Birth (in words)" fields, e.g.
 *  "Fifteenth August Two Thousand Ten". Empty string for null/invalid input. */
export function numberToWordsDate(date?: string | null): string {
  if (!date) return ''
  const d = new Date(date)
  if (Number.isNaN(d.getTime())) return ''
  return `${dayOrdinal(d.getDate())} ${MONTHS[d.getMonth()]} ${numToWords(d.getFullYear())}`
}
