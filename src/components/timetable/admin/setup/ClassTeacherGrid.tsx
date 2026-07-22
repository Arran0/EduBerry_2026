'use client'

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { Loader2, Check, X } from 'lucide-react'
import { fetchAllHomerooms, updateHomeroomClassTeacher } from '@/lib/homerooms'
import type { Homeroom } from '@/lib/homerooms'
import { fetchAllProfiles } from '@/lib/admin'
import { isStaffRole } from '@/lib/supabase'
import type { UserProfile } from '@/lib/supabase'
import { Section } from '../../ui'
import NameLink from '../../NameLink'
import SmartTypeahead from '@/components/SmartTypeahead'

/**
 * Excel-style bulk class-teacher assignment: one row per homeroom, a
 * typeahead-in-cell for the class teacher, and Tab / Enter to move down the
 * column. Replaces the old grid-of-cards. Shares `updateHomeroomClassTeacher`
 * with the Homeroom hub's per-homeroom picker.
 */
export default function ClassTeacherGrid() {
  const [homerooms, setHomerooms] = useState<Homeroom[]>([])
  const [teachers, setTeachers] = useState<UserProfile[]>([])
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState<string | null>(null)
  // Per-row draft query text (empty string = show the assigned teacher).
  const [queries, setQueries] = useState<Record<string, string>>({})
  const inputRefs = useRef<Record<string, React.RefObject<HTMLInputElement | null>>>({})

  const load = useCallback(async () => {
    setLoading(true)
    const [hr, profiles] = await Promise.all([fetchAllHomerooms(), fetchAllProfiles()])
    setHomerooms(hr)
    setTeachers(profiles.filter((p) => isStaffRole(p.role)))
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  // Stable input refs keyed by homeroom id, for Tab/Enter focus movement.
  const getRef = (id: string) => {
    if (!inputRefs.current[id]) inputRefs.current[id] = React.createRef<HTMLInputElement>()
    return inputRefs.current[id]
  }

  const teacherName = (id: string | null) =>
    id ? teachers.find((t) => t.id === id)?.full_name ?? 'Unknown' : null

  const focusRow = (index: number) => {
    const next = homerooms[index]
    if (next) getRef(next.id).current?.focus()
  }

  const save = async (homeroomId: string, teacherId: string | null, rowIndex: number) => {
    setSavingId(homeroomId)
    const ok = await updateHomeroomClassTeacher(homeroomId, teacherId)
    setSavingId(null)
    if (ok) {
      setHomerooms((prev) => prev.map((h) => (h.id === homeroomId ? { ...h, class_teacher_id: teacherId } : h)))
      setQueries((q) => ({ ...q, [homeroomId]: '' }))
      focusRow(rowIndex + 1)  // excel-style: drop to the next row
    }
  }

  const suggestionsFor = (query: string): UserProfile[] => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    return teachers.filter((t) => t.full_name?.toLowerCase().includes(q) || t.email?.toLowerCase().includes(q))
  }

  return (
    <Section
      title="Class teachers"
      hint="One class teacher per homeroom. Type a name, press Enter to assign and drop to the next row. Click any class or teacher name to view its week."
    >
      {loading ? (
        <div className="flex justify-center py-6 text-[#A1A1AA]"><Loader2 className="animate-spin" size={18} /></div>
      ) : homerooms.length === 0 ? (
        <p className="text-xs text-[#A1A1AA] py-2">No homerooms yet.</p>
      ) : (
        <div className="border border-[#D4D4D8] overflow-x-auto">
          <table className="w-full border-collapse text-sm min-w-[32rem]">
            <thead>
              <tr className="bg-[#FAFAF9]">
                <th className="text-left px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-[#525252] w-1/2">Homeroom</th>
                <th className="text-left px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-[#525252] border-l border-[#E4E4E7]">Class teacher</th>
              </tr>
            </thead>
            <tbody>
              {homerooms.map((h, i) => {
                const draft = queries[h.id] ?? ''
                const assigned = teacherName(h.class_teacher_id)
                return (
                  <tr key={h.id} className="border-t border-[#E4E4E7]">
                    <td className="px-3 py-1.5 align-middle">
                      <NameLink kind="homeroom" id={h.id} name={h.name} className="font-medium text-[#18181B]" />
                    </td>
                    <td className="px-2 py-1 align-middle border-l border-[#E4E4E7]">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 min-w-0">
                          <SmartTypeahead<UserProfile>
                            inputRef={getRef(h.id)}
                            query={draft}
                            onQueryChange={(v) => setQueries((q) => ({ ...q, [h.id]: v }))}
                            suggestions={suggestionsFor(draft)}
                            onSelect={(t) => save(h.id, t.id, i)}
                            getKey={(t) => t.id}
                            placeholder={savingId === h.id ? 'Saving…' : assigned ?? 'Assign…'}
                            className="flex items-center gap-2 border border-[#E4E4E7] bg-white px-2.5 py-1.5 focus-within:border-[#27272A] transition-colors"
                            renderSuggestion={(t, active) => (
                              <div className={`px-3 py-2 text-sm ${active ? 'bg-[#F5F5F5]' : 'bg-white'}`}>
                                <div className="font-medium text-[#18181B]">{t.full_name}</div>
                                <div className="text-[11px] text-[#71717A]">{t.email}</div>
                              </div>
                            )}
                          />
                        </div>
                        {h.class_teacher_id && !draft && (
                          <span className="inline-flex items-center gap-1 text-[11px] text-emerald-700 flex-shrink-0">
                            <Check size={12} />
                            <NameLink kind="teacher" id={h.class_teacher_id} name={assigned ?? 'Unknown'} className="hidden sm:inline" />
                            <button onClick={() => save(h.id, null, i)} className="text-[#A1A1AA] hover:text-rose-500" title="Clear"><X size={13} /></button>
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  )
}
