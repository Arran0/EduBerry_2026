'use client'

import React, { useEffect, useState } from 'react'
import { Save, Loader2, Check, Users, UserPlus } from 'lucide-react'
import Avatar from '@/components/Avatar'
import { supabase, UserProfile } from '@/lib/supabase'
import { Homeroom } from '@/lib/homerooms'
import { fetchAudience, setExamAudience, fetchProfilesByIds } from '@/lib/exam'
import AudiencePicker, { AudienceValue } from '@/components/exam/AudiencePicker'
import { Skeleton } from '@/components/exam/examUi'

export default function AudienceEditor({ examId, readOnly = false, onChanged }: { examId: string; readOnly?: boolean; onChanged?: () => void }) {
  const [loading, setLoading] = useState(true)
  const [value, setValue] = useState<AudienceValue>({ homerooms: [], students: [] })
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    (async () => {
      setLoading(true)
      const audience = await fetchAudience(examId)
      const hrIds = audience.map(a => a.homeroom_id).filter((v): v is string => !!v)
      const uIds = audience.map(a => a.user_id).filter((v): v is string => !!v)
      const [hrRows, profiles] = await Promise.all([
        hrIds.length ? supabase.from('homerooms').select('*').in('id', hrIds) : Promise.resolve({ data: [] as Homeroom[] }),
        fetchProfilesByIds(uIds),
      ])
      setValue({ homerooms: (hrRows.data ?? []) as Homeroom[], students: profiles })
      setLoading(false)
    })()
  }, [examId])

  const handleSave = async () => {
    setSaving(true)
    setSaved(false)
    const ok = await setExamAudience(examId, {
      homeroomIds: value.homerooms.map(h => h.id),
      userIds: value.students.map(s => s.id),
    })
    setSaving(false)
    if (ok) { setSaved(true); onChanged?.(); setTimeout(() => setSaved(false), 2000) }
  }

  if (loading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex items-center gap-2 py-1">
            <Skeleton className="w-7 h-7 rounded-full shrink-0" />
            <Skeleton className="h-3.5 w-1/3" />
          </div>
        ))}
      </div>
    )
  }

  if (readOnly) {
    return (
      <div className="space-y-5">
        <div>
          <h3 className="text-sm font-semibold text-[#27272A] mb-2 flex items-center gap-2"><Users size={15} /> Classes</h3>
          <div className="flex flex-wrap gap-2">
            {value.homerooms.map(hr => (
              <span key={hr.id} className="px-2.5 py-1 rounded-lg bg-[var(--page-accent-light)] text-[var(--page-accent)] text-sm border border-[#E7E2D8]">{hr.name}</span>
            ))}
            {value.homerooms.length === 0 && <span className="text-xs text-[#A1A1AA]">None</span>}
          </div>
        </div>
        <div>
          <h3 className="text-sm font-semibold text-[#27272A] mb-2 flex items-center gap-2"><UserPlus size={15} /> Individual students</h3>
          <div className="space-y-1.5">
            {value.students.map(s => (
              <div key={s.id} className="flex items-center gap-2 py-1">
                <Avatar avatarUrl={s.avatar_url} name={s.full_name} size={28} userId={s.id} />
                <span className="text-sm text-[#27272A] flex-1 truncate">{s.full_name}</span>
                <span className="text-xs text-[#A1A1AA] truncate">{s.email}</span>
              </div>
            ))}
            {value.students.length === 0 && <span className="text-xs text-[#A1A1AA]">None</span>}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <AudiencePicker value={value} onChange={setValue} />
      <div className="flex justify-end">
        <button onClick={handleSave} disabled={saving} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#B8983C] text-white text-sm font-semibold hover:bg-[#9C7F2C] shadow-[0_4px_14px_-4px_rgba(184,152,60,0.5)] disabled:opacity-60 transition-colors">
          {saving ? <Loader2 size={14} className="animate-spin" /> : saved ? <Check size={14} /> : <Save size={14} />}
          {saved ? 'Saved' : 'Save participants'}
        </button>
      </div>
    </div>
  )
}
