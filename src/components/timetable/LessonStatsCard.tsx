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
  teacher: 'Their week in numbers',
  class: 'This class in numbers',
  subject: 'This subject in numbers',
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
  //
  // Measured against `plannedPlaced`, not `placed`: rows with no requirement
  // behind them (combined lessons, hand-placed periods) are not part of the
  // plan, so counting them here reported a full week as massively over and a
  // short one as fine.
  const shortfall =
    (totals.planned != null ? Math.max(0, totals.planned - totals.plannedPlaced) : 0) +
    missing.reduce((n, r) => n + (r.planned ?? 0), 0)

  const Icon = DIMENSION_ICON[dimension]
  // Which of the three dimensions stay as columns — the scope's own is in the
  // header, so repeating it down the table would be a column of one value.
  const showSubject = dimension !== 'subject'
  const showTeacher = dimension !== 'teacher'
  const showClass = dimension !== 'class'

  if (!draft || !id || (rows.length === 0 && missing.length === 0)) return null

  return (
    <div className={`fx-card min-w-0 ${className}`}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="w-full flex flex-wrap items-center gap-x-2.5 gap-y-1 px-3.5 py-2.5 hover:bg-[#FAF7F0] transition-colors text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#B8983C]/60"
      >
        <Icon size={14} className="text-slate-400 flex-shrink-0" />
        <span className="text-[13px] font-semibold text-slate-900 flex-shrink-0">
          {DIMENSION_TITLE[dimension]}
        </span>

        {/* The headline numbers, so the card is useful closed. "Periods" is time
            on the clock, never a row count: a combined lesson fills a row in
            every member class, so rows would overstate a week by double or more. */}
        <span className="flex items-center gap-x-3 gap-y-0.5 flex-wrap flex-1 min-w-[10rem] text-[12px] text-slate-500 tabular-nums">
          <Stat
            value={totals.periods}
            label={totals.periods === 1 ? 'period' : 'periods'}
            title="Distinct day + period cells. A lesson taught to several classes at once counts once."
          />
          {totals.placed !== totals.periods && (
            <Stat
              value={totals.placed}
              label="class-periods"
              title={`Periods × classes taught${totals.combined > 0 ? ` · ${totals.combined} combined` : ''}`}
            />
          )}
          {showSubject && <Stat value={totals.subjects} label={totals.subjects === 1 ? 'subject' : 'subjects'} />}
          {showTeacher && <Stat value={totals.teachers} label={totals.teachers === 1 ? 'teacher' : 'teachers'} />}
          {showClass && <Stat value={totals.classes} label={totals.classes === 1 ? 'class' : 'classes'} />}
          {totals.blocks > 0 && (
            <Stat
              value={totals.blocks}
              label={totals.blocks === 1 ? 'double+' : 'doubles+'}
              title="Lessons running two or more periods back to back"
            />
          )}
          {totals.byDay[0] && (
            <span className="text-slate-400" title="Busiest day">
              Busiest {WEEKDAY_LABELS[totals.byDay[0].day].slice(0, 3)} ({totals.byDay[0].count})
            </span>
          )}
        </span>

        {shortfall > 0 && (
          <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-amber-700 flex-shrink-0">
            <AlertTriangle size={12} /> {shortfall} short
          </span>
        )}
        {open
          ? <ChevronUp size={14} className="text-slate-400 flex-shrink-0" />
          : <ChevronDown size={14} className="text-slate-400 flex-shrink-0" />}
      </button>

      {open && (
        <ul className="sm:hidden border-t border-[#EEEAE1] divide-y divide-[#F0ECE3]">
          {ordered.map((r) => {
            const short = r.planned != null && r.placed < r.planned
            const group = groupLabel(r.groupId)
            const who = [
              showSubject ? subjectName(r.subjectId) : null,
              showTeacher ? (r.teacherIds.length === 0 ? 'No teacher' : r.teacherIds.map((t) => teacherName(t)).join(', ')) : null,
              showClass ? className_(r.homeroomId) + (group ? ` · ${group}` : '') : null,
            ].filter(Boolean)
            return (
              <li key={r.key} className="flex items-start gap-2.5 px-3.5 py-2">
                {showSubject && <span className="w-1.5 h-4 mt-0.5 rounded-full flex-shrink-0" style={{ background: subjectColor(r.subjectId) }} aria-hidden />}
                <span className="flex-1 min-w-0">
                  <span className="block text-[13px] font-medium text-slate-900 break-words">{who[0]}</span>
                  <span className="block text-[12px] text-slate-500 break-words">
                    {[...who.slice(1), r.lengths.length ? `length ${r.lengths.join(', ')}` : null, `${r.days.length} day${r.days.length === 1 ? '' : 's'}`].filter(Boolean).join(' · ')}
                  </span>
                </span>
                <span className={`text-[13px] tabular-nums flex-shrink-0 ${short ? 'text-amber-700 font-semibold' : 'text-slate-900 font-medium'}`}>
                  {r.placed}{r.planned != null && r.planned !== r.placed && <span className="text-slate-400 font-normal"> / {r.planned}</span>}
                </span>
              </li>
            )
          })}
          {missing.map((r) => (
            <li key={r.key} className="flex items-start gap-2.5 px-3.5 py-2 bg-[#FBF6E9]">
              <span className="flex-1 min-w-0">
                <span className="block text-[13px] font-medium text-slate-900 break-words">
                  {dimension === 'subject' ? className_(r.homeroomId) : subjectName(r.subjectId)}
                </span>
                <span className="block text-[12px] text-amber-700">Not scheduled</span>
              </span>
              <span className="text-[13px] tabular-nums text-amber-700 font-semibold flex-shrink-0">0 <span className="text-slate-400 font-normal">/ {r.planned}</span></span>
            </li>
          ))}
          <li className="px-3.5 py-2 bg-[#F7F5F0] text-[12px] text-slate-600">
            <strong className="text-slate-900">{totals.periods}</strong> period{totals.periods === 1 ? '' : 's'} of time
            {totals.planned != null && <> · plan <strong className={shortfall > 0 ? 'text-amber-700' : 'text-slate-900'}>{totals.plannedPlaced}/{totals.planned}</strong></>}
          </li>
        </ul>
      )}

      {open && (
        <div className="hidden sm:block border-t border-[#EEEAE1] overflow-x-auto">
          <table className="w-full border-collapse text-[12px]">
            <thead>
              <tr className="bg-[#F7F5F0] text-slate-500">
                {showSubject && <Th>Subject</Th>}
                {showTeacher && <Th>Teacher</Th>}
                {showClass && <Th>Class</Th>}
                <Th align="right" title="Periods on the grid / what the requirement asks for">Count</Th>
                <Th align="right" title="Periods back to back: 1 is single, 2 is double">Length</Th>
                <Th title="Rooms used across the week">Rooms</Th>
                <Th align="right" title="Days it falls on">Days</Th>
              </tr>
            </thead>
            <tbody>
              {ordered.map((r) => {
                const short = r.planned != null && r.placed < r.planned
                const group = groupLabel(r.groupId)
                return (
                  <tr key={r.key} className="border-t border-[#F0ECE3] hover:bg-[#FAF8F3]">
                    {showSubject && (
                      <Td>
                        <span className="inline-flex items-center gap-1.5">
                          <span
                            className="w-1.5 h-3 rounded-full flex-shrink-0"
                            style={{ background: subjectColor(r.subjectId) }}
                            aria-hidden
                          />
                          <span className="font-medium text-slate-900">{subjectName(r.subjectId)}</span>
                        </span>
                      </Td>
                    )}
                    {showTeacher && (
                      <Td>
                        {r.teacherIds.length === 0 ? (
                          <span className="text-slate-400">No teacher</span>
                        ) : (
                          r.teacherIds.map((t) => teacherName(t)).join(', ')
                        )}
                      </Td>
                    )}
                    {showClass && (
                      <Td>
                        {className_(r.homeroomId)}
                        {group && <span className="text-slate-400"> · {group}</span>}
                      </Td>
                    )}
                    <Td align="right">
                      <span className={short ? 'text-amber-600 font-semibold' : 'text-slate-900 font-medium'}>
                        {r.placed}
                      </span>
                      {r.planned != null && r.planned !== r.placed && (
                        <span className="text-slate-400"> / {r.planned}</span>
                      )}
                    </Td>
                    <Td align="right">
                      {r.lengths.length === 0 ? <span className="text-slate-300">—</span> : r.lengths.join(', ')}
                    </Td>
                    <Td>
                      {r.roomIds.length === 0 ? (
                        <span className="text-slate-300">—</span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-slate-600">
                          <DoorOpen size={11} className="text-slate-400 flex-shrink-0" />
                          {r.roomIds.map((rid) => roomName(rid) ?? 'not tracked').join(', ')}
                        </span>
                      )}
                    </Td>
                    <Td align="right">{r.days.length || <span className="text-slate-300">—</span>}</Td>
                  </tr>
                )
              })}

              {/* Requirements with nothing on the grid at all. They cannot show
                  as a short count because there is no row to be short. */}
              {missing.map((r) => (
                <tr key={r.key} className="border-t border-[#F0ECE3] bg-[#FBF6E9]">
                  {showSubject && (
                    <Td>
                      <span className="inline-flex items-center gap-1.5">
                        <span className="w-1.5 h-3 rounded-full flex-shrink-0" style={{ background: subjectColor(r.subjectId) }} aria-hidden />
                        <span className="font-medium text-slate-900">{subjectName(r.subjectId)}</span>
                      </span>
                    </Td>
                  )}
                  {showTeacher && (
                    <Td>
                      {r.teacherIds.length === 0
                        ? <span className="text-slate-400">No teacher</span>
                        : r.teacherIds.map((t) => teacherName(t)).join(', ')}
                    </Td>
                  )}
                  {showClass && <Td>{className_(r.homeroomId)}</Td>}
                  <Td align="right">
                    <span className="text-amber-700 font-semibold">0</span>
                    <span className="text-slate-400"> / {r.planned}</span>
                  </Td>
                  <Td align="right">{r.lengths.join(', ')}</Td>
                  <Td colSpan={2}>
                    <span className="inline-flex items-center gap-1 text-amber-700">
                      <AlertTriangle size={11} className="flex-shrink-0" /> Not scheduled
                    </span>
                  </Td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              {/* Two different things get added up here, and mixing them is
                  what produced the old "114 / 12": 114 was every row on the
                  grid, 12 was the plan for the handful of rows that have one.
                  The plan total now sits next to the periods placed against
                  THAT plan, and the grid total stands on its own. */}
              <tr className="border-t border-[#DDD8CC] bg-[#F7F5F0] font-semibold text-slate-900">
                <Td colSpan={[showSubject, showTeacher, showClass].filter(Boolean).length || 1}>
                  Total for {scopeName}
                </Td>
                <Td align="right">
                  <span title="Every row above added up. A lesson taught to several classes at once counts once per class.">
                    {totals.placed}
                  </span>
                </Td>
                <Td colSpan={3}>
                  <span className="font-normal text-slate-600">
                    <strong className="text-slate-900">{totals.periods}</strong> period
                    {totals.periods === 1 ? '' : 's'} of time
                    {totals.planned != null && (
                      <>
                        {' · plan '}
                        <strong className={shortfall > 0 ? 'text-amber-700' : 'text-slate-900'}>
                          {totals.plannedPlaced}/{totals.planned}
                        </strong>
                        {totals.unplannedRows > 0 && (
                          <span className="text-slate-400">
                            {' '}({totals.unplannedRows} row{totals.unplannedRows === 1 ? '' : 's'} outside the plan)
                          </span>
                        )}
                      </>
                    )}
                  </span>
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
      <strong className="text-slate-900 font-semibold">{value}</strong> {label}
    </span>
  )
}

function Th({
  children, align = 'left', title,
}: { children?: React.ReactNode; align?: 'left' | 'right'; title?: string }) {
  return (
    <th
      title={title}
      className={`px-2.5 py-2 font-semibold text-[11.5px] whitespace-nowrap ${
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
      className={`px-2.5 py-1.5 text-slate-600 align-top ${align === 'right' ? 'text-right tabular-nums' : ''}`}
    >
      {children}
    </td>
  )
}
