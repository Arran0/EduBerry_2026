'use client'

import React, { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import ProtectedLayout from '@/components/ProtectedLayout'
import { useAuth } from '@/contexts/AuthContext'
import { isStaffRole } from '@/lib/supabase'
import { ChevronLeft, Library, Trash2, Plus, Loader2, FileText, Search } from 'lucide-react'
import { ExamTemplate, fetchPyqLibrary, deletePyq, createExamFromTemplate } from '@/lib/exam'
import { EXAM_MAX_W } from '@/components/exam/ExamNav'
import { EXAM, FadeIn, ExamListSkeleton } from '@/components/exam/examUi'

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
      <div data-page-theme="exam">
        <div style={{ minHeight: '100vh' }}>
          <div className={`${EXAM_MAX_W} mx-auto px-4 sm:px-6 lg:px-8 py-6`}>
            <button onClick={() => router.push('/more/exam')} className="inline-flex items-center gap-1.5 text-sm text-[#71717A] px-3 py-1.5 -ml-3 border border-transparent hover:text-[#27272A] hover:bg-[#F4F4F5] hover:border-[#E4E4E7] mb-4 transition-colors">
              <ChevronLeft size={16} /> Back to Exams
            </button>

            <div className="flex items-center gap-3 mb-5">
              <div className={`w-11 h-11 ${EXAM.iconTile}`}>
                <Library size={22} className="text-[var(--page-accent)]" />
              </div>
              <div>
                <h1 className="font-display text-2xl font-bold text-[#18181B]">PYQ Library</h1>
                <p className="text-xs text-[#A1A1AA]">Reuse saved exam sheets as previous-year questions</p>
              </div>
            </div>

            {!isStaffRole(profile.role) ? (
              <div className={`${EXAM.card} p-10 text-center text-[#71717A]`}>This page is for staff.</div>
            ) : (
              <>
                {/* Smart search */}
                <div className="relative mb-4">
                  <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#A1A1AA] pointer-events-none" />
                  <input
                    value={query}
                    onChange={e => setQuery(e.target.value)}
                    placeholder="Search PYQs by title or subject…"
                    className="w-full bg-white border border-[#E4E4E7] pl-9 pr-3 py-2.5 text-sm text-[#27272A] placeholder:text-[#A1A1AA] focus:outline-none focus:border-[var(--page-primary)] transition-colors"
                  />
                </div>

                {loading ? (
                  <ExamListSkeleton rows={4} />
                ) : !q ? (
                  <FadeIn>
                    <div className="text-center py-16 text-[#A1A1AA]">
                      <Search size={32} className="mx-auto mb-3 text-[#D4D4D8]" />
                      <p className="text-sm">Search your saved PYQs to get started.</p>
                    </div>
                  </FadeIn>
                ) : results.length === 0 ? (
                  <FadeIn>
                    <div className="text-center py-16 text-[#A1A1AA]">
                      <Library size={32} className="mx-auto mb-3 text-[#D4D4D8]" />
                      <p className="text-sm">No PYQs match “{query.trim()}”.</p>
                    </div>
                  </FadeIn>
                ) : (
                  <div className="space-y-3">
                    {results.map((t, i) => (
                      <FadeIn key={t.id} index={i}>
                        <div className={`${EXAM.cardHover} p-4 flex items-center justify-between gap-3`}>
                          <div className="min-w-0">
                            <h3 className="font-semibold text-[#18181B] truncate flex items-center gap-2"><FileText size={15} className="text-[var(--page-accent)]" />{t.title}</h3>
                            <div className="flex flex-wrap items-center gap-3 text-xs text-[#A1A1AA] mt-0.5">
                              {t.subject && <span>{t.subject}</span>}
                              <span>{(t.questions ?? []).length} questions</span>
                              <span>{new Date(t.created_at).toLocaleDateString()}</span>
                            </div>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <button onClick={() => handleUse(t.id)} disabled={busyId === t.id} className={EXAM.goldBtn}>
                              {busyId === t.id ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Use
                            </button>
                            {t.created_by === user.id && (
                              <button onClick={() => handleDelete(t.id)} className="p-2 text-[#A1A1AA] hover:text-rose-500 hover:bg-rose-50 transition-colors"><Trash2 size={15} /></button>
                            )}
                          </div>
                        </div>
                      </FadeIn>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </ProtectedLayout>
  )
}
