'use client'

import React, { useEffect, useState } from 'react'
import { Search, X, Plus, Users, Save, Loader2, Check, UserPlus } from 'lucide-react'
import Avatar from '@/components/Avatar'
import { supabase, UserProfile } from '@/lib/supabase'
import {
  Homeroom, searchHomerooms, homeroomGradeSectionBadge,
} from '@/lib/homerooms'
import {
  fetchAudience, setExamAudience, fetchProfilesByIds, findUserByEmail,
} from '@/lib/exam'

export default function AudienceEditor({ examId, readOnly = false }: { examId: string; readOnly?: boolean }) {
  const [loading, setLoading] = useState(true)
  const [homerooms, setHomerooms] = useState<Homeroom[]>([])
  const [students, setStudents] = useState<UserProfile[]>([])
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Homeroom[]>([])
  const [email, setEmail] = useState('')
  const [emailErr, setEmailErr] = useState<string | null>(null)
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
      setHomerooms((hrRows.data ?? []) as Homeroom[])
      setStudents(profiles)
      setLoading(false)
    })()
  }, [examId])

  useEffect(() => {
    if (!query.trim()) { setResults([]); return }
    let active = true
    searchHomerooms(query).then(r => { if (active) setResults(r) })
    return () => { active = false }
  }, [query])

  const addHomeroom = (hr: Homeroom) => {
    if (!homerooms.some(h => h.id === hr.id)) setHomerooms([...homerooms, hr])
    setQuery('')
    setResults([])
  }

  const addStudent = async () => {
    setEmailErr(null)
    const { user, error } = await findUserByEmail(email, ['student'])
    if (error || !user) { setEmailErr(error ?? 'Not found'); return }
    if (!students.some(s => s.id === user.id)) setStudents([...students, user])
    setEmail('')
  }

  const handleSave = async () => {
    setSaving(true)
    setSaved(false)
    const ok = await setExamAudience(examId, {
      homeroomIds: homerooms.map(h => h.id),
      userIds: students.map(s => s.id),
    })
    setSaving(false)
    if (ok) { setSaved(true); setTimeout(() => setSaved(false), 2000) }
  }

  if (loading) return <div className="text-center py-10"><div className="spinner mx-auto" /></div>

  return (
    <div className="space-y-5">
      {/* Homerooms */}
      <div>
        <h3 className="text-sm font-semibold text-slate-700 mb-2 flex items-center gap-2"><Users size={15} /> Homerooms</h3>
        <div className="flex flex-wrap gap-2 mb-2">
          {homerooms.map(hr => (
            <span key={hr.id} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-50 text-amber-700 text-sm border border-amber-200">
              {hr.name}
              {!readOnly && <button onClick={() => setHomerooms(homerooms.filter(h => h.id !== hr.id))}><X size={13} /></button>}
            </span>
          ))}
          {homerooms.length === 0 && <span className="text-xs text-slate-400">None added</span>}
        </div>
        {!readOnly && (
          <div className="relative">
            <div className="flex items-center gap-2 border border-slate-200 rounded-xl px-3 py-2">
              <Search size={15} className="text-slate-400" />
              <input className="flex-1 text-sm focus:outline-none" placeholder="Search homerooms (e.g. 7A)" value={query} onChange={e => setQuery(e.target.value)} />
            </div>
            {results.length > 0 && (
              <div className="absolute z-10 mt-1 w-full bg-white border border-slate-200 rounded-xl shadow-lg max-h-56 overflow-y-auto">
                {results.map(hr => (
                  <button key={hr.id} onClick={() => addHomeroom(hr)} className="w-full text-left px-3 py-2 hover:bg-slate-50 flex items-center justify-between">
                    <span className="text-sm text-slate-700">{hr.name}</span>
                    <span className="text-xs text-slate-400">{homeroomGradeSectionBadge(hr)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Individual students */}
      <div>
        <h3 className="text-sm font-semibold text-slate-700 mb-2 flex items-center gap-2"><UserPlus size={15} /> Individual students</h3>
        <div className="space-y-1.5 mb-2">
          {students.map(s => (
            <div key={s.id} className="flex items-center gap-2 py-1">
              <Avatar avatarUrl={s.avatar_url} name={s.full_name} size={28} userId={s.id} />
              <span className="text-sm text-slate-700 flex-1 truncate">{s.full_name}</span>
              <span className="text-xs text-slate-400 truncate">{s.email}</span>
              {!readOnly && <button onClick={() => setStudents(students.filter(x => x.id !== s.id))} className="text-slate-300 hover:text-rose-400"><X size={14} /></button>}
            </div>
          ))}
          {students.length === 0 && <span className="text-xs text-slate-400">None added</span>}
        </div>
        {!readOnly && (
          <div className="flex items-center gap-2">
            <input
              className="flex-1 border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-200"
              placeholder="Add by student email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addStudent()}
            />
            <button onClick={addStudent} className="px-3 py-2 rounded-xl bg-slate-100 text-slate-600 hover:bg-slate-200"><Plus size={16} /></button>
          </div>
        )}
        {emailErr && <p className="text-xs text-rose-500 mt-1">{emailErr}</p>}
      </div>

      {!readOnly && (
        <div className="flex justify-end">
          <button onClick={handleSave} disabled={saving} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-amber-500 text-white text-sm font-semibold hover:bg-amber-600 disabled:opacity-60">
            {saving ? <Loader2 size={14} className="animate-spin" /> : saved ? <Check size={14} /> : <Save size={14} />}
            {saved ? 'Saved' : 'Save audience'}
          </button>
        </div>
      )}
    </div>
  )
}
