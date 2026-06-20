'use client'

import React, { useEffect, useState } from 'react'
import { Save, Loader2, Check, Users, UserPlus } from 'lucide-react'
import Avatar from '@/components/Avatar'
import { supabase, UserProfile } from '@/lib/supabase'
import { Homeroom } from '@/lib/homerooms'
import { fetchAudience, setExamAudience, fetchProfilesByIds } from '@/lib/exam'
import AudiencePicker, { AudienceValue } from '@/components/exam/AudiencePicker'

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

  if (loading) return <div className="text-center py-10"><div className="spinner mx-auto" /></div>

  if (readOnly) {
    return (
      <div className="space-y-5">
        <div>
          <h3 className="text-sm font-semibold text-slate-700 mb-2 flex items-center gap-2"><Users size={15} /> Classes</h3>
          <div className="flex flex-wrap gap-2">
            {value.homerooms.map(hr => (
              <span key={hr.id} className="px-2.5 py-1 rounded-lg bg-amber-50 text-amber-700 text-sm border border-amber-200">{hr.name}</span>
            ))}
            {value.homerooms.length === 0 && <span className="text-xs text-slate-400">None</span>}
          </div>
        </div>
        <div>
          <h3 className="text-sm font-semibold text-slate-700 mb-2 flex items-center gap-2"><UserPlus size={15} /> Individual students</h3>
          <div className="space-y-1.5">
            {value.students.map(s => (
              <div key={s.id} className="flex items-center gap-2 py-1">
                <Avatar avatarUrl={s.avatar_url} name={s.full_name} size={28} userId={s.id} />
                <span className="text-sm text-slate-700 flex-1 truncate">{s.full_name}</span>
                <span className="text-xs text-slate-400 truncate">{s.email}</span>
              </div>
            ))}
            {value.students.length === 0 && <span className="text-xs text-slate-400">None</span>}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <AudiencePicker value={value} onChange={setValue} />
      <div className="flex justify-end">
        <button onClick={handleSave} disabled={saving} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-amber-500 text-white text-sm font-semibold hover:bg-amber-600 disabled:opacity-60">
          {saving ? <Loader2 size={14} className="animate-spin" /> : saved ? <Check size={14} /> : <Save size={14} />}
          {saved ? 'Saved' : 'Save participants'}
        </button>
      </div>
    </div>
  )
}
