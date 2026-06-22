'use client'

import React, { useEffect, useState } from 'react'
import ProtectedLayout from '@/components/ProtectedLayout'
import { useRouter } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import {
  FileBadge, BadgeCheck, GraduationCap, CheckCircle2, ArrowUpCircle, Wand2,
  FileQuestion, Search, X, ArrowLeft, Loader2, ChevronLeft,
  Download, Check, ExternalLink, User,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import {
  CERT_TYPES, CERT_TYPE_BY_KEY, CertType, CertificateTemplate,
  fetchTemplates, fetchCertificatesForStudent, CertificateRecord,
} from '@/lib/certificates'
import { listAcademicYears, currentAcademicYear } from '@/lib/fees'
import { downloadCertificate } from '@/components/certificates/generate'
import { fetchAllProfiles, ProfileWithTeams } from '@/lib/admin'

const SHOWN_TYPES: CertType[] = ['transfer', 'bonafide', 'study', 'no_due', 'promotion', 'custom']

const ICONS: Record<string, LucideIcon> = {
  FileBadge, BadgeCheck, GraduationCap, CheckCircle2, ArrowUpCircle, Wand2,
}

const inputCls = 'border border-[#D4D4D8] bg-white px-3 py-2 text-sm focus:outline-none focus:border-[#27272A] transition-colors w-full rounded-lg'
const labelCls = 'block text-[10px] font-bold uppercase tracking-widest text-[#525252] mb-1.5'

export default function CertificateBuilderPage() {
  const router = useRouter()
  const [students, setStudents] = useState<ProfileWithTeams[]>([])
  const [loadingStudents, setLoadingStudents] = useState(true)
  const [query, setQuery] = useState('')
  const [selectedStudent, setSelectedStudent] = useState<ProfileWithTeams | null>(null)
  const [selectedType, setSelectedType] = useState<CertType | null>(null)
  const [extra, setExtra] = useState<Record<string, string>>({})
  const [year, setYear] = useState(currentAcademicYear())
  const [years, setYears] = useState<string[]>([currentAcademicYear()])
  const [templates, setTemplates] = useState<CertificateTemplate[]>([])
  const [templateId, setTemplateId] = useState('')
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [issuedNo, setIssuedNo] = useState<string | null>(null)
  const [recent, setRecent] = useState<CertificateRecord[]>([])

  useEffect(() => {
    fetchAllProfiles().then(ps => {
      setStudents(ps.filter(p => p.role === 'student'))
      setLoadingStudents(false)
    })
    listAcademicYears().then(setYears)
    fetchTemplates().then(setTemplates)
  }, [])

  useEffect(() => {
    if (selectedStudent) fetchCertificatesForStudent(selectedStudent.id).then(setRecent)
  }, [selectedStudent])

  const filteredStudents = students.filter(s => {
    if (!query.trim()) return true
    const q = query.toLowerCase()
    return (
      s.full_name?.toLowerCase().includes(q) ||
      s.email?.toLowerCase().includes(q) ||
      (s.grade ? String(s.grade).includes(q) || `grade ${s.grade}`.includes(q) : false) ||
      s.section?.toLowerCase().includes(q)
    )
  })

  const filteredCertTypes = CERT_TYPES.filter(c => SHOWN_TYPES.includes(c.type))
  const meta = selectedType ? CERT_TYPE_BY_KEY[selectedType] : null

  function selectStudent(s: ProfileWithTeams) {
    setSelectedStudent(s)
    setSelectedType(null)
    setExtra({})
    setError(null)
    setIssuedNo(null)
    setQuery('')
  }

  function pickType(type: CertType) {
    setSelectedType(type)
    setExtra({})
    setError(null)
    setIssuedNo(null)
  }

  async function handleGenerate() {
    if (!selectedType || !selectedStudent) return
    const template = selectedType === 'custom' ? templates.find(t => t.id === templateId) : undefined
    if (selectedType === 'custom' && !template) { setError('Please select a template.'); return }
    setGenerating(true); setError(null)
    const certNo = await downloadCertificate(selectedType, selectedStudent.id, { academicYear: year, extra }, template)
    setGenerating(false)
    if (!certNo) { setError('Could not generate the certificate. Please try again.'); return }
    setIssuedNo(certNo)
    fetchCertificatesForStudent(selectedStudent.id).then(setRecent)
  }

  return (
    <ProtectedLayout adminOnly>
      <div data-page-theme="admin" style={{ backgroundColor: '#FDFCF9', minHeight: '100vh' }} className="px-4 sm:px-6 lg:px-8 py-8">
        <div className="max-w-6xl mx-auto">
          {/* Header */}
          <div className="flex items-center gap-3 mb-6">
            <button onClick={() => router.back()} className="p-2 bg-white border border-[#D4D4D8] rounded-lg hover:bg-[#F4F4F5] transition-colors">
              <ArrowLeft size={16} className="text-[#18181B]" />
            </button>
            <div className="w-9 h-9 bg-[#27272A] flex items-center justify-center rounded-lg flex-shrink-0">
              <FileBadge size={18} className="text-[#B8983C]" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-[#18181B]">Certificate Builder</h1>
              <p className="text-xs text-[#71717A]">Issue TC, Bonafide, Study, No-Due, Promotion &amp; Custom certificates</p>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-5 items-start">
            {/* Left — student search panel */}
            <div className="space-y-3">
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#71717A] pointer-events-none" />
                <input
                  type="text"
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder="Search by name, email, grade…"
                  className="w-full border border-[#D4D4D8] bg-white pl-9 pr-9 py-2.5 text-sm focus:outline-none focus:border-[#27272A] transition-colors rounded-xl"
                />
                {query && (
                  <button onClick={() => setQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#71717A] hover:text-[#27272A]">
                    <X size={14} />
                  </button>
                )}
              </div>

              {selectedStudent && (
                <div className="flex items-center gap-2 px-3 py-2 bg-[#27272A] text-white rounded-xl text-sm">
                  <User size={14} className="flex-shrink-0" />
                  <span className="font-medium truncate flex-1">{selectedStudent.full_name || selectedStudent.email}</span>
                  <button onClick={() => { setSelectedStudent(null); setSelectedType(null); setIssuedNo(null) }} className="flex-shrink-0 hover:text-white/70">
                    <X size={14} />
                  </button>
                </div>
              )}

              <div className="bg-white border border-[#E4E4E7] rounded-xl overflow-hidden">
                {loadingStudents ? (
                  <div className="flex items-center justify-center py-10 gap-2 text-sm text-[#71717A]">
                    <Loader2 size={14} className="animate-spin" /> Loading…
                  </div>
                ) : filteredStudents.length === 0 ? (
                  <p className="text-xs text-[#A1A1AA] text-center py-8">No students found.</p>
                ) : (
                  <div className="divide-y divide-[#F4F4F5] max-h-[65vh] overflow-y-auto">
                    {filteredStudents.map(s => (
                      <button
                        key={s.id}
                        onClick={() => selectStudent(s)}
                        className={`w-full text-left px-4 py-3 transition-colors hover:bg-[#FAFAFA] ${selectedStudent?.id === s.id ? 'bg-[#F4F4F5] border-l-2 border-l-[#27272A]' : 'border-l-2 border-l-transparent'}`}
                      >
                        <p className="text-sm font-semibold text-[#18181B] truncate">{s.full_name || '(no name)'}</p>
                        <p className="text-xs text-[#71717A] truncate">
                          {s.email}
                          {s.grade ? ` · Grade ${s.grade}${s.section ? `-${s.section}` : ''}` : ''}
                        </p>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Right — cert form */}
            <AnimatePresence mode="wait">
              {!selectedStudent ? (
                <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                  className="bg-white border border-[#E4E4E7] rounded-xl flex items-center justify-center h-52">
                  <div className="text-center">
                    <FileBadge size={32} className="text-[#D4D4D8] mx-auto mb-2" />
                    <p className="text-sm text-[#71717A]">Select a student from the left to get started</p>
                  </div>
                </motion.div>
              ) : issuedNo ? (
                <motion.div key="issued" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                  className="bg-white border border-[#E4E4E7] rounded-xl p-8 text-center">
                  <div className="w-14 h-14 bg-[#27272A] rounded-2xl flex items-center justify-center mx-auto mb-4">
                    <Check size={28} className="text-white" />
                  </div>
                  <h3 className="font-bold text-lg text-[#18181B] mb-1">Certificate Issued</h3>
                  <p className="text-sm text-[#71717A]">The PDF has been downloaded.</p>
                  <p className="text-xs text-[#71717A] mt-2">
                    No: <span className="font-mono font-semibold text-[#18181B]">{issuedNo}</span>
                  </p>
                  <div className="flex gap-3 justify-center mt-5">
                    <a href={`/verify/${encodeURIComponent(issuedNo)}`} target="_blank" rel="noreferrer"
                      className="flex items-center gap-1.5 px-4 py-2 border border-[#D4D4D8] text-sm font-medium rounded-lg hover:bg-[#F4F4F5] transition-colors">
                      Verify <ExternalLink size={13} />
                    </a>
                    <button onClick={() => { setSelectedType(null); setIssuedNo(null) }}
                      className="px-4 py-2 bg-[#27272A] hover:bg-[#18181B] text-white text-sm font-medium rounded-lg transition-colors">
                      Another Certificate
                    </button>
                  </div>
                </motion.div>
              ) : !selectedType ? (
                <motion.div key="type-picker" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                  className="space-y-4">
                  {/* Student info bar */}
                  <div className="bg-white border border-[#E4E4E7] rounded-xl px-5 py-3.5 flex items-center gap-3">
                    <div className="w-9 h-9 bg-[#F4F4F5] rounded-full flex items-center justify-center flex-shrink-0">
                      <User size={16} className="text-[#71717A]" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-[#18181B]">{selectedStudent.full_name || selectedStudent.email}</p>
                      {selectedStudent.grade && (
                        <p className="text-xs text-[#71717A]">
                          Grade {selectedStudent.grade}{selectedStudent.section ? ` · Section ${selectedStudent.section}` : ''}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {filteredCertTypes.map(c => {
                      const Icon = ICONS[c.icon] ?? FileQuestion
                      return (
                        <button key={c.type} onClick={() => pickType(c.type)}
                          className="flex items-start gap-3 p-3.5 bg-white border border-[#E4E4E7] rounded-xl text-left hover:border-[#27272A] hover:shadow-sm transition-all">
                          <div className="p-2 bg-[#F4F4F5] rounded-lg flex-shrink-0">
                            <Icon size={18} className="text-[#27272A]" />
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-[#18181B]">{c.label}</p>
                            <p className="text-xs text-[#71717A] mt-0.5">{c.description}</p>
                          </div>
                        </button>
                      )
                    })}
                  </div>

                  {recent.length > 0 && (
                    <div>
                      <p className={labelCls}>Recently Issued</p>
                      <div className="space-y-1.5">
                        {recent.slice(0, 5).map(r => (
                          <div key={r.id} className="flex items-center justify-between gap-2 bg-white border border-[#E4E4E7] rounded-lg px-3 py-2">
                            <div className="min-w-0">
                              <p className="text-xs font-semibold text-[#18181B] truncate">
                                {CERT_TYPE_BY_KEY[r.cert_type as CertType]?.label ?? r.cert_type}
                                {r.status === 'revoked' && <span className="ml-2 text-rose-600">(Revoked)</span>}
                              </p>
                              <p className="text-[11px] text-[#71717A] font-mono truncate">{r.certificate_no}</p>
                            </div>
                            <a href={`/verify/${encodeURIComponent(r.certificate_no)}`} target="_blank" rel="noreferrer"
                              className="flex items-center gap-1 text-[11px] text-[#27272A] hover:underline flex-shrink-0">
                              Verify <ExternalLink size={11} />
                            </a>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </motion.div>
              ) : (
                <motion.div key="form" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                  className="bg-white border border-[#E4E4E7] rounded-xl p-5 space-y-4">
                  <div className="flex items-center gap-2">
                    <button onClick={() => { setSelectedType(null); setError(null) }}
                      className="p-1.5 bg-[#F4F4F5] hover:bg-[#E4E4E7] rounded-lg transition-colors">
                      <ChevronLeft size={16} className="text-[#27272A]" />
                    </button>
                    <span className="text-sm font-semibold text-[#18181B]">{meta?.label}</span>
                    <span className="text-xs text-[#71717A]">· {selectedStudent.full_name || selectedStudent.email}</span>
                  </div>

                  {error && (
                    <div className="bg-rose-50 border border-rose-200 text-rose-700 px-4 py-3 text-sm rounded-lg">{error}</div>
                  )}

                  <div>
                    <label className={labelCls}>Academic Year</label>
                    <select value={year} onChange={e => setYear(e.target.value)} className={inputCls}>
                      {years.map(y => <option key={y} value={y}>{y}</option>)}
                    </select>
                  </div>

                  {selectedType === 'custom' && (
                    <div>
                      <label className={labelCls}>Template</label>
                      {templates.length === 0 ? (
                        <p className="text-xs text-[#71717A]">
                          No templates yet. Create one in the{' '}
                          <a href="/more/profiles/templates" className="text-[#27272A] underline">Template Manager</a>.
                        </p>
                      ) : (
                        <select value={templateId} onChange={e => setTemplateId(e.target.value)} className={inputCls}>
                          <option value="">Select a template…</option>
                          {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                        </select>
                      )}
                    </div>
                  )}

                  {meta?.inputs.map(f => (
                    <div key={f.key}>
                      <label className={labelCls}>{f.label}</label>
                      {f.type === 'select' ? (
                        <select value={extra[f.key] ?? ''} onChange={e => setExtra(p => ({ ...p, [f.key]: e.target.value }))} className={inputCls}>
                          <option value="">Select…</option>
                          {(f.options ?? []).map(o => <option key={o} value={o}>{o}</option>)}
                        </select>
                      ) : f.type === 'textarea' ? (
                        <textarea value={extra[f.key] ?? ''} onChange={e => setExtra(p => ({ ...p, [f.key]: e.target.value }))} rows={3} placeholder={f.placeholder} className={inputCls} />
                      ) : (
                        <input type="text" value={extra[f.key] ?? ''} onChange={e => setExtra(p => ({ ...p, [f.key]: e.target.value }))} placeholder={f.placeholder} className={inputCls} />
                      )}
                    </div>
                  ))}

                  <button onClick={handleGenerate} disabled={generating}
                    className="w-full mt-2 px-4 py-2.5 bg-[#27272A] hover:bg-[#18181B] text-white text-sm font-medium rounded-lg transition-colors flex items-center justify-center gap-2 disabled:opacity-60">
                    {generating
                      ? <><Loader2 size={16} className="animate-spin" /> Generating…</>
                      : <><Download size={16} /> Generate &amp; Download</>
                    }
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </ProtectedLayout>
  )
}
