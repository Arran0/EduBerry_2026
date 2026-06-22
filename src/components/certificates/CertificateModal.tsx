'use client'

import React, { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import {
  X, Loader2, Download, Check, ChevronLeft, ExternalLink,
  FileBadge, BadgeCheck, GraduationCap, CheckCircle2, CalendarCheck,
  LineChart, ClipboardList, FileText, BarChart3, ArrowUpCircle, Wand2, FileQuestion,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import {
  CERT_TYPES, CERT_TYPE_BY_KEY, CertType, CertificateTemplate,
  fetchTemplates, fetchCertificatesForStudent, CertificateRecord,
} from '@/lib/certificates'
import { listAcademicYears, currentAcademicYear } from '@/lib/fees'
import { downloadCertificate } from './generate'

const ICONS: Record<string, LucideIcon> = {
  FileBadge, BadgeCheck, GraduationCap, CheckCircle2, CalendarCheck,
  LineChart, ClipboardList, FileText, BarChart3, ArrowUpCircle, Wand2,
}

const input = 'border border-[#D4D4D8] bg-white px-3 py-2 text-sm focus:outline-none focus:border-[#27272A] transition-colors w-full rounded-lg'
const labelCls = 'block text-[10px] font-bold uppercase tracking-widest text-[#525252] mb-1.5'

export default function CertificateModal({
  studentId, studentName, onClose,
}: {
  studentId: string
  studentName: string
  onClose: () => void
}) {
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
    listAcademicYears().then(setYears)
    fetchTemplates().then(setTemplates)
    fetchCertificatesForStudent(studentId).then(setRecent)
  }, [studentId])

  const meta = selectedType ? CERT_TYPE_BY_KEY[selectedType] : null

  function pick(type: CertType) {
    setSelectedType(type)
    setExtra({})
    setError(null)
    setIssuedNo(null)
  }

  async function handleGenerate() {
    if (!selectedType) return
    const template = selectedType === 'custom' ? templates.find(t => t.id === templateId) : undefined
    if (selectedType === 'custom' && !template) { setError('Please select a template.'); return }
    setGenerating(true); setError(null)
    const certNo = await downloadCertificate(selectedType, studentId, { academicYear: year, extra }, template)
    setGenerating(false)
    if (!certNo) { setError('Could not generate the certificate. Please try again.'); return }
    setIssuedNo(certNo)
    fetchCertificatesForStudent(studentId).then(setRecent)
  }

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        onClick={onClose} className="fixed inset-0 bg-black/60 z-40"
      />
      <motion.div
        initial={{ opacity: 0, scale: 0.97, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97, y: 16 }}
        transition={{ type: 'spring', stiffness: 380, damping: 30 }}
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
      >
        <div className="bg-white shadow-2xl w-full max-w-2xl flex flex-col max-h-[90vh] rounded-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
          <div className="bg-[#27272A] px-6 py-4 flex items-center justify-between flex-shrink-0">
            <div className="flex items-center gap-3">
              {meta ? (
                <button onClick={() => setSelectedType(null)} className="p-2 bg-white/10 hover:bg-white/20 rounded-lg transition-colors">
                  <ChevronLeft size={18} className="text-white" />
                </button>
              ) : (
                <div className="p-2 bg-white/10 rounded-lg"><FileBadge size={18} className="text-white" /></div>
              )}
              <div>
                <h2 className="text-lg font-bold text-white">{meta ? meta.label : 'Generate Certificate'}</h2>
                <p className="text-xs text-white/60">{studentName}</p>
              </div>
            </div>
            <button onClick={onClose} className="p-1.5 bg-white/10 hover:bg-white/20 rounded-lg transition-colors">
              <X size={18} className="text-white" />
            </button>
          </div>

          <div className="p-6 overflow-y-auto flex-1" style={{ backgroundColor: '#FDFCF9' }}>
            {!meta ? (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {CERT_TYPES.map(c => {
                    const Icon = ICONS[c.icon] ?? FileQuestion
                    return (
                      <button key={c.type} onClick={() => pick(c.type)}
                        className="flex items-start gap-3 p-3.5 bg-white border border-[#E4E4E7] rounded-xl text-left hover:border-[#27272A] hover:shadow-sm transition-all">
                        <div className="p-2 bg-[#F4F4F5] rounded-lg flex-shrink-0"><Icon size={18} className="text-[#27272A]" /></div>
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-[#18181B]">{c.label}</p>
                          <p className="text-xs text-[#71717A] mt-0.5">{c.description}</p>
                        </div>
                      </button>
                    )
                  })}
                </div>

                {recent.length > 0 && (
                  <div className="mt-6">
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
              </>
            ) : issuedNo ? (
              <div className="text-center py-8">
                <div className="w-16 h-16 bg-[#27272A] rounded-2xl flex items-center justify-center mx-auto mb-4">
                  <Check size={32} className="text-white" />
                </div>
                <h3 className="font-bold text-lg text-[#18181B] mb-1">Certificate Issued</h3>
                <p className="text-sm text-[#71717A]">The PDF has been downloaded.</p>
                <p className="text-xs text-[#71717A] mt-2">Certificate No: <span className="font-mono font-semibold text-[#18181B]">{issuedNo}</span></p>
                <div className="flex gap-3 justify-center mt-5">
                  <a href={`/verify/${encodeURIComponent(issuedNo)}`} target="_blank" rel="noreferrer"
                    className="flex items-center gap-1.5 px-4 py-2 border border-[#D4D4D8] text-sm font-medium rounded-lg hover:bg-[#F4F4F5] transition-colors">
                    Open verification <ExternalLink size={14} />
                  </a>
                  <button onClick={() => { setSelectedType(null); setIssuedNo(null) }}
                    className="px-4 py-2 bg-[#27272A] hover:bg-[#18181B] text-white text-sm font-medium rounded-lg transition-colors">
                    Done
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {error && (
                  <div className="bg-rose-50 border border-rose-200 text-rose-700 px-4 py-3 text-sm rounded-lg">{error}</div>
                )}

                <div>
                  <label className={labelCls}>Academic Year</label>
                  <select value={year} onChange={e => setYear(e.target.value)} className={input}>
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
                      <select value={templateId} onChange={e => setTemplateId(e.target.value)} className={input}>
                        <option value="">Select a template…</option>
                        {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                      </select>
                    )}
                  </div>
                )}

                {meta.inputs.map(f => (
                  <div key={f.key}>
                    <label className={labelCls}>{f.label}</label>
                    {f.type === 'select' ? (
                      <select value={extra[f.key] ?? ''} onChange={e => setExtra(p => ({ ...p, [f.key]: e.target.value }))} className={input}>
                        <option value="">Select…</option>
                        {(f.options ?? []).map(o => <option key={o} value={o}>{o}</option>)}
                      </select>
                    ) : f.type === 'textarea' ? (
                      <textarea value={extra[f.key] ?? ''} onChange={e => setExtra(p => ({ ...p, [f.key]: e.target.value }))} rows={3} placeholder={f.placeholder} className={input} />
                    ) : (
                      <input type="text" value={extra[f.key] ?? ''} onChange={e => setExtra(p => ({ ...p, [f.key]: e.target.value }))} placeholder={f.placeholder} className={input} />
                    )}
                  </div>
                ))}

                <button onClick={handleGenerate} disabled={generating}
                  className="w-full mt-2 px-4 py-2.5 bg-[#27272A] hover:bg-[#18181B] text-white text-sm font-medium rounded-lg transition-colors flex items-center justify-center gap-2 disabled:opacity-60">
                  {generating ? <><Loader2 size={16} className="animate-spin" /> Generating…</> : <><Download size={16} /> Generate &amp; Download</>}
                </button>
              </div>
            )}
          </div>
        </div>
      </motion.div>
    </>
  )
}
