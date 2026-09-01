'use client'

import React, { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2, UserX, Loader2, Megaphone, Pencil, Lock, Zap } from 'lucide-react'
import Avatar from '@/components/Avatar'
import {
  GradingQueueRow, Exam, fetchGradingQueue, markAbsent, publishResults, isExamClosed,
} from '@/lib/exam'
import { EXAM, Skeleton, StatusPill } from '@/components/exam/examUi'

const STATUS_META: Record<string, { label: string; cls: string }> = {
  not_started: { label: 'Not started', cls: 'bg-[#FAF9F6] text-[#8A8578] border-[#E4E1D8]' },
  in_progress: { label: 'In progress', cls: 'bg-blue-50 text-blue-700 border-blue-200' },
  submitted: { label: 'To grade', cls: 'bg-[#F4F2EC] text-[#9C7F2C] border-[#E7E2D8]' },
  graded: { label: 'Graded', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  absent: { label: 'Absent', cls: 'bg-rose-50 text-rose-600 border-rose-200' },
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
    if (!confirm(
      'Publish results and close this exam?\n\n'
      + 'Students will see their grades and remarks, anyone who never handed in is marked absent, '
      + 'and the exam moves to the Closed section — grading and editing lock.',
    )) return
    setPublishing(true)
    await publishResults(exam.id)
    setPublishing(false)
    onPublished?.()
  }

  if (loading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-4 w-1/3 mb-4" />
        <div className={EXAM.listWrap}>
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 px-3 py-2.5">
              <Skeleton className="w-9 h-9 rounded-full shrink-0" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-3.5 w-2/5" />
                <Skeleton className="h-2.5 w-1/2" />
              </div>
              <Skeleton className="h-6 w-20 shrink-0" />
            </div>
          ))}
        </div>
      </div>
    )
  }

  const pending = rows.filter(r => rowStatus(r) === 'submitted').length
  const done = rows.filter(r => ['graded', 'absent'].includes(rowStatus(r))).length
  // Publishing closes the exam, and a closed exam is read-only.
  const locked = isExamClosed(exam)

  return (
    <div className="space-y-4">
      {exam.immediate_results && !locked && (
        <div className="flex items-start gap-2 border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-800">
          <Zap size={13} className="mt-0.5 shrink-0" />
          <span>
            Results publish to each student the moment they submit.
            {exam.auto_close_at
              ? ` This exam auto-closes on ${new Date(exam.auto_close_at).toLocaleString()}.`
              : ''}
            {' '}You can still publish and close it now.
          </span>
        </div>
      )}

      {locked && (
        <div className="flex items-start gap-2 border border-[#E4E1D8] bg-[#FAF9F6] px-3 py-2 text-[11px] leading-relaxed text-[#8A8578]">
          <Lock size={13} className="mt-0.5 shrink-0 text-[#B8983C]" />
          <span>Results are published and this exam is closed — grading is read-only.</span>
        </div>
      )}

      {/* Progress — a bar plus the counts that matter, not a sentence. */}
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="font-display text-lg font-bold tabular-nums text-[#18181B]">{done}</span>
            <span className="text-xs text-[#A8A29A] tabular-nums">/ {rows.length} finalised</span>
            {pending > 0 && (
              <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-[#B8983C]">{pending} to grade</span>
            )}
          </div>
          <div className="mt-1.5 h-1 w-full max-w-xs bg-[#EDEAE2]">
            <div
              className="h-full bg-[#18181B] transition-all duration-300"
              style={{ width: rows.length ? `${Math.round((done / rows.length) * 100)}%` : '0%' }}
            />
          </div>
        </div>
        {canManage && (
          exam.results_published ? (
            <span className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.1em] text-emerald-700">
              <CheckCircle2 size={14} /> Published
            </span>
          ) : (
            <button onClick={handlePublish} disabled={publishing} className={EXAM.goldBtn}>
              {publishing ? <Loader2 size={14} className="animate-spin" /> : <Megaphone size={14} />}
              Publish results
            </button>
          )
        )}
      </div>

      <div className={EXAM.listWrap}>
        <div className={EXAM.listHead}>
          <span className="w-[34px] shrink-0" />
          <span className="flex-1">Student</span>
          <span className="w-16 text-right">Score</span>
          <span className="w-24 text-right">Status</span>
          {canManage && <span className="w-32 text-right">Action</span>}
        </div>

        {rows.map(row => {
          const st = rowStatus(row)
          const meta = STATUS_META[st]
          const sub = row.submission
          return (
            <div key={row.student.id} className={EXAM.listRow}>
              <Avatar avatarUrl={row.student.avatar_url} name={row.student.full_name} size={34} userId={row.student.id} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-[#18181B] truncate">{row.student.full_name}</p>
                <p className="text-[11px] text-[#A8A29A] truncate">{row.student.email}</p>
              </div>
              <span className="w-16 text-right text-sm font-semibold tabular-nums text-[#18181B] shrink-0">
                {sub && st === 'graded' && sub.total_score != null
                  ? `${sub.total_score}/${sub.max_score}`
                  : <span className="text-[#D8D2C4]">—</span>}
              </span>
              <span className="w-24 flex justify-end shrink-0">
                <StatusPill label={meta.label} tone={meta.cls} />
              </span>
              {canManage && (
                <div className="w-32 flex items-center justify-end gap-1 shrink-0">
                  {(st === 'submitted' || st === 'graded') && (
                    <button
                      onClick={() => router.push(`/more/exam/${exam.id}/grade/${row.student.id}`)}
                      className={EXAM.darkBtnSm}
                    >
                      <Pencil size={12} /> {locked || st === 'graded' ? 'Review' : 'Grade'}
                    </button>
                  )}
                  {!locked && (st === 'not_started' || st === 'in_progress') && (
                    <button
                      onClick={() => handleAbsent(row.student.id)}
                      disabled={busyId === row.student.id}
                      className={EXAM.dangerBtnSm}
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
          <div className="px-4 py-10 text-center">
            <p className="text-sm font-semibold text-[#18181B]">No participants yet</p>
            <p className="mt-1 text-xs text-[#A8A29A]">Add an audience in the Pre-Exam Manager to build the grading queue.</p>
          </div>
        )}
      </div>
    </div>
  )
}
