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
import { INPUT, INPUT_SIZED as FIELD, BTN_PRIMARY, SmartSelect, Section, Field } from '../../ui'
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
import { BTN_SM, TAP, FOCUS } from '../../ui'

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
  const [subjects, setSubjects] = useState<Subject[]>([])
  const [homerooms, setHomerooms] = useState<Homeroom[]>([])
  const [loading, setLoading] = useState(true)
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
    setLoading(true)
    const [subs, hr] = await Promise.all([fetchSubjects(), fetchAllHomerooms()])
    setSubjects(subs)
    setHomerooms(hr)
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

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
      await Promise.all([load(), draft?.refreshReference() ?? Promise.resolve()])
      setSelectedId(created.id)
    }
  }

  if (loading) {
    return <div className="flex justify-center py-16 text-[#A1A1AA]"><Loader2 className="animate-spin" size={22} /></div>
  }

  const addSubjectForm = (
        /* The CBSE name typeahead, a thumb-friendly colour strip (no hidden
           popover — every swatch is visible and directly tappable), then code
           + submit. */
        <div className="p-2 border-t border-[#E4E4E7] bg-white space-y-2">
          <div className="relative">
            <input
              ref={inputRef}
              className={`${FIELD} w-full`}
              placeholder="Add subject…"
              value={name}
              onChange={(e) => handleNameChange(e.target.value)}
              onFocus={() => name && suggestions.length > 0 && setShowSuggestions(true)}
              onBlur={() => setTimeout(() => setShowSuggestions(false), 120)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleAdd() }}
              autoComplete="off"
            />
            {showSuggestions && (
              <div className="absolute z-20 bottom-full left-0 right-0 mb-0.5 bg-white border border-[#E4E4E7] shadow-md max-h-44 overflow-y-auto">
                {suggestions.map((sug) => (
                  <button key={sug} type="button" onMouseDown={() => { setName(sug); setShowSuggestions(false); inputRef.current?.focus() }} className="w-full text-left px-3 py-2 text-sm text-[#18181B] hover:bg-[#F5F5F5]">{sug}</button>
                ))}
              </div>
            )}
          </div>

          <ColorPicker colors={SUBJECT_COLORS} value={color} onChange={setColor} ariaLabel="Subject colour" />

          <div className="flex items-stretch gap-1.5">
            <input
              className={`${FIELD} w-20 flex-none`}
              placeholder="Code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleAdd() }}
            />
            <button onClick={handleAdd} disabled={adding || !name.trim()} className={`${BTN_PRIMARY} flex-1 min-w-0`}>
              {adding ? <Loader2 className="animate-spin" size={15} /> : <Plus size={15} />}
              Add subject
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
                className={`w-full ${BTN_SM} border ${
                  showRooms
                    ? 'bg-[#27272A] text-white border-[#27272A]'
                    : 'bg-white text-[#52525B] border-[#D4D4D8] hover:bg-[#F5F5F5]'
                }`}
              >
                <DoorOpen size={13} /> {showRooms ? 'Back to subjects' : 'Manage rooms'}
              </button>
            }
          >
            {filtered.length === 0 ? (
              <p className="text-xs text-[#A1A1AA] p-2">No subjects yet.</p>
            ) : filtered.map((s) => (
              <EntityRow
                key={s.id}
                selected={s.id === selectedId && !showRooms}
                onClick={() => { setSelectedId(s.id); setShowRooms(false) }}
                title={s.name}
                swatch={s.color}
                trailing={s.code
                  ? <span className={`text-[10px] font-mono ${s.id === selectedId && !showRooms ? 'text-white/60' : 'text-[#A1A1AA]'}`}>{s.code}</span>
                  : undefined}
              />
            ))}
          </EntityList>
          {addSubjectForm}
        </div>
      }
    >
      {showRooms ? (
        <div className="flex-1 overflow-y-auto p-3 sm:p-4"><RoomsPanel /></div>
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
                  if (!confirm(`Delete subject "${selected.name}"?`)) return
                  await deleteSubject(selected.id)
                  setSelectedId('')
                  await Promise.all([load(), draft?.refreshReference() ?? Promise.resolve()])
                }}
                aria-label={`Delete ${selected.name}`}
                className={`text-[#D4D4D8] hover:text-rose-500 ${TAP} ${FOCUS}`}
              ><Trash2 size={15} /></button>
            }
          >
            <span className="inline-flex items-center gap-2">
              <span className="w-3 h-3 flex-shrink-0" style={{ background: selected.color || '#94a3b8' }} aria-hidden />
              {selected.name}
            </span>
          </DetailHeader>
          <div className="flex-1 overflow-y-auto p-3 sm:p-4">
            {config
              ? <SubjectConstraintsPanel config={config} subject={selected} homerooms={homerooms} />
              : <p className="text-sm text-[#71717A] py-4">Select or create a timetable configuration to set this subject&rsquo;s limits.</p>}
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
    () => [{ value: '', label: 'All homerooms' }, ...homerooms.map((h) => ({ value: h.id, label: h.name }))],
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

  if (loading) return <div className="flex justify-center py-8 text-[#A1A1AA]"><Loader2 className="animate-spin" size={20} /></div>
  if (slots.length === 0) return <p className="text-sm text-[#71717A] py-4">Add teaching period slots first (Configuration).</p>

  return (
    <div>
      <Section
        title="Time off"
        hint="Tap a free period this subject must never be taught in. The draft is drawn in — click a lesson to open it."
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

      <Section title="Per day / per week limits" hint="Leave blank for no limit. Applies to all homerooms, or restrict to a specific one.">
        <div className="mb-3 max-w-xs">
          <Field label="Applies to homeroom">
            <SmartSelect options={homeroomOptions} value={homeroomTarget} onChange={setHomeroomTarget} placeholder="All homerooms" searchPlaceholder="Search classes…" />
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
  const [rooms, setRooms] = useState<Room[]>([])
  const [loading, setLoading] = useState(true)
  const [name, setName] = useState('')
  const [roomType, setRoomType] = useState<RoomType>('classroom')
  const [capacity, setCapacity] = useState('')
  const [adding, setAdding] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setRooms(await fetchRooms())
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  const handleAdd = async () => {
    if (!name.trim()) return
    setAdding(true)
    const created = await createRoom({ name: name.trim(), room_type: roomType, capacity: capacity ? parseInt(capacity, 10) : null })
    setAdding(false)
    if (created) {
      setName(''); setCapacity('')
      await Promise.all([load(), draft?.refreshReference() ?? Promise.resolve()])
    }
  }

  return (
    <Section title="Rooms" hint="Rooms available to the scheduler. A requirement's room type is matched against these." first>
      {loading ? (
        <div className="flex justify-center py-6 text-[#A1A1AA]"><Loader2 className="animate-spin" size={18} /></div>
      ) : (
        <div className="space-y-px">
          {rooms.map((r) => (
            <div key={r.id} className="flex items-center gap-3 px-3 py-2 bg-[#F5F5F5] border border-[#E4E4E7]">
              <span className="text-sm font-medium text-[#18181B] flex-1 truncate">{r.name}</span>
              <span className="text-[11px] px-2 py-0.5 bg-white border border-[#E4E4E7] text-[#71717A]">{ROOM_TYPE_LABELS[r.room_type]}</span>
              {r.capacity != null && <span className="text-[11px] text-[#A1A1AA]">{r.capacity} seats</span>}
              <button onClick={async () => { if (confirm(`Delete room "${r.name}"?`)) { await deleteRoom(r.id); await Promise.all([load(), draft?.refreshReference() ?? Promise.resolve()]) } }} className="text-[#D4D4D8] hover:text-rose-500 transition-colors flex-shrink-0"><Trash2 size={15} /></button>
            </div>
          ))}
          {rooms.length === 0 && <p className="text-xs text-[#A1A1AA] py-2">No rooms yet.</p>}
        </div>
      )}
      <div className="mt-4 grid grid-cols-[1fr_auto_auto_auto] gap-2 items-end">
        <input className={`${INPUT} w-full`} placeholder="Room name" value={name} onChange={(e) => setName(e.target.value)} />
        <select className={`${FIELD} w-36`} value={roomType} onChange={(e) => setRoomType(e.target.value as RoomType)}>
          {ROOM_TYPES.map((t) => <option key={t} value={t}>{ROOM_TYPE_LABELS[t]}</option>)}
        </select>
        <input className={`${FIELD} w-20`} placeholder="Seats" type="number" value={capacity} onChange={(e) => setCapacity(e.target.value)} />
        <button onClick={handleAdd} disabled={adding || !name.trim()} className={BTN_PRIMARY}>
          {adding ? <Loader2 className="animate-spin" size={15} /> : <Plus size={15} />} Add
        </button>
      </div>
    </Section>
  )
}
