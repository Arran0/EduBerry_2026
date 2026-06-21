'use client'

import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Search, X, School, UserPlus, Users } from 'lucide-react'
import Avatar from '@/components/Avatar'
import { UserProfile } from '@/lib/supabase'
import { Homeroom, searchHomerooms, homeroomGradeSectionBadge } from '@/lib/homerooms'
import { searchStudents } from '@/lib/exam'

export interface AudienceValue {
  homerooms: Homeroom[]
  students: UserProfile[]
}

/**
 * Controlled participant picker for an exam: add one or more homerooms
 * (classes) and/or individual students. Neither search bar is shown until
 * the teacher taps "Add class" / "Add student" — mirroring the "Add member"
 * affordance on the New Announcement card. Used by the create sheet and the
 * exam detail Participants tab.
 */
export default function AudiencePicker({
  value,
  onChange,
}: {
  value: AudienceValue
  onChange: (next: AudienceValue) => void
}) {
  const [showHrSearch, setShowHrSearch] = useState(false)
  const [hrQuery, setHrQuery] = useState('')
  const [hrResults, setHrResults] = useState<Homeroom[]>([])
  const hrInputRef = useRef<HTMLInputElement>(null)

  const [showStSearch, setShowStSearch] = useState(false)
  const [stQuery, setStQuery] = useState('')
  const [stResults, setStResults] = useState<UserProfile[]>([])
  const [searchingSt, setSearchingSt] = useState(false)
  const stInputRef = useRef<HTMLInputElement>(null)
  const stTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Homeroom search (debounced)
  useEffect(() => {
    if (!hrQuery.trim()) { setHrResults([]); return }
    let active = true
    const t = setTimeout(() => {
      searchHomerooms(hrQuery).then(r => {
        if (!active) return
        const have = new Set(value.homerooms.map(h => h.id))
        setHrResults(r.filter(h => !have.has(h.id)))
      })
    }, 250)
    return () => { active = false; clearTimeout(t) }
  }, [hrQuery, value.homerooms])

  // Student search (debounced)
  useEffect(() => {
    if (stTimer.current) clearTimeout(stTimer.current)
    if (!stQuery.trim()) { setStResults([]); setSearchingSt(false); return }
    setSearchingSt(true)
    stTimer.current = setTimeout(async () => {
      const r = await searchStudents(stQuery)
      const have = new Set(value.students.map(s => s.id))
      setStResults(r.filter(s => !have.has(s.id)))
      setSearchingSt(false)
    }, 300)
    return () => { if (stTimer.current) clearTimeout(stTimer.current) }
  }, [stQuery, value.students])

  const addHomeroom = (hr: Homeroom) => {
    if (!value.homerooms.some(h => h.id === hr.id)) {
      onChange({ ...value, homerooms: [...value.homerooms, hr] })
    }
    setHrQuery(''); setHrResults([]); hrInputRef.current?.focus()
  }
  const removeHomeroom = (id: string) =>
    onChange({ ...value, homerooms: value.homerooms.filter(h => h.id !== id) })

  const addStudent = (s: UserProfile) => {
    if (!value.students.some(x => x.id === s.id)) {
      onChange({ ...value, students: [...value.students, s] })
    }
    setStQuery(''); setStResults([]); stInputRef.current?.focus()
  }
  const removeStudent = (id: string) =>
    onChange({ ...value, students: value.students.filter(s => s.id !== id) })

  const total = value.homerooms.length + value.students.length

  const toggleBtn = (active: boolean) =>
    `flex items-center gap-1 text-xs font-medium px-2.5 py-1.5 rounded-lg transition-colors ${
      active ? 'bg-[#27272A] text-white' : 'text-[#71717A] hover:text-[#27272A] hover:bg-[#F4F4F5]'
    }`

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-[#27272A] flex items-center gap-1.5">
          <Users size={15} /> Participants
        </h3>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => { setShowHrSearch(p => !p); setHrQuery(''); setHrResults([]) }}
            className={toggleBtn(showHrSearch)}
          >
            <School size={13} /> Add class
          </button>
          <button
            type="button"
            onClick={() => { setShowStSearch(p => !p); setStQuery(''); setStResults([]) }}
            className={toggleBtn(showStSearch)}
          >
            <UserPlus size={13} /> Add student
          </button>
        </div>
      </div>

      {/* Class search */}
      {showHrSearch && (
        <div className="relative">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#A1A1AA] pointer-events-none" />
          <input
            ref={hrInputRef}
            value={hrQuery}
            onChange={e => setHrQuery(e.target.value)}
            placeholder="Search class — e.g. 9A, Grade 10…"
            className="w-full bg-white border border-[#E4E4E7] rounded-lg pl-8 pr-3 py-2 text-sm text-[#27272A] focus:outline-none focus:border-[#27272A] transition-colors"
            autoFocus
          />
          {hrResults.length > 0 && hrInputRef.current && createPortal(
            <div
              className="bg-white border border-[#E4E4E7] rounded-xl shadow-2xl overflow-hidden max-h-56 overflow-y-auto"
              style={dropdownStyle(hrInputRef.current)}
            >
              {hrResults.map(hr => (
                <button
                  key={hr.id}
                  type="button"
                  onClick={() => addHomeroom(hr)}
                  className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-[#FAFAFA] transition-colors text-left"
                >
                  <span className="text-sm text-[#27272A]">{hr.name}</span>
                  <span className="text-xs text-[#A1A1AA]">{homeroomGradeSectionBadge(hr)}</span>
                </button>
              ))}
            </div>,
            document.body,
          )}
        </div>
      )}

      {/* Student search */}
      {showStSearch && (
        <div className="relative">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#A1A1AA] pointer-events-none" />
          <input
            ref={stInputRef}
            value={stQuery}
            onChange={e => setStQuery(e.target.value)}
            placeholder="Search students by name or email…"
            className="w-full bg-white border border-[#E4E4E7] rounded-lg pl-8 pr-3 py-2 text-sm text-[#27272A] focus:outline-none focus:border-[#27272A] transition-colors"
            autoFocus
          />
          {(stResults.length > 0 || searchingSt) && stQuery.trim() && stInputRef.current && createPortal(
            <div
              className="bg-white border border-[#E4E4E7] rounded-xl shadow-2xl overflow-hidden max-h-64 overflow-y-auto"
              style={dropdownStyle(stInputRef.current)}
            >
              {searchingSt && stResults.length === 0 ? (
                <div className="px-3 py-2 text-sm text-[#A1A1AA]">Searching…</div>
              ) : (
                stResults.map(s => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => addStudent(s)}
                    className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-[#FAFAFA] transition-colors text-left"
                  >
                    <Avatar avatarUrl={s.avatar_url} name={s.full_name} size={28} userId={s.id} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-[#27272A] truncate">{s.full_name}</p>
                      <p className="text-xs text-[#A1A1AA] truncate">{s.email}</p>
                    </div>
                  </button>
                ))
              )}
            </div>,
            document.body,
          )}
        </div>
      )}

      {/* Selected chips */}
      {total > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {value.homerooms.map(hr => (
            <span key={hr.id} className="inline-flex items-center gap-1 pl-2 pr-1.5 py-1 rounded-full bg-[#F4F2EC] text-[#8A6D1F] text-xs font-medium border border-[#E7E2D8]">
              <School size={11} /> {hr.name}
              <button type="button" onClick={() => removeHomeroom(hr.id)} className="ml-0.5 hover:text-rose-500 transition-colors"><X size={11} /></button>
            </span>
          ))}
          {value.students.map(s => (
            <span key={s.id} className="inline-flex items-center gap-1.5 pl-1 pr-2 py-0.5 rounded-full bg-[#F4F4F5] text-[#27272A] text-xs font-medium border border-[#E4E4E7]">
              <Avatar avatarUrl={s.avatar_url} name={s.full_name} size={16} userId={s.id} />
              {s.full_name}
              <button type="button" onClick={() => removeStudent(s.id)} className="ml-0.5 text-[#A1A1AA] hover:text-rose-500 transition-colors"><X size={11} /></button>
            </span>
          ))}
        </div>
      ) : (
        <p className="text-xs text-[#A1A1AA]">No participants yet — add a class or individual students.</p>
      )}
    </div>
  )
}

function dropdownStyle(el: HTMLElement): React.CSSProperties {
  const r = el.getBoundingClientRect()
  return { position: 'fixed', top: r.bottom + 4, left: r.left, width: r.width, zIndex: 9999 }
}
