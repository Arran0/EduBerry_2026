'use client'

import React, { useEffect, useState } from 'react'
import ProtectedLayout from '@/components/ProtectedLayout'
import { useRouter } from 'next/navigation'
import {
  FileBadge, BadgeCheck, GraduationCap, CheckCircle2, ArrowUpCircle, Wand2,
  FileQuestion, X, Loader2, ChevronLeft, Download, Check,
  ExternalLink, User, AlertTriangle,
} from 'lucide-react'
import SmartTypeahead from '@/components/SmartTypeahead'
import type { LucideIcon } from 'lucide-react'
import {
  CERT_TYPES, CERT_TYPE_BY_KEY, CertType, CertificateTemplate,
  fetchTemplates, fetchCertificatesForStudent, CertificateRecord,
} from '@/lib/certificates'
import { listAcademicYears, currentAcademicYear, fetchFeesForStudent, SchoolFee } from '@/lib/fees'
import { hasNoDue } from '@/components/fees/statements/generate'
import { downloadCertificate } from '@/components/certificates/generate'
import { fetchAllProfiles, ProfileWithTeams } from '@/lib/admin'

const SHOWN_TYPES: CertType[] = ['transfer', 'bonafide', 'study', 'no_due', 'promotion', 'custom']

const ICONS: Record<string, LucideIcon> = {
  FileBadge, BadgeCheck, GraduationCap, CheckCircle2, ArrowUpCircle, Wand2,
}

// Admin-space aesthetic: sharp corners, #27272A dark accents, #B8983C gold.
const inputCls = 'border border-[#D4D4D8] bg-white px-3 py-2 text-sm focus:outline-none focus:border-[#27272A] transition-colors w-full'
const labelCls = 'block text-[10px] font-bold uppercase tracking-widest text-[#525252] mb-1.5'

function CertStudentTypeahead({ query, onQueryChange, matches, onSelect }: {
  query: string
  onQueryChange: (v: string) => void
  matches: ProfileWithTeams[]
  onSelect: (s: ProfileWithTeams) => void
}) {
  return (
    <SmartTypeahead
      query={query}
      onQueryChange={onQueryChange}
      suggestions={matches}
      onSelect={onSelect}
      getKey={(s: ProfileWithTeams) => s.id}
      placeholder="Search a student by name, email, or grade..."
      className="flex items-center gap-2.5 border border-[#D4D4D8] bg-white px-3 py-2.5 focus-within:border-[#27272A] transition-colors"
      renderSuggestion={(s: ProfileWithTeams, active: boolean) => (
        <div className={`px-4 py-2.5 transition-colors border-b border-[#F4F4F5] last:border-b-0 ${active ? 'bg-[#F4F4F5]' : 'hover:bg-[#F4F4F5]'}`}>
          <p className="text-sm font-semibold text-[#18181B] truncate">{s.full_name || '(no name)'}</p>
          <p className="text-xs text-[#71717A] truncate">
            {s.email}{s.grade ? ` - Grade ${s.grade}${s.section ? `-${s.section}` : ''}` : ''}
          </p>
        </div>
      )}
    />
  )
}

export default function CertificateBuilderPage() {
  const router = useRouter()
  const [students, setStudents] = useState<ProfileWithTeams[]>([])
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

  // No-Due gating — mirrors the fee page: if any fee is unpaid/partial the
  // No-Due certificate cannot be issued.
  const [fees, setFees] = useState<SchoolFee[] | null>(null)
  const [feesLoading, setFeesLoading] = useState(false)

  useEffect(() => {
    fetchAllProfiles().then(ps => setStudents(ps.filter(p => p.role === 'student')))
    listAcademicYears().then(setYears)
    fetchTemplates().then(setTemplates)
  }, [])

  useEffect(() => {
    if (selectedStudent) fetchCertificatesForStudent(selectedStudent.id).then(setRecent)
  }, [selectedStudent])

  // Load fees whenever No-Due is the active type (used to enable/disable issue).
  useEffect(() => {
    if (selectedType !== 'no_due' || !selectedStudent) { setFees(null); return }
    setFeesLoading(true)
    fetchFeesForStudent(selectedStudent.id, year).then(f => { setFees(f); setFeesLoading(false) })
  }, [selectedType, selectedStudent, year])

  const matches = query.trim()
    ? students.filter(s => {
        const q = query.toLowerCase()
        return (
          s.full_name?.toLowerCase().includes(q) ||
          s.email?.toLowerCase().includes(q) ||
          (s.grade ? `grade ${s.grade}`.includes(q) || String(s.grade) === q : false) ||
          s.section?.toLowerCase() === q
        )
      }).slice(0, 5)
    : []

  const filteredCertTypes = CERT_TYPES.filter(c => SHOWN_TYPES.includes(c.type))
  const meta = selectedType ? CERT_TYPE_BY_KEY[selectedType] : null

  const noDueClear = fees !== null && hasNoDue(fees)
  const noDueBlocked = selectedType === 'no_due' && !feesLoading && fees !== null && !noDueClear

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
    if (noDueBlocked) { setError('This student has outstanding dues — the No-Due certificate cannot be issued.'); return }
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
      <div className="w-full px-4 sm:px-6 lg:px-8 py-8 min-h-screen" data-page-theme="admin" style={{ backgroundColor: '#FDFCF9' }}>

        {/* Header — admin-space pattern */}
        <div className="mb-5 flex items-center justify-between flex-wrap gap-3 max-w-5xl mx-auto">
          <div className="flex items-center gap-3">
            <button onClick={() => router.back()} className="w-9 h-9 bg-white border border-[#D4D4D8] flex items-center justify-center hover:bg-[#F4F4F5] transition-colors">
              <ChevronLeft size={18} className="text-[#18181B]" />
            </button>
            <div className="w-9 h-9 bg-[#27272A] flex items-center justify-center flex-shrink-0">
              <FileBadge className="text-[#B8983C]" size={18} />
            </div>
            <div>
              <h1 className="text-xl font-bold text-[#18181B]">Certificate Builder</h1>
              <p className="text-xs text-[#71717A]">Issue TC, Bonafide, Study, No-Due, Promotion &amp; custom certificates</p>
            </div>
          </div>
          <a href="/more/profiles/templates"
            className="flex items-center gap-2 px-4 py-2.5 bg-white border border-[#D4D4D8] hover:bg-[#F4F4F5] text-[#18181B] text-sm font-medium transition-colors">
            <Wand2 size={14} /> Manage Templates
          </a>
        </div>

        <div className="max-w-5xl mx-auto border border-[#D4D4D8] bg-white">
          {/* Smart search bar */}
          <div className="border-b border-[#E4E4E7] p-5 bg-[#F5F5F5]">
            {selectedStudent ? (
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 bg-[#27272A] flex items-center justify-center flex-shrink-0">
                  <User size={16} className="text-[#B8983C]" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-[#18181B] truncate">{selectedStudent.full_name || selectedStudent.email}</p>
                  <p className="text-xs text-[#71717A] truncate">
                    {selectedStudent.email}
                    {selectedStudent.grade ? ` · Grade ${selectedStudent.grade}${selectedStudent.section ? `-${selectedStudent.section}` : ''}` : ''}
                  </p>
                </div>
                <button
                  onClick={() => { setSelectedStudent(null); setSelectedType(null); setIssuedNo(null) }}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-white border border-[#D4D4D8] hover:bg-[#F4F4F5] transition-colors text-[#18181B]"
                >
                  <X size={13} /> Change
                </button>
              </div>
            ) : (
              <CertStudentTypeahead
                query={query}
                onQueryChange={setQuery}
                matches={matches}
                onSelect={selectStudent}
              />
            )}
          </div>

          {/* Body */}
          <div className="p-5 sm:p-6">
            {!selectedStudent ? (
              <div className="flex items-center justify-center h-52 text-center">
                <div>
                  <FileBadge size={32} className="text-[#D4D4D8] mx-auto mb-2" />
                  <p className="text-sm text-[#71717A]">Search and select a student to begin.</p>
                </div>
              </div>
            ) : issuedNo ? (
              <div className="text-center py-10">
                <div className="w-14 h-14 bg-[#27272A] flex items-center justify-center mx-auto mb-4">
                  <Check size={28} className="text-[#B8983C]" />
                </div>
                <h3 className="font-bold text-lg text-[#18181B] mb-1">Certificate Issued</h3>
                <p className="text-sm text-[#71717A]">The PDF has been downloaded.</p>
                <p className="text-xs text-[#71717A] mt-2">
                  No: <span className="font-mono font-semibold text-[#18181B]">{issuedNo}</span>
                </p>
                <div className="flex gap-3 justify-center mt-5">
                  <a href={`/verify/${encodeURIComponent(issuedNo)}`} target="_blank" rel="noreferrer"
                    className="flex items-center gap-1.5 px-4 py-2 border border-[#D4D4D8] text-sm font-medium hover:bg-[#F4F4F5] transition-colors text-[#18181B]">
                    Verify <ExternalLink size={13} />
                  </a>
                  <button onClick={() => { setSelectedType(null); setIssuedNo(null) }}
                    className="px-4 py-2 bg-[#27272A] hover:bg-[#18181B] text-[#F5F5F5] text-sm font-medium transition-colors">
                    Another Certificate
                  </button>
                </div>
              </div>
            ) : !selectedType ? (
              <div className="space-y-5">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {filteredCertTypes.map(c => {
                    const Icon = ICONS[c.icon] ?? FileQuestion
                    return (
                      <button key={c.type} onClick={() => pickType(c.type)}
                        className="flex items-start gap-3 p-3.5 bg-[#F5F5F5] border border-[#E4E4E7] text-left hover:border-[#27272A] hover:bg-white transition-all">
                        <div className="w-9 h-9 bg-[#27272A] flex items-center justify-center flex-shrink-0">
                          <Icon size={17} className="text-[#B8983C]" />
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
                    <div className="space-y-px border border-[#E4E4E7]">
                      {recent.slice(0, 5).map(r => (
                        <div key={r.id} className="flex items-center justify-between gap-2 bg-[#F5F5F5] px-3 py-2">
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
              </div>
            ) : (
              <div className="space-y-4 max-w-xl">
                <div className="flex items-center gap-2">
                  <button onClick={() => { setSelectedType(null); setError(null) }}
                    className="p-1.5 bg-[#F4F4F5] hover:bg-[#E4E4E7] transition-colors">
                    <ChevronLeft size={16} className="text-[#27272A]" />
                  </button>
                  <span className="text-sm font-bold text-[#18181B]">{meta?.label}</span>
                </div>

                {error && (
                  <div className="bg-rose-50 border border-rose-200 text-rose-700 px-4 py-3 text-sm">{error}</div>
                )}

                {/* No-Due gate */}
                {selectedType === 'no_due' && (
                  feesLoading ? (
                    <div className="flex items-center gap-2 text-sm text-[#71717A] px-4 py-3 bg-[#F5F5F5] border border-[#E4E4E7]">
                      <Loader2 size={14} className="animate-spin" /> Checking dues…
                    </div>
                  ) : noDueBlocked ? (
                    <div className="flex items-start gap-2.5 bg-amber-50 border border-amber-200 text-amber-800 px-4 py-3 text-sm">
                      <AlertTriangle size={16} className="flex-shrink-0 mt-0.5" />
                      <span>Outstanding dues for {year}. A No-Due certificate can only be issued once all fees are cleared.</span>
                    </div>
                  ) : (
                    <div className="flex items-start gap-2.5 bg-emerald-50 border border-emerald-200 text-emerald-800 px-4 py-3 text-sm">
                      <CheckCircle2 size={16} className="flex-shrink-0 mt-0.5" />
                      <span>All dues cleared for {year} — the No-Due certificate is available.</span>
                    </div>
                  )
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

                <button onClick={handleGenerate} disabled={generating || noDueBlocked || feesLoading}
                  className="w-full mt-2 px-4 py-2.5 bg-[#27272A] hover:bg-[#18181B] text-[#F5F5F5] text-sm font-medium transition-colors flex items-center justify-center gap-2 disabled:opacity-50">
                  {generating
                    ? <><Loader2 size={16} className="animate-spin" /> Generating…</>
                    : <><Download size={16} /> Generate &amp; Download</>
                  }
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </ProtectedLayout>
  )
}
