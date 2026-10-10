'use client'

import React, { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  X, Pin, PinOff, Layers, Users, DoorOpen, Clock, GraduationCap, AlertTriangle,
  Trash2, Pencil, Ban, CalendarClock, Check, Repeat, Undo2,
} from 'lucide-react'
import { WEEKDAY_LABELS, teacherIdsOf } from '@/lib/timetable'
import type { PlacedEntry, PeriodSlot, Subject, Room, Weekday } from '@/lib/timetable'
import type { EntryOverride, OverrideKind, OverrideSpan } from '@/lib/timetable/overrides'
import { describeSpan, nextDateOn, formatDateLabel, todayISO } from '@/lib/timetable/overrides'
import type { UserProfile } from '@/lib/supabase'
import { SmartSelect, BTN_SM, SECTION_LABEL, INPUT, TAP, FOCUS } from './ui'
import type { SmartOption } from './ui'
import MultiTeacherSelect from './MultiTeacherSelect'
import useBodyScrollLock from '@/hooks/useBodyScrollLock'

// ============================================================
// One period of one class — the single box every grid opens.
//
// Before this, clicking a cell did different things depending on where you
// clicked it: the master grid and the class week opened a details box, while
// the same cell inside a Time-off calendar silently toggled a pin. Same
// gesture, same-looking cell, two unrelated outcomes. Now every grid opens
// this, and everything you can do to a period lives in it:
//
//   · what is scheduled, who teaches it, where, and whether it is pinned
//   · which classes a combined lesson gathers, and how long a double runs
//   · edit the lesson in the weekly template
//   · ban the period (time off) without hunting for the right tab
//   · replace it for ONE date, or from a date onwards, leaving the
//     template alone — see src/lib/timetable/overrides.ts
// ============================================================

export interface SlotTarget {
  homeroomId: string
  homeroomName: string
  day: Weekday
  slot: PeriodSlot
}

/** Which classes a combined lesson gathers, resolved by the host. */
export interface CombinedInfo {
  name: string
  subjectName?: string
  members: { homeroomName: string; groupName?: string }[]
}

export interface OverrideDraft {
  kind: OverrideKind
  span: OverrideSpan
  date: string
  groupId: string | null
  subjectId: string | null
  teacherIds: string[]
  roomId: string | null
  note: string
}

interface Props {
  target: SlotTarget
  /** Every entry sitting in this class's cell (whole-class + parallel groups). */
  entries: PlacedEntry[]
  subjects: Subject[]
  teachers: UserProfile[]
  rooms: Room[]
  /** Human name for a split group id, when known. */
  groupName?: (groupId: string) => string | undefined
  /** Human-readable reasons this cell is flagged, if any. */
  conflicts?: string[]
  /** This class is marked time off in this period. */
  timeOff?: boolean
  /** Lets the box toggle time off itself. Omit to show the state read-only. */
  onToggleTimeOff?: () => void | Promise<void>
  /** How many periods a lesson's block runs for (1 = a single period). */
  blockSpan?: (entry: PlacedEntry) => number
  /** The classes behind a combined lesson's `combinedKey`. */
  combinedInfo?: (combinedKey: string) => CombinedInfo | null
  /** Overrides already recorded against this cell, newest first. */
  overrides?: EntryOverride[]
  /** Omit to hide the date-replacement panel (e.g. before a config exists). */
  onSaveOverride?: (draft: OverrideDraft) => void | Promise<void>
  onDeleteOverride?: (id: string) => void | Promise<void>
  onClose: () => void
  onTogglePin: (entry: PlacedEntry) => void
  onSave: (groupId: string | null, subjectId: string, teacherIds: string[], roomId: string | null) => void
  onClear: (entry: PlacedEntry) => void
}

const entryKey = (e: PlacedEntry) =>
  `${e.homeroomId}__${e.day}__${e.slotId}__${e.groupId ?? ''}__${e.combinedKey ?? ''}`

const BLOCK_WORD: Record<number, string> = { 2: 'Double', 3: 'Triple', 4: 'Quad' }
const blockWord = (n: number) => BLOCK_WORD[n] ?? `${n} in a row`

export default function SlotDetailsModal({
  target, entries, subjects, teachers, rooms, groupName, conflicts = [], timeOff = false,
  onToggleTimeOff, blockSpan, combinedInfo, overrides = [], onSaveOverride, onDeleteOverride,
  onClose, onTogglePin, onSave, onClear,
}: Props) {
  const { homeroomName, day, slot } = target

  const subjectById = useMemo(() => new Map(subjects.map((s) => [s.id, s])), [subjects])
  const teacherById = useMemo(() => new Map(teachers.map((t) => [t.id, t])), [teachers])
  const roomById = useMemo(() => new Map(rooms.map((r) => [r.id, r])), [rooms])

  // Combined lessons are edited on the combined class itself, so only the
  // class's own lessons are candidates for the edit form.
  const editableEntries = useMemo(() => entries.filter((e) => !e.combinedKey), [entries])

  type Panel = { mode: 'edit' | 'replace'; entry: PlacedEntry | null } | null
  const [panel, setPanel] = useState<Panel>(
    entries.length === 0 ? { mode: 'edit', entry: null } : null,
  )

  useBodyScrollLock(true)

  // Esc closes. Registered in the capture phase so this box — which can be
  // opened from inside the workspace modal — gets the key before the modal
  // underneath does and closes itself rather than its host.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  const subjectOptions: SmartOption[] = useMemo(
    () => subjects.map((s) => ({
      value: s.id, label: s.name, color: s.color ?? undefined, sublabel: s.code ?? undefined,
    })),
    [subjects],
  )
  const roomOptions: SmartOption[] = useMemo(
    () => rooms.map((r) => ({ value: r.id, label: r.name })),
    [rooms],
  )

  const timeLabel = slot.start_time && slot.end_time
    ? `${slot.start_time.slice(0, 5)}–${slot.end_time.slice(0, 5)}`
    : null

  if (typeof document === 'undefined') return null

  // Through a portal: the grids that open this can themselves live inside the
  // workspace modal, whose panel is both `overflow-hidden` and transformed by
  // its entry animation — a `fixed` child of that is clipped and positioned
  // against the panel rather than the viewport.
  return createPortal(
    <div
      className="fixed inset-0 z-[1300] flex items-end sm:items-center justify-center bg-black/40 sm:p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${homeroomName}, ${WEEKDAY_LABELS[day]}, ${slot.label ?? 'period'}`}
        className="bg-white border-t sm:border border-[#D4D4D8] shadow-xl w-full sm:max-w-lg max-h-[92vh] sm:max-h-[86vh] overflow-y-auto overscroll-contain"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Where in the week this cell sits. */}
        <div className="flex items-start justify-between gap-3 px-4 sm:px-5 pt-3.5 pb-3 border-b border-[#E4E4E7] sticky top-0 bg-white z-10">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-sm font-semibold text-[#18181B]">
              <GraduationCap size={15} className="text-[#71717A] flex-shrink-0" />
              <span className="truncate">{homeroomName}</span>
            </div>
            <div className="flex items-center gap-1.5 text-[11px] text-[#71717A] mt-0.5">
              <Clock size={12} />
              {WEEKDAY_LABELS[day]} · {slot.label ?? 'Period'}
              {timeLabel && <span className="tabular-nums">· {timeLabel}</span>}
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className={`-mr-1 p-1.5 text-[#A1A1AA] hover:text-[#18181B] flex-shrink-0 ${TAP} ${FOCUS}`}
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-4 sm:p-5 space-y-3.5">
          {conflicts.length > 0 && (
            <div className="px-3 py-2 bg-rose-50 border border-rose-200 text-[12px] text-rose-800 space-y-1">
              {conflicts.map((c, i) => (
                <div key={i} className="flex items-start gap-2">
                  <AlertTriangle size={13} className="flex-shrink-0 mt-0.5" />
                  <span>{c}</span>
                </div>
              ))}
            </div>
          )}

          {/* What is scheduled here */}
          {entries.length === 0 ? (
            <p className="text-sm text-[#A1A1AA]">
              {timeOff ? 'Kept free — this class is banned from this period.' : 'This period is free.'}
            </p>
          ) : (
            <div className="space-y-2">
              {entries.map((entry) => (
                <LessonCard
                  key={entryKey(entry)}
                  entry={entry}
                  subject={entry.subjectId ? subjectById.get(entry.subjectId) : undefined}
                  room={entry.roomId ? roomById.get(entry.roomId) : undefined}
                  teacherName={(id) => teacherById.get(id)?.full_name ?? 'Teacher'}
                  groupName={groupName}
                  span={blockSpan?.(entry) ?? 1}
                  combined={entry.combinedKey ? combinedInfo?.(entry.combinedKey) ?? null : null}
                  onTogglePin={() => onTogglePin(entry)}
                  onEdit={() => setPanel({ mode: 'edit', entry })}
                  onReplace={onSaveOverride ? () => setPanel({ mode: 'replace', entry }) : undefined}
                  onRemove={() => onClear(entry)}
                />
              ))}
            </div>
          )}

          {/* This period, regardless of what sits in it. Ban lives here rather
              than on the lesson: it is a property of the class's week. */}
          <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
            {onToggleTimeOff ? (
              <button
                onClick={() => onToggleTimeOff()}
                aria-pressed={timeOff}
                className={`${BTN_SM} border ${
                  timeOff
                    ? 'bg-rose-600 text-white border-rose-600 hover:bg-rose-700'
                    : 'bg-white text-[#52525B] border-[#D4D4D8] hover:bg-[#F5F5F5] hover:text-rose-700'
                }`}
                title={timeOff
                  ? `Let lessons back into this period for ${homeroomName}`
                  : `Keep ${homeroomName} out of this period — the generator never schedules it`}
              >
                {/* Named, not just "Ban this period": the same box opens from a
                    teacher's calendar, where the corner toggle bans the
                    TEACHER. One word for two scopes is how they got confused. */}
                {timeOff ? <Check size={12} /> : <Ban size={12} />}
                {timeOff ? `Allow ${homeroomName} again` : `Ban for ${homeroomName}`}
              </button>
            ) : timeOff ? (
              <span className="inline-flex items-center gap-1.5 text-[12px] text-rose-700 px-2 py-1 bg-rose-50 border border-rose-200">
                <Ban size={12} /> Banned for this class
              </span>
            ) : null}
            {entries.length > 0 && editableEntries.length === 0 && (
              <span className="text-[11px] text-[#A1A1AA]">
                Combined lessons are edited on the combined class.
              </span>
            )}
            {entries.length > 0 && editableEntries.length > 0 && panel === null && (
              <button
                onClick={() => setPanel({ mode: 'edit', entry: null })}
                className={`${BTN_SM} bg-white border border-[#D4D4D8] text-[#52525B] hover:bg-[#F5F5F5]`}
              >
                <Pencil size={12} /> Add another lesson
              </button>
            )}
          </div>

          {/* Overrides already in place on this cell. */}
          {overrides.length > 0 && (
            <OverrideList
              overrides={overrides}
              subjectName={(id) => (id ? subjectById.get(id)?.name ?? 'Lesson' : 'Lesson')}
              teacherName={(id) => teacherById.get(id)?.full_name ?? 'Teacher'}
              groupName={groupName}
              onDelete={onDeleteOverride}
            />
          )}

          {entries.length === 0 && panel === null && (
            <button
              onClick={() => setPanel({ mode: 'edit', entry: null })}
              className={`w-full ${BTN_SM} bg-[#F5F5F5] border border-[#D4D4D8] text-[#18181B] hover:bg-[#EBEBEB]`}
            >
              <Pencil size={12} /> Add a lesson
            </button>
          )}

          {panel?.mode === 'edit' && (
            <LessonForm
              entry={panel.entry}
              groupName={groupName}
              subjectOptions={subjectOptions}
              roomOptions={roomOptions}
              teachers={teachers}
              onCancel={() => setPanel(null)}
              onSubmit={(subjectId, teacherIds, roomId) =>
                onSave(panel.entry?.groupId ?? null, subjectId, teacherIds, roomId)}
            />
          )}

          {panel?.mode === 'replace' && onSaveOverride && (
            <ReplaceForm
              entry={panel.entry}
              day={day}
              subjectOptions={subjectOptions}
              roomOptions={roomOptions}
              teachers={teachers}
              onCancel={() => setPanel(null)}
              onSubmit={(draft) => onSaveOverride(draft)}
            />
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}

// ── One scheduled lesson ─────────────────────────────────────

function LessonCard({
  entry, subject, room, teacherName, groupName, span, combined,
  onTogglePin, onEdit, onReplace, onRemove,
}: {
  entry: PlacedEntry
  subject?: Subject
  room?: Room
  teacherName: (id: string) => string
  groupName?: (groupId: string) => string | undefined
  span: number
  combined: CombinedInfo | null
  onTogglePin: () => void
  onEdit: () => void
  onReplace?: () => void
  onRemove: () => void
}) {
  const ids = teacherIdsOf(entry)
  const accent = subject?.color ?? '#52525B'

  return (
    <div
      className="border border-[#E4E4E7] bg-[#FAFAF9] p-3"
      style={{ borderLeft: `3px solid ${accent}` }}
    >
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="font-semibold text-sm text-[#18181B] flex-1 min-w-0 truncate">
          {subject?.name ?? 'Lesson'}
        </span>
        {span > 1 && <Tag tone="zinc" icon={Repeat}>{blockWord(span)}</Tag>}
        {entry.groupId && (
          <Tag tone="indigo" icon={Users}>{groupName?.(entry.groupId) ?? 'Group'}</Tag>
        )}
        {entry.combinedKey && <Tag tone="indigo" icon={Layers}>Combined</Tag>}
        {entry.isLocked && <Tag tone="dark" icon={Pin}>Pinned</Tag>}
      </div>

      <dl className="mt-2 space-y-1 text-[12px] text-[#52525B]">
        <Line icon={Users}>
          {ids.length === 0 ? (
            <span className="text-[#A1A1AA] italic">No teacher assigned</span>
          ) : (
            ids.map((id, i) => (
              <span key={id}>
                {i > 0 && ', '}
                {teacherName(id)}
                {i === 0 && ids.length > 1 && <span className="text-[#A1A1AA]"> (primary)</span>}
              </span>
            ))
          )}
        </Line>
        <Line icon={DoorOpen}>{room?.name ?? <span className="text-[#A1A1AA]">No room</span>}</Line>
        {combined && (
          <Line icon={Layers}>
            <span>
              <span className="text-[#71717A]">
                {combined.members.length} classes together
                {combined.name ? ` · ${combined.name}` : ''}
                {': '}
              </span>
              {combined.members
                .map((m) => (m.groupName ? `${m.homeroomName} (${m.groupName})` : m.homeroomName))
                .join(', ')}
            </span>
          </Line>
        )}
      </dl>

      <div className="flex items-center gap-1.5 flex-wrap mt-2.5">
        <button
          onClick={onTogglePin}
          aria-pressed={entry.isLocked}
          className={`${BTN_SM} border ${
            entry.isLocked
              ? 'bg-[#27272A] text-white border-[#27272A] hover:bg-[#18181B]'
              : 'bg-white text-[#52525B] border-[#D4D4D8] hover:bg-[#F5F5F5]'
          }`}
          title={entry.isLocked
            ? 'Unpin — the generator may move it'
            : 'Pin here — regenerating builds the week around it'}
        >
          {entry.isLocked ? <PinOff size={12} /> : <Pin size={12} />}
          {entry.isLocked ? 'Unpin' : 'Pin here'}
        </button>
        {onReplace && (
          <button
            onClick={onReplace}
            className={`${BTN_SM} bg-white border border-[#D4D4D8] text-[#52525B] hover:bg-[#F5F5F5]`}
            title="Change this period for one date, or from a date onwards, without touching the weekly timetable"
          >
            <CalendarClock size={12} /> Replace on a date
          </button>
        )}
        {!entry.combinedKey && (
          <>
            <button
              onClick={onEdit}
              className={`${BTN_SM} bg-white border border-[#D4D4D8] text-[#52525B] hover:bg-[#F5F5F5]`}
              title="Change the lesson in the weekly timetable, every week"
            >
              <Pencil size={12} /> Edit
            </button>
            <button
              onClick={onRemove}
              className={`${BTN_SM} text-rose-600 hover:bg-rose-50 ml-auto`}
            >
              <Trash2 size={12} /> Remove
            </button>
          </>
        )}
      </div>
      {entry.combinedKey && (
        <p className="text-[11px] text-[#A1A1AA] mt-2">
          Pinning or moving it carries every class above with it.
        </p>
      )}
    </div>
  )
}

function Line({ icon: Icon, children }: { icon: React.ElementType; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-1.5">
      <Icon size={12} className="flex-shrink-0 mt-0.5 text-[#A1A1AA]" aria-hidden />
      <span className="min-w-0">{children}</span>
    </div>
  )
}

const TAG_TONE = {
  zinc: 'bg-[#F5F5F5] border-[#D4D4D8] text-[#52525B]',
  indigo: 'bg-indigo-50 border-indigo-200 text-indigo-700',
  dark: 'bg-[#27272A] border-[#27272A] text-white',
  amber: 'bg-amber-50 border-amber-200 text-amber-800',
} as const

function Tag({
  tone, icon: Icon, children,
}: { tone: keyof typeof TAG_TONE; icon?: React.ElementType; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 border flex-shrink-0 ${TAG_TONE[tone]}`}>
      {Icon && <Icon size={10} aria-hidden />}
      {children}
    </span>
  )
}

// ── Edit the weekly lesson ───────────────────────────────────

function LessonForm({
  entry, groupName, subjectOptions, roomOptions, teachers, onCancel, onSubmit,
}: {
  entry: PlacedEntry | null
  groupName?: (groupId: string) => string | undefined
  subjectOptions: SmartOption[]
  roomOptions: SmartOption[]
  teachers: UserProfile[]
  onCancel: () => void
  onSubmit: (subjectId: string, teacherIds: string[], roomId: string | null) => void
}) {
  const [subjectId, setSubjectId] = useState(entry?.subjectId ?? '')
  const [teacherIds, setTeacherIds] = useState<string[]>(entry ? teacherIdsOf(entry) : [])
  const [roomId, setRoomId] = useState(entry?.roomId ?? '')

  return (
    <form
      className="border-t border-[#E4E4E7] pt-3.5 space-y-3"
      onSubmit={(e) => { e.preventDefault(); if (subjectId) onSubmit(subjectId, teacherIds, roomId || null) }}
    >
      <p className={SECTION_LABEL}>
        {entry ? 'Edit lesson — every week' : 'Add a lesson — every week'}
        {entry?.groupId && ` · ${groupName?.(entry.groupId) ?? 'Group'}`}
      </p>
      <Labelled label="Subject">
        <SmartSelect options={subjectOptions} value={subjectId} onChange={setSubjectId} placeholder="Select subject…" searchPlaceholder="Search subjects…" />
      </Labelled>
      <Labelled label="Teachers">
        <MultiTeacherSelect teachers={teachers} value={teacherIds} onChange={setTeacherIds} compact />
      </Labelled>
      <Labelled label="Room">
        <SmartSelect options={roomOptions} value={roomId} onChange={setRoomId} placeholder="None" searchPlaceholder="Search rooms…" allowClear />
      </Labelled>
      <FormActions onCancel={onCancel} disabled={!subjectId} submitLabel="Save" />
    </form>
  )
}

// ── Replace on a date ────────────────────────────────────────

function ReplaceForm({
  entry, day, subjectOptions, roomOptions, teachers, onCancel, onSubmit,
}: {
  entry: PlacedEntry | null
  day: Weekday
  subjectOptions: SmartOption[]
  roomOptions: SmartOption[]
  teachers: UserProfile[]
  onCancel: () => void
  onSubmit: (draft: OverrideDraft) => void
}) {
  // The cell is a Tuesday period, so the date that needs replacing is almost
  // always the next Tuesday — not today, which may not even be a Tuesday.
  const [date, setDate] = useState(() => nextDateOn(day))
  const [span, setSpan] = useState<OverrideSpan>('date')
  const [kind, setKind] = useState<OverrideKind>('replace')
  const [subjectId, setSubjectId] = useState(entry?.subjectId ?? '')
  const [teacherIds, setTeacherIds] = useState<string[]>(entry ? teacherIdsOf(entry) : [])
  const [roomId, setRoomId] = useState(entry?.roomId ?? '')
  const [note, setNote] = useState('')

  const wrongWeekday = useMemo(() => {
    const d = new Date(`${date}T12:00:00`)
    const names: Weekday[] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
    return names[(d.getDay() + 6) % 7] !== day
  }, [date, day])

  const ready = date !== '' && !wrongWeekday && (kind === 'cancel' || !!subjectId)

  return (
    <form
      className="border-t border-[#E4E4E7] pt-3.5 space-y-3"
      onSubmit={(e) => {
        e.preventDefault()
        if (!ready) return
        onSubmit({
          kind, span, date, groupId: entry?.groupId ?? null,
          subjectId: kind === 'replace' ? subjectId : null,
          teacherIds, roomId: roomId || null, note,
        })
      }}
    >
      <p className={SECTION_LABEL}>Replace on a date — the weekly timetable stays as it is</p>

      <Labelled label="Date">
        <input
          type="date"
          value={date}
          min={todayISO()}
          onChange={(e) => setDate(e.target.value)}
          className={INPUT}
        />
      </Labelled>
      {wrongWeekday && (
        <p className="flex items-start gap-1.5 text-[11px] text-amber-800 bg-amber-50 border border-amber-200 px-2.5 py-1.5">
          <AlertTriangle size={12} className="flex-shrink-0 mt-0.5" />
          <span>
            {formatDateLabel(date)} is not a {WEEKDAY_LABELS[day]}, and this period only runs on{' '}
            {WEEKDAY_LABELS[day]}s. Pick a {WEEKDAY_LABELS[day]}.
          </span>
        </p>
      )}

      <Labelled label="How long">
        <Choice
          value={span}
          onChange={setSpan}
          options={[
            { value: 'date' as const, label: 'That date only', hint: formatDateLabel(date) },
            { value: 'onwards' as const, label: 'That date onwards', hint: 'every following week' },
          ]}
        />
      </Labelled>

      <Labelled label="What happens">
        <Choice
          value={kind}
          onChange={setKind}
          options={[
            { value: 'replace' as const, label: 'A different lesson', hint: 'subject, teachers, room' },
            { value: 'cancel' as const, label: 'No lesson', hint: 'the period goes free' },
          ]}
        />
      </Labelled>

      {kind === 'replace' && (
        <>
          <Labelled label="Subject">
            <SmartSelect options={subjectOptions} value={subjectId} onChange={setSubjectId} placeholder="Select subject…" searchPlaceholder="Search subjects…" />
          </Labelled>
          <Labelled label="Teachers">
            <MultiTeacherSelect teachers={teachers} value={teacherIds} onChange={setTeacherIds} compact />
          </Labelled>
          <Labelled label="Room">
            <SmartSelect options={roomOptions} value={roomId} onChange={setRoomId} placeholder="None" searchPlaceholder="Search rooms…" allowClear />
          </Labelled>
        </>
      )}

      <Labelled label="Note (optional)">
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="e.g. covering for sick leave"
          className={INPUT}
        />
      </Labelled>

      <FormActions onCancel={onCancel} disabled={!ready} submitLabel="Apply" />
    </form>
  )
}

/** Existing overrides on this cell, with a way to lift each one. */
function OverrideList({
  overrides, subjectName, teacherName, groupName, onDelete,
}: {
  overrides: EntryOverride[]
  subjectName: (id: string | null) => string
  teacherName: (id: string) => string
  groupName?: (groupId: string) => string | undefined
  onDelete?: (id: string) => void | Promise<void>
}) {
  const today = todayISO()
  return (
    <div className="border border-[#E4E4E7]">
      <p className={`${SECTION_LABEL} px-3 py-1.5 bg-[#FAFAF9] border-b border-[#E4E4E7]`}>
        Date changes
      </p>
      <ul className="divide-y divide-[#F0F0F0]">
        {overrides.map((o) => {
          const live = o.effective_from <= today && (o.effective_to === null || o.effective_to >= today)
          const names = teacherIdsOf(o).map(teacherName)
          return (
            <li key={o.id} className="flex items-start gap-2 px-3 py-2 text-[12px]">
              <CalendarClock
                size={13}
                className={`flex-shrink-0 mt-0.5 ${live ? 'text-[#B8983C]' : 'text-[#D4D4D8]'}`}
                aria-hidden
              />
              <div className="min-w-0 flex-1">
                <p className="text-[#18181B]">
                  {o.kind === 'cancel'
                    ? 'No lesson'
                    : subjectName(o.subject_id)}
                  {o.group_id && (
                    <span className="text-[#A1A1AA]"> · {groupName?.(o.group_id) ?? 'Group'}</span>
                  )}
                  {names.length > 0 && <span className="text-[#71717A]"> · {names.join(', ')}</span>}
                </p>
                <p className="text-[11px] text-[#A1A1AA]">
                  {describeSpan(o)}
                  {!live && ' · not in force today'}
                  {o.note && ` · ${o.note}`}
                </p>
              </div>
              {onDelete && (
                <button
                  onClick={() => onDelete(o.id)}
                  aria-label="Lift this date change"
                  title="Lift it — the ordinary weekly lesson comes back"
                  className={`p-1 text-[#A1A1AA] hover:text-rose-600 flex-shrink-0 ${TAP} ${FOCUS}`}
                >
                  <Undo2 size={13} />
                </button>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

// ── Form furniture ───────────────────────────────────────────

function Labelled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <span className={`block ${SECTION_LABEL} mb-1.5`}>{label}</span>
      {children}
    </div>
  )
}

function Choice<T extends string>({
  value, onChange, options,
}: {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: string; hint?: string }[]
}) {
  return (
    <div className="grid grid-cols-2 gap-1.5">
      {options.map((o) => {
        const active = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            aria-pressed={active}
            className={`text-left px-2.5 py-2 border ${TAP} ${FOCUS} ${
              active
                ? 'bg-[#27272A] border-[#27272A] text-white'
                : 'bg-white border-[#D4D4D8] text-[#52525B] hover:bg-[#F5F5F5]'
            }`}
          >
            <span className="block text-[12px] font-medium">{o.label}</span>
            {o.hint && (
              <span className={`block text-[10px] ${active ? 'text-white/60' : 'text-[#A1A1AA]'}`}>
                {o.hint}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

function FormActions({
  onCancel, disabled, submitLabel,
}: { onCancel: () => void; disabled: boolean; submitLabel: string }) {
  return (
    <div className="flex items-center gap-2">
      <button type="button" onClick={onCancel} className={`${BTN_SM} text-[#71717A] hover:text-[#18181B]`}>
        Cancel
      </button>
      <div className="flex-1" />
      <button
        type="submit"
        disabled={disabled}
        className={`${BTN_SM} px-4 bg-[#27272A] text-[#F5F5F5] hover:bg-[#18181B]`}
      >
        {submitLabel}
      </button>
    </div>
  )
}
