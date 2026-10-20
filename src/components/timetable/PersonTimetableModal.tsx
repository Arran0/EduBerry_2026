'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { CalendarRange, User, GraduationCap, Users } from 'lucide-react'
import {
  fetchTimetableForStaff,
  fetchTimetableForStudent,
  fetchTimetableForHomeroom,
  entryTeacherLabel,
} from '@/lib/timetable'
import type { TimetableViewData, TimetableEntry } from '@/lib/timetable'
import { fetchAllHomerooms } from '@/lib/homerooms'
import ModalShell from '@/components/ui/ModalShell'
import { SALARY_ICON } from '@/components/salary/ui'
import TimetableGrid from './TimetableGrid'
import { Loading } from './ui'

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
  teacher: 'Teacher · published timetable',
  student: 'Student · published timetable',
  homeroom: 'Class · published timetable',
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

  // The secondary line under each subject depends on whose view this is.
  const secondary = (e: TimetableEntry): string | null => {
    if (kind === 'teacher') return homeroomNames.get(e.homeroom_id) ?? 'Class'
    return entryTeacherLabel(e)
  }

  const Icon = KIND_ICON[kind]

  return (
    <ModalShell
      onClose={onClose}
      size="2xl"
      sharp
      glass
      title={name}
      subtitle={KIND_LABEL[kind]}
      icon={<Icon size={17} />}
      iconClassName={SALARY_ICON}
    >
      {loading ? (
        <Loading />
      ) : views.length === 0 ? (
        <div className="text-center py-12">
          <CalendarRange className="mx-auto text-slate-300" size={26} strokeWidth={1.5} />
          <p className="mt-3 text-[14px] font-semibold text-slate-800">No published timetable yet</p>
          <p className="text-[12.5px] text-slate-500 mt-1">It shows here once a timetable with {name} in it is published.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {views.map(({ config, slots, timetable, entries }) => (
            <div key={config.id} className="space-y-2">
              <p className="text-[12.5px] text-slate-500 break-words">
                <span className="font-semibold text-slate-900">{config.name}</span>
                {' · '}
                {[config.academic_year, `${entries.length} periods a week`, timetable.name].filter(Boolean).join(' · ')}
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
    </ModalShell>
  )
}
