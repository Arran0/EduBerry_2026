'use client'

import React, { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2, UserX, Loader2, Megaphone, Pencil } from 'lucide-react'
import Avatar from '@/components/Avatar'
import {
  GradingQueueRow, Exam, fetchGradingQueue, markAbsent, publishResults,
} from '@/lib/exam'
import { Skeleton } from '@/components/exam/examUi'

const STATUS_META: Record<string, { label: string; cls: string }> = {
  not_started: { label: 'Not started', cls: 'bg-[#F4F4F5] text-[#71717A]' },
  in_progress: { label: 'In progress', cls: 'bg-blue-50 text-blue-600' },
  submitted: { label: 'Needs grading', cls: 'bg-[var(--page-accent-light)] text-[var(--page-accent)]' },
  graded: { label: 'Graded', cls: 'bg-emerald-50 text-emerald-600' },
  absent: { label: 'Absent', cls: 'bg-rose-50 text-rose-500' },
}

function rowStatus(row: GradingQueueRow): keyof typeof STATUS_META {
  if (row.submission?.is_absent) return 'absent'
  return (row.submission?.status as keyof typeof STATUS_META) ?? 'not_started'
}

export default function GradingTab({
  exam,
  canManage,
  onPublished,
}: {
  exam: Exam
  canManage: boolean
  onPublished?: () => void
}) {
  const router = useRouter()
  const [rows, setRows] = useState<GradingQueueRow[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [publishing, setPublishing] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setRows(await fetchGradingQueue(exam.id))
    setLoading(false)
  }, [exam.id])

  useEffect(() => { load() }, [load])

  const handleAbsent = async (studentId: string) => {
    setBusyId(studentId)
    await markAbsent(exam.id, studentId)
    await load()
    setBusyId(null)
  }

  const handlePublish = async () => {
    if (!confirm('Publish results to students? They will be able to see their grades and remarks.')) return
    setPublishing(true)
    await publishResults(exam.id)
    setPublishing(false)
    onPublished?.()
  }

  if (loading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-4 w-1/3 mb-4" />
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 p-2.5">
            <Skeleton className="w-9 h-9 rounded-full shrink-0" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-3.5 w-2/5" />
              <Skeleton className="h-2.5 w-1/2" />
            </div>
            <Skeleton className="h-6 w-20 rounded-full shrink-0" />
          </div>
        ))}
      </div>
    )
  }

  const pending = rows.filter(r => rowStatus(r) === 'submitted').length
  const done = rows.filter(r => ['graded', 'absent'].includes(rowStatus(r))).length

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-[#71717A]">
          {done}/{rows.length} finalised{pending > 0 && <span className="text-[var(--page-accent)] font-medium"> · {pending} need grading</span>}
        </p>
        {canManage && (
          exam.results_published ? (
            <span className="inline-flex items-center gap-1.5 text-sm text-emerald-600"><CheckCircle2 size={15} /> Published</span>
          ) : (
            <button
              onClick={handlePublish}
              disabled={publishing}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#B8983C] text-white text-sm font-semibold hover:bg-[#9C7F2C] shadow-[0_4px_14px_-4px_rgba(184,152,60,0.5)] disabled:opacity-60 transition-colors"
            >
              {publishing ? <Loader2 size={14} className="animate-spin" /> : <Megaphone size={14} />}
              Publish results
            </button>
          )
        )}
      </div>

      <div className="space-y-2">
        {rows.map(row => {
          const st = rowStatus(row)
          const meta = STATUS_META[st]
          const sub = row.submission
          return (
            <div key={row.student.id} className="flex items-center gap-3 p-2.5 rounded-lg border border-[#F0F0F0] hover:bg-[#FAFAFA] transition-colors">
              <Avatar avatarUrl={row.student.avatar_url} name={row.student.full_name} size={34} userId={row.student.id} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-[#27272A] truncate">{row.student.full_name}</p>
                <p className="text-xs text-[#A1A1AA] truncate">{row.student.email}</p>
              </div>
              {sub && st === 'graded' && sub.total_score != null && (
                <span className="text-sm font-semibold text-[#27272A] tabular-nums">{sub.total_score}/{sub.max_score}</span>
              )}
              <span className={`text-xs px-2 py-0.5 rounded-full ${meta.cls}`}>{meta.label}</span>
              {canManage && (
                <div className="flex items-center gap-1">
                  {(st === 'submitted' || st === 'graded') && (
                    <button
                      onClick={() => router.push(`/more/exam/${exam.id}/grade/${row.student.id}`)}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[var(--page-primary)] text-white text-xs hover:bg-[var(--page-primary-dark)] transition-colors"
                    >
                      <Pencil size={12} /> {st === 'graded' ? 'Review' : 'Grade'}
                    </button>
                  )}
                  {(st === 'not_started' || st === 'in_progress') && (
                    <button
                      onClick={() => handleAbsent(row.student.id)}
                      disabled={busyId === row.student.id}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-[#E4E4E7] text-[#71717A] text-xs hover:bg-rose-50 hover:text-rose-500 hover:border-rose-200 disabled:opacity-60 transition-colors"
                    >
                      {busyId === row.student.id ? <Loader2 size={12} className="animate-spin" /> : <UserX size={12} />} Absent
                    </button>
                  )}
                </div>
              )}
            </div>
          )
        })}
        {rows.length === 0 && (
          <div className="text-center py-8 text-sm text-[#A1A1AA]">
            No students in the audience yet. Add an audience first.
          </div>
        )}
      </div>
    </div>
  )
}
