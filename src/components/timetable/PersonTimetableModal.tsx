'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { X, Loader2, CalendarRange, User, GraduationCap, Users } from 'lucide-react'
import {
  fetchTimetableForStaff,
  fetchTimetableForStudent,
  fetchTimetableForHomeroom,
  entryTeacherLabel,
} from '@/lib/timetable'
import type { TimetableViewData, TimetableEntry } from '@/lib/timetable'
import { fetchAllHomerooms } from '@/lib/homerooms'
import TimetableGrid from './TimetableGrid'

export type PersonKind = 'teacher' | 'student' | 'homeroom'

interface Props {
  kind: PersonKind
  id: string
  name: string
  onClose: () => void
}

const KIND_ICON: Record<PersonKind, typeof User> = {
  teacher: User,
  student: GraduationCap,
  homeroom: Users,
}

const KIND_LABEL: Record<PersonKind, string> = {
  teacher: 'Teacher timetable',
  student: 'Student timetable',
  homeroom: 'Class timetable',
}

// Admin viewer: click a teacher / student / homeroom name and see that
// person's published weekly timetable(s) across every active config.
export default function PersonTimetableModal({ kind, id, name, onClose }: Props) {
  const [loading, setLoading] = useState(true)
  const [views, setViews] = useState<TimetableViewData[]>([])
  const [homeroomNames, setHomeroomNames] = useState<Map<string, string>>(new Map())

  const load = useCallback(async () => {
    setLoading(true)
    const fetcher =
      kind === 'teacher'
        ? fetchTimetableForStaff
        : kind === 'student'
          ? fetchTimetableForStudent
          : fetchTimetableForHomeroom
    const [v, homerooms] = await Promise.all([fetcher(id), fetchAllHomerooms()])
    setViews(v)
    setHomeroomNames(new Map(homerooms.map((h) => [h.id, h.name])))
    setLoading(false)
  }, [kind, id])

  useEffect(() => {
    load()
  }, [load])

  // Close on Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // The secondary line under each subject depends on whose view this is.
  const secondary = (e: TimetableEntry): string | null => {
    if (kind === 'teacher') return homeroomNames.get(e.homeroom_id) ?? 'Class'
    return entryTeacherLabel(e)
  }

  const Icon = KIND_ICON[kind]

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4 bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-white w-full sm:max-w-4xl max-h-[92vh] flex flex-col border border-[#D4D4D8] shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-[#E4E4E7] bg-[#FAFAF9] flex-shrink-0">
          <div className="w-8 h-8 bg-[#27272A] flex items-center justify-center flex-shrink-0">
            <Icon className="text-[#B8983C]" size={16} strokeWidth={1.75} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-bold uppercase tracking-widest text-[#71717A]">{KIND_LABEL[kind]}</p>
            <p className="font-semibold text-[#18181B] text-sm truncate">{name}</p>
          </div>
          <button onClick={onClose} className="text-[#A1A1AA] hover:text-[#18181B] transition-colors flex-shrink-0">
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto p-4">
          {loading ? (
            <div className="flex justify-center py-16 text-[#A1A1AA]">
              <Loader2 className="animate-spin" size={22} />
            </div>
          ) : views.length === 0 ? (
            <div className="text-center py-14">
              <div className="w-12 h-12 mx-auto bg-[#F5F5F5] border border-[#E4E4E7] flex items-center justify-center mb-3">
                <CalendarRange className="text-[#A1A1AA]" size={22} strokeWidth={1.5} />
              </div>
              <p className="text-sm text-[#52525B] font-medium">No published timetable yet</p>
              <p className="text-xs text-[#A1A1AA] mt-1">
                Once a timetable covering {name} is published, it will show here.
              </p>
            </div>
          ) : (
            <div className="space-y-6">
              {views.map(({ config, slots, timetable, entries }) => (
                <div key={config.id} className="space-y-2">
                  <p className="text-sm text-[#71717A]">
                    <span className="font-medium text-[#18181B]">{config.name}</span>
                    {config.academic_year ? ` · ${config.academic_year}` : ''} · {entries.length} periods / week
                    {timetable.name ? ` · ${timetable.name}` : ''}
                  </p>
                  <TimetableGrid
                    days={config.working_days}
                    slots={slots}
                    entries={entries}
                    secondary={secondary}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
