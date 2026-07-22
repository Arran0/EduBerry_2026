'use client'

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { Loader2, Search, Plus, Trash2, DoorOpen } from 'lucide-react'
import {
  fetchSubjects, createSubject, deleteSubject,
  fetchRooms, createRoom, deleteRoom, ROOM_TYPE_LABELS,
} from '@/lib/timetable'
import type { Subject, Room, RoomType, TimetableConfig, Weekday } from '@/lib/timetable'
import { fetchAllHomerooms } from '@/lib/homerooms'
import type { Homeroom } from '@/lib/homerooms'
import { searchSubjects } from '@/lib/cbseSubjects'
import { INPUT, BTN_PRIMARY, SmartSelect, Section, Field } from '../../ui'
import type { SmartOption } from '../../ui'
import { TimeOffGrid, ValueInput, valueOf } from '../constraintAtoms'
import { useConstraints } from '../useConstraints'

const ROOM_TYPES: RoomType[] = ['classroom', 'science_lab', 'computer_lab', 'other']
const SUBJECT_COLORS = ['#27272A', '#0891b2', '#059669', '#B8983C', '#db2777', '#7c3aed', '#dc2626', '#0d9488']

/**
 * The Subjects hub — a searchable list of subjects (with the CBSE name
 * typeahead for adding) and, per subject, its time-off and min/max per day &
 * week limits (all homerooms or a specific one). A Rooms panel lives alongside.
 */
export default function SubjectModal({ config }: { config: TimetableConfig | null }) {
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
      await load()
      setSelectedId(created.id)
    }
  }

  if (loading) {
    return <div className="flex justify-center py-16 text-[#A1A1AA]"><Loader2 className="animate-spin" size={22} /></div>
  }

  return (
    <div className="grid gap-0 sm:grid-cols-[17rem_1fr] sm:min-h-[26rem] border border-[#E4E4E7]">
      {/* Column 1 — subjects + add */}
      <div className="border-b sm:border-b-0 sm:border-r border-[#E4E4E7] bg-[#FAFAF9] flex flex-col">
        <div className="p-2.5 border-b border-[#E4E4E7] space-y-2">
          <div className="flex items-center gap-2 border border-[#D4D4D8] bg-white px-2.5 py-1.5">
            <Search size={13} className="text-[#A1A1AA] flex-shrink-0" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search subjects…" className="flex-1 min-w-0 bg-transparent text-sm focus:outline-none" />
          </div>
          <button
            onClick={() => setShowRooms((v) => !v)}
            className={`w-full inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 text-xs font-medium border transition-colors ${showRooms ? 'bg-[#27272A] text-white border-[#27272A]' : 'bg-white text-[#52525B] border-[#D4D4D8] hover:bg-[#F5F5F5]'}`}
          >
            <DoorOpen size={13} /> {showRooms ? 'Back to subjects' : 'Manage rooms'}
          </button>
        </div>

        <div className="flex-1 overflow-y-auto max-h-56 sm:max-h-none p-1.5 space-y-px">
          {filtered.length === 0 ? (
            <p className="text-xs text-[#A1A1AA] p-2">No subjects yet.</p>
          ) : filtered.map((s) => (
            <button
              key={s.id}
              onClick={() => { setSelectedId(s.id); setShowRooms(false) }}
              className={`w-full flex items-center gap-2 text-left px-2.5 py-2 text-sm transition-colors ${s.id === selectedId && !showRooms ? 'bg-[#27272A] text-white' : 'text-[#3F3F46] hover:bg-[#EBEBEB]'}`}
            >
              <span className="w-2.5 h-2.5 flex-shrink-0" style={{ background: s.color || '#94a3b8' }} />
              <span className="flex-1 min-w-0 truncate font-medium">{s.name}</span>
              {s.code && <span className={`text-[10px] font-mono ${s.id === selectedId && !showRooms ? 'text-white/60' : 'text-[#A1A1AA]'}`}>{s.code}</span>}
            </button>
          ))}
        </div>

        {/* Add subject */}
        <div className="p-2.5 border-t border-[#E4E4E7] bg-white space-y-2">
          <div className="relative">
            <input
              ref={inputRef}
              className={`${INPUT} w-full`}
              placeholder="Add subject…"
              value={name}
              onChange={(e) => handleNameChange(e.target.value)}
              onFocus={() => name && suggestions.length > 0 && setShowSuggestions(true)}
              onBlur={() => setTimeout(() => setShowSuggestions(false), 120)}
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
          <div className="flex gap-2">
            <input className={`${INPUT} w-20`} placeholder="Code" value={code} onChange={(e) => setCode(e.target.value)} />
            <div className="flex gap-1 flex-wrap flex-1 items-center">
              {SUBJECT_COLORS.map((c) => (
                <button key={c} onClick={() => setColor(c)} className={`w-5 h-5 ${color === c ? 'ring-2 ring-offset-1 ring-[#27272A]' : ''}`} style={{ background: c }} />
              ))}
            </div>
          </div>
          <button onClick={handleAdd} disabled={adding || !name.trim()} className={`${BTN_PRIMARY} w-full`}>
            {adding ? <Loader2 className="animate-spin" size={15} /> : <Plus size={15} />} Add subject
          </button>
        </div>
      </div>

      {/* Column 2 — detail */}
      <div className="min-w-0 flex flex-col">
        {showRooms ? (
          <div className="flex-1 overflow-y-auto p-4"><RoomsPanel /></div>
        ) : !selected ? (
          <div className="flex-1 flex items-center justify-center text-sm text-[#A1A1AA] p-6">Select a subject.</div>
        ) : (
          <div className="flex-1 overflow-y-auto p-4">
            <div className="flex items-center gap-2 mb-3">
              <span className="w-3.5 h-3.5 flex-shrink-0" style={{ background: selected.color || '#94a3b8' }} />
              <span className="font-semibold text-[#18181B]">{selected.name}</span>
              {selected.code && <span className="text-[11px] font-mono text-[#A1A1AA]">{selected.code}</span>}
              <button
                onClick={async () => { if (confirm(`Delete subject "${selected.name}"?`)) { await deleteSubject(selected.id); setSelectedId(''); load() } }}
                className="ml-auto text-[#D4D4D8] hover:text-rose-500 transition-colors"
              ><Trash2 size={15} /></button>
            </div>
            {config
              ? <SubjectConstraintsPanel config={config} subject={selected} homerooms={homerooms} />
              : <p className="text-sm text-[#71717A] py-4">Select or create a timetable configuration to set this subject's limits.</p>}
          </div>
        )}
      </div>
    </div>
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
  const [homeroomTarget, setHomeroomTarget] = useState('')
  const scopeId = subject.id
  const hrTarget = homeroomTarget || null

  const homeroomOptions: SmartOption[] = useMemo(
    () => [{ value: '', label: 'All homerooms' }, ...homerooms.map((h) => ({ value: h.id, label: h.name }))],
    [homerooms],
  )

  const isOff = (day: Weekday, slotId: string) =>
    constraints.some((c) => c.type === 'time_off' && c.scope === 'subject' && c.scope_id === scopeId && c.day === day && c.slot_id === slotId)

  if (loading) return <div className="flex justify-center py-8 text-[#A1A1AA]"><Loader2 className="animate-spin" size={20} /></div>
  if (slots.length === 0) return <p className="text-sm text-[#71717A] py-4">Add teaching period slots first (Configuration).</p>

  return (
    <div>
      <Section title="Time off" hint="Tap a period this subject must never be taught in." first>
        <TimeOffGrid days={config.working_days} slots={slots} isOn={isOff} onToggle={(d, s) => toggleSlot('subject', scopeId, 'time_off', d, s)} />
      </Section>

      <Section title="Per day / per week limits" hint="Leave blank for no limit. Applies to all homerooms, or restrict to a specific one.">
        <div className="mb-3 max-w-xs">
          <Field label="Applies to homeroom">
            <SmartSelect options={homeroomOptions} value={homeroomTarget} onChange={setHomeroomTarget} placeholder="All homerooms" searchPlaceholder="Search classes…" />
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Min / day"><ValueInput seed={valueOf(constraints, 'subject', scopeId, hrTarget, 'min_per_day')} onCommit={(v) => commitValue('subject', scopeId, hrTarget, 'min_per_day', v)} /></Field>
          <Field label="Max / day"><ValueInput seed={valueOf(constraints, 'subject', scopeId, hrTarget, 'max_per_day')} onCommit={(v) => commitValue('subject', scopeId, hrTarget, 'max_per_day', v)} /></Field>
          <Field label="Min / week"><ValueInput seed={valueOf(constraints, 'subject', scopeId, hrTarget, 'min_per_week')} onCommit={(v) => commitValue('subject', scopeId, hrTarget, 'min_per_week', v)} /></Field>
          <Field label="Max / week"><ValueInput seed={valueOf(constraints, 'subject', scopeId, hrTarget, 'max_per_week')} onCommit={(v) => commitValue('subject', scopeId, hrTarget, 'max_per_week', v)} /></Field>
        </div>
      </Section>
    </div>
  )
}

// ── Rooms ─────────────────────────────────────────────────────

function RoomsPanel() {
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
    if (created) { setName(''); setCapacity(''); load() }
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
              <button onClick={async () => { if (confirm(`Delete room "${r.name}"?`)) { await deleteRoom(r.id); load() } }} className="text-[#D4D4D8] hover:text-rose-500 transition-colors flex-shrink-0"><Trash2 size={15} /></button>
            </div>
          ))}
          {rooms.length === 0 && <p className="text-xs text-[#A1A1AA] py-2">No rooms yet.</p>}
        </div>
      )}
      <div className="mt-4 grid grid-cols-[1fr_auto_auto_auto] gap-2 items-end">
        <input className={`${INPUT} w-full`} placeholder="Room name" value={name} onChange={(e) => setName(e.target.value)} />
        <select className={`${INPUT} w-36`} value={roomType} onChange={(e) => setRoomType(e.target.value as RoomType)}>
          {ROOM_TYPES.map((t) => <option key={t} value={t}>{ROOM_TYPE_LABELS[t]}</option>)}
        </select>
        <input className={`${INPUT} w-20`} placeholder="Seats" type="number" value={capacity} onChange={(e) => setCapacity(e.target.value)} />
        <button onClick={handleAdd} disabled={adding || !name.trim()} className={BTN_PRIMARY}>
          {adding ? <Loader2 className="animate-spin" size={15} /> : <Plus size={15} />} Add
        </button>
      </div>
    </Section>
  )
}
