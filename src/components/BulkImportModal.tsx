'use client'

import React, { useState, useRef } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Upload, FileSpreadsheet, AlertCircle, CheckCircle2, RefreshCw, Download, Check } from 'lucide-react'
import * as XLSX from 'xlsx'
import { supabase } from '@/lib/supabase'
import type { UserRole } from '@/lib/supabase'

const ALL_VALID_ROLES: UserRole[] = ['student', 'teacher', 'coordinator', 'principal', 'admin', 'driver', 'smartboard']
const STUDENT_ROLES: UserRole[] = ['student']
const STAFF_ROLES: UserRole[] = ['teacher', 'coordinator', 'principal', 'admin', 'driver', 'smartboard']
const VALID_SECTIONS = Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i))
const DEFAULT_AUTOCONFIRM_PASSWORD = 'mps2627'
const GRADE_LABELS: Record<string, number> = Object.fromEntries(
  Array.from({ length: 12 }, (_, i) => [`Grade ${i + 1}`, i + 1])
)

interface ParsedRow {
  email: string
  full_name: string
  role: UserRole
  grade?: number
  section?: string
  // Student detail fields
  admission_no?: string
  roll_no?: string
  date_of_birth?: string
  father_name?: string
  mother_name?: string
  guardian_name?: string
  phone?: string
  nationality?: string
  religion?: string
  category?: string
  blood_group?: string
  address?: string
  // Staff detail fields
  employee_id?: string
  designation?: string
  department?: string
  subjects_taught?: string
  employment_type?: string
  date_of_joining?: string
  date_of_retirement?: string
  date_of_confirmation?: string
  cbse_reg_no?: string
  qualification?: string
  ugc_net_qualified?: string
  teaching_diploma?: string
  teaching_experience_years?: string
  gender?: string
  alternate_phone?: string
  emergency_contact_name?: string
  emergency_contact?: string
  emergency_contact_relation?: string
  aadhaar_no?: string
  pan_no?: string
  epf_no?: string
  nps_no?: string
  bank_account_no?: string
  bank_name?: string
  ifsc_code?: string
  isExisting?: boolean
  validationError?: string
}

interface BulkImportModalProps {
  existingEmails: Set<string>
  onClose: () => void
  onDone: () => void
  /** 'student' → only student rows accepted; 'staff' → only non-student rows accepted */
  mode?: 'student' | 'staff'
}

function parseRoleCell(raw: unknown, allowedRoles: UserRole[]): UserRole | null {
  if (!raw) return null
  const s = String(raw).trim().toLowerCase()
  const found = allowedRoles.find(r => r === s)
  return found ?? null
}

function parseGradeCell(raw: unknown): number | undefined {
  if (raw === null || raw === undefined || raw === '') return undefined
  const n = Number(raw)
  if (!isNaN(n) && n >= 1 && n <= 12) return n
  const label = String(raw).trim()
  return GRADE_LABELS[label] ?? undefined
}

function parseSectionCell(raw: unknown): string | undefined {
  if (!raw) return undefined
  const s = String(raw).trim().toUpperCase()
  return VALID_SECTIONS.includes(s) ? s : undefined
}

function parseSheet(workbook: XLSX.WorkBook, allowedRoles: UserRole[]): ParsedRow[] {
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' })

  return rows.map(row => {
    const get = (keys: string[]) => {
      for (const key of Object.keys(row)) {
        if (keys.some(k => key.trim().toLowerCase() === k.toLowerCase())) return row[key]
      }
      return ''
    }

    const str = (keys: string[]) => { const v = String(get(keys) || '').trim(); return v || undefined }

    const email = String(get(['email', 'email address']) || '').trim().toLowerCase()
    const full_name = String(get(['full name', 'fullname', 'name']) || '').trim()
    const rawRole = get(['role'])
    const rawGrade = get(['grade'])
    const rawSection = get(['section'])

    const role = parseRoleCell(rawRole, allowedRoles)
    const grade = parseGradeCell(rawGrade)
    const section = parseSectionCell(rawSection)

    // Student fields
    const admission_no = str(['admission no', 'admission_no', 'admissionno', 'admission number'])
    const roll_no = str(['roll no', 'roll_no', 'rollno', 'roll number'])
    const date_of_birth = str(['date of birth', 'dob', 'birthdate', 'date_of_birth'])
    const father_name = str(['father name', 'father_name', 'fathername', "father's name"])
    const mother_name = str(['mother name', 'mother_name', 'mothername', "mother's name"])
    const guardian_name = str(['guardian name', 'guardian_name', 'guardianname'])
    const phone = str(['phone', 'phone number', 'mobile', 'contact'])
    const nationality = str(['nationality'])
    const religion = str(['religion'])
    const category = str(['category', 'caste category'])
    const blood_group = str(['blood group', 'blood_group', 'bloodgroup'])
    const address = str(['address'])
    // Staff fields
    const employee_id = str(['employee id', 'employee_id', 'employeeid', 'emp id', 'emp_id'])
    const designation = str(['designation', 'post'])
    const department = str(['department'])
    const subjects_taught = str(['subjects taught', 'subjects_taught', 'subject', 'subjects'])
    const employment_type = str(['employment type', 'employment_type'])
    const date_of_joining = str(['date of joining', 'date_of_joining', 'doj', 'joining date'])
    const date_of_retirement = str(['date of retirement', 'date_of_retirement', 'retirement date'])
    const date_of_confirmation = str(['date of confirmation', 'date_of_confirmation', 'confirmation date'])
    const cbse_reg_no = str(['cbse reg no', 'cbse_reg_no', 'cbse registration', 'cbse reg'])
    const qualification = str(['qualification', 'qualifications'])
    const ugc_net_qualified = str(['ugc net', 'ugc_net_qualified', 'net qualified'])
    const teaching_diploma = str(['teaching diploma', 'teaching_diploma'])
    const teaching_experience_years = str(['teaching experience', 'teaching_experience_years', 'experience years'])
    const gender = str(['gender'])
    const alternate_phone = str(['alternate phone', 'alternate_phone', 'alt phone'])
    const emergency_contact_name = str(['emergency contact name', 'emergency_contact_name'])
    const emergency_contact = str(['emergency contact', 'emergency_contact', 'emergency number'])
    const emergency_contact_relation = str(['emergency contact relation', 'emergency_contact_relation'])
    const aadhaar_no = str(['aadhaar', 'aadhaar no', 'aadhaar_no', 'aadhar'])
    const pan_no = str(['pan', 'pan no', 'pan_no'])
    const epf_no = str(['epf no', 'epf_no', 'epf', 'pf no'])
    const nps_no = str(['nps', 'nps no', 'nps_no', 'pran'])
    const bank_account_no = str(['bank account', 'bank_account_no', 'account no', 'bank account no'])
    const bank_name = str(['bank name', 'bank_name', 'bank'])
    const ifsc_code = str(['ifsc', 'ifsc code', 'ifsc_code'])

    let validationError: string | undefined
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      validationError = 'Invalid email'
    } else if (!full_name) {
      validationError = 'Missing full name'
    } else if (!role) {
      validationError = `Invalid role "${rawRole}"`
    }

    return {
      email, full_name, role: role ?? allowedRoles[0], grade, section,
      admission_no, roll_no, date_of_birth, father_name, mother_name,
      guardian_name, phone, nationality, religion, category, blood_group, address,
      employee_id, designation, department, subjects_taught, employment_type,
      date_of_joining, date_of_retirement, date_of_confirmation, cbse_reg_no,
      qualification, ugc_net_qualified, teaching_diploma, teaching_experience_years,
      gender, alternate_phone, emergency_contact_name, emergency_contact,
      emergency_contact_relation, aadhaar_no, pan_no, epf_no, nps_no,
      bank_account_no, bank_name, ifsc_code,
      validationError,
    }
  }).filter(r => r.email || r.full_name)
}

export default function BulkImportModal({ existingEmails, onClose, onDone, mode }: BulkImportModalProps) {
  const allowedRoles = mode === 'student' ? STUDENT_ROLES : mode === 'staff' ? STAFF_ROLES : ALL_VALID_ROLES
  const fileRef = useRef<HTMLInputElement>(null)
  const [rows, setRows] = useState<ParsedRow[]>([])
  const [fileName, setFileName] = useState('')
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState<{ created: number; updated: number; errors: { email: string; error: string }[]; autoConfirm: boolean } | null>(null)
  const [parseError, setParseError] = useState('')
  const [autoConfirm, setAutoConfirm] = useState(false)
  const [password, setPassword] = useState(DEFAULT_AUTOCONFIRM_PASSWORD)

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setFileName(file.name)
    setParseError('')
    setResult(null)

    const reader = new FileReader()
    reader.onload = (ev) => {
      try {
        const data = new Uint8Array(ev.target!.result as ArrayBuffer)
        const workbook = XLSX.read(data, { type: 'array' })
        const parsed = parseSheet(workbook, allowedRoles)
        if (parsed.length === 0) {
          setParseError('No data rows found. Check your file has the correct headers.')
          setRows([])
          return
        }
        setRows(parsed.map(r => ({ ...r, isExisting: existingEmails.has(r.email) })))
      } catch {
        setParseError('Could not read file. Make sure it is a valid .xlsx or .csv file.')
        setRows([])
      }
    }
    reader.readAsArrayBuffer(file)
    e.target.value = ''
  }

  const validRows = rows.filter(r => !r.validationError)
  const invalidRows = rows.filter(r => r.validationError)
  const newRows = validRows.filter(r => !r.isExisting)
  const updateRows = validRows.filter(r => r.isExisting)

  const handleImport = async () => {
    if (validRows.length === 0) return
    setImporting(true)
    setParseError('')

    const payload = JSON.stringify({
      users: validRows.map(r => ({
        email: r.email, full_name: r.full_name, role: r.role, grade: r.grade, section: r.section,
        admission_no: r.admission_no, roll_no: r.roll_no, date_of_birth: r.date_of_birth,
        father_name: r.father_name, mother_name: r.mother_name, guardian_name: r.guardian_name,
        phone: r.phone, nationality: r.nationality, religion: r.religion,
        category: r.category, blood_group: r.blood_group, address: r.address,
        employee_id: r.employee_id, designation: r.designation, department: r.department,
        subjects_taught: r.subjects_taught, employment_type: r.employment_type,
        date_of_joining: r.date_of_joining, date_of_retirement: r.date_of_retirement,
        date_of_confirmation: r.date_of_confirmation, cbse_reg_no: r.cbse_reg_no,
        qualification: r.qualification, ugc_net_qualified: r.ugc_net_qualified,
        teaching_diploma: r.teaching_diploma, teaching_experience_years: r.teaching_experience_years,
        gender: r.gender, alternate_phone: r.alternate_phone,
        emergency_contact_name: r.emergency_contact_name, emergency_contact: r.emergency_contact,
        emergency_contact_relation: r.emergency_contact_relation,
        aadhaar_no: r.aadhaar_no, pan_no: r.pan_no, epf_no: r.epf_no, nps_no: r.nps_no,
        bank_account_no: r.bank_account_no, bank_name: r.bank_name, ifsc_code: r.ifsc_code,
      })),
      autoConfirm,
      password: autoConfirm ? (password || DEFAULT_AUTOCONFIRM_PASSWORD) : undefined,
    })

    const send = (token: string) =>
      fetch('/api/admin/bulk-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: payload,
      })

    const { data: { session } } = await supabase.auth.getSession()
    if (!session) {
      setParseError('Your session has expired. Please sign out and sign in again, then retry.')
      setImporting(false)
      return
    }

    let res = await send(session.access_token)
    if (res.status === 401) {
      const { data: refreshed } = await supabase.auth.refreshSession()
      if (refreshed?.session) res = await send(refreshed.session.access_token)
    }

    const data = await res.json()
    setImporting(false)
    if (data.success) {
      setResult({ created: data.created, updated: data.updated, errors: data.errors, autoConfirm: !!data.autoConfirm })
      onDone()
    } else if (res.status === 401) {
      setParseError('Your session has expired. Please sign out and sign in again, then retry.')
    } else {
      setParseError(data.error || 'Import failed')
    }
  }

  const downloadTemplate = () => {
    if (mode === 'student') {
      const headers = [
        'Email Address', 'Full Name', 'Role', 'Grade', 'Section',
        'Admission No', 'Roll No', 'Date of Birth', "Father's Name", "Mother's Name",
        "Guardian's Name", 'Phone', 'Nationality', 'Religion', 'Category', 'Blood Group', 'Address',
      ]
      const row = [
        'student@example.com', 'Jane Doe', 'student', 'Grade 5', 'A',
        'ADM-2024-001', '21', '2010-08-15', 'Mr. Doe', 'Mrs. Doe',
        '', '9876543210', 'Indian', 'Hindu', 'General', 'O+', '123 Main Street, City',
      ]
      const ws = XLSX.utils.aoa_to_sheet([headers, row])
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, 'Students')
      XLSX.writeFile(wb, 'student-import-template.xlsx')
    } else if (mode === 'staff') {
      const headers = [
        'Email Address', 'Full Name', 'Role',
        'Employee ID', 'Designation', 'Department', 'Subjects Taught', 'Employment Type',
        'Date of Joining', 'Date of Confirmation', 'Date of Retirement', 'CBSE Reg No',
        'Qualification', 'Teaching Diploma', 'UGC Net', 'Teaching Experience',
        'Date of Birth', 'Gender', 'Nationality', 'Religion', 'Category', 'Marital Status',
        'Blood Group', 'Phone', 'Alternate Phone',
        'Emergency Contact Name', 'Emergency Contact', 'Emergency Contact Relation',
        'Address', 'Aadhaar No', 'PAN No', 'EPF No', 'NPS No',
        'Bank Account No', 'Bank Name', 'IFSC Code',
      ]
      const row = [
        'teacher@example.com', 'Mr Smith', 'teacher',
        'EMP-001', 'PGT', 'Mathematics', 'Mathematics, Physics', 'Permanent',
        '2020-06-01', '2021-06-01', '', '',
        'M.Sc, B.Ed', 'B.Ed', 'Yes', '5',
        '1985-04-12', 'Male', 'Indian', 'Hindu', 'General', 'Married',
        'O+', '9876543210', '',
        'Spouse Name', '9876543211', 'Spouse',
        '123 Street, City – 600001', '', 'ABCDE1234F', '', '',
        '', 'SBI – Main Branch', 'SBIN0001234',
      ]
      const ws = XLSX.utils.aoa_to_sheet([headers, row])
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, 'Staff')
      XLSX.writeFile(wb, 'staff-import-template.xlsx')
    } else {
      const headers = [
        'Email Address', 'Full Name', 'Role', 'Grade', 'Section',
        'Admission No', 'Roll No', 'Date of Birth', "Father's Name", "Mother's Name",
        "Guardian's Name", 'Phone', 'Nationality', 'Religion', 'Category', 'Blood Group', 'Address',
        'Employee ID', 'Designation', 'Department', 'Date of Joining', 'Qualification',
      ]
      const studentRow = [
        'student@example.com', 'Jane Doe', 'student', 'Grade 5', 'A',
        'ADM-2024-001', '21', '2010-08-15', 'Mr. Doe', 'Mrs. Doe',
        '', '9876543210', 'Indian', 'Hindu', 'General', 'O+', '123 Main Street, City',
        '', '', '', '', '',
      ]
      const teacherRow = [
        'teacher@example.com', 'Mr Smith', 'teacher', '', '',
        '', '', '', '', '', '', '9123456780', '', '', '', '', '',
        'EMP-001', 'PGT', 'Mathematics', '2020-06-01', 'M.Sc, B.Ed',
      ]
      const ws = XLSX.utils.aoa_to_sheet([headers, studentRow, teacherRow])
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, 'Users')
      XLSX.writeFile(wb, 'bulk-import-template.xlsx')
    }
  }

  const modeLabel = mode === 'student' ? 'Students' : mode === 'staff' ? 'Staff' : 'Users'

  const modal = (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60" onClick={onClose}>
        <motion.div
          initial={{ scale: 0.97, opacity: 0, y: 8 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.97, opacity: 0, y: 8 }}
          transition={{ type: 'spring', stiffness: 400, damping: 30 }}
          onClick={e => e.stopPropagation()}
          className="bg-white w-full max-w-2xl max-h-[85vh] flex flex-col shadow-2xl rounded-2xl overflow-hidden"
        >
          {/* Header */}
          <div className="bg-[#27272A] px-6 py-4 flex items-center justify-between flex-shrink-0">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-white/10 rounded-lg">
                <FileSpreadsheet size={18} className="text-white" />
              </div>
              <div>
                <h2 className="font-semibold text-white text-base">Import {modeLabel}</h2>
                <p className="text-xs text-[#A1A1AA]">Upload an Excel or CSV file to create or update {modeLabel.toLowerCase()}</p>
              </div>
            </div>
            <button onClick={onClose} className="p-1.5 bg-white/10 hover:bg-white/20 rounded-lg transition-colors">
              <X size={16} className="text-white" />
            </button>
          </div>

          {/* Body */}
          <div className="overflow-y-auto flex-1 p-5 space-y-4" style={{ backgroundColor: '#FDFCF9' }}>

            {/* Result banner */}
            {result && (
              <div className="bg-white border border-[#E4E4E7] rounded-xl p-4 space-y-1">
                <div className="flex items-center gap-2 text-[#18181B] font-semibold text-sm">
                  <CheckCircle2 size={16} className="text-emerald-600 flex-shrink-0" />
                  Import complete
                </div>
                <p className="text-sm text-[#52525B]">
                  {result.created} account{result.created !== 1 ? 's' : ''} created{' '}
                  {result.autoConfirm ? '(auto-confirmed)' : '(invite sent)'}&nbsp;·&nbsp;{result.updated} updated
                </p>
                {result.autoConfirm && result.created > 0 && (
                  <p className="text-xs text-[#71717A]">
                    New members can sign in with password{' '}
                    <span className="font-mono font-semibold text-[#18181B]">{password || DEFAULT_AUTOCONFIRM_PASSWORD}</span>
                  </p>
                )}
                {result.errors.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {result.errors.map(e => (
                      <p key={e.email} className="text-xs text-rose-600 flex items-center gap-1">
                        <AlertCircle size={11} /> {e.email}: {e.error}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Upload area + options */}
            {!result && (
              <>
                <div
                  className="border-2 border-dashed border-[#D4D4D8] hover:border-[#71717A] rounded-xl p-6 text-center cursor-pointer transition-colors bg-white"
                  onClick={() => fileRef.current?.click()}
                >
                  <div className="w-10 h-10 border border-[#E4E4E7] bg-[#F5F5F5] rounded-xl flex items-center justify-center mx-auto mb-3">
                    <Upload size={18} className="text-[#71717A]" />
                  </div>
                  {fileName ? (
                    <p className="text-sm font-medium text-[#18181B]">{fileName}</p>
                  ) : (
                    <>
                      <p className="text-sm font-medium text-[#27272A]">Click to upload .xlsx or .csv</p>
                      <p className="text-xs text-[#A1A1AA] mt-1">Required columns: Email Address, Full Name, Role</p>
                    </>
                  )}
                  <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="sr-only" onChange={handleFile} />
                </div>

                <button
                  type="button"
                  onClick={downloadTemplate}
                  className="flex items-center gap-1.5 text-xs text-[#71717A] hover:text-[#18181B] font-medium transition-colors"
                >
                  <Download size={12} /> Download {mode ? `${mode} ` : ''}template
                </button>

                {/* Auto-confirm */}
                <div className="border border-[#E4E4E7] bg-white rounded-xl p-3.5 space-y-3">
                  <label className="flex items-start gap-2.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={autoConfirm}
                      onChange={e => setAutoConfirm(e.target.checked)}
                      className="mt-0.5 h-4 w-4 border-[#D4D4D8] accent-[#27272A]"
                    />
                    <span className="text-sm">
                      <span className="font-medium text-[#18181B]">Auto-confirm new members</span>
                      <span className="block text-xs text-[#71717A] mt-0.5">
                        Skip invite emails — create accounts with a shared password so members can sign in immediately.
                      </span>
                    </span>
                  </label>

                  {autoConfirm && (
                    <div className="pl-7">
                      <label className="block text-[10px] font-bold uppercase tracking-widest text-[#525252] mb-1">Default password</label>
                      <input
                        type="text"
                        value={password}
                        onChange={e => setPassword(e.target.value)}
                        placeholder={DEFAULT_AUTOCONFIRM_PASSWORD}
                        className="w-full max-w-xs border border-[#D4D4D8] bg-[#F5F5F5] px-3 py-1.5 text-sm font-mono focus:border-[#27272A] outline-none transition-colors rounded-lg"
                      />
                      <p className="text-[11px] text-[#A1A1AA] mt-1">
                        Applied to every new account. Must meet your Supabase minimum password length.
                      </p>
                    </div>
                  )}
                </div>

                {parseError && (
                  <p className="text-xs text-rose-600 flex items-center gap-1.5">
                    <AlertCircle size={13} /> {parseError}
                  </p>
                )}
              </>
            )}

            {/* Preview table */}
            {rows.length > 0 && !result && (
              <div className="space-y-2">
                <div className="flex flex-wrap gap-2 text-xs">
                  {newRows.length > 0 && (
                    <span className="px-2.5 py-1 bg-white border border-[#E4E4E7] text-[#52525B] font-medium rounded-lg">
                      {newRows.length} new · {autoConfirm ? 'auto-confirm' : 'invite email'}
                    </span>
                  )}
                  {updateRows.length > 0 && (
                    <span className="px-2.5 py-1 bg-white border border-[#E4E4E7] text-[#52525B] font-medium rounded-lg">
                      {updateRows.length} existing · update only
                    </span>
                  )}
                  {invalidRows.length > 0 && (
                    <span className="px-2.5 py-1 bg-rose-50 border border-rose-200 text-rose-700 font-medium rounded-lg">
                      {invalidRows.length} invalid · skipped
                    </span>
                  )}
                </div>

                <div className="border border-[#E4E4E7] overflow-hidden rounded-xl">
                  <div className="max-h-64 overflow-y-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-[#27272A] sticky top-0">
                        <tr>
                          <th className="text-left px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-[#A1A1AA]">Email</th>
                          <th className="text-left px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-[#A1A1AA]">Name</th>
                          <th className="text-left px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-[#A1A1AA]">Role</th>
                          <th className="text-left px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-[#A1A1AA]">Grade/Sec</th>
                          <th className="text-left px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-[#A1A1AA]">Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((r, i) => (
                          <tr
                            key={i}
                            className={`border-t border-[#F4F4F5] ${
                              r.validationError ? 'bg-rose-50/60' : r.isExisting ? 'bg-[#F5F5F5]/60' : 'bg-white'
                            }`}
                          >
                            <td className="px-3 py-2 truncate max-w-[160px] font-mono text-[#52525B]">{r.email}</td>
                            <td className="px-3 py-2 truncate max-w-[120px] text-[#52525B]">{r.full_name}</td>
                            <td className="px-3 py-2 capitalize text-[#52525B]">{r.role}</td>
                            <td className="px-3 py-2 text-[#71717A]">
                              {r.role === 'student' ? [r.grade ? `G${r.grade}` : '', r.section ? `S${r.section}` : ''].filter(Boolean).join(' / ') || '—' : '—'}
                            </td>
                            <td className="px-3 py-2">
                              {r.validationError ? (
                                <span className="text-rose-600 flex items-center gap-1"><AlertCircle size={11} />{r.validationError}</span>
                              ) : r.isExisting ? (
                                <span className="text-[#71717A] font-medium flex items-center gap-1"><RefreshCw size={10} />Update</span>
                              ) : (
                                <span className="text-[#525252] font-medium flex items-center gap-1"><Check size={10} />{autoConfirm ? 'Create' : 'Invite'}</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between px-5 py-4 border-t border-[#E4E4E7] bg-white flex-shrink-0">
            <button
              onClick={onClose}
              className="text-sm text-[#71717A] hover:text-[#18181B] px-3 py-1.5 hover:bg-[#F5F5F5] rounded-lg transition-colors"
            >
              {result ? 'Close' : 'Cancel'}
            </button>
            {!result && (
              <button
                onClick={handleImport}
                disabled={validRows.length === 0 || importing}
                className="flex items-center gap-2 px-5 py-2.5 bg-[#27272A] hover:bg-[#18181B] text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
              >
                {importing && <RefreshCw size={14} className="animate-spin" />}
                {importing ? 'Importing…' : `Import ${validRows.length} ${validRows.length === 1 ? modeLabel.slice(0,-1) : modeLabel}`}
              </button>
            )}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  )

  return typeof document !== 'undefined' ? createPortal(modal, document.body) : null
}
