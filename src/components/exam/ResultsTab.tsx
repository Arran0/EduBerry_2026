'use client'

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Link2, Loader2, CheckCircle2, Lock, X, GraduationCap } from 'lucide-react'
import { UserRole } from '@/lib/supabase'
import { fetchClassroomsForUser, ClassroomWithDetails } from '@/lib/classrooms'
import { Exam, ExamResultLink, linkResultsToClassrooms, fetchResultLinks } from '@/lib/exam'
import { Skeleton } from '@/components/exam/examUi'
import SmartTypeahead from '@/components/SmartTypeahead'

export default function ResultsTab({
  exam,
  userId,
  userRole,
  canManage,
}: {
  exam: Exam
  userId: string
  userRole: UserRole
  canManage: boolean
}) {
  const [classrooms, setClassrooms] = useState<ClassroomWithDetails[]>([])
  const [links, setLinks] = useState<ExamResultLink[]>([])
  const [selected, setSelected] = useState<ClassroomWithDetails[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [linking, setLinking] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const [cls, lnks] = await Promise.all([
      fetchClassroomsForUser(userId, userRole, true),
      fetchResultLinks(exam.id),
    ])
    setClassrooms(cls)
    setLinks(lnks)
    setLoading(false)
  }, [userId, userRole, exam.id])

  useEffect(() => { load() }, [load])

  const linkedClassroomIds = useMemo(() => new Set(links.map(l => l.classroom_id)), [links])
  const selectedIds = useMemo(() => new Set(selected.map(c => c.id)), [selected])
  const linkedClassrooms = useMemo(
    () => classrooms.filter(c => linkedClassroomIds.has(c.id)),
    [classrooms, linkedClassroomIds],
  )

  // Type-ahead suggestions: match by title/subject, hide already-linked or
  // already-picked classrooms. No giant list — only what the search surfaces.
  const suggestions = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    return classrooms.filter(c => {
      if (linkedClassroomIds.has(c.id) || selectedIds.has(c.id)) return false
      return (
        c.title.toLowerCase().includes(q) ||
        (c.subject ?? '').toLowerCase().includes(q)
      )
    })
  }, [query, classrooms, linkedClassroomIds, selectedIds])

  const addClassroom = (c: ClassroomWithDetails) => {
    setSelected(prev => [...prev, c])
    setQuery('')
  }

  const removeClassroom = (id: string) => {
    setSelected(prev => prev.filter(c => c.id !== id))
  }

  const handleLink = async () => {
    if (selected.length === 0) return
    setLinking(true)
    setMsg(null)
    const res = await linkResultsToClassrooms(exam.id, selected.map(c => c.id), userId)
    setLinking(false)
    setSelected([])
    setMsg(`Linked ${res.linked} student result${res.linked === 1 ? '' : 's'} into ${res.classrooms} classroom${res.classrooms === 1 ? '' : 's'}.`)
    load()
  }

  if (loading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-4 w-3/4 mb-4" />
        <Skeleton className="h-11 w-full rounded-lg mb-3" />
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 px-3 py-2">
            <Skeleton className="w-8 h-8 rounded-lg shrink-0" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-3.5 w-1/3" />
              <Skeleton className="h-2.5 w-1/4" />
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (!canManage) {
    return <p className="text-sm text-[#A1A1AA] text-center py-6">Only the exam owner or graders can link results.</p>
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-[#71717A] flex items-center gap-2">
        <Link2 size={15} className="text-[var(--page-accent)] shrink-0" /> Push graded results into a classroom as an assessment. Only students in both the exam and the classroom get a mark.
      </p>

      {!exam.results_published && (
        <div className="flex items-center gap-2 text-xs text-[var(--page-accent)] bg-[var(--page-accent-light)] border border-[#E7E2D8] rounded-lg px-3 py-2">
          <Lock size={13} className="shrink-0" /> Tip: finish grading before linking — only graded students are included.
        </div>
      )}

      {/* Smart type-ahead classroom picker */}
      <div>
        <label className="block text-[11px] font-bold uppercase tracking-widest text-[#71717A] mb-1.5">Find a classroom</label>
        <SmartTypeahead<ClassroomWithDetails>
          query={query}
          onQueryChange={setQuery}
          suggestions={suggestions}
          onSelect={addClassroom}
          getKey={c => c.id}
          placeholder="Type a classroom name or subject…"
          className="flex items-center gap-2 border border-[#E4E4E7] rounded-lg px-3 py-2.5 bg-white focus-within:border-[var(--page-primary)] transition-colors"
          renderSuggestion={(c, active) => (
            <div className={`flex items-center gap-3 px-3 py-2.5 transition-colors ${active ? 'bg-[#F4F4F5]' : 'hover:bg-[#F4F4F5]'}`}>
              <div className="w-8 h-8 rounded-lg bg-[var(--page-accent-light)] border border-[#E7E2D8] flex items-center justify-center shrink-0">
                <GraduationCap size={15} className="text-[var(--page-accent)]" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-[#27272A] truncate">{c.title}</p>
                {c.subject && <p className="text-xs text-[#A1A1AA] truncate">{c.subject}</p>}
              </div>
            </div>
          )}
        />
      </div>

      {/* Selected (to be linked) chips */}
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {selected.map(c => (
            <span key={c.id} className="inline-flex items-center gap-1.5 pl-2.5 pr-1.5 py-1 rounded-full bg-[var(--page-primary)] text-white text-xs font-medium">
              {c.title}
              <button onClick={() => removeClassroom(c.id)} className="rounded-full p-0.5 hover:bg-white/20 transition-colors" title="Remove">
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Already-linked classrooms */}
      {linkedClassrooms.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[11px] font-bold uppercase tracking-widest text-[#71717A]">Already linked</p>
          {linkedClassrooms.map(c => (
            <div key={c.id} className="flex items-center gap-3 px-3 py-2 rounded-lg border border-[#F0F0F0] bg-[#FAFAFA]">
              <div className="w-8 h-8 rounded-lg bg-white border border-[#E4E4E7] flex items-center justify-center shrink-0">
                <GraduationCap size={15} className="text-[#71717A]" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-[#27272A] truncate">{c.title}</p>
                {c.subject && <p className="text-xs text-[#A1A1AA] truncate">{c.subject}</p>}
              </div>
              <span className="text-xs text-emerald-500 flex items-center gap-1 shrink-0"><CheckCircle2 size={12} /> Linked</span>
            </div>
          ))}
        </div>
      )}

      {classrooms.length === 0 && (
        <p className="text-sm text-[#A1A1AA] text-center py-4">You don&apos;t teach any classrooms.</p>
      )}

      {msg && <p className="text-sm text-emerald-600">{msg}</p>}

      <div className="flex justify-end">
        <button
          onClick={handleLink}
          disabled={linking || selected.length === 0}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[var(--page-accent)] text-white text-sm font-semibold hover:brightness-95 disabled:opacity-50 transition-colors"
        >
          {linking ? <Loader2 size={14} className="animate-spin" /> : <Link2 size={14} />}
          Link {selected.length || ''} classroom{selected.length === 1 ? '' : 's'}
        </button>
      </div>
    </div>
  )
}
