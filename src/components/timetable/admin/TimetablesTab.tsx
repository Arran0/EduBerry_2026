'use client'

import React, { useState, useEffect, useMemo } from 'react'
import { Loader2, CheckCircle2 } from 'lucide-react'
import {
  fetchAllTimetablesWithConfig, fetchEntries, fetchPeriodSlots,
} from '@/lib/timetable'
import type { Timetable, TimetableConfig, TimetableEntry, PeriodSlot } from '@/lib/timetable'
import { fetchAllHomerooms } from '@/lib/homerooms'
import type { Homeroom } from '@/lib/homerooms'
import { fetchAllProfiles } from '@/lib/admin'
import { isStaffRole } from '@/lib/supabase'
import type { UserProfile } from '@/lib/supabase'
import TimetableGrid from '../TimetableGrid'
import { SmartSelect, SECTION_LABEL } from '../ui'
import type { SmartOption } from '../ui'

type ViewMode = 'class' | 'staff'

export default function TimetablesTab() {
  const [loading, setLoading] = useState(true)
  const [allTimetables, setAllTimetables] = useState<Array<Timetable & { config: TimetableConfig }>>([])
  const [selectedId, setSelectedId] = useState<string>('')
  const [viewMode, setViewMode] = useState<ViewMode>('class')
  const [selectedHomeroomId, setSelectedHomeroomId] = useState<string>('')
  const [selectedTeacherId, setSelectedTeacherId] = useState<string>('')
  const [entries, setEntries] = useState<TimetableEntry[]>([])
  const [slots, setSlots] = useState<PeriodSlot[]>([])
  const [homerooms, setHomerooms] = useState<Homeroom[]>([])
  const [teachers, setTeachers] = useState<UserProfile[]>([])
  const [homeroomNames, setHomeroomNames] = useState<Map<string, string>>(new Map())
  const [entriesLoading, setEntriesLoading] = useState(false)

  useEffect(() => {
    async function boot() {
      setLoading(true)
      const [timetables, hrs, profiles] = await Promise.all([
        fetchAllTimetablesWithConfig(),
        fetchAllHomerooms(),
        fetchAllProfiles(),
      ])
      const typedTTs = timetables as Array<Timetable & { config: TimetableConfig }>
      const typedHrs = hrs as Homeroom[]
      setAllTimetables(typedTTs)
      setHomerooms(typedHrs)
      setHomeroomNames(new Map(typedHrs.map((h: Homeroom) => [h.id, h.name])))
      setTeachers((profiles as UserProfile[]).filter((p: UserProfile) => isStaffRole(p.role)))
      const defaultTt =
        typedTTs.find((t: Timetable & { config: TimetableConfig }) => t.config.is_active && t.status === 'published') ??
        typedTTs.find((t: Timetable & { config: TimetableConfig }) => t.status === 'published') ??
        typedTTs[0]
      if (defaultTt) setSelectedId(defaultTt.id)
      setLoading(false)
    }
    boot()
  }, [])

  useEffect(() => {
    if (!selectedId) return
    const typedTimetables = allTimetables as Array<Timetable & { config: TimetableConfig }>
    const tt = typedTimetables.find((t: Timetable & { config: TimetableConfig }) => t.id === selectedId)
    if (!tt) return
    setEntriesLoading(true)
    Promise.all([fetchEntries(selectedId), fetchPeriodSlots(tt.config.id)]).then(([e, s]) => {
      const typedEntries = e as TimetableEntry[]
      setEntries(typedEntries)
      setSlots(s as PeriodSlot[])
      const homeroomIds = [...new Set(typedEntries.map((entry: TimetableEntry) => entry.homeroom_id))]
      if (homeroomIds.length > 0 && !homeroomIds.includes(selectedHomeroomId)) {
        setSelectedHomeroomId(homeroomIds[0])
      }
      const teacherIds = [
        ...new Set(typedEntries.map((entry: TimetableEntry) => entry.teacher_id).filter(Boolean) as string[]),
      ]
      if (teacherIds.length > 0 && !teacherIds.includes(selectedTeacherId)) {
        setSelectedTeacherId(teacherIds[0])
      }
      setEntriesLoading(false)
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, allTimetables])

  const typedTimetables = allTimetables as Array<Timetable & { config: TimetableConfig }>
  const selectedTimetable = typedTimetables.find(
    (t: Timetable & { config: TimetableConfig }) => t.id === selectedId,
  )

  const timetableOptions: SmartOption[] = useMemo(
    () =>
      (allTimetables as Array<Timetable & { config: TimetableConfig }>).map(
        (t: Timetable & { config: TimetableConfig }) => ({
          value: t.id,
          label: t.name,
          sublabel: `${t.config.name}${t.config.academic_year ? ` · ${t.config.academic_year}` : ''}`,
          badge:
            t.status === 'published'
              ? t.config.is_active
                ? 'Active'
                : 'Published'
              : 'Draft',
        }),
      ),
    [allTimetables],
  )

  const homeroomOptions: SmartOption[] = useMemo(() => {
    const typedEntries = entries as TimetableEntry[]
    const ids = new Set(typedEntries.map((e: TimetableEntry) => e.homeroom_id))
    return (homerooms as Homeroom[])
      .filter((h: Homeroom) => ids.has(h.id))
      .map((h: Homeroom) => ({ value: h.id, label: h.name }))
  }, [entries, homerooms])

  const teacherOptions: SmartOption[] = useMemo(() => {
    const typedEntries = entries as TimetableEntry[]
    const ids = new Set(
      typedEntries.map((e: TimetableEntry) => e.teacher_id).filter(Boolean) as string[],
    )
    return (teachers as UserProfile[])
      .filter((t: UserProfile) => ids.has(t.id))
      .map((t: UserProfile) => ({ value: t.id, label: t.full_name ?? t.id }))
  }, [entries, teachers])

  const displayEntries = useMemo(
    () =>
      viewMode === 'class'
        ? (entries as TimetableEntry[]).filter((e: TimetableEntry) => e.homeroom_id === selectedHomeroomId)
        : (entries as TimetableEntry[]).filter((e: TimetableEntry) => e.teacher_id === selectedTeacherId),
    [entries, viewMode, selectedHomeroomId, selectedTeacherId],
  )

  if (loading) {
    return (
      <div className="flex justify-center py-16 text-[#A1A1AA]">
        <Loader2 className="animate-spin" size={22} />
      </div>
    )
  }

  if (allTimetables.length === 0) {
    return (
      <div className="py-12 text-center text-sm text-[#71717A]">
        No timetables yet. Generate one in the <strong>Generate &amp; Publish</strong> tab.
      </div>
    )
  }

  const isPublished = selectedTimetable?.status === 'published'
  const isActive = selectedTimetable?.config.is_active

  return (
    <div className="space-y-4">
      {/* Timetable picker + status */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex-1 min-w-[12rem]">
          <SmartSelect
            options={timetableOptions}
            value={selectedId}
            onChange={(v) => { if (v) setSelectedId(v) }}
            placeholder="Select timetable…"
            searchPlaceholder="Search timetables…"
          />
        </div>
        {selectedTimetable && (
          <span
            className={`inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-widest px-2.5 py-1 border flex-shrink-0 ${
              isPublished && isActive
                ? 'text-emerald-700 bg-emerald-50 border-emerald-200'
                : isPublished
                  ? 'text-blue-700 bg-blue-50 border-blue-200'
                  : 'text-[#71717A] bg-[#F5F5F5] border-[#E4E4E7]'
            }`}
          >
            {isPublished && isActive ? (
              <><CheckCircle2 size={12} /> Published &amp; Active</>
            ) : isPublished ? (
              'Published'
            ) : (
              'Draft'
            )}
          </span>
        )}
      </div>

      {/* Timetable heading */}
      {selectedTimetable && (
        <div>
          <h3 className="font-semibold text-[#18181B] text-base leading-tight">
            {selectedTimetable.name}
          </h3>
          <p className="text-xs text-[#71717A] mt-0.5">
            {selectedTimetable.config.name}
            {selectedTimetable.config.academic_year
              ? ` · ${selectedTimetable.config.academic_year}`
              : ''}
          </p>
        </div>
      )}

      {/* View mode toggle */}
      <div className="flex gap-px border border-[#E4E4E7] w-fit">
        {(['class', 'staff'] as ViewMode[]).map((mode) => (
          <button
            key={mode}
            onClick={() => setViewMode(mode)}
            className={`px-4 py-1.5 text-sm font-medium transition-colors ${
              viewMode === mode
                ? 'bg-[#27272A] text-[#F5F5F5]'
                : 'bg-[#F5F5F5] text-[#52525B] hover:bg-[#EBEBEB]'
            }`}
          >
            {mode === 'class' ? 'By Class' : 'By Staff'}
          </button>
        ))}
      </div>

      {entriesLoading ? (
        <div className="flex justify-center py-10 text-[#A1A1AA]">
          <Loader2 className="animate-spin" size={18} />
        </div>
      ) : (
        <>
          {/* Class or Staff selector */}
          <div className="flex items-center gap-2">
            <span className={`${SECTION_LABEL} flex-shrink-0`}>
              {viewMode === 'class' ? 'Class' : 'Teacher'}
            </span>
            <div className="flex-1 min-w-0">
              <SmartSelect
                options={viewMode === 'class' ? homeroomOptions : teacherOptions}
                value={viewMode === 'class' ? selectedHomeroomId : selectedTeacherId}
                onChange={(v) =>
                  viewMode === 'class' ? setSelectedHomeroomId(v) : setSelectedTeacherId(v)
                }
                placeholder={viewMode === 'class' ? 'Select class…' : 'Select teacher…'}
                searchPlaceholder={
                  viewMode === 'class' ? 'Search classes…' : 'Search teachers…'
                }
              />
            </div>
          </div>

          {/* Grid */}
          {selectedTimetable && displayEntries.length > 0 ? (
            <TimetableGrid
              days={selectedTimetable.config.working_days}
              slots={slots}
              entries={displayEntries}
              secondary={
                viewMode === 'class'
                  ? (e) => e.teacher?.full_name ?? e.teacher_name ?? null
                  : (e) => homeroomNames.get(e.homeroom_id) ?? 'Class'
              }
            />
          ) : (
            <p className="text-sm text-[#A1A1AA] py-6 text-center">
              {!selectedId
                ? 'Select a timetable above.'
                : viewMode === 'class' && !selectedHomeroomId
                  ? 'Select a class to view its timetable.'
                  : viewMode === 'staff' && !selectedTeacherId
                    ? 'Select a teacher to view their schedule.'
                    : 'No periods found for this selection.'}
            </p>
          )}
        </>
      )}
    </div>
  )
}
