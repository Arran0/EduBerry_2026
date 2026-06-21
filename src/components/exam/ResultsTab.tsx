'use client'

import React, { useCallback, useEffect, useState } from 'react'
import { Link2, Loader2, CheckCircle2, Lock } from 'lucide-react'
import { UserRole } from '@/lib/supabase'
import { fetchClassroomsForUser, ClassroomWithDetails } from '@/lib/classrooms'
import { Exam, ExamResultLink, linkResultsToClassrooms, fetchResultLinks } from '@/lib/exam'
import { Skeleton } from '@/components/exam/examUi'

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
  const [selected, setSelected] = useState<Set<string>>(new Set())
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

  const toggle = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const handleLink = async () => {
    if (selected.size === 0) return
    setLinking(true)
    setMsg(null)
    const res = await linkResultsToClassrooms(exam.id, [...selected], userId)
    setLinking(false)
    setSelected(new Set())
    setMsg(`Linked ${res.linked} student result${res.linked === 1 ? '' : 's'} into ${res.classrooms} classroom${res.classrooms === 1 ? '' : 's'}.`)
    load()
  }

  if (loading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-4 w-3/4 mb-4" />
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 px-3 py-2">
            <Skeleton className="w-4 h-4 rounded shrink-0" />
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

  const linkedClassroomIds = new Set(links.map(l => l.classroom_id))

  return (
    <div className="space-y-4">
      <p className="text-sm text-[#71717A] flex items-center gap-2">
        <Link2 size={15} /> Push graded results into a classroom as an assessment. Only students in both the exam and the classroom get a mark.
      </p>

      {!exam.results_published && (
        <div className="flex items-center gap-2 text-xs text-[#B8983C] bg-[#F4F2EC] border border-[#E7E2D8] rounded-lg px-3 py-2">
          <Lock size={13} /> Tip: finish grading before linking — only graded students are included.
        </div>
      )}

      <div className="space-y-1.5 max-h-72 overflow-y-auto">
        {classrooms.map(c => {
          const already = linkedClassroomIds.has(c.id)
          return (
            <label key={c.id} className="flex items-center gap-3 px-3 py-2 rounded-lg border border-[#F0F0F0] hover:bg-[#FAFAFA] cursor-pointer transition-colors">
              <input
                type="checkbox"
                className="accent-[#27272A]"
                checked={selected.has(c.id)}
                onChange={() => toggle(c.id)}
              />
              <div className="flex-1 min-w-0">
                <p className="text-sm text-[#27272A] truncate">{c.title}</p>
                {c.subject && <p className="text-xs text-[#A1A1AA]">{c.subject}</p>}
              </div>
              {already && <span className="text-xs text-emerald-500 flex items-center gap-1"><CheckCircle2 size={12} /> Linked</span>}
            </label>
          )
        })}
        {classrooms.length === 0 && <p className="text-sm text-[#A1A1AA] text-center py-4">You don&apos;t teach any classrooms.</p>}
      </div>

      {msg && <p className="text-sm text-emerald-600">{msg}</p>}

      <div className="flex justify-end">
        <button
          onClick={handleLink}
          disabled={linking || selected.size === 0}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#B8983C] text-white text-sm font-semibold hover:bg-[#A6862F] disabled:opacity-50 transition-colors"
        >
          {linking ? <Loader2 size={14} className="animate-spin" /> : <Link2 size={14} />}
          Link to {selected.size || ''} classroom{selected.size === 1 ? '' : 's'}
        </button>
      </div>
    </div>
  )
}
