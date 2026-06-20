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
        <button onClick={() => router.push('/more/exam')} className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 mb-4">
          <ChevronLeft size={16} /> Back to Exams
        </button>

        <div className="flex items-center gap-3 mb-5">
          <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center text-white shadow-sm">
            <Library size={22} />
          </div>
          <div>
            <h1 className="font-display text-2xl font-bold text-slate-800">PYQ Library</h1>
            <p className="text-xs text-slate-400">Reuse saved exam sheets as previous-year questions</p>
          </div>
        </div>

        {!isStaffRole(profile.role) ? (
          <div className="glass rounded-2xl p-10 text-center text-slate-500">This page is for staff.</div>
        ) : (
          <>
            {/* Smart search */}
            <div className="relative mb-4">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Search PYQs by title or subject…"
                className="w-full border border-slate-200 rounded-xl pl-9 pr-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-amber-200"
              />
            </div>

            {loading ? (
              <div className="text-center py-16"><div className="spinner mx-auto mb-3" /><p className="text-sm text-slate-500">Loading…</p></div>
            ) : !q ? (
              <div className="text-center py-16 text-slate-400">
                <Search size={32} className="mx-auto mb-3 text-slate-300" />
                <p className="text-sm">Search your saved PYQs to get started.</p>
              </div>
            ) : results.length === 0 ? (
              <div className="text-center py-16 text-slate-400">
                <Library size={32} className="mx-auto mb-3 text-slate-300" />
                <p className="text-sm">No PYQs match “{query.trim()}”.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {results.map(t => (
                  <div key={t.id} className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm hover:shadow-md transition-shadow flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="font-semibold text-slate-800 truncate flex items-center gap-2"><FileText size={15} className="text-amber-500" />{t.title}</h3>
                  <div className="flex flex-wrap items-center gap-3 text-xs text-slate-400 mt-0.5">
                    {t.subject && <span>{t.subject}</span>}
                    <span>{(t.questions ?? []).length} questions</span>
                    <span>{new Date(t.created_at).toLocaleDateString()}</span>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button onClick={() => handleUse(t.id)} disabled={busyId === t.id} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-amber-500 text-white text-sm font-medium hover:bg-amber-600 disabled:opacity-60">
                    {busyId === t.id ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Use
                  </button>
                  {t.created_by === user.id && (
                    <button onClick={() => handleDelete(t.id)} className="p-2 text-slate-400 hover:text-rose-500 hover:bg-rose-50 rounded-lg"><Trash2 size={15} /></button>
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
