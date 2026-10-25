'use client'

// ─────────────────────────────────────────────────────────────────────────────
// Holiday calendars — one panel per half of Attendance Rules.
//
// A calendar is a named list of holidays (single days or ranges such as a
// winter break) plus any weekly offs, for everyone or for chosen groups. It
// can be typed in, or uploaded from a CSV (a spreadsheet export) or an .ics
// file (Google Calendar, Outlook, government holiday lists), and downloaded
// back as a CSV.
//
// Staff calendars feed staff attendance and payroll the same way a hand-made
// holiday does; student calendars tell the class register which days are off.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useMemo, useRef, useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import {
  AlertTriangle, CalendarDays, CalendarRange, Check, Download, FileUp, Loader2, Pencil, Plus, Trash2, X,
} from 'lucide-react'
import ModalShell from '@/components/ui/ModalShell'
import { AX, EmptyLine, Field, Panel, Switch } from '@/components/admin/ui'
import {
  AttendanceAudience, AttendanceGroup, HolidayCalendar, HolidayCalendarEntry,
  HOLIDAY_CSV_TEMPLATE, deleteHolidayCalendar, entriesToCsv, entryDayCount, normalizeEntries,
  parseHolidayFile, saveHolidayCalendar, setHolidayCalendarActive,
} from '@/lib/attendanceCalendars'

const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function formatDay(iso: string, withYear = true): string {
  return new Date(iso + 'T12:00:00').toLocaleDateString('en-IN', {
    day: 'numeric', month: 'short', ...(withYear ? { year: 'numeric' } : {}),
  })
}

function formatEntryDates(e: HolidayCalendarEntry): string {
  if (e.start_date === e.end_date) return formatDay(e.start_date)
  const sameYear = e.start_date.slice(0, 4) === e.end_date.slice(0, 4)
  return `${formatDay(e.start_date, !sameYear)} – ${formatDay(e.end_date)}`
}

function downloadText(fileName: string, text: string, type = 'text/csv') {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const a = document.createElement('a')
  a.href = url; a.download = fileName
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function slug(s: string): string {
  return s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'holidays'
}

interface Props {
  audience: AttendanceAudience
  calendars: HolidayCalendar[]
  groups: AttendanceGroup[]
  viewerId: string
  onChanged: () => void
}

export default function HolidayCalendarsPanel({ audience, calendars, groups, viewerId, onChanged }: Props) {
  const [editing, setEditing] = useState<HolidayCalendar | 'new' | null>(null)
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const groupName = useMemo(() => new Map(groups.map(g => [g.id, g.name])), [groups])
  const today = new Date().toISOString().slice(0, 10)
  const isStaff = audience === 'staff'

  async function handleToggle(c: HolidayCalendar) {
    setBusyId(c.id)
    const ok = await setHolidayCalendarActive(audience, c.id, !c.is_active, viewerId)
    setBusyId(null)
    if (ok) onChanged()
  }

  async function handleDelete(c: HolidayCalendar) {
    setBusyId(c.id)
    const ok = await deleteHolidayCalendar(audience, c.id)
    setBusyId(null); setConfirmingId(null)
    if (ok) onChanged()
  }

  function coverage(c: HolidayCalendar): string {
    if (c.group_ids.length === 0) return isStaff ? 'All staff' : 'All classes'
    const names = c.group_ids.map(id => groupName.get(id)).filter(Boolean)
    return names.length ? names.join(', ') : 'No groups (covers nobody)'
  }

  return (
    <Panel
      icon={CalendarDays}
      title="Holiday calendars"
      className="h-full"
      description={isStaff
        ? 'Whole-year holiday lists for all staff or chosen groups. They count as paid holidays, exactly like the ones added by hand.'
        : 'Whole-year holiday lists for all classes or chosen groups. The class register shows the holiday on those days.'}
    >
      {calendars.length === 0 ? (
        <EmptyLine icon={CalendarDays} fill>No calendars yet. Create one, or upload a CSV or .ics file.</EmptyLine>
      ) : (
        <ul className="flex-1 space-y-1.5 max-h-96 overflow-y-auto overscroll-contain pr-0.5">
          {calendars.map(c => {
            const days = c.entries.reduce((n, e) => n + entryDayCount(e), 0)
            const next = c.entries.find(e => e.end_date >= today)
            const busy = busyId === c.id
            return (
              <li key={c.id} className={`${AX.row} !items-start flex-wrap ${c.is_active ? '' : 'opacity-60'}`}>
                <span className="mt-0.5 text-[#B8983C] flex-shrink-0"><CalendarRange size={14} /></span>
                {/* On a phone the actions drop under the text rather than squeezing it. */}
                <div className="flex-1 min-w-[12rem]">
                  <p className="text-[13.5px] font-semibold text-[#18181B] truncate">{c.name}</p>
                  <p className="text-[12px] text-[#71717A] leading-snug break-words">
                    {c.entries.length} {c.entries.length === 1 ? 'holiday' : 'holidays'} ({days} {days === 1 ? 'day' : 'days'})
                    {c.weekly_offs.length > 0 && <> · every {c.weekly_offs.map(d => WEEKDAY_SHORT[d]).join(', ')} off</>}
                    {' · '}{coverage(c)}
                  </p>
                  {next && c.is_active && (
                    <p className="text-[11.5px] text-[#8A6F22] mt-0.5 truncate">Next: {next.name} · {formatEntryDates(next)}</p>
                  )}
                </div>
                {confirmingId === c.id ? (
                  <div className="ml-auto flex items-center gap-1 -my-1 -mr-1.5">
                    <button onClick={() => handleDelete(c)} disabled={busy} className={`${AX.ghost} !h-8`}>
                      {busy ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />} Delete
                    </button>
                    <button onClick={() => setConfirmingId(null)} aria-label="Keep calendar" className={AX.icon}><X size={14} /></button>
                  </div>
                ) : (
                  <div className="ml-auto flex items-center gap-0.5 -my-1 -mr-1.5">
                    <span className="mr-1 mt-1">
                      <Switch on={c.is_active} disabled={busy} label={`${c.is_active ? 'Turn off' : 'Turn on'} ${c.name}`} onChange={() => handleToggle(c)} />
                    </span>
                    <button onClick={() => downloadText(`${slug(c.name)}.csv`, entriesToCsv(c.entries))} aria-label={`Download ${c.name}`} className={AX.icon}>
                      <Download size={13} />
                    </button>
                    <button onClick={() => setEditing(c)} aria-label={`Edit ${c.name}`} className={AX.icon}><Pencil size={13} /></button>
                    <button onClick={() => setConfirmingId(c.id)} aria-label={`Delete ${c.name}`} className={AX.iconDanger}><Trash2 size={14} /></button>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
      <button
        onClick={() => setEditing('new')}
        className="mt-2 w-full inline-flex items-center justify-center gap-1.5 h-9 rounded-lg text-[13px] font-semibold text-[#27272A] hover:bg-[#F5F5F5] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B8983C]/60"
      >
        <Plus size={14} /> Create or upload calendar
      </button>

      <AnimatePresence>
        {editing && (
          <CalendarModal
            key="calendar-modal"
            audience={audience}
            calendar={editing === 'new' ? null : editing}
            groups={groups}
            viewerId={viewerId}
            onClose={() => setEditing(null)}
            onSaved={() => { setEditing(null); onChanged() }}
          />
        )}
      </AnimatePresence>
    </Panel>
  )
}

function CalendarModal({ audience, calendar, groups, viewerId, onClose, onSaved }: {
  audience: AttendanceAudience
  calendar: HolidayCalendar | null
  groups: AttendanceGroup[]
  viewerId: string
  onClose: () => void
  onSaved: () => void
}) {
  const isStaff = audience === 'staff'
  const [name, setName] = useState(calendar?.name ?? '')
  const [description, setDescription] = useState(calendar?.description ?? '')
  const [isActive, setIsActive] = useState(calendar?.is_active ?? true)
  const [weeklyOffs, setWeeklyOffs] = useState<number[]>(calendar?.weekly_offs ?? [])
  const [mode, setMode] = useState<'everyone' | 'groups'>(calendar && calendar.group_ids.length > 0 ? 'groups' : 'everyone')
  const [groupIds, setGroupIds] = useState<string[]>(calendar?.group_ids ?? [])
  const [entries, setEntries] = useState<HolidayCalendarEntry[]>(calendar?.entries ?? [])

  const [newStart, setNewStart] = useState('')
  const [newEnd, setNewEnd] = useState('')
  const [newName, setNewName] = useState('')

  const [upload, setUpload] = useState<{ file: string; added: number; errors: string[] } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const totalDays = entries.reduce((n, e) => n + entryDayCount(e), 0)

  function addEntry() {
    setError(null)
    if (!newStart) { setError('Pick the date of the holiday.'); return }
    if (!newName.trim()) { setError('Give the holiday a name.'); return }
    if (newEnd && newEnd < newStart) { setError('The end date is before the start date.'); return }
    setEntries(prev => normalizeEntries([...prev, { name: newName, start_date: newStart, end_date: newEnd || newStart }]))
    setNewStart(''); setNewEnd(''); setNewName('')
  }

  async function handleFile(file: File) {
    setError(null)
    const text = await file.text()
    const parsed = parseHolidayFile(file.name, text)
    const before = entries.length
    const merged = normalizeEntries([...entries, ...parsed.entries])
    setEntries(merged)
    setUpload({ file: file.name, added: merged.length - before, errors: parsed.errors })
    // A calendar created straight from a file takes the file's name.
    if (!name.trim()) setName(file.name.replace(/\.(csv|ics|txt)$/i, '').replace(/[_-]+/g, ' ').trim())
  }

  async function handleSave() {
    setError(null)
    if (!name.trim()) { setError('Give the calendar a name.'); return }
    if (mode === 'groups' && groupIds.length === 0) { setError('Pick at least one group, or choose everyone.'); return }
    if (entries.length === 0 && weeklyOffs.length === 0) { setError('Add at least one holiday or weekly off.'); return }
    setSaving(true)
    const id = await saveHolidayCalendar(audience, {
      id: calendar?.id, name, description, is_active: isActive, weekly_offs: weeklyOffs,
      group_ids: mode === 'groups' ? groupIds : [], entries,
    }, viewerId)
    setSaving(false)
    if (!id) { setError('Could not save the calendar. Please try again.'); return }
    onSaved()
  }

  const chip = (on: boolean) => `px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${on ? 'bg-[#27272A] text-white' : 'bg-[#F5F5F5] text-[#52525B] hover:bg-[#EBEBEB]'}`

  return (
    <ModalShell
      onClose={onClose}
      sharp size="xl"
      title={calendar ? 'Edit holiday calendar' : `New ${isStaff ? 'staff' : 'student'} holiday calendar`}
      subtitle="Type holidays in, or upload a CSV or .ics file"
      icon={<CalendarDays size={15} />}
      iconClassName="bg-[#27272A] text-[#B8983C]"
      minHClass="sm:min-h-[36rem]"
      footer={
        <div className="flex items-center gap-2">
          {error
            ? <p className="flex-1 text-[12.5px] text-[#B42318]">{error}</p>
            : <span className="flex-1 text-[12px] text-[#71717A] tabular-nums">{entries.length} holidays · {totalDays} days</span>}
          <button onClick={onClose} className={AX.ghost}>Cancel</button>
          <button onClick={handleSave} disabled={saving} className={AX.primary}>
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Save calendar
          </button>
        </div>
      }
    >
      <div className="space-y-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Name">
            <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Academic year 2026–27" className={AX.field} />
          </Field>
          <Field label="Note (optional)">
            <input value={description} onChange={e => setDescription(e.target.value)} placeholder="e.g. As circulated in April" className={AX.field} />
          </Field>
        </div>

        {/* Who it covers */}
        <div>
          <p className={AX.label}>Applies to</p>
          <div className="flex flex-wrap gap-1.5">
            <button type="button" onClick={() => setMode('everyone')} className={chip(mode === 'everyone')}>
              {isStaff ? 'All staff' : 'All classes'}
            </button>
            <button type="button" onClick={() => setMode('groups')} className={chip(mode === 'groups')} disabled={groups.length === 0}>
              Chosen groups
            </button>
          </div>
          {groups.length === 0 && (
            <p className={`${AX.hint} mt-1.5`}>Add {isStaff ? 'staff' : 'student'} groups to give a calendar to only part of the school.</p>
          )}
          {mode === 'groups' && groups.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {groups.map(g => {
                const on = groupIds.includes(g.id)
                return (
                  <button
                    key={g.id} type="button"
                    onClick={() => setGroupIds(prev => on ? prev.filter(x => x !== g.id) : [...prev, g.id])}
                    className={`${chip(on)} inline-flex items-center gap-1`}
                  >
                    {on && <Check size={11} />} {g.name}
                    <span className={`font-normal ${on ? 'text-zinc-400' : 'text-[#A1A1AA]'}`}>· {g.member_ids.length}</span>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* Weekly offs */}
        <div>
          <p className={AX.label}>Weekly offs</p>
          <div className="flex flex-wrap gap-1.5">
            {WEEKDAY_SHORT.map((d, i) => {
              const on = weeklyOffs.includes(i)
              return (
                <button key={d} type="button" onClick={() => setWeeklyOffs(prev => on ? prev.filter(x => x !== i) : [...prev, i])} className={chip(on)}>
                  {d}
                </button>
              )
            })}
          </div>
          <p className={`${AX.hint} mt-1.5`}>Days off every week under this calendar. Leave empty if they are set elsewhere.</p>
        </div>

        {/* Upload */}
        <div className="rounded-lg border border-dashed border-[#D4D4D8] bg-white p-3.5">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-semibold text-[#18181B]">Upload a holiday list</p>
              <p className={AX.hint}>
                A CSV with a date (or start and end date) and a name on each row, or an .ics calendar file. Uploaded holidays are added to the list below.
              </p>
            </div>
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <button type="button" onClick={() => downloadText('holiday-calendar-template.csv', HOLIDAY_CSV_TEMPLATE)} className={AX.ghost}>
                <Download size={13} /> Template
              </button>
              <button type="button" onClick={() => fileRef.current?.click()} className={AX.ghost}>
                <FileUp size={13} /> Upload file
              </button>
              <input
                ref={fileRef} type="file" accept=".csv,.ics,.txt,text/csv,text/calendar" className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = '' }}
              />
            </div>
          </div>
          {upload && (
            <div className="mt-3 text-[12.5px]">
              <p className="text-[#1F6B42] font-medium">
                {upload.file}: {upload.added} {upload.added === 1 ? 'holiday' : 'holidays'} added
                {upload.errors.length > 0 && <span className="text-[#8A6F22]"> · {upload.errors.length} skipped</span>}
              </p>
              {upload.errors.length > 0 && (
                <ul className="mt-1.5 space-y-0.5 max-h-24 overflow-y-auto">
                  {upload.errors.slice(0, 20).map((e, i) => (
                    <li key={i} className="flex items-start gap-1.5 text-[#71717A]"><AlertTriangle size={12} className="mt-0.5 text-[#B8983C] flex-shrink-0" /> {e}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        {/* Add one */}
        <div>
          <p className={AX.label}>Holidays</p>
          <div className="grid grid-cols-2 sm:grid-cols-[9.5rem_9.5rem_1fr_auto] gap-2">
            <input type="date" value={newStart} onChange={e => setNewStart(e.target.value)} aria-label="Holiday date" className={AX.field} />
            <input type="date" value={newEnd} min={newStart || undefined} onChange={e => setNewEnd(e.target.value)} aria-label="Ends on (optional)" title="Ends on (optional, for a break of several days)" className={AX.field} />
            <input
              value={newName} onChange={e => setNewName(e.target.value)} placeholder="Holiday name"
              onKeyDown={e => { if (e.key === 'Enter') addEntry() }}
              className={`${AX.field} col-span-2 sm:col-span-1`}
            />
            <button type="button" onClick={addEntry} className={`${AX.primary} col-span-2 sm:col-span-1 !h-[38px]`}><Plus size={14} /> Add</button>
          </div>
          <p className={`${AX.hint} mt-1`}>Second date is optional — set it for a break of several days.</p>

          <div className="mt-3">
            {entries.length === 0 ? (
              <EmptyLine icon={CalendarDays}>No holidays in this calendar yet.</EmptyLine>
            ) : (
              <ul className="space-y-1 max-h-72 overflow-y-auto overscroll-contain pr-0.5">
                {entries.map((e, i) => {
                  const days = entryDayCount(e)
                  return (
                    <li key={`${e.start_date}-${e.end_date}-${e.name}`} className={`${AX.row} !py-2`}>
                      <span className="w-40 flex-shrink-0 text-[12.5px] font-semibold text-[#18181B] tabular-nums">{formatEntryDates(e)}</span>
                      <span className="flex-1 min-w-0 text-[13px] text-[#3F3F46] truncate">{e.name}</span>
                      {days > 1 && <span className="text-[11px] text-[#71717A] tabular-nums flex-shrink-0">{days} days</span>}
                      <button
                        onClick={() => setEntries(prev => prev.filter((_, j) => j !== i))}
                        aria-label={`Remove ${e.name}`} className={`${AX.iconDanger} -my-1 -mr-1.5`}
                      >
                        <Trash2 size={13} />
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 pt-1">
          <div>
            <p className="text-[13px] font-semibold text-[#18181B]">In use</p>
            <p className={AX.hint}>Switch off to keep the calendar without applying it.</p>
          </div>
          <Switch on={isActive} label="Calendar in use" onChange={() => setIsActive(v => !v)} />
        </div>
      </div>
    </ModalShell>
  )
}
