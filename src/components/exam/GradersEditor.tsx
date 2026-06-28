'use client'

import React, { useCallback, useEffect, useState } from 'react'
import { Plus, X, Shield, Loader2, Crown } from 'lucide-react'
import Avatar from '@/components/Avatar'
import { UserProfile } from '@/lib/supabase'
import {
  ExamGrader, fetchGraders, addGrader, removeGrader, findUserByEmail, fetchProfilesByIds,
} from '@/lib/exam'
import { Skeleton } from '@/components/exam/examUi'
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
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex items-center gap-2 py-1">
            <Skeleton className="w-7 h-7 rounded-full shrink-0" />
            <Skeleton className="h-3.5 w-1/3" />
          </div>
        ))}
      </div>
    )
  }

  // The creator is always a grader; never list them twice or allow removal.
  const otherGraders = graders.filter(g => g.teacher_id !== createdBy)

  return (
    <div className="space-y-4">
      <p className="text-sm text-[#71717A] flex items-center gap-2">
        <Shield size={15} /> Graders can grade this exam and see it in their own exam lists.
      </p>

      <div className="space-y-1.5">
        {/* Exam creator */}
        {creator && (
          <div className="flex items-center gap-2 py-1">
            <Avatar avatarUrl={creator.avatar_url} name={creator.full_name} size={28} userId={creator.id} />
            <span className="text-sm text-[#27272A] flex-1 truncate">{creator.full_name}</span>
            <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-[var(--page-accent-light)] text-[var(--page-accent)] border border-[#E7E2D8]">
              <Crown size={10} /> Creator
            </span>
          </div>
        )}

        {otherGraders.map(g => (
          <div key={g.id} className="flex items-center gap-2 py-1">
            <Avatar avatarUrl={g.teacher?.avatar_url} name={g.teacher?.full_name} size={28} userId={g.teacher_id} />
            <span className="text-sm text-[#27272A] flex-1 truncate">{g.teacher?.full_name ?? 'Teacher'}</span>
            <span className="text-xs text-[#A1A1AA] truncate">{g.teacher?.email}</span>
            {canEdit && <button onClick={() => handleRemove(g.teacher_id)} className="text-[#D4D4D8] hover:text-rose-400 transition-colors"><X size={14} /></button>}
          </div>
        ))}
        {otherGraders.length === 0 && <span className="text-xs text-[#A1A1AA]">No additional graders</span>}
      </div>

      {canEdit && (
        <>
          <div className="flex items-center gap-2">
            <div className="flex-1 min-w-0">
              <UserEmailSuggest
                value={email}
                onChange={setEmail}
                roles={[...STAFF_ROLES]}
                placeholder="Search staff by name or email"
                className="border border-[#E4E4E7] rounded-lg px-3 py-2 bg-white focus-within:border-[var(--page-primary)] transition-colors"
              />
            </div>
            <button onClick={handleAdd} disabled={busy || !email.trim()} className="shrink-0 px-3 py-2 rounded-lg bg-[var(--page-primary)] text-white hover:bg-[var(--page-primary-dark)] disabled:opacity-60 transition-colors">
              {busy ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
            </button>
          </div>
          <p className="text-[11px] text-[#A1A1AA]">Only staff members can be added as graders.</p>
          {err && <p className="text-xs text-rose-500">{err}</p>}
        </>
      )}
    </div>
  )
}
