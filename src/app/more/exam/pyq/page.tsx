'use client'

import React, { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import ProtectedLayout from '@/components/ProtectedLayout'
import { useAuth } from '@/contexts/AuthContext'
import { isStaffRole } from '@/lib/supabase'
import { ChevronLeft, Library, Trash2, Plus, Loader2, FileText, Search } from 'lucide-react'
import { ExamTemplate, fetchPyqLibrary, deletePyq, createExamFromTemplate } from '@/lib/exam'
import { EXAM_MAX_W } from '@/components/exam/ExamNav'

export default function PyqLibraryPage() {
  const { user, profile } = useAuth()
  const router = useRouter()
  const [templates, setTemplates] = useState<ExamTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setTemplates(await fetchPyqLibrary())
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  if (!user || !profile) return null

  const q = query.trim().toLowerCase()
  const results = q
    ? templates.filter(t =>
        t.title.toLowerCase().includes(q) ||
        (t.subject ?? '').toLowerCase().includes(q),
      )
    : []

  const handleUse = async (id: string) => {
    setBusyId(id)
    const exam = await createExamFromTemplate(id, user.id)
    setBusyId(null)
    if (exam) router.push(`/more/exam/${exam.id}/edit`)
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this PYQ template?')) return
    await deletePyq(id)
    load()
  }

  return (
    <ProtectedLayout>
      <div data-page-theme="exam" className={`${EXAM_MAX_W} mx-auto px-4 sm:px-6 lg:px-8 py-6`}>
        <button onClick={() => router.push('/more/exam')} className=”flex items-center gap-1.5 text-sm text-[#71717A] hover:text-[#27272A] font-medium transition-colors mb-4”>
          <ChevronLeft size={16} /> Back to Exams
        </button>

        <div className=”flex items-center gap-3 mb-5”>
          <div className=”w-11 h-11 rounded-xl bg-[#27272A] flex items-center justify-center text-[#B8983C] shadow-sm”>
            <Library size={22} />
          </div>
          <div>
            <h1 className=”font-display text-2xl font-bold text-[#18181B]”>PYQ Library</h1>
            <p className=”text-xs text-[#A1A1AA]”>Reuse saved exam sheets as previous-year questions</p>
          </div>
        </div>

        {!isStaffRole(profile.role) ? (
          <div className=”bg-white border border-[#E4E4E7] rounded-xl p-10 text-center text-[#71717A] shadow-sm”>This page is for staff.</div>
        ) : (
          <>
            {/* Smart search */}
            <div className=”relative mb-4”>
              <Search size={16} className=”absolute left-3 top-1/2 -translate-y-1/2 text-[#A1A1AA]” />
              <input
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder=”Search PYQs by title or subject…”
                className=”w-full border border-[#E4E4E7] rounded-lg pl-9 pr-3 py-2.5 text-sm bg-white text-[#27272A] placeholder:text-[#A1A1AA] focus:outline-none focus:border-[#27272A] transition-colors”
              />
            </div>

            {loading ? (
              <div className=”text-center py-16”><div className=”spinner mx-auto mb-3” /><p className=”text-sm text-[#71717A]”>Loading…</p></div>
            ) : !q ? (
              <div className=”text-center py-16 text-[#A1A1AA]”>
                <Search size={32} className=”mx-auto mb-3 text-[#D4D4D8]” />
                <p className=”text-sm”>Search your saved PYQs to get started.</p>
              </div>
            ) : results.length === 0 ? (
              <div className=”text-center py-16 text-[#A1A1AA]”>
                <Library size={32} className=”mx-auto mb-3 text-[#D4D4D8]” />
                <p className=”text-sm”>No PYQs match “{query.trim()}”.</p>
              </div>
            ) : (
              <div className=”space-y-3”>
                {results.map(t => (
                  <div key={t.id} className=”bg-white border border-[#E4E4E7] rounded-xl p-4 shadow-sm hover:shadow-md transition-shadow flex items-center justify-between gap-3”>
                <div className=”min-w-0”>
                  <h3 className=”font-semibold text-[#18181B] truncate flex items-center gap-2”><FileText size={15} className=”text-[#B8983C]” />{t.title}</h3>
                  <div className=”flex flex-wrap items-center gap-3 text-xs text-[#A1A1AA] mt-0.5”>
                    {t.subject && <span>{t.subject}</span>}
                    <span>{(t.questions ?? []).length} questions</span>
                    <span>{new Date(t.created_at).toLocaleDateString()}</span>
                  </div>
                </div>
                <div className=”flex items-center gap-1 shrink-0”>
                  <button onClick={() => handleUse(t.id)} disabled={busyId === t.id} className=”inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#27272A] text-white text-xs font-semibold hover:bg-[#18181B] transition-colors disabled:opacity-60”>
                    {busyId === t.id ? <Loader2 size={14} className=”animate-spin” /> : <Plus size={14} />} Use
                  </button>
                  {t.created_by === user.id && (
                    <button onClick={() => handleDelete(t.id)} className=”p-2 text-[#A1A1AA] hover:text-rose-500 hover:bg-rose-50 rounded-lg transition-colors”><Trash2 size={15} /></button>
                  )}
                </div>
              </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </ProtectedLayout>
  )
}
