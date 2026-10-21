'use client'

import React, { useEffect, useRef, useState, useCallback } from 'react'
import ProtectedLayout from '@/components/ProtectedLayout'
import { useRouter } from 'next/navigation'
import { Wand2, Plus, Save, Trash2, Loader2, ArrowLeft, Eye } from 'lucide-react'
import {
  CertificateTemplate, PLACEHOLDERS,
  fetchTemplates, saveTemplate, deleteTemplate,
} from '@/lib/certificates'

const input = 'border border-[#D4D4D8] bg-white px-3 py-2 text-sm focus:outline-none focus:border-[#27272A] transition-colors w-full rounded-lg'
const labelCls = 'block text-[12.5px] font-medium text-[#52525B] mb-1.5'

// Sample values so the editor preview reads like a real certificate without
// needing a selected student.
const SAMPLE: Record<string, string> = {
  student_name: 'Aarav Sharma', admission_no: 'ADM-2024-118', class: '8', section: 'A',
  roll_no: '21', dob: '15 Aug 2010', father_name: 'Rajesh Sharma', mother_name: 'Priya Sharma',
  academic_year: '2026-27', attendance_percentage: '94%', issue_date: '22 Jun 2026',
  principal_name: 'Dr. A. Menon', school_name: 'Your School', school_affiliation_no: '1930456',
  certificate_no: 'CC-2026-27-7K3MQ9', qr_code: '',
}

function previewBody(body: string): string {
  return body
    .replace(/\{\{\s*qr_code\s*\}\}/g, '[QR code]')
    .replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k: string) => (k in SAMPLE ? SAMPLE[k] : m))
}

export default function CertificateTemplatesPage() {
  const router = useRouter()
  const [templates, setTemplates] = useState<CertificateTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [saving, setSaving] = useState(false)
  const bodyRef = useRef<HTMLTextAreaElement>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setTemplates(await fetchTemplates())
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  function startNew() {
    setSelectedId(null); setName(''); setTitle(''); setBody('')
  }

  function edit(t: CertificateTemplate) {
    setSelectedId(t.id); setName(t.name); setTitle(t.title ?? ''); setBody(t.body)
  }

  function insertToken(token: string) {
    const el = bodyRef.current
    if (!el) { setBody(b => b + token); return }
    const start = el.selectionStart ?? body.length
    const end = el.selectionEnd ?? body.length
    const next = body.slice(0, start) + token + body.slice(end)
    setBody(next)
    requestAnimationFrame(() => {
      el.focus()
      const pos = start + token.length
      el.setSelectionRange(pos, pos)
    })
  }

  async function handleSave() {
    if (!name.trim()) return
    setSaving(true)
    const res = await saveTemplate({ id: selectedId ?? undefined, name: name.trim(), title: title.trim() || null, body })
    setSaving(false)
    if (res.success) {
      await load()
      if (res.id) setSelectedId(res.id)
    }
  }

  async function handleDelete() {
    if (!selectedId) return
    if (!window.confirm(`Delete template "${name}"?`)) return
    const res = await deleteTemplate(selectedId)
    if (res.success) { startNew(); await load() }
  }

  return (
    <ProtectedLayout adminOnly>
      <div data-page-theme="admin" style={{ minHeight: '100vh' }} className="px-4 sm:px-6 lg:px-8 pt-3 sm:pt-6 pb-14">
        <div className="max-w-6xl mx-auto">
          <button onClick={() => router.back()}
            className="bg-white border border-[#D4D4D8] hover:bg-[#F5F5F5] inline-flex items-center gap-1.5 h-8 pl-2.5 pr-3.5 text-[12.5px] font-semibold text-[#3F3F46] hover:text-[#18181B] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B8983C]/60">
            <ArrowLeft size={14} /> Back
          </button>
          <div className="flex items-center gap-3.5 mt-4 sm:mt-5 mb-5 sm:mb-6">
            <div className="w-12 h-12 flex items-center justify-center flex-shrink-0 border-b-2 border-[#B8983C] bg-[#27272A]">
              <Wand2 size={21} className="text-[#B8983C]" />
            </div>
            <div className="min-w-0">
              <h1 className="font-display text-[1.45rem] sm:text-[1.75rem] font-bold leading-[1.15] tracking-[-0.015em] text-[#18181B]">Certificate Templates</h1>
              <p className="text-[13px] text-[#71717A] mt-0.5">Write your own certificates, with placeholders filled from each student&apos;s record</p>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-5">
            {/* Template list */}
            <div className="bg-white border border-[#E4E4E7] shadow-[0_1px_2px_rgba(24,24,27,.04),0_14px_30px_-24px_rgba(24,24,27,.35)] p-3 h-fit">
              <button onClick={startNew}
                className="w-full flex items-center justify-center gap-1.5 px-3 py-2 mb-2 bg-[#27272A] hover:bg-[#18181B] text-white text-sm font-medium rounded-lg transition-colors">
                <Plus size={15} /> New Template
              </button>
              {loading ? (
                <div className="flex items-center justify-center py-8 text-sm text-[#71717A] gap-2"><Loader2 size={14} className="animate-spin" /> Loading…</div>
              ) : templates.length === 0 ? (
                <p className="text-xs text-[#A1A1AA] text-center py-6">No templates yet.</p>
              ) : (
                <div className="space-y-1">
                  {templates.map(t => (
                    <button key={t.id} onClick={() => edit(t)}
                      className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors border-l-2 ${selectedId === t.id ? 'border-l-[#27272A] bg-[#F4F4F5] text-[#18181B] font-medium' : 'border-l-transparent text-[#71717A] hover:bg-[#FAFAFA]'}`}>
                      <span className="truncate block">{t.name}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Editor */}
            <div className="space-y-5">
              <div className="bg-white border border-[#E4E4E7] shadow-[0_1px_2px_rgba(24,24,27,.04),0_14px_30px_-24px_rgba(24,24,27,.35)] p-5 space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className={labelCls}>Template Name</label>
                    <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Character Certificate" className={input} />
                  </div>
                  <div>
                    <label className={labelCls}>Document Title (printed)</label>
                    <input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Character Certificate" className={input} />
                  </div>
                </div>

                <div>
                  <label className={labelCls}>Body</label>
                  <textarea ref={bodyRef} value={body} onChange={e => setBody(e.target.value)} rows={9}
                    placeholder="Write the certificate text. Insert placeholders below — e.g. This is to certify that {{student_name}} of {{class}}…"
                    className={`${input} font-mono leading-relaxed`} />
                </div>

                <div>
                  <label className={labelCls}>Insert Placeholder</label>
                  <div className="flex flex-wrap gap-1.5">
                    {PLACEHOLDERS.map(p => (
                      <button key={p.token} onClick={() => insertToken(p.token)} title={p.token}
                        className="px-2 py-1 text-[11px] bg-[#F4F4F5] border border-[#E4E4E7] rounded-md hover:border-[#27272A] transition-colors text-[#52525B]">
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex gap-3 pt-1">
                  <button onClick={handleSave} disabled={saving || !name.trim()}
                    className="flex items-center gap-2 px-5 py-2 bg-[#27272A] hover:bg-[#18181B] text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50">
                    {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save
                  </button>
                  {selectedId && (
                    <button onClick={handleDelete}
                      className="flex items-center gap-2 px-4 py-2 border border-rose-200 text-rose-700 bg-rose-50 hover:bg-rose-100 text-sm font-medium rounded-lg transition-colors">
                      <Trash2 size={14} /> Delete
                    </button>
                  )}
                </div>
              </div>

              {/* Live preview */}
              <div className="bg-white border border-[#E4E4E7] shadow-[0_1px_2px_rgba(24,24,27,.04),0_14px_30px_-24px_rgba(24,24,27,.35)] p-5">
                <p className="text-[10px] font-bold uppercase tracking-widest text-[#525252] mb-3 flex items-center gap-1.5">
                  <Eye size={12} /> Live Preview (sample values)
                </p>
                {title && <p className="text-center font-bold uppercase tracking-wider text-[#18181B] mb-4 text-sm">{title}</p>}
                {body.trim() ? (
                  <div className="text-sm text-[#3F3F46] leading-relaxed whitespace-pre-wrap">{previewBody(body)}</div>
                ) : (
                  <p className="text-xs text-[#A1A1AA] italic">Start typing to see a preview…</p>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </ProtectedLayout>
  )
}
