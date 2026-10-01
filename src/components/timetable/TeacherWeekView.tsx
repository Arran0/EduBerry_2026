'use client'

import React, { useMemo, useState } from 'react'
import { UserCog, CalendarOff, Gauge } from 'lucide-react'
import { teacherIdsOf } from '@/lib/timetable'
import type { PeriodSlot, PlacedEntry, Weekday } from '@/lib/timetable'
import { useTimetableDraft } from './draft/TimetableDraftContext'
import DraftWeekGrid from './draft/DraftWeekGrid'
import SlotDetailsModal from './SlotDetailsModal'
import LessonStatsCard from './LessonStatsCard'
import { SECTION_LABEL } from './ui'

// ============================================================
// One teacher's week, laid out like the by-class view: periods down the side,
// days across the top, one tile per lesson labelled with the class it belongs
// to. Lessons drag and pin exactly as they do on the master grid, and the same
// calendar doubles as the teacher's time-off sheet.
//
// A teacher can teach across bell schedules, so one calendar is drawn per
// period group they appear in — the periods of two bands are different rows
// and can't share a grid.
// ============================================================

export default function TeacherWeekView({ teacherId }: { teacherId: string }) {
  const {
    weeks, slotGroupIds, entries, homerooms, subjects, teachers, rooms, constraints,
    isConstraintOn, toggleConstraintCell, moveEntry, togglePin, setCellEntry, clearCellEntry,
    groupName, cellConflicts, liveConflicts,
  } = useTimetableDraft()

  const [open, setOpen] = useState<{ entry: PlacedEntry; day: Weekday; slot: PeriodSlot } | null>(null)

  const teacher = teachers.find((t) => t.id === teacherId) ?? null

  const lessons = useMemo(
    () => entries.filter((e) => teacherIdsOf(e).includes(teacherId)),
    [entries, teacherId],
  )

  const homeroomName = useMemo(() => {
    const m = new Map(homerooms.map((h) => [h.id, h.name]))
    return (id: string) => m.get(id) ?? 'Class'
  }, [homerooms])

  // Cells to outline in red — the same hard conflicts the master grid marks.
  const conflictCells = useMemo(() => {
    const keys = new Set<string>()
    for (const c of liveConflicts) {
      if (!c.day || !c.slotId) continue
      for (const e of lessons) {
        if (e.day === c.day && e.slotId === c.slotId) keys.add(`${e.homeroomId}__${e.day}__${e.slotId}`)
      }
    }
    return keys
  }, [liveConflicts, lessons])

  // The bands this teacher actually appears in, plus any band they are timed
  // off in — a teacher with no lessons yet still needs a sheet to mark.
  const relevantWeeks = useMemo(() => {
    if (weeks.length <= 1) return weeks
    const used = new Set<string | null>()
    for (const e of lessons) used.add(slotGroupIds[e.homeroomId] ?? null)
    return used.size === 0 ? weeks : weeks.filter((w) => used.has(w.groupId))
  }, [weeks, lessons, slotGroupIds])

  // Periods of TIME, not lesson rows. A combined lesson fills a row in every
  // member class, so counting rows reads a teacher who takes three classes
  // together as teaching three times over — on the live school that turned a
  // 44-period week into "114 periods a week".
  const { periodCount, busiestDay } = useMemo(() => {
    const cells = new Set<string>()
    const byDay = new Map<string, Set<string>>()
    for (const e of lessons) {
      const cell = `${e.day}|${e.slotId}`
      cells.add(cell)
      if (!byDay.has(e.day)) byDay.set(e.day, new Set())
      byDay.get(e.day)!.add(cell)
    }
    let best: [string, number] | null = null
    for (const [day, set] of byDay) if (!best || set.size > best[1]) best = [day, set.size]
    return { periodCount: cells.size, busiestDay: best }
  }, [lessons])

  if (!teacher) {
    return <p className="text-sm text-[#A1A1AA] py-8 text-center">Select a teacher.</p>
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 mb-2.5">
        <span className="inline-flex items-center gap-1.5 font-semibold text-[#18181B]">
          <UserCog size={15} className="text-[#71717A]" /> {teacher.full_name}
        </span>
        <span className="inline-flex items-center gap-1 text-xs text-[#71717A]">
          <Gauge size={13} /> {periodCount} period{periodCount === 1 ? '' : 's'} a week
          {busiestDay && ` · busiest ${busiestDay[0]} (${busiestDay[1]})`}
        </span>
        <span className="inline-flex items-center gap-1 text-xs text-[#71717A]">
          <CalendarOff size={13} /> Tap an empty period to block it for this teacher
        </span>
      </div>

      <div className="space-y-4">
        {relevantWeeks.map((week) => (
          <div key={week.groupId ?? 'base'}>
            {weeks.length > 1 && <div className={`${SECTION_LABEL} mb-1.5`}>{week.name}</div>}
            <DraftWeekGrid
              week={week}
              lessons={lessons.filter((e) => (slotGroupIds[e.homeroomId] ?? null) === week.groupId)}
              isOff={(day, slotId) => isConstraintOn('teacher', teacherId, 'time_off', day, slotId)}
              onToggleOff={(day, slotId) => toggleConstraintCell('teacher', teacherId, 'time_off', day, slotId)}
              subjects={subjects}
              teachers={teachers}
              rooms={rooms}
              classLabel={homeroomName}
              conflicts={conflictCells}
              onMove={moveEntry}
              onTogglePin={togglePin}
              onOpen={(entry, day, slot) => setOpen({ entry, day, slot })}
            />
          </div>
        ))}
      </div>

      {/* The teacher's contract: what their week adds up to, class by class. */}
      <LessonStatsCard dimension="teacher" id={teacherId} className="mt-2.5" />

      {open && (
        <SlotDetailsModal
          target={{
            homeroomId: open.entry.homeroomId,
            homeroomName: homeroomName(open.entry.homeroomId),
            day: open.day,
            slot: open.slot,
          }}
          entries={entries.filter(
            (e) => e.homeroomId === open.entry.homeroomId && e.day === open.day && e.slotId === open.slot.id,
          )}
          subjects={subjects}
          teachers={teachers}
          rooms={rooms}
          groupName={groupName}
          conflicts={cellConflicts(open.entry.homeroomId, open.day, open.slot.id)}
          timeOff={constraints.some(
            (c) => c.type === 'time_off' && c.scope === 'homeroom' &&
              c.scope_id === open.entry.homeroomId && c.day === open.day && c.slot_id === open.slot.id,
          )}
          onClose={() => setOpen(null)}
          onTogglePin={togglePin}
          onSave={(groupId, subjectId, teacherIds, roomId) => {
            setCellEntry(open.entry.homeroomId, open.day, open.slot.id, groupId, subjectId, teacherIds, roomId)
            setOpen(null)
          }}
          onClear={(entry) => {
            clearCellEntry(open.entry.homeroomId, open.day, open.slot.id, entry.groupId ?? null)
            setOpen(null)
          }}
        />
      )}
    </div>
  )
}
