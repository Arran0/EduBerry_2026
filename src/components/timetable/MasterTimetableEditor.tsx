'use client'

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Pin, Layers, Maximize2, Minimize2, ZoomIn, ZoomOut, Scan, Ban, CalendarClock } from 'lucide-react'
import { conflictCellKeys } from '@/lib/timetable/generator'
import { buildConstraintIndex, cellKey, timeOffBlocked } from '@/lib/timetable/constraints'
import { TIME_OFF_FILL } from './EditableTimetableGrid'
import { WEEKDAY_LABELS, teacherIdsOf } from '@/lib/timetable'
import type {
  PlacedEntry, PeriodSlot, Subject, Room, TeacherUnavailability, TimetableConstraint, HomeroomLite, Weekday,
} from '@/lib/timetable'
import type { Homeroom } from '@/lib/homerooms'
import type { UserProfile } from '@/lib/supabase'
import DraftSlotModal from './draft/DraftSlotModal'
import useBodyScrollLock from '@/hooks/useBodyScrollLock'
import { BTN_SM, SM_GHOST, SM_DARK, ICON_BTN, FOCUS } from './ui'

interface Props {
  days: Weekday[]
  slots: PeriodSlot[]
  homerooms: Homeroom[] // rows (scheduled homerooms)
  entries: PlacedEntry[]
  subjects: Subject[]
  teachers: UserProfile[]
  rooms: Room[]
  unavailability: TeacherUnavailability[]
  constraints: TimetableConstraint[]
  homeroomsLite: HomeroomLite[]
  // Periods of other bell schedules that share a wall-clock hour, so a teacher
  // booked across two bands highlights as the clash it is.
  slotClash?: Map<string, string[]>
  onMove: (entry: PlacedEntry, day: Weekday, slotId: string) => boolean
  /** Marks a cell a date change amends, so an exception is visible on the grid. */
  hasOverride?: (homeroomId: string, day: Weekday, slotId: string) => boolean
  /** Opens the by-class timetable focused on this class, when the host offers one. */
  onOpenClass?: (homeroomId: string) => void
}

const cellId = (hr: string, day: Weekday, slotId: string) => `${hr}__${day}__${slotId}`
// Identity of one entry within the in-memory array (no DB id yet).
const entryId = (e: PlacedEntry) =>
  `${e.homeroomId}__${e.day}__${e.slotId}__${e.groupId ?? ''}__${e.combinedKey ?? ''}`

// Geometry at zoom 1. Everything else scales off these so the whole week can be
// squeezed onto one screen (or blown up when there is room to spare).
const BASE_CELL = 56 // px per period column
const BASE_ROW = 38 // px per class row
// The class column is NOT zoomed: a clipped class name makes the grid unusable,
// so it keeps a readable font and sizes itself to its longest label, and the
// period columns get whatever width is left over.
const LABEL_FONT = 11
const FALLBACK_LABEL = 128
const MIN_ZOOM = 0.28
const MAX_ZOOM = 1.6
/**
 * How far Fit is allowed to shrink before it stops shrinking.
 *
 * Low enough that a whole week — every day, every period — fits the pane on a
 * desktop, because seeing the shape of the week at once is the whole point of
 * a master grid.
 */
const MIN_FIT_ZOOM = 0.34
/**
 * Below this a cell is too narrow for a four-letter code, so the label is cut
 * to three. The cell keeps its ordinary look either way — accent edge, tinted
 * fill, subject text — because a grid of plain colour blocks is pretty and
 * unreadable: you cannot tell Maths from Music without clicking.
 */
const TINY_ZOOM = 0.52
/** Characters of the subject code a cell has room for at each tier. */
const LABEL_CHARS = { tiny: 3, normal: 4 } as const

// Rules for the sticky header and the sticky class column.
//
// `border-collapse: collapse` moves border painting to the table itself, and
// the table does not paint the borders of a cell that is `position: sticky` —
// so every rule in the header disappeared the moment it stuck, which is why
// the period numbers looked like they were floating in a block of colour.
// An inset shadow is painted by the element, so it stays put.
const HEAD_EDGES = 'inset 0 -1px 0 #52525B'
const DAY_HEAD_EDGES = 'inset 0 -1px 0 #52525B, inset 2px 0 0 #A1A1AA'
const SLOT_HEAD_EDGES = 'inset 0 -1px 0 #71717A, inset 1px 0 0 #52525B'
const SLOT_HEAD_DAY_EDGES = 'inset 0 -1px 0 #71717A, inset 2px 0 0 #A1A1AA'
const STICKY_HEAD_EDGES = 'inset 0 -1px 0 #52525B, inset -1px 0 0 #52525B'
const STICKY_COL_EDGES = 'inset 0 -1px 0 #E4E4E7, inset -1px 0 0 #A1A1AA'


/**
 * The compact class label for a grid row: "G:3A 26-27" — grade + section and
 * the short academic year. Full names ("Grade 3 Section A 2026-2027") cost the
 * lesson columns far too much width in a grid this dense; the homeroom's real
 * name stays on the row's tooltip and in the slot details.
 */
function classLabel(hr: Homeroom): string {
  const core =
    hr.grade != null
      ? `G:${hr.grade}${(hr.section ?? '').toUpperCase()}`
      : hr.name
  const year = shortYear(hr.academic_year)
  return year ? `${core} ${year}` : core
}

// "2026-2027" / "2026-27" / "2026/27" → "26-27". Anything unparseable is
// dropped rather than printed at full length.
function shortYear(year: string | null): string | null {
  if (!year) return null
  const m = year.match(/(\d{4})\s*[-/–]\s*(\d{2,4})/)
  if (!m) return null
  return `${m[1].slice(-2)}-${m[2].slice(-2)}`
}

// aSc-style master grid: homeroom rows × (day → slot sub-columns). Drag a
// lesson to another period; click one for the slot box. Live-validated against
// clashes and constraints.
export default function MasterTimetableEditor({
  days, slots, homerooms, entries, subjects, teachers, rooms,
  unavailability, constraints, homeroomsLite, slotClash, onMove, hasOverride, onOpenClass,
}: Props) {
  const teachingSlots = useMemo(() => slots.filter((s) => !s.is_break), [slots])
  const dragRef = useRef<PlacedEntry | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)
  const [overCell, setOverCell] = useState<string | null>(null)
  const [open, setOpen] = useState<{ homeroom: Homeroom; day: Weekday; slot: PeriodSlot } | null>(null)

  // ── Density ────────────────────────────────────────────────
  // "Fit" keeps the entire week inside the viewport width; the +/− buttons
  // switch to a manual zoom.
  const [zoom, setZoom] = useState(1)
  const [autoFit, setAutoFit] = useState(true)
  const [fullscreen, setFullscreen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const labelRef = useRef<HTMLTableCellElement>(null)
  // The day row's real rendered height. The period row sticks directly beneath
  // it, and that offset has to be MEASURED: it comes from the font, the padding
  // and the browser's own rounding, so any formula drifts and the day names end
  // up sliced in half as the body scrolls under them.
  const dayRowRef = useRef<HTMLTableRowElement>(null)
  const [dayRowH, setDayRowH] = useState(0)

  const periodsWidth = days.length * teachingSlots.length * BASE_CELL

  const recomputeFit = useCallback(() => {
    const el = wrapRef.current
    if (!el || periodsWidth === 0) return
    // The class column auto-sizes to its longest name at a fixed font, so it is
    // measured rather than assumed: the period columns get the rest of the row.
    const measured = labelRef.current?.getBoundingClientRect().width
    const label = measured && measured > 0 ? Math.ceil(measured) : FALLBACK_LABEL
    const available = el.clientWidth - label - 2
    if (available <= 0) return
    setZoom(Math.max(MIN_FIT_ZOOM, Math.min(MAX_ZOOM, available / periodsWidth)))
  }, [periodsWidth])

  useLayoutEffect(() => {
    if (!autoFit) return
    recomputeFit()
    const el = wrapRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => recomputeFit())
    ro.observe(el)
    return () => ro.disconnect()
  }, [autoFit, recomputeFit, fullscreen, homerooms])

  // Re-measured whenever anything that can change the header's height does —
  // the zoom, a font load, the viewport, going full screen.
  useLayoutEffect(() => {
    const row = dayRowRef.current
    if (!row) return
    const measure = () => {
      const h = Math.round(row.getBoundingClientRect().height)
      setDayRowH((prev) => (prev === h ? prev : h))
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(row)
    return () => ro.disconnect()
  }, [zoom, fullscreen, days, teachingSlots.length])

  useEffect(() => {
    if (!fullscreen) return
    const onKey = (e: KeyboardEvent) => {
      // A period opened over the full-screen grid takes Escape first.
      if (e.key !== 'Escape' || document.querySelector('.modal-portal')) return
      setFullscreen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [fullscreen])

  // Full screen locks the page behind it; without this the body scrolls under
  // the overlay on a phone and the grid drifts off the top. The shared lock
  // is refcounted, so a popup opened over it cannot unlock the page early.
  useBodyScrollLock(fullscreen)

  const nudgeZoom = (delta: number) => {
    setAutoFit(false)
    setZoom((z) => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.round((z + delta) * 100) / 100)))
  }

  const cellW = Math.round(BASE_CELL * zoom)
  const rowH = Math.round(BASE_ROW * zoom)
  const px = (n: number) => `${n}px`
  // Below ~0.75 there is no room for a second line inside a cell; below
  // TINY_ZOOM the label itself has to be shorter.
  const dense = zoom < 0.75
  const tiny = zoom < TINY_ZOOM
  const labelChars = tiny ? LABEL_CHARS.tiny : LABEL_CHARS.normal
  const fontMain = Math.max(7, Math.round(10.5 * zoom))
  const fontSub = Math.max(6, Math.round(8.5 * zoom))
  const fontHead = Math.max(8, Math.round(10 * zoom))

  const subjectById = useMemo(() => new Map(subjects.map((s) => [s.id, s])), [subjects])
  const teacherById = useMemo(() => new Map(teachers.map((t) => [t.id, t])), [teachers])
  const roomById = useMemo(() => new Map(rooms.map((r) => [r.id, r])), [rooms])

  const conflicts = useMemo(
    () => conflictCellKeys(entries, unavailability, constraints, homeroomsLite, slotClash),
    [entries, unavailability, constraints, homeroomsLite, slotClash],
  )

  // Periods a class is kept free (Homeroom → Time off) are drawn as closed, so
  // the gaps the generator leaves on purpose read differently from real gaps.
  const constraintIndex = useMemo(
    () => buildConstraintIndex(constraints, homeroomsLite),
    [constraints, homeroomsLite],
  )
  const isTimeOff = (homeroomId: string, day: Weekday, slotId: string) =>
    timeOffBlocked(constraintIndex.homeroomTimeOff, homeroomId, cellKey(day, slotId))

  const byCell = useMemo(() => {
    const m = new Map<string, PlacedEntry[]>()
    for (const e of entries) {
      const k = cellId(e.homeroomId, e.day, e.slotId)
      const arr = m.get(k) ?? []
      arr.push(e)
      m.set(k, arr)
    }
    return m
  }, [entries])

  // How many periods each double/triple runs for, and which of its periods sit
  // next to each other — enough to draw a block as one slab across columns.
  const blockSpan = useMemo(() => {
    const m = new Map<string, number>()
    for (const e of entries) if (e.blockKey) m.set(e.blockKey, (m.get(e.blockKey) ?? 0) + 1)
    return m
  }, [entries])

  const slotAt = useMemo(() => new Map(teachingSlots.map((s, i) => [s.id, i])), [teachingSlots])

  // Every period a block occupies, so asking "is the next period the same
  // double?" is a lookup. It used to scan every entry, once per lesson drawn —
  // a whole-school week squared on every render.
  const blockCells = useMemo(() => {
    const set = new Set<string>()
    for (const e of entries) if (e.blockKey) set.add(`${e.blockKey}|${e.day}|${e.slotId}`)
    return set
  }, [entries])

  const blockNeighbour = (e: PlacedEntry, delta: -1 | 1): boolean => {
    if (!e.blockKey) return false
    const i = slotAt.get(e.slotId)
    if (i == null) return false
    const neighbour = teachingSlots[i + delta]
    return !!neighbour && blockCells.has(`${e.blockKey}|${e.day}|${neighbour.id}`)
  }

  // ── Move ─────────────────────────────────────────────────────
  // Where a lesson may land — blocks staying whole, combined lessons moving
  // together — is the draft's business, not the grid's. The grid only says
  // what was dropped where; a refused move leaves everything as it was.
  const handleDrop = (targetHr: string, day: Weekday, slotId: string) => {
    const dragged = dragRef.current
    dragRef.current = null
    setDragId(null)
    setOverCell(null)
    if (!dragged) return
    // A class's lesson only moves within its own row; a combined lesson is
    // anchored to its member classes and carries them all with it.
    if (!dragged.combinedKey && targetHr !== dragged.homeroomId) return
    onMove(dragged, day, slotId)
  }

  const grid = (
    <div
      ref={wrapRef}
      className={`overflow-auto overscroll-contain border border-[#DDD8CC] bg-white ${
        fullscreen ? 'flex-1 min-h-0' : 'max-h-[72vh] sm:max-h-[78vh]'
      }`}
    >
      <table className="border-collapse" style={{ fontSize: px(fontMain) }}>
        <thead>
          <tr ref={dayRowRef} className="bg-[#27272A]">
            <th
              ref={labelRef}
              rowSpan={2}
              className="sticky left-0 top-0 z-30 bg-[#27272A] text-[#F5F5F5] px-2 py-1 text-left font-semibold whitespace-nowrap"
              style={{ fontSize: px(fontHead), boxShadow: STICKY_HEAD_EDGES }}
            >
              Class
            </th>
            {days.map((d, di) => (
              <th
                key={d}
                colSpan={teachingSlots.length}
                className="sticky top-0 z-20 bg-[#27272A] text-[#F5F5F5] px-1 py-1 text-center font-semibold"
                style={{
                  fontSize: px(fontHead),
                  boxShadow: di > 0 ? DAY_HEAD_EDGES : HEAD_EDGES,
                }}
              >
                {dense ? WEEKDAY_LABELS[d].slice(0, 3) : WEEKDAY_LABELS[d]}
              </th>
            ))}
          </tr>
          <tr className="bg-[#3F3F46]">
            {days.map((d, di) =>
              teachingSlots.map((s, i) => (
                <th
                  key={`${d}-${s.id}`}
                  className="sticky z-20 bg-[#3F3F46] text-slate-300 px-0.5 py-0.5 text-center font-medium"
                  style={{
                    top: px(dayRowH),
                    width: px(cellW),
                    minWidth: px(cellW),
                    fontSize: px(fontSub),
                    boxShadow: i === 0 && di > 0 ? SLOT_HEAD_DAY_EDGES : SLOT_HEAD_EDGES,
                  }}
                  title={s.label ?? undefined}
                >
                  {i + 1}
                </th>
              )),
            )}
          </tr>
        </thead>
        <tbody>
          {homerooms.map((hr, rowIndex) => {
            // Alternating bands. Thirty columns is a long way for the eye to
            // carry a row, and the stripe is what carries it. The row under
            // the pointer lights up in CSS (group-hover), so following a class
            // across the week costs no re-render of the whole grid.
            const band = rowIndex % 2 === 1
            return (
              <tr key={hr.id} className="group">
                <td
                  className={`sticky left-0 z-10 p-0 whitespace-nowrap leading-tight font-semibold text-slate-900 tabular-nums group-hover:bg-[#FEF9E7] ${
                    band ? 'bg-[#F8F6F1]' : 'bg-white'
                  }`}
                  style={{ fontSize: px(LABEL_FONT), boxShadow: STICKY_COL_EDGES }}
                >
                  {onOpenClass ? (
                    <button
                      onClick={() => onOpenClass(hr.id)}
                      title={`${hr.name}. Open this class's week.`}
                      className={`w-full text-left px-2 py-0.5 hover:bg-[#EDE8DE] hover:text-slate-900 underline-offset-2 hover:underline decoration-[#B8983C] ${FOCUS}`}
                    >
                      {classLabel(hr)}
                    </button>
                  ) : (
                    <span className="block px-2 py-0.5" title={hr.name}>{classLabel(hr)}</span>
                  )}
                </td>
                {days.map((day, di) =>
                  teachingSlots.map((slot, si) => {
                    const key = cellId(hr.id, day, slot.id)
                    const cellEntries = byCell.get(key) ?? []
                    const inConflict = conflicts.has(key)
                    const isOver = overCell === key
                    const off = isTimeOff(hr.id, day, slot.id)
                    const dayEdge = si === 0 && di > 0
                    return (
                      <td
                        key={key}
                        onDragOver={(e) => {
                          e.preventDefault()
                          setOverCell(key)
                        }}
                        onDragLeave={() => setOverCell((c) => (c === key ? null : c))}
                        onDrop={() => handleDrop(hr.id, day, slot.id)}
                        onClick={() => setOpen({ homeroom: hr, day, slot })}
                        title={off && cellEntries.length === 0 ? `${hr.name}: kept free` : undefined}
                        className={`border-b border-[#EEEAE1] p-px align-top cursor-pointer ${
                          dayEdge ? 'border-l-2 border-l-[#A1A1AA]' : 'border-l border-l-[#EDEDEF]'
                        } ${
                          isOver
                            ? 'bg-indigo-100 ring-1 ring-inset ring-indigo-400'
                            : inConflict
                              ? 'bg-rose-50'
                              : `group-hover:bg-[#FEFCF3] ${band ? 'bg-[#FCFBF8]' : ''}`
                        }`}
                        style={{
                          width: px(cellW),
                          minWidth: px(cellW),
                          ...(off && !isOver && !inConflict ? { backgroundImage: TIME_OFF_FILL } : {}),
                        }}
                      >
                        <div className="space-y-px" style={{ minHeight: px(rowH) }}>
                          {off && cellEntries.length === 0 && (
                            <div className="flex items-center justify-center text-rose-300" style={{ height: px(rowH) }}>
                              <Ban size={Math.max(8, Math.round(11 * zoom))} />
                            </div>
                          )}
                          {cellEntries.map((entry) => {
                            const subj = entry.subjectId ? subjectById.get(entry.subjectId) : null
                            const ids = teacherIdsOf(entry)
                            const names = ids
                              .map((id) => teacherById.get(id)?.full_name)
                              .filter((n): n is string => !!n)
                            const eid = entryId(entry)
                            const span = entry.blockKey ? blockSpan.get(entry.blockKey) ?? 1 : 1
                            const linkedLeft = blockNeighbour(entry, -1)
                            const linkedRight = blockNeighbour(entry, 1)
                            const room = entry.roomId ? roomById.get(entry.roomId) : null
                            const amended = hasOverride?.(entry.homeroomId, day, slot.id) ?? false
                            return (
                              <div
                                key={eid}
                                draggable
                                onDragStart={() => {
                                  dragRef.current = entry
                                  setDragId(eid)
                                }}
                                onDragEnd={() => {
                                  dragRef.current = null
                                  setDragId(null)
                                  setOverCell(null)
                                }}
                                title={`${subj?.name ?? 'Lesson'}${names.length ? ' · ' + names.join(', ') : ''}${room ? ' · ' + room.name : ''}${span > 1 ? ` · ${span}-period block` : ''}${entry.isLocked ? ' · pinned' : ''}`}
                                className={`relative px-0.5 cursor-grab active:cursor-grabbing leading-tight ${
                                  dragId === eid ? 'opacity-40' : ''
                                } ${inConflict ? 'ring-1 ring-inset ring-rose-400' : ''}`}
                                style={{
                                  background: (subj?.color ?? '#52525B') + '33',
                                  // A double/triple runs across adjacent period
                                  // columns: only the outer edges of the run are
                                  // drawn, so it reads as one wide lesson.
                                  borderLeft: linkedLeft ? 'none' : `2px solid ${subj?.color ?? '#52525B'}`,
                                  marginLeft: linkedLeft ? -1 : undefined,
                                  marginRight: linkedRight ? -1 : undefined,
                                }}
                              >
                                <div className="font-bold text-slate-900 truncate">
                                  {linkedLeft
                                    ? '·'
                                    : (subj?.code || subj?.name || '—').slice(0, labelChars)}
                                </div>
                                {!dense && !linkedLeft && names.length > 0 && (
                                  <div className="text-slate-700 truncate" style={{ fontSize: px(fontSub) }}>
                                    {names.length > 1 ? `${shortName(names[0])} +${names.length - 1}` : shortName(names[0])}
                                  </div>
                                )}
                                {/* Badges compete with the label for a cell
                                    about 19px wide at the smallest zoom, so
                                    below TINY_ZOOM only the pin survives — it
                                    is the one that changes what the next
                                    generate does. The rest come back on the
                                    way in. */}
                                <div className="absolute top-0 right-0 flex items-center gap-px">
                                  {entry.groupId && !tiny && (
                                    <span className="w-1 h-1 rounded-full bg-indigo-500" title="Split group" />
                                  )}
                                  {span > 1 && !linkedLeft && !tiny && (
                                    <span
                                      className="font-bold text-slate-600"
                                      style={{ fontSize: px(Math.max(6, Math.round(7 * zoom))) }}
                                      title={`${span}-period block`}
                                    >
                                      ×{span}
                                    </span>
                                  )}
                                  {amended && !tiny && (
                                    <span title="A date change amends this period" className="inline-flex">
                                      <CalendarClock
                                        size={Math.max(7, Math.round(9 * zoom))}
                                        className="text-[#B8983C]"
                                      />
                                    </span>
                                  )}
                                  {entry.combinedKey && !tiny && <Layers size={Math.max(7, Math.round(9 * zoom))} className="text-indigo-600" />}
                                  {entry.isLocked && !linkedLeft && (
                                    <Pin size={Math.max(7, Math.round(9 * zoom))} className="text-slate-900" />
                                  )}
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      </td>
                    )
                  }),
                )}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )

  const toolbar = (
    <div className="flex flex-wrap items-center gap-1.5 mb-2">
      <button
        onClick={() => { setAutoFit(true); recomputeFit() }}
        aria-pressed={autoFit}
        className={`${BTN_SM} ${autoFit ? SM_DARK : SM_GHOST}`}
        title="Shrink the grid to fit the screen"
      >
        <Scan size={13} /> Fit
      </button>
      <div className="inline-flex items-center rounded-full bg-white border border-[#E2DDD2]">
        <button onClick={() => nudgeZoom(-0.1)} aria-label="Zoom out" title="Zoom out" className={`${ICON_BTN} !w-9 !h-9 sm:!w-7 sm:!h-7 text-slate-600`}>
          <ZoomOut size={13} />
        </button>
        <span className="px-1 text-[12px] tabular-nums text-slate-500 min-w-[2.75rem] text-center">
          {Math.round(zoom * 100)}%
        </span>
        <button onClick={() => nudgeZoom(0.1)} aria-label="Zoom in" title="Zoom in" className={`${ICON_BTN} !w-9 !h-9 sm:!w-7 sm:!h-7 text-slate-600`}>
          <ZoomIn size={13} />
        </button>
      </div>
      <button
        onClick={() => setFullscreen((f) => !f)}
        className={`${BTN_SM} ${SM_GHOST}`}
        title={fullscreen ? 'Leave full screen (Esc)' : 'Use the whole screen'}
        aria-label={fullscreen ? 'Leave full screen' : 'Full screen'}
      >
        {fullscreen ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
        <span className="hidden sm:inline">{fullscreen ? 'Exit full screen' : 'Full screen'}</span>
      </button>
      <span className="ml-auto flex items-center gap-3 text-[11.5px] text-slate-400">
        <span className="hidden lg:inline">Drag a lesson to move it · tap to open · red is a clash</span>
        <span className="tabular-nums">{homerooms.length} classes × {days.length * teachingSlots.length} periods</span>
      </span>
    </div>
  )

  const modal = open && (
    <DraftSlotModal
      homeroomId={open.homeroom.id}
      homeroomName={open.homeroom.name}
      day={open.day}
      slot={open.slot}
      onClose={() => setOpen(null)}
    />
  )

  if (fullscreen) {
    return (
      <div className="fixed inset-0 z-50 bg-[#F7F5F1] p-2 sm:p-3 pb-[max(0.5rem,env(safe-area-inset-bottom))] flex flex-col">
        {toolbar}
        {grid}
        {modal}
      </div>
    )
  }

  return (
    <div>
      {toolbar}
      {grid}
      {modal}
    </div>
  )
}

// "Priya Raman" → "P. Raman", so a name still reads inside a 50px cell.
function shortName(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0]
  return `${parts[0][0]}. ${parts[parts.length - 1]}`
}
