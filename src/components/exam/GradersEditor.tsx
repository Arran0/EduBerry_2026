'use client'

import React, { useCallback, useEffect, useState } from 'react'
import { Plus, X, Shield, Loader2, Crown } from 'lucide-react'
import Avatar from '@/components/Avatar'
import { UserProfile } from '@/lib/supabase'
import {
  ExamGrader, fetchGraders, addGrader, removeGrader, findUserByEmail, fetchProfilesByIds,
} from '@/lib/exam'
import { EXAM, Skeleton } from '@/components/exam/examUi'
import UserEmailSuggest from '@/components/UserEmailSuggest'

const STAFF_ROLES = ['teacher', 'coordinator', 'principal', 'admin'] as const

export default function GradersEditor({
  examId,
  createdBy,
  currentUserId,
  canEdit,
}: {
  examId: string
  createdBy: string | null
  currentUserId: string
  canEdit: boolean
}) {
  const [graders, setGraders] = useState<ExamGrader[]>([])
  const [creator, setCreator] = useState<UserProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [email, setEmail] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const [g, profs] = await Promise.all([
      fetchGraders(examId),
      createdBy ? fetchProfilesByIds([createdBy]) : Promise.resolve([] as UserProfile[]),
    ])
    setGraders(g)
    setCreator(profs[0] ?? null)
    setLoading(false)
  }, [examId, createdBy])

  useEffect(() => { load() }, [load])

  const handleAdd = async () => {
    setErr(null)
    setBusy(true)
    const { user, error } = await findUserByEmail(email, [...STAFF_ROLES])
    if (error || !user) { setErr(error ?? 'Not found'); setBusy(false); return }
    const ok = await addGrader(examId, user.id, currentUserId)
    setBusy(false)
    if (!ok) { setErr('Could not add (already a grader?)'); return }
    setEmail('')
    load()
  }

  const handleRemove = async (teacherId: string) => {
    await removeGrader(examId, teacherId)
    load()
  }

  if (loading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-4 w-2/3 mb-4" />
        <div className={EXAM.listWrap}>
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 px-3 py-2.5">
              <Skeleton className="w-7 h-7 rounded-full shrink-0" />
              <Skeleton className="h-3.5 w-1/3" />
            </div>
          ))}
        </div>
      </div>
    )
  }

  // The creator is always a grader; never list them twice or allow removal.
  const otherGraders = graders.filter(g => g.teacher_id !== createdBy)

  return (
    <div className="space-y-4">
      <p className="flex items-start gap-2 text-[11px] leading-relaxed text-[#8A8578]">
        <Shield size={14} className="mt-px text-[#B8983C] shrink-0" />
        Graders can grade this exam and see it in their own exam lists.
      </p>

      <div className={EXAM.listWrap}>
        <div className={EXAM.listHead}>
          <span className="w-7 shrink-0" />
          <span className="flex-1">Name</span>
          <span className="w-56">Email</span>
          <span className="w-24 text-right">Role</span>
        </div>

        {/* Exam creator */}
        {creator && (
          <div className={EXAM.listRow}>
            <Avatar avatarUrl={creator.avatar_url} name={creator.full_name} size={28} userId={creator.id} />
            <span className="flex-1 min-w-0 truncate text-sm font-medium text-[#18181B]">{creator.full_name}</span>
            <span className="hidden md:block w-56 truncate text-xs text-[#A8A29A]">{creator.email}</span>
            <span className="w-24 flex justify-end shrink-0">
              <span className={EXAM.tagGold}><Crown size={10} /> Owner</span>
            </span>
          </div>
        )}

        {otherGraders.map(g => (
          <div key={g.id} className={EXAM.listRow}>
            <Avatar avatarUrl={g.teacher?.avatar_url} name={g.teacher?.full_name} size={28} userId={g.teacher_id} />
            <span className="flex-1 min-w-0 truncate text-sm font-medium text-[#18181B]">{g.teacher?.full_name ?? 'Teacher'}</span>
            <span className="hidden md:block w-56 truncate text-xs text-[#A8A29A]">{g.teacher?.email}</span>
            <span className="w-24 flex items-center justify-end gap-1 shrink-0">
              <span className={EXAM.tag}>Grader</span>
              {canEdit && (
                <button
                  onClick={() => handleRemove(g.teacher_id)}
                  title="Remove grader"
                  className="h-6 w-6 flex items-center justify-center text-[#C7C2B6] hover:text-rose-600 hover:bg-rose-50 transition-colors"
                >
                  <X size={13} />
                </button>
              )}
            </span>
          </div>
        ))}
        {otherGraders.length === 0 && (
          <p className="px-3 py-4 text-center text-[11px] uppercase tracking-[0.1em] text-[#C7C2B6]">No additional graders</p>
        )}
      </div>

      {canEdit && (
        <div className="space-y-2">
          <label className={EXAM.fieldLabel}>Add a grader</label>
          <div className="flex items-center gap-2">
            <div className="flex-1 min-w-0">
              <UserEmailSuggest
                value={email}
                onChange={setEmail}
                roles={[...STAFF_ROLES]}
                placeholder="Search staff by name or email"
                className="h-9 flex items-center border border-[#E4E1D8] px-3 bg-white focus-within:border-[#B8983C] transition-colors"
              />
            </div>
            <button onClick={handleAdd} disabled={busy || !email.trim()} className={EXAM.iconBtnDark}>
              {busy ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
            </button>
          </div>
          <p className={EXAM.hint}>Only staff members can be added as graders.</p>
          {err && <p className={EXAM.error}>{err}</p>}
        </div>
      )}
    </div>
  )
}
