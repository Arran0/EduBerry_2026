'use client'

import React, { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2, UserX, Loader2, Megaphone, Pencil } from 'lucide-react'
import Avatar from '@/components/Avatar'
import {
  GradingQueueRow, Exam, fetchGradingQueue, markAbsent, publishResults,
} from '@/lib/exam'

const STATUS_META: Record<string, { label: string; cls: string }> = {
  not_started: { label: 'Not started', cls: 'bg-slate-100 text-slate-500' },
  in_progress: { label: 'In progress', cls: 'bg-blue-50 text-blue-600' },
  submitted: { label: 'Needs grading', cls: 'bg-amber-50 text-amber-600' },
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

  if (loading) return <div className="text-center py-10"><div className="spinner mx-auto" /></div>

  const pending = rows.filter(r => rowStatus(r) === 'submitted').length
  const done = rows.filter(r => ['graded', 'absent'].includes(rowStatus(r))).length

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-slate-500">
          {done}/{rows.length} finalised{pending > 0 && <span className="text-amber-600"> · {pending} need grading</span>}
        </p>
        {canManage && (
          exam.results_published ? (
            <span className="inline-flex items-center gap-1.5 text-sm text-emerald-600"><CheckCircle2 size={15} /> Published</span>
          ) : (
            <button
              onClick={handlePublish}
              disabled={publishing}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500 text-white text-sm font-medium hover:bg-amber-600 disabled:opacity-60"
            >
              {publishing ? <Loader2 size={14} className="animate-spin" /> : <Megaphone size={14} />}
              Publish results
            </button>
          )
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
        {rows.map(row => {
          const st = rowStatus(row)
          const meta = STATUS_META[st]
          const sub = row.submission
          return (
            <div key={row.student.id} className="flex items-center gap-3 p-2.5 rounded-xl border border-slate-100 hover:bg-slate-50">
              <Avatar avatarUrl={row.student.avatar_url} name={row.student.full_name} size={34} userId={row.student.id} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-700 truncate">{row.student.full_name}</p>
                <p className="text-xs text-slate-400 truncate">{row.student.email}</p>
              </div>
              {sub && st === 'graded' && sub.total_score != null && (
                <span className="text-sm font-semibold text-slate-700">{sub.total_score}/{sub.max_score}</span>
              )}
              <span className={`text-xs px-2 py-0.5 rounded-full ${meta.cls}`}>{meta.label}</span>
              {canManage && (
                <div className="flex items-center gap-1">
                  {(st === 'submitted' || st === 'graded') && (
                    <button
                      onClick={() => router.push(`/more/exam/${exam.id}/grade/${row.student.id}`)}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-800 text-white text-xs hover:bg-slate-900"
                    >
                      <Pencil size={12} /> {st === 'graded' ? 'Review' : 'Grade'}
                    </button>
                  )}
                  {(st === 'not_started' || st === 'in_progress') && (
                    <button
                      onClick={() => handleAbsent(row.student.id)}
                      disabled={busyId === row.student.id}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 text-slate-500 text-xs hover:bg-rose-50 hover:text-rose-500 disabled:opacity-60"
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
          <div className="col-span-full text-center py-8 text-sm text-slate-400">
            No students in the audience yet. Add an audience first.
          </div>
        )}
      </div>
    </div>
  )
}
