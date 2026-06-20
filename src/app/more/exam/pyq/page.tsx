'use client'

import React, { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import ProtectedLayout from '@/components/ProtectedLayout'
import { useAuth } from '@/contexts/AuthContext'
import { isStaffRole } from '@/lib/supabase'
import { ChevronLeft, Library, Trash2, Plus, Loader2, FileText } from 'lucide-react'
import { ExamTemplate, fetchPyqLibrary, deletePyq, createExamFromTemplate } from '@/lib/exam'

export default function PyqLibraryPage() {
  const { user, profile } = useAuth()
  const router = useRouter()
  const [templates, setTemplates] = useState<ExamTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setTemplates(await fetchPyqLibrary())
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  if (!user || !profile) return null

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
      <div data-page-theme="academics" className="max-w-3xl mx-auto px-4 sm:px-6 py-6">
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
        ) : loading ? (
          <div className="text-center py-16"><div className="spinner mx-auto mb-3" /><p className="text-sm text-slate-500">Loading…</p></div>
        ) : templates.length === 0 ? (
          <div className="glass rounded-2xl p-10 text-center">
            <Library size={36} className="text-slate-300 mx-auto mb-3" />
            <p className="text-slate-600 font-medium">No saved PYQs yet</p>
            <p className="text-sm text-slate-400 mt-1">Use &quot;Save as PYQ&quot; on an exam&apos;s Sheet tab.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {templates.map(t => (
              <div key={t.id} className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm flex items-center justify-between gap-3">
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
      </div>
    </ProtectedLayout>
  )
}
