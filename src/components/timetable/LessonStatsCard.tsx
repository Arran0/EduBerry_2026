'use client'

import React, { useMemo, useState } from 'react'
import {
  BookOpen, UserCog, GraduationCap, ChevronDown, ChevronUp, AlertTriangle, DoorOpen,
} from 'lucide-react'
import { WEEKDAY_LABELS } from '@/lib/timetable'
import { buildLessonStats, unplacedRows } from '@/lib/timetable/lessonStats'
import type { LessonStatRow, StatsDimension } from '@/lib/timetable/lessonStats'
import { useTimetableDraftOptional } from './draft/TimetableDraftContext'
import type { TimetableDraft } from './draft/TimetableDraftContext'

// ============================================================
// The aSc-style "contract" table, as a card under a timetable.
//
// The grid above says when lessons happen. This says what they add up to: one
// row per teaching assignment with its period count, its block length and its
// rooms, plus the plan it is measured against — so a subject that is two periods
// short reads as a number rather than as a gap you have to spot by eye.
//
// Scoped to whatever the view above is about: a teacher's week shows their
// contract, a class's week shows its subjects, a subject's sheet shows every
// teacher and class that carries it. The scope's own dimension is named in the
// header rather than repeated down a column of identical cells.
// ============================================================

const DIMENSION_ICON: Record<StatsDimension, typeof BookOpen> = {
  teacher: UserCog,
  class: GraduationCap,
  subject: BookOpen,
}

const DIMENSION_TITLE: Record<StatsDimension, string> = {
  teacher: 'Contract',
  class: 'Lessons for this class',
  subject: 'Lessons for this subject',
}

/** Stand-in outside the provider, so every hook below still runs in order. */
const EMPTY: Pick<
  TimetableDraft, 'entries' | 'requirements' | 'subjects' | 'teachers' | 'homerooms' | 'rooms' | 'groups'
> = { entries: [], requirements: [], subjects: [], teachers: [], homerooms: [], rooms: [], groups: [] }

interface Props {
  dimension: StatsDimension
  /** The teacher / homeroom / subject id the table is about. */
  id: string
  /** Start expanded. Defaults to collapsed so it never pushes the grid off-screen. */
  defaultOpen?: boolean
  className?: string
}

export default function LessonStatsCard({ dimension, id, defaultOpen = false, className = '' }: Props) {
  // The entity editors render outside the provider when no timetable is
  // selected, and there is nothing to count then.
  const draft = useTimetableDraftOptional()
  const [open, setOpen] = useState(defaultOpen)
  const { entries, requirements, subjects, teachers, homerooms, rooms, groups } = draft ?? EMPTY

  const subjectName = useMemo(() => {
    const m = new Map(subjects.map((s) => [s.id, s]))
    return (sid: string) => m.get(sid)?.name ?? '—'
  }, [subjects])
  const subjectColor = useMemo(() => {
    const m = new Map(subjects.map((s) => [s.id, s.color]))
    return (sid: string) => m.get(sid) ?? '#52525B'
  }, [subjects])
  const teacherName = useMemo(() => {
    const m = new Map(teachers.map((t) => [t.id, t.full_name]))
    return (tid: string) => m.get(tid) ?? 'Teacher'
  }, [teachers])
  const className_ = useMemo(() => {
    const m = new Map(homerooms.map((h) => [h.id, h.name]))
    return (hid: string) => m.get(hid) ?? 'Class'
  }, [homerooms])
  const roomName = useMemo(() => {
    const m = new Map(rooms.map((r) => [r.id, r.name]))
    return (rid: string | null) => (rid ? m.get(rid) ?? 'Room' : null)
  }, [rooms])
  const groupLabel = useMemo(() => {
    const m = new Map(groups.map((g) => [g.id, g.name]))
    return (gid: string | null) => (gid ? m.get(gid) ?? 'Group' : null)
  }, [groups])

  const scopeName =
    dimension === 'teacher' ? teacherName(id) : dimension === 'class' ? className_(id) : subjectName(id)

  const { rows, totals, missing } = useMemo(() => {
    const scope = { dimension, id }
    const stats = buildLessonStats(scope, entries, requirements)
    return { ...stats, missing: unplacedRows(scope, entries, requirements) }
  }, [dimension, id, entries, requirements])

  // Sorted for reading, not for ranking: the label a human scans down first.
  const labelOf = (r: LessonStatRow) =>
    dimension === 'subject' ? teacherName(r.teacherIds[0] ?? '') : subjectName(r.subjectId)
  const ordered = useMemo(
    () => [...rows].sort((a, b) => labelOf(a).localeCompare(labelOf(b)) || a.key.localeCompare(b.key)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, dimension, teachers, subjects],
  )

  // Periods the plan asks for that have nothing at all on the grid, plus the
  // rows that are simply short. Both are the same problem to whoever is reading.
  const shortfall =
    (totals.planned != null ? Math.max(0, totals.planned - totals.placed) : 0) +
    missing.reduce((n, r) => n + (r.planned ?? 0), 0)

  const Icon = DIMENSION_ICON[dimension]
  // Which of the three dimensions stay as columns — the scope's own is in the
  // header, so repeating it down the table would be a column of one value.
  const showSubject = dimension !== 'subject'
  const showTeacher = dimension !== 'teacher'
  const showClass = dimension !== 'class'

  if (!draft || !id || (rows.length === 0 && missing.length === 0)) return null

  return (
    <div className={`border border-[#E4E4E7] bg-white ${className}`}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-[#FAFAF9] transition-colors text-left"
      >
        <Icon size={14} className="text-[#71717A] flex-shrink-0" />
        <span className="text-[10px] font-bold uppercase tracking-widest text-[#525252] flex-shrink-0">
          {DIMENSION_TITLE[dimension]}
        </span>

        {/* The headline numbers, so the card is useful closed. "Periods" is time
            on the clock, never a row count: a combined lesson fills a row in
            every member class, so rows would overstate a week by double or more. */}
        <span className="flex items-center gap-x-3 gap-y-0.5 flex-wrap flex-1 min-w-0 text-[11px] text-[#71717A] tabular-nums">
          <Stat
            value={totals.periods}
            label={totals.periods === 1 ? 'period' : 'periods'}
            title="Periods of time on the timetable. A lesson taught to several classes at once counts once."
          />
          {totals.placed !== totals.periods && (
            <Stat
              value={totals.placed}
              label="class-periods"
              title={`Periods × classes taught${totals.combined > 0 ? ` — ${totals.combined} of these are combined lessons taking more than one class at a time` : ''}.`}
            />
          )}
          {showSubject && <Stat value={totals.subjects} label={totals.subjects === 1 ? 'subject' : 'subjects'} />}
          {showTeacher && <Stat value={totals.teachers} label={totals.teachers === 1 ? 'teacher' : 'teachers'} />}
          {showClass && <Stat value={totals.classes} label={totals.classes === 1 ? 'class' : 'classes'} />}
          {totals.blocks > 0 && (
            <Stat
              value={totals.blocks}
              label={totals.blocks === 1 ? 'double+' : 'doubles+'}
              title="Lessons running two or more periods back to back."
            />
          )}
          {totals.byDay[0] && (
            <span className="text-[#A1A1AA]" title="The day with the most periods on it">
              busiest {WEEKDAY_LABELS[totals.byDay[0].day].slice(0, 3)} ({totals.byDay[0].count})
            </span>
          )}
        </span>

        {shortfall > 0 && (
          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-600 flex-shrink-0">
            <AlertTriangle size={12} /> {shortfall} short
          </span>
        )}
        {open
          ? <ChevronUp size={14} className="text-[#A1A1AA] flex-shrink-0" />
          : <ChevronDown size={14} className="text-[#A1A1AA] flex-shrink-0" />}
      </button>

      {open && (
        <div className="border-t border-[#E4E4E7] overflow-x-auto">
          <table className="w-full border-collapse text-xs min-w-[30rem]">
            <thead>
              <tr className="bg-[#FAFAF9] text-[#525252]">
                {showSubject && <Th>Subject</Th>}
                {showTeacher && <Th>Teacher</Th>}
                {showClass && <Th>Class</Th>}
                <Th align="right" title="Periods on the timetable, and what the requirement asks for">Count</Th>
                <Th align="right" title="How many periods the lesson runs back to back — 1 is a single, 2 a double">Length</Th>
                <Th title="Distinct rooms used across the week">Rooms</Th>
                <Th align="right" title="Distinct days the lesson falls on">Days</Th>
              </tr>
            </thead>
            <tbody>
              {ordered.map((r) => {
                const short = r.planned != null && r.placed < r.planned
                const group = groupLabel(r.groupId)
                return (
                  <tr key={r.key} className="border-t border-[#F0F0F0] hover:bg-[#FAFAF9]">
                    {showSubject && (
                      <Td>
                        <span className="inline-flex items-center gap-1.5">
                          <span
                            className="w-1.5 h-3 flex-shrink-0"
                            style={{ background: subjectColor(r.subjectId) }}
                            aria-hidden
                          />
                          <span className="font-medium text-[#18181B]">{subjectName(r.subjectId)}</span>
                        </span>
                      </Td>
                    )}
                    {showTeacher && (
                      <Td>
                        {r.teacherIds.length === 0 ? (
                          <span className="text-[#A1A1AA] italic">unassigned</span>
                        ) : (
                          r.teacherIds.map((t) => teacherName(t)).join(', ')
                        )}
                      </Td>
                    )}
                    {showClass && (
                      <Td>
                        {className_(r.homeroomId)}
                        {group && <span className="text-[#A1A1AA]"> · {group}</span>}
                      </Td>
                    )}
                    <Td align="right">
                      <span className={short ? 'text-amber-600 font-semibold' : 'text-[#18181B] font-medium'}>
                        {r.placed}
                      </span>
                      {r.planned != null && r.planned !== r.placed && (
                        <span className="text-[#A1A1AA]"> / {r.planned}</span>
                      )}
                    </Td>
                    <Td align="right">
                      {r.lengths.length === 0 ? <span className="text-[#D4D4D8]">—</span> : r.lengths.join(', ')}
                    </Td>
                    <Td>
                      {r.roomIds.length === 0 ? (
                        <span className="text-[#D4D4D8]">—</span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[#52525B]">
                          <DoorOpen size={11} className="text-[#A1A1AA] flex-shrink-0" />
                          {r.roomIds.map((rid) => roomName(rid) ?? 'not tracked').join(', ')}
                        </span>
                      )}
                    </Td>
                    <Td align="right">{r.days.length || <span className="text-[#D4D4D8]">—</span>}</Td>
                  </tr>
                )
              })}

              {/* Requirements with nothing on the grid at all. They cannot show
                  as a short count because there is no row to be short. */}
              {missing.map((r) => (
                <tr key={r.key} className="border-t border-[#F0F0F0] bg-amber-50/50">
                  {showSubject && (
                    <Td>
                      <span className="inline-flex items-center gap-1.5">
                        <span className="w-1.5 h-3 flex-shrink-0" style={{ background: subjectColor(r.subjectId) }} aria-hidden />
                        <span className="font-medium text-[#18181B]">{subjectName(r.subjectId)}</span>
                      </span>
                    </Td>
                  )}
                  {showTeacher && (
                    <Td>
                      {r.teacherIds.length === 0
                        ? <span className="text-[#A1A1AA] italic">unassigned</span>
                        : r.teacherIds.map((t) => teacherName(t)).join(', ')}
                    </Td>
                  )}
                  {showClass && <Td>{className_(r.homeroomId)}</Td>}
                  <Td align="right">
                    <span className="text-amber-700 font-semibold">0</span>
                    <span className="text-[#A1A1AA]"> / {r.planned}</span>
                  </Td>
                  <Td align="right">{r.lengths.join(', ')}</Td>
                  <Td colSpan={2}>
                    <span className="inline-flex items-center gap-1 text-amber-700">
                      <AlertTriangle size={11} className="flex-shrink-0" /> nothing scheduled yet
                    </span>
                  </Td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-[#D4D4D8] bg-[#FAFAF9] font-semibold text-[#18181B]">
                <Td colSpan={[showSubject, showTeacher, showClass].filter(Boolean).length || 1}>
                  Total — {scopeName}
                </Td>
                <Td align="right">
                  {totals.placed}
                  {totals.planned != null && totals.planned !== totals.placed && (
                    <span className="text-[#A1A1AA] font-normal"> / {totals.planned}</span>
                  )}
                </Td>
                <Td colSpan={3}>
                  {totals.placed !== totals.periods && (
                    <span className="font-normal text-[#71717A]">
                      {totals.periods} period{totals.periods === 1 ? '' : 's'} of time
                    </span>
                  )}
                </Td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  )
}

function Stat({ value, label, title }: { value: number; label: string; title?: string }) {
  return (
    <span title={title} className={title ? 'cursor-help' : undefined}>
      <strong className="text-[#18181B] font-semibold">{value}</strong> {label}
    </span>
  )
}

function Th({
  children, align = 'left', title,
}: { children?: React.ReactNode; align?: 'left' | 'right'; title?: string }) {
  return (
    <th
      title={title}
      className={`px-2 py-1.5 font-bold uppercase tracking-widest text-[9px] whitespace-nowrap ${
        align === 'right' ? 'text-right' : 'text-left'
      } ${title ? 'cursor-help' : ''}`}
    >
      {children}
    </th>
  )
}

function Td({
  children, align = 'left', colSpan,
}: { children?: React.ReactNode; align?: 'left' | 'right'; colSpan?: number }) {
  return (
    <td
      colSpan={colSpan}
      className={`px-2 py-1 text-[#52525B] align-top ${align === 'right' ? 'text-right tabular-nums' : ''}`}
    >
      {children}
    </td>
  )
}
