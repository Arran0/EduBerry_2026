'use client'

import React, { useState, useRef } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Upload, FileSpreadsheet, AlertCircle, CheckCircle2, RefreshCw, Download, Check } from 'lucide-react'
import * as XLSX from 'xlsx'
import { supabase } from '@/lib/supabase'
import type { UserRole } from '@/lib/supabase'

const VALID_ROLES: UserRole[] = ['student', 'teacher', 'coordinator', 'principal', 'admin']
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
  isExisting?: boolean
  validationError?: string
}

interface BulkImportModalProps {
  existingEmails: Set<string>
  onClose: () => void
  onDone: () => void
}

function parseRoleCell(raw: unknown): UserRole | null {
  if (!raw) return null
  const s = String(raw).trim().toLowerCase()
  const found = VALID_ROLES.find(r => r === s)
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

function parseSheet(workbook: XLSX.WorkBook): ParsedRow[] {
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' })

  return rows.map(row => {
    const get = (keys: string[]) => {
      for (const key of Object.keys(row)) {
        if (keys.some(k => key.trim().toLowerCase() === k.toLowerCase())) return row[key]
      }
      return ''
    }

    const email = String(get(['email', 'email address']) || '').trim().toLowerCase()
    const full_name = String(get(['full name', 'fullname', 'name']) || '').trim()
    const rawRole = get(['role'])
    const rawGrade = get(['grade'])
    const rawSection = get(['section'])

    const role = parseRoleCell(rawRole)
    const grade = parseGradeCell(rawGrade)
    const section = parseSectionCell(rawSection)

    let validationError: string | undefined
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      validationError = 'Invalid email'
    } else if (!full_name) {
      validationError = 'Missing full name'
    } else if (!role) {
      validationError = `Invalid role "${rawRole}"`
    }

    return { email, full_name, role: role ?? 'student', grade, section, validationError }
  }).filter(r => r.email || r.full_name)
}

export default function BulkImportModal({ existingEmails, onClose, onDone }: BulkImportModalProps) {
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
        const parsed = parseSheet(workbook)
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
      users: validRows.map(r => ({ email: r.email, full_name: r.full_name, role: r.role, grade: r.grade, section: r.section })),
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
    const ws = XLSX.utils.aoa_to_sheet([
      ['Email Address', 'Full Name', 'Role', 'Grade', 'Section'],
      ['student@example.com', 'Jane Doe', 'student', 'Grade 5', 'Section A'],
      ['teacher@example.com', 'Mr Smith', 'teacher', '', ''],
    ])
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Users')
    XLSX.writeFile(wb, 'bulk-import-template.xlsx')
  }

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
                <h2 className="font-semibold text-white text-base">Bulk Import Users</h2>
                <p className="text-xs text-[#A1A1AA]">Upload an Excel or CSV file to create or update users</p>
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
                  <Download size={12} /> Download template
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
                {importing ? 'Importing…' : `Import ${validRows.length} user${validRows.length !== 1 ? 's' : ''}`}
              </button>
            )}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  )

  return typeof document !== 'undefined' ? createPortal(modal, document.body) : null
}
