'use client'

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { Loader2, Plus, Trash2, DoorOpen, BookOpen } from 'lucide-react'
import {
  fetchSubjects, createSubject, deleteSubject,
  fetchRooms, createRoom, deleteRoom, ROOM_TYPE_LABELS,
} from '@/lib/timetable'
import type { Subject, Room, RoomType, TimetableConfig, Weekday } from '@/lib/timetable'
import { fetchAllHomerooms } from '@/lib/homerooms'
import type { Homeroom } from '@/lib/homerooms'
import { searchSubjects } from '@/lib/cbseSubjects'
import {
  INPUT, BTN_PRIMARY, SmartSelect, Section, Field, Loading, Chip, ICON_BTN_DANGER, askConfirm, choice,
} from '../../ui'
import type { SmartOption } from '../../ui'
import { TimeOffGrid, LoadLimitFields } from '../constraintAtoms'
import LessonStatsCard from '../../LessonStatsCard'
import { useConstraints } from '../useConstraints'
import { ColorPicker, SUBJECT_COLORS } from '../colorPicker'
import { useTimetableDraftOptional } from '../../draft/TimetableDraftContext'
import DraftWeekGrid from '../../draft/DraftWeekGrid'
import PeriodGroupSwitch, { usePeriodGroupSwitch } from '../../PeriodGroupSwitch'
import {
  EntityShell, EntityList, EntityRow, DetailHeader, EmptyDetail,
} from '../EntityList'


const ROOM_TYPES: RoomType[] = ['classroom', 'science_lab', 'computer_lab', 'other']

/**
 * The Subjects hub — a searchable list of subjects (with the CBSE name
 * typeahead for adding) and, per subject, its time-off and min/max per day &
 * week limits (all homerooms or a specific one). A Rooms panel lives alongside.
 */
export default function SubjectModal({ config }: { config: TimetableConfig | null }) {
  // Subject and room changes colour the grid and feed the next generate, so
  // the shared draft has to hear about them too.
  const draft = useTimetableDraftOptional()
  // Inside the workspace the draft already holds the subjects and classes, and
  // refreshReference() re-reads them after a change; only without a draft
  // does the editor read them itself.
  const [own, setOwn] = useState<{ subjects: Subject[]; homerooms: Homeroom[] } | null>(null)
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState('')
  const [showRooms, setShowRooms] = useState(false)

  // Add-subject form (CBSE typeahead).
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [color, setColor] = useState(SUBJECT_COLORS[0])
  const [adding, setAdding] = useState(false)
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    if (draft) { await draft.refreshReference(); return }
    const [subs, hr] = await Promise.all([fetchSubjects(), fetchAllHomerooms()])
    setOwn({ subjects: subs, homerooms: hr })
    // Only whether there is a draft matters here, not its every edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!draft])

  useEffect(() => { if (!draft) load() }, [draft, load])

  const fromDraft = !!draft && !draft.loading
  const subjects = useMemo(() => (fromDraft ? draft!.subjects : own?.subjects ?? []), [fromDraft, draft, own])
  const homerooms = useMemo(() => (fromDraft ? draft!.homerooms : own?.homerooms ?? []), [fromDraft, draft, own])
  const loading = draft ? draft.loading : own === null

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? subjects.filter((s) => s.name.toLowerCase().includes(q) || s.code?.toLowerCase().includes(q)) : subjects
  }, [subjects, query])

  useEffect(() => {
    if (!showRooms && filtered.length > 0 && !filtered.some((s) => s.id === selectedId)) setSelectedId(filtered[0].id)
  }, [filtered, selectedId, showRooms])

  const selected = subjects.find((s) => s.id === selectedId) ?? null

  const handleNameChange = (val: string) => {
    setName(val)
    const results = searchSubjects(val)
    setSuggestions(results)
    setShowSuggestions(results.length > 0)
  }

  const handleAdd = async () => {
    if (!name.trim()) return
    setAdding(true)
    const created = await createSubject({ name: name.trim(), code: code.trim() || null, color })
    setAdding(false)
    if (created) {
      setName(''); setCode(''); setSuggestions([]); setShowSuggestions(false)
      await load()
      setSelectedId(created.id)
    }
  }

  if (loading) return <Loading />

  const addSubjectForm = (
        /* The CBSE name typeahead, a thumb-friendly colour strip (no hidden
           popover — every swatch is visible and directly tappable), then code
           + submit. */
        <div className="p-2.5 border-t border-[#EEEAE1] bg-white space-y-2">
          <p className="text-[12px] font-semibold text-slate-500 px-0.5">New subject</p>
          <div className="relative">
            <input
              ref={inputRef}
              className={INPUT}
              placeholder="Subject name"
              value={name}
              onChange={(e) => handleNameChange(e.target.value)}
              onFocus={() => name && suggestions.length > 0 && setShowSuggestions(true)}
              onBlur={() => setTimeout(() => setShowSuggestions(false), 120)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleAdd() }}
              autoComplete="off"
            />
            {showSuggestions && (
              <div className="absolute z-20 bottom-full left-0 right-0 mb-1.5 rounded-[14px] bg-white border border-black/[.07] shadow-[0_24px_60px_-20px_rgba(15,23,42,.45)] max-h-44 overflow-y-auto py-1">
                {suggestions.map((sug) => (
                  <button key={sug} type="button" onMouseDown={() => { setName(sug); setShowSuggestions(false); inputRef.current?.focus() }} className="w-full text-left px-3.5 py-2 text-[13.5px] text-slate-900 hover:bg-[#FAF7F0]">{sug}</button>
                ))}
              </div>
            )}
          </div>

          <ColorPicker colors={SUBJECT_COLORS} value={color} onChange={setColor} ariaLabel="Subject colour" />

          <div className="flex items-center gap-1.5">
            <input
              className={`${INPUT} !w-24 flex-none`}
              placeholder="Code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleAdd() }}
            />
            <button onClick={handleAdd} disabled={adding || !name.trim()} className={`${BTN_PRIMARY} flex-1 min-w-0`}>
              {adding ? <Loader2 className="animate-spin" size={15} /> : <Plus size={15} />}
              Add
            </button>
          </div>
        </div>
  )

  return (
    <EntityShell
      listWidth="17rem"
      list={
        <div className="flex flex-col min-h-0 sm:h-full">
          <EntityList
            query={query}
            onQuery={setQuery}
            placeholder="Search subjects…"
            count={filtered.length}
            total={subjects.length}
            actions={
              <button
                onClick={() => setShowRooms((v) => !v)}
                aria-pressed={showRooms}
                className={`${choice(showRooms)} w-full justify-center`}
              >
                <DoorOpen size={13} /> {showRooms ? 'Back to subjects' : 'Rooms'}
              </button>
            }
          >
            {filtered.length === 0 ? (
              <p className="text-[12.5px] text-slate-400 p-3.5">No subjects yet.</p>
            ) : filtered.map((s) => (
              <EntityRow
                key={s.id}
                selected={s.id === selectedId && !showRooms}
                onClick={() => { setSelectedId(s.id); setShowRooms(false) }}
                title={s.name}
                swatch={s.color}
                trailing={s.code ? <span className="text-[11px] font-mono text-slate-400">{s.code}</span> : undefined}
              />
            ))}
          </EntityList>
          {addSubjectForm}
        </div>
      }
    >
      {showRooms ? (
        <div className="flex-1 sm:overflow-y-auto overscroll-contain p-3.5 sm:p-5"><RoomsPanel /></div>
      ) : !selected ? (
        <EmptyDetail>Select a subject.</EmptyDetail>
      ) : (
        <>
          <DetailHeader
            icon={BookOpen}
            meta={selected.code ?? undefined}
            right={
              <button
                onClick={async () => {
                  const ok = await askConfirm({
                    title: `Delete ${selected.name}?`,
                    body: 'Every class requirement for this subject is deleted with it. Saved lessons keep their period but lose the subject.',
                    confirmLabel: 'Delete subject',
                    tone: 'danger',
                  })
                  if (!ok) return
                  await deleteSubject(selected.id)
                  setSelectedId('')
                  await load()
                }}
                aria-label={`Delete ${selected.name}`}
                title="Delete subject"
                className={ICON_BTN_DANGER}
              ><Trash2 size={15} /></button>
            }
          >
            <span className="inline-flex items-start gap-2">
              <span className="w-3 h-3 rounded-[3px] flex-shrink-0 mt-[6px]" style={{ background: selected.color || '#94a3b8' }} aria-hidden />
              <span className="min-w-0 break-words">{selected.name}</span>
            </span>
          </DetailHeader>
          <div className="flex-1 sm:overflow-y-auto overscroll-contain p-3.5 sm:p-5">
            {config
              ? <SubjectConstraintsPanel config={config} subject={selected} homerooms={homerooms} />
              : <p className="text-[13px] text-slate-500 py-4">Create a timetable in Configuration to set this subject&rsquo;s limits.</p>}
          </div>
        </>
      )}
    </EntityShell>
  )
}

function SubjectConstraintsPanel({
  config, subject, homerooms,
}: {
  config: TimetableConfig
  subject: Subject
  homerooms: Homeroom[]
}) {
  const { slots, constraints, loading, toggleSlot, commitValue } = useConstraints(config)
  const draft = useTimetableDraftOptional()
  const [homeroomTarget, setHomeroomTarget] = useState('')
  const scopeId = subject.id
  const hrTarget = homeroomTarget || null

  const homeroomOptions: SmartOption[] = useMemo(
    () => [{ value: '', label: 'Every class' }, ...homerooms.map((h) => ({ value: h.id, label: h.name }))],
    [homerooms],
  )

  const isOff = (day: Weekday, slotId: string) =>
    constraints.some((c) => c.type === 'time_off' && c.scope === 'subject' && c.scope_id === scopeId && c.day === day && c.slot_id === slotId)

  // Every class already taught this subject in the draft, so blocking a period
  // shows what it would displace rather than hiding it until the next generate.
  const lessons = useMemo(
    () => (draft?.entries ?? []).filter((e) => e.subjectId === scopeId),
    [draft?.entries, scopeId],
  )
  const homeroomName = useMemo(() => {
    const m = new Map(homerooms.map((h) => [h.id, h.name]))
    return (id: string) => m.get(id) ?? 'Class'
  }, [homerooms])

  // The bell schedules this subject is actually taught in become a switch
  // above the calendar, not one calendar per band stacked down the panel.
  const bandsWeeks = useMemo(() => draft?.weeks ?? [], [draft?.weeks])
  const bands = usePeriodGroupSwitch(
    bandsWeeks,
    useMemo(
      () => lessons.map((e) => draft?.slotGroupIds[e.homeroomId] ?? null),
      [lessons, draft?.slotGroupIds],
    ),
  )

  if (loading) return <Loading className="py-8" />
  if (slots.length === 0) return <p className="text-[13px] text-slate-500 py-4">Add the periods of the day in Configuration first.</p>

  return (
    <div>
      <Section
        title="Time off"
        hint="Tap a free period this subject must never be taught in. Tap a lesson to open it."
        first
        right={
          <PeriodGroupSwitch
            weeks={bandsWeeks}
            present={bands.present}
            counts={bands.counts}
            value={bands.groupId}
            onChange={bands.setGroupId}
          />
        }
      >
        {draft && bands.week ? (
          <DraftWeekGrid
            week={bands.week}
            lessons={lessons.filter((e) => (draft.slotGroupIds[e.homeroomId] ?? null) === bands.week!.groupId)}
            isOff={(d, s) => draft.isConstraintOn('subject', scopeId, 'time_off', d, s)}
            onToggleOff={(d, s) => draft.toggleConstraintCell('subject', scopeId, 'time_off', d, s)}
            subjects={draft.subjects}
            teachers={draft.teachers}
            rooms={draft.rooms}
            classLabel={homeroomName}
            hasOverride={(hr, d, sl) => draft.overrideToday(hr, d, sl, null) !== null}
            onMove={draft.moveEntry}
          />
        ) : (
          <TimeOffGrid days={config.working_days} slots={slots} isOn={isOff} onToggle={(d, s) => toggleSlot('subject', scopeId, 'time_off', d, s)} />
        )}
        {/* Every teacher and class that carries this subject. */}
        <LessonStatsCard dimension="subject" id={scopeId} className="mt-2.5" />
      </Section>

      <Section title="Limits per day and week" hint="Leave a box empty for no limit. Pick a class to set limits for that class only.">
        <div className="mb-3 max-w-xs">
          <Field label="Applies to" group>
            <SmartSelect options={homeroomOptions} value={homeroomTarget} onChange={setHomeroomTarget} placeholder="Every class" searchPlaceholder="Search classes…" />
          </Field>
        </div>
        <LoadLimitFields
          constraints={constraints}
          scope="subject"
          scopeId={scopeId}
          homeroomId={hrTarget}
          workingDays={config.working_days.length}
          onCommit={(type, v) => commitValue('subject', scopeId, hrTarget, type, v)}
        />
      </Section>
    </div>
  )
}

// ── Rooms ─────────────────────────────────────────────────────

function RoomsPanel() {
  const draft = useTimetableDraftOptional()
  const [own, setOwn] = useState<Room[] | null>(null)
  const [name, setName] = useState('')
  const [roomType, setRoomType] = useState<RoomType>('classroom')
  const [capacity, setCapacity] = useState('')
  const [adding, setAdding] = useState(false)

  // The draft's rooms when there is one; refreshReference() re-reads them.
  const load = useCallback(async () => {
    if (draft) await draft.refreshReference()
    else setOwn(await fetchRooms())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!draft])
  useEffect(() => { if (!draft) load() }, [draft, load])

  const rooms = draft ? draft.rooms : own ?? []
  const loading = draft ? draft.loading : own === null

  const handleAdd = async () => {
    if (!name.trim()) return
    setAdding(true)
    const created = await createRoom({ name: name.trim(), room_type: roomType, capacity: capacity ? parseInt(capacity, 10) : null })
    setAdding(false)
    if (created) {
      setName(''); setCapacity('')
      await load()
    }
  }

  return (
    <Section title="Rooms" hint="The rooms the generator can use. A lesson that needs a lab is only placed in a room of that type." first>
      {loading ? (
        <Loading className="py-6" />
      ) : rooms.length === 0 ? (
        <p className="text-[12.5px] text-slate-400 py-2">No rooms yet.</p>
      ) : (
        <div className="fx-card">
          {rooms.map((r) => (
            <div key={r.id} className="flex flex-wrap items-center gap-x-2.5 gap-y-1 pl-3.5 pr-1.5 py-1.5 border-b border-[#EEEAE1] last:border-b-0">
              <span className="text-[13.5px] font-medium text-slate-900 flex-1 min-w-[8rem] break-words">{r.name}</span>
              <Chip>{ROOM_TYPE_LABELS[r.room_type]}</Chip>
              {r.capacity != null && <span className="text-[12px] text-slate-400 tabular-nums">{r.capacity} seats</span>}
              <button
                onClick={async () => {
                  const ok = await askConfirm({
                    title: `Delete ${r.name}?`,
                    body: 'Lessons placed in this room keep their period but lose the room.',
                    confirmLabel: 'Delete room',
                    tone: 'danger',
                  })
                  if (ok) { await deleteRoom(r.id); await load() }
                }}
                aria-label={`Delete ${r.name}`}
                title="Delete room"
                className={ICON_BTN_DANGER}
              ><Trash2 size={15} /></button>
            </div>
          ))}
        </div>
      )}
      <div className="mt-4 grid grid-cols-2 sm:grid-cols-[minmax(0,1fr)_10rem_6rem_auto] gap-2 items-end">
        <div className="col-span-2 sm:col-span-1">
          <Field label="Room name">
            <input className={INPUT} placeholder="e.g. Physics lab" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
        </div>
        <Field label="Type">
          <select className={INPUT} value={roomType} onChange={(e) => setRoomType(e.target.value as RoomType)}>
            {ROOM_TYPES.map((t) => <option key={t} value={t}>{ROOM_TYPE_LABELS[t]}</option>)}
          </select>
        </Field>
        <Field label="Seats">
          <input className={INPUT} placeholder="—" type="number" inputMode="numeric" min={0} value={capacity} onChange={(e) => setCapacity(e.target.value)} />
        </Field>
        <button onClick={handleAdd} disabled={adding || !name.trim()} className={`${BTN_PRIMARY} col-span-2 sm:col-span-1`}>
          {adding ? <Loader2 className="animate-spin" size={15} /> : <Plus size={15} />} Add room
        </button>
      </div>
    </Section>
  )
}
