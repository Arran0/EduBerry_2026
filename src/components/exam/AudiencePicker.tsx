'use client'

import React, { useEffect, useRef, useState } from 'react'
import { Search, X, Users, UserPlus } from 'lucide-react'
import Avatar from '@/components/Avatar'
import { UserProfile } from '@/lib/supabase'
import { Homeroom, searchHomerooms, homeroomGradeSectionBadge } from '@/lib/homerooms'
import { searchStudents } from '@/lib/exam'

export interface AudienceValue {
  homerooms: Homeroom[]
  students: UserProfile[]
}

/**
 * Controlled smart-search picker for exam participants: add one or more
 * homerooms and/or individual students. Used both in the create flow
 * (local selection, persisted after the exam is created) and in the
 * exam detail Audience tab.
 */
export default function AudiencePicker({
  value,
  onChange,
}: {
  value: AudienceValue
  onChange: (next: AudienceValue) => void
}) {
  const [hrQuery, setHrQuery] = useState('')
  const [hrResults, setHrResults] = useState<Homeroom[]>([])
  const [stQuery, setStQuery] = useState('')
  const [stResults, setStResults] = useState<UserProfile[]>([])
  const [searchingSt, setSearchingSt] = useState(false)
  const stTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Homeroom search (debounced)
  useEffect(() => {
    if (!hrQuery.trim()) { setHrResults([]); return }
    let active = true
    const t = setTimeout(() => {
      searchHomerooms(hrQuery).then(r => { if (active) setHrResults(r) })
    }, 250)
    return () => { active = false; clearTimeout(t) }
  }, [hrQuery])

  // Student search (debounced)
  useEffect(() => {
    if (stTimer.current) clearTimeout(stTimer.current)
    if (!stQuery.trim()) { setStResults([]); setSearchingSt(false); return }
    setSearchingSt(true)
    stTimer.current = setTimeout(async () => {
      const r = await searchStudents(stQuery)
      setStResults(r)
      setSearchingSt(false)
    }, 300)
    return () => { if (stTimer.current) clearTimeout(stTimer.current) }
  }, [stQuery])

  const addHomeroom = (hr: Homeroom) => {
    if (!value.homerooms.some(h => h.id === hr.id)) {
      onChange({ ...value, homerooms: [...value.homerooms, hr] })
    }
    setHrQuery(''); setHrResults([])
  }
  const removeHomeroom = (id: string) =>
    onChange({ ...value, homerooms: value.homerooms.filter(h => h.id !== id) })

  const addStudent = (s: UserProfile) => {
    if (!value.students.some(x => x.id === s.id)) {
      onChange({ ...value, students: [...value.students, s] })
    }
    setStQuery(''); setStResults([])
  }
  const removeStudent = (id: string) =>
    onChange({ ...value, students: value.students.filter(s => s.id !== id) })

  const total = value.homerooms.length + value.students.length

  return (
    <div className="space-y-5">
      {/* Homerooms */}
      <div>
        <h3 className="text-sm font-semibold text-slate-700 mb-2 flex items-center gap-2"><Users size={15} /> Homerooms</h3>
        {value.homerooms.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-2">
            {value.homerooms.map(hr => (
              <span key={hr.id} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-50 text-amber-700 text-sm border border-amber-200">
                {hr.name}
                <button onClick={() => removeHomeroom(hr.id)}><X size={13} /></button>
              </span>
            ))}
          </div>
        )}
        <div className="relative">
          <div className="flex items-center gap-2 border border-slate-200 rounded-xl px-3 py-2">
            <Search size={15} className="text-slate-400" />
            <input className="flex-1 text-sm focus:outline-none bg-transparent" placeholder="Search homerooms (e.g. 7A, Grade 9)" value={hrQuery} onChange={e => setHrQuery(e.target.value)} />
          </div>
          {hrResults.length > 0 && (
            <div className="absolute z-20 mt-1 w-full bg-white border border-slate-200 rounded-xl shadow-lg max-h-56 overflow-y-auto">
              {hrResults.map(hr => (
                <button key={hr.id} onClick={() => addHomeroom(hr)} className="w-full text-left px-3 py-2 hover:bg-slate-50 flex items-center justify-between">
                  <span className="text-sm text-slate-700">{hr.name}</span>
                  <span className="text-xs text-slate-400">{homeroomGradeSectionBadge(hr)}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Individual students */}
      <div>
        <h3 className="text-sm font-semibold text-slate-700 mb-2 flex items-center gap-2"><UserPlus size={15} /> Individual students</h3>
        {value.students.length > 0 && (
          <div className="space-y-1.5 mb-2">
            {value.students.map(s => (
              <div key={s.id} className="flex items-center gap-2 py-1">
                <Avatar avatarUrl={s.avatar_url} name={s.full_name} size={28} userId={s.id} />
                <span className="text-sm text-slate-700 flex-1 truncate">{s.full_name}</span>
                <span className="text-xs text-slate-400 truncate">{s.email}</span>
                <button onClick={() => removeStudent(s.id)} className="text-slate-300 hover:text-rose-400"><X size={14} /></button>
              </div>
            ))}
          </div>
        )}
        <div className="relative">
          <div className="flex items-center gap-2 border border-slate-200 rounded-xl px-3 py-2">
            <Search size={15} className="text-slate-400" />
            <input className="flex-1 text-sm focus:outline-none bg-transparent" placeholder="Search students by name or email" value={stQuery} onChange={e => setStQuery(e.target.value)} />
          </div>
          {(stResults.length > 0 || searchingSt) && stQuery.trim() && (
            <div className="absolute z-20 mt-1 w-full bg-white border border-slate-200 rounded-xl shadow-lg max-h-64 overflow-y-auto">
              {searchingSt && stResults.length === 0 ? (
                <div className="px-3 py-2 text-sm text-slate-400">Searching…</div>
              ) : (
                stResults.map(s => (
                  <button key={s.id} onClick={() => addStudent(s)} className="w-full text-left px-3 py-2 hover:bg-slate-50 flex items-center gap-2">
                    <Avatar avatarUrl={s.avatar_url} name={s.full_name} size={26} userId={s.id} />
                    <span className="text-sm text-slate-700 flex-1 truncate">{s.full_name}</span>
                    <span className="text-xs text-slate-400 truncate">{s.email}</span>
                  </button>
                ))
              )}
            </div>
          )}
        </div>
      </div>

      <p className="text-xs text-slate-400">{total === 0 ? 'No participants selected yet.' : `${value.homerooms.length} homeroom(s) + ${value.students.length} student(s) selected.`}</p>
    </div>
  )
}
