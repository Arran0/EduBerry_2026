'use client'

import React, { useMemo } from 'react'
import { UserCog, CalendarOff, Gauge } from 'lucide-react'
import { teacherIdsOf } from '@/lib/timetable'
import { useTimetableDraft } from './draft/TimetableDraftContext'
import DraftWeekGrid from './draft/DraftWeekGrid'
import LessonStatsCard from './LessonStatsCard'
import PeriodGroupSwitch, { usePeriodGroupSwitch } from './PeriodGroupSwitch'

// ============================================================
// One teacher's week, laid out like the by-class view: periods down the side,
// days across the top, one tile per lesson labelled with the class it belongs
// to. Lessons drag exactly as they do on the master grid, clicking one opens
// the same slot box, and the calendar doubles as the teacher's time-off sheet.
//
// A teacher can teach across bell schedules, whose periods are different rows
// and cannot share a grid. Rather than stacking one calendar per band down the
// page, the bands they actually work in become a switch above the grid.
// ============================================================

export default function TeacherWeekView({ teacherId }: { teacherId: string }) {
  const {
    weeks, slotGroupIds, entries, homerooms, subjects, teachers, rooms,
    isConstraintOn, toggleConstraintCell, moveEntry, liveConflicts, overrideToday,
  } = useTimetableDraft()

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

  const lessonBands = useMemo(
    () => lessons.map((e) => slotGroupIds[e.homeroomId] ?? null),
    [lessons, slotGroupIds],
  )
  const { groupId, setGroupId, present, counts, week } = usePeriodGroupSwitch(weeks, lessonBands)

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
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 mb-2">
        <span className="inline-flex items-center gap-1.5 font-semibold text-[#18181B]">
          <UserCog size={15} className="text-[#71717A]" /> {teacher.full_name}
        </span>
        <span className="inline-flex items-center gap-1 text-xs text-[#71717A] tabular-nums">
          <Gauge size={13} /> {periodCount} period{periodCount === 1 ? '' : 's'}/week
          {busiestDay && ` · busiest ${busiestDay[0].slice(0, 3)} (${busiestDay[1]})`}
        </span>
        <span className="inline-flex items-center gap-1 text-xs text-[#A1A1AA]">
          <CalendarOff size={13} /> Tap a free period to block it
        </span>
        <PeriodGroupSwitch
          weeks={weeks}
          present={present}
          counts={counts}
          value={groupId}
          onChange={setGroupId}
          className="ml-auto"
        />
      </div>

      {week && (
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
          hasOverride={(hr, day, slotId) => overrideToday(hr, day, slotId, null) !== null}
          onMove={moveEntry}
        />
      )}

      {/* The teacher's contract: what their week adds up to, class by class. */}
      <LessonStatsCard dimension="teacher" id={teacherId} className="mt-2.5" />
    </div>
  )
}
