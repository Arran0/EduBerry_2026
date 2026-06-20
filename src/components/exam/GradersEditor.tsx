'use client'

import React, { useCallback, useEffect, useState } from 'react'
import { Plus, X, Shield, Loader2 } from 'lucide-react'
import Avatar from '@/components/Avatar'
import { ExamGrader, fetchGraders, addGrader, removeGrader, findUserByEmail } from '@/lib/exam'

const STAFF_ROLES = ['teacher', 'coordinator', 'principal', 'admin'] as const

export default function GradersEditor({
  examId,
  currentUserId,
  canEdit,
}: {
  examId: string
  currentUserId: string
  canEdit: boolean
}) {
  const [graders, setGraders] = useState<ExamGrader[]>([])
  const [loading, setLoading] = useState(true)
  const [email, setEmail] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setGraders(await fetchGraders(examId))
    setLoading(false)
  }, [examId])

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

  if (loading) return <div className="text-center py-10"><div className="spinner mx-auto" /></div>

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-500 flex items-center gap-2">
        <Shield size={15} /> Graders can grade this exam and see it in their own exam lists.
      </p>

      <div className="space-y-1.5">
        {graders.map(g => (
          <div key={g.id} className="flex items-center gap-2 py-1">
            <Avatar avatarUrl={g.teacher?.avatar_url} name={g.teacher?.full_name} size={28} userId={g.teacher_id} />
            <span className="text-sm text-slate-700 flex-1 truncate">{g.teacher?.full_name ?? 'Teacher'}</span>
            <span className="text-xs text-slate-400 truncate">{g.teacher?.email}</span>
            {canEdit && <button onClick={() => handleRemove(g.teacher_id)} className="text-slate-300 hover:text-rose-400"><X size={14} /></button>}
          </div>
        ))}
        {graders.length === 0 && <span className="text-xs text-slate-400">No additional graders</span>}
      </div>

      {canEdit && (
        <>
          <div className="flex items-center gap-2">
            <input
              className="flex-1 border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-200"
              placeholder="Add grader by teacher email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleAdd()}
            />
            <button onClick={handleAdd} disabled={busy} className="px-3 py-2 rounded-xl bg-slate-100 text-slate-600 hover:bg-slate-200 disabled:opacity-60">
              {busy ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
            </button>
          </div>
          {err && <p className="text-xs text-rose-500">{err}</p>}
        </>
      )}
    </div>
  )
}
