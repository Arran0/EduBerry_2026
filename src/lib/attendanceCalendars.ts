import { supabase } from './supabase'
import { recomputePendingAttendance } from './attendance'

// ─────────────────────────────────────────────────────────────────────────────
// Attendance groups and holiday calendars — see
// add_attendance_groups_and_holiday_calendars.sql.
//
//   Groups      — a named slice of the staff (people) or of the students
//                 (homerooms), so different parts of the school can keep
//                 different calendars.
//   Calendars   — named lists of holidays (single days or ranges) plus weekly
//                 offs, for everyone in an audience or for chosen groups.
//                 Typed in, or uploaded as a CSV or an .ics file.
//
// A staff calendar is written into attendance_holidays (stamped with
// calendar_id), so check-in scoring, reports and payroll — which already read
// that table — honour it without knowing calendars exist. Its rows are a
// copy, rebuilt whole by syncStaffCalendar whenever the calendar or one of
// its groups changes. Student calendars are read straight from the calendar
// tables by the attendance sheet.
// ─────────────────────────────────────────────────────────────────────────────

export type AttendanceAudience = 'staff' | 'student'

export interface AttendanceGroup {
  id: string
  audience: AttendanceAudience
  name: string
  description: string | null
  /** Staff profile ids for a staff group, homeroom ids for a student group. */
  member_ids: string[]
}

export interface AttendanceGroupInput {
  id?: string
  name: string
  description?: string | null
  member_ids: string[]
}

export interface HolidayCalendarEntry {
  name: string
  start_date: string
  /** Same as start_date for a single day. */
  end_date: string
}

export interface HolidayCalendar {
  id: string
  audience: AttendanceAudience
  name: string
  description: string | null
  weekly_offs: number[]
  is_active: boolean
  /** Empty = the calendar covers everyone in its audience. */
  group_ids: string[]
  entries: HolidayCalendarEntry[]
}

export interface HolidayCalendarInput {
  id?: string
  name: string
  description?: string | null
  weekly_offs: number[]
  is_active: boolean
  group_ids: string[]
  entries: HolidayCalendarEntry[]
}

// ============================================
// Dates — plain 'YYYY-MM-DD' strings, done in UTC so no time zone can shift a
// holiday onto the day before.
// ============================================

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

function isoFromParts(y: number, m: number, d: number): string | null {
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return null
  if (y < 1900 || y > 2200 || m < 1 || m > 12 || d < 1 || d > 31) return null
  const dt = new Date(Date.UTC(y, m - 1, d))
  // Rejects 31 April and friends rather than rolling them into the next month.
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

export function addDaysIso(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d + days))
  return dt.toISOString().slice(0, 10)
}

export function weekdayOfIso(date: string): number {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
}

/**
 * Reads the date formats a school's holiday list arrives in: 2026-08-15,
 * 15/08/2026, 15-08-2026, 15.08.2026 (day first — the Indian and British
 * order), 20260815, and written-out months: "15 Aug 2026", "August 15, 2026".
 * Returns null for anything else.
 */
export function parseFlexibleDate(raw: string): string | null {
  const s = raw.trim().replace(/^"|"$/g, '').trim()
  if (!s) return null

  if (ISO_DATE.test(s)) {
    const [y, m, d] = s.split('-').map(Number)
    return isoFromParts(y, m, d)
  }
  let m = s.match(/^(\d{4})[/.](\d{1,2})[/.](\d{1,2})$/)
  if (m) return isoFromParts(+m[1], +m[2], +m[3])
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/)
  if (m) {
    const y = m[3].length === 2 ? 2000 + +m[3] : +m[3]
    return isoFromParts(y, +m[2], +m[1])
  }
  m = s.match(/^(\d{4})(\d{2})(\d{2})$/)
  if (m) return isoFromParts(+m[1], +m[2], +m[3])

  // "15 Aug 2026", "15-Aug-2026", "15th August 2026", optionally led by a weekday.
  const cleaned = s.replace(/^(mon|tue|wed|thu|fri|sat|sun)[a-z]*,?\s+/i, '')
  m = cleaned.match(/^(\d{1,2})(?:st|nd|rd|th)?[\s-]+([a-z]+)\.?,?[\s-]+(\d{4})$/i)
  if (m) {
    const month = MONTHS[m[2].toLowerCase().slice(0, 3)]
    return month ? isoFromParts(+m[3], month, +m[1]) : null
  }
  // "Aug 15, 2026", "August 15th 2026".
  m = cleaned.match(/^([a-z]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/i)
  if (m) {
    const month = MONTHS[m[1].toLowerCase().slice(0, 3)]
    return month ? isoFromParts(+m[3], month, +m[2]) : null
  }
  return null
}

/** Every date an entry covers, start to end inclusive. */
export function expandEntryDates(entry: HolidayCalendarEntry): string[] {
  const out: string[] = []
  let d = entry.start_date
  // A year is the most a single entry may span — a guard against a typo'd end
  // year writing thousands of rows.
  for (let i = 0; d <= entry.end_date && i < 366; i++) {
    out.push(d)
    d = addDaysIso(d, 1)
  }
  return out
}

export function entryDayCount(entry: HolidayCalendarEntry): number {
  return expandEntryDates(entry).length
}

/** Sorted by start date, exact duplicates dropped, ends never before starts. */
export function normalizeEntries(entries: HolidayCalendarEntry[]): HolidayCalendarEntry[] {
  const seen = new Set<string>()
  const out: HolidayCalendarEntry[] = []
  for (const e of entries) {
    const name = e.name.trim()
    if (!name || !ISO_DATE.test(e.start_date)) continue
    const end = ISO_DATE.test(e.end_date) && e.end_date >= e.start_date ? e.end_date : e.start_date
    const key = `${e.start_date}|${end}|${name.toLowerCase()}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ name, start_date: e.start_date, end_date: end })
  }
  return out.sort((a, b) => a.start_date.localeCompare(b.start_date) || a.end_date.localeCompare(b.end_date))
}

// ============================================
// Upload — CSV and iCalendar (.ics)
// ============================================

export interface ParsedHolidayFile {
  entries: HolidayCalendarEntry[]
  /** One line per row that could not be read, for the admin to fix. */
  errors: string[]
}

/** Splits one CSV line, honouring double-quoted fields with commas and "" escapes. */
function splitCsvLine(line: string, delimiter: string): string[] {
  const out: string[] = []
  let cur = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++ }
      else if (ch === '"') quoted = false
      else cur += ch
    } else if (ch === '"') quoted = true
    else if (ch === delimiter) { out.push(cur.trim()); cur = '' }
    else cur += ch
  }
  out.push(cur.trim())
  return out
}

const HEADER_ALIASES = {
  start: ['date', 'start', 'start date', 'start_date', 'from', 'from date', 'begins'],
  end: ['end', 'end date', 'end_date', 'to', 'to date', 'till', 'until', 'ends'],
  name: ['name', 'holiday', 'holiday name', 'occasion', 'title', 'event', 'description', 'reason', 'summary'],
}

/**
 * A spreadsheet export of the holiday list. With a header row, the columns are
 * found by name (date / start date, end date, name / holiday / occasion, in
 * any order). Without one, each row is `date, name` or `start, end, name`.
 * Commas, semicolons and tabs all work as separators.
 */
export function parseHolidayCsv(text: string): ParsedHolidayFile {
  const lines = text.replace(/^﻿/, '').split(/\r\n|\n|\r/).filter(l => l.trim())
  if (lines.length === 0) return { entries: [], errors: ['The file is empty.'] }

  const first = lines[0]
  const delimiter = first.includes('\t') ? '\t' : (first.split(';').length > first.split(',').length ? ';' : ',')
  const rows = lines.map(l => splitCsvLine(l, delimiter))

  let startCol = -1, endCol = -1, nameCol = -1
  let body = rows
  const header = rows[0].map(h => h.toLowerCase().replace(/\s+/g, ' ').trim())
  const findCol = (aliases: string[]) => header.findIndex(h => aliases.includes(h))
  if (findCol(HEADER_ALIASES.start) >= 0 || findCol(HEADER_ALIASES.name) >= 0) {
    startCol = findCol(HEADER_ALIASES.start)
    endCol = findCol(HEADER_ALIASES.end)
    nameCol = findCol(HEADER_ALIASES.name)
    body = rows.slice(1)
    if (startCol < 0) return { entries: [], errors: ['No date column found. Name a column "Date" or "Start date".'] }
    if (nameCol < 0) return { entries: [], errors: ['No name column found. Name a column "Holiday" or "Name".'] }
  }

  const entries: HolidayCalendarEntry[] = []
  const errors: string[] = []
  body.forEach((cells, i) => {
    const lineNo = i + (body === rows ? 1 : 2)
    let start: string | null, end: string | null, name: string
    if (startCol >= 0) {
      start = parseFlexibleDate(cells[startCol] ?? '')
      end = endCol >= 0 && cells[endCol]?.trim() ? parseFlexibleDate(cells[endCol]) : start
      name = (cells[nameCol] ?? '').trim()
    } else if (cells.length >= 3 && parseFlexibleDate(cells[1]) !== null) {
      start = parseFlexibleDate(cells[0]); end = parseFlexibleDate(cells[1]); name = cells.slice(2).join(' ').trim()
    } else {
      start = parseFlexibleDate(cells[0] ?? ''); end = start; name = cells.slice(1).join(' ').trim()
    }
    if (!start) { errors.push(`Line ${lineNo}: "${cells[startCol >= 0 ? startCol : 0] ?? ''}" is not a date.`); return }
    if (!end) { errors.push(`Line ${lineNo}: the end date is not a date.`); return }
    if (end < start) { errors.push(`Line ${lineNo}: ends before it starts.`); return }
    if (!name) { errors.push(`Line ${lineNo}: no holiday name.`); return }
    entries.push({ name, start_date: start, end_date: end })
  })
  return { entries: normalizeEntries(entries), errors }
}

function unescapeIcsText(s: string): string {
  return s.replace(/\\n/gi, ' ').replace(/\\([,;\\])/g, '$1').trim()
}

/** The date part of an iCalendar DTSTART / DTEND value (20261102 or 20261102T090000Z). */
function icsDate(value: string): string | null {
  const m = value.trim().match(/^(\d{4})(\d{2})(\d{2})/)
  return m ? isoFromParts(+m[1], +m[2], +m[3]) : null
}

/**
 * An iCalendar file — what Google Calendar, Outlook and most government
 * holiday lists export. Each VEVENT becomes one entry; an all-day event's
 * DTEND is the day *after* it ends (RFC 5545), so it is pulled back a day.
 */
export function parseHolidayIcs(text: string): ParsedHolidayFile {
  // Unfold continuation lines (a line starting with a space or tab).
  const lines = text.replace(/\r\n|\r/g, '\n').replace(/\n[ \t]/g, '').split('\n')
  const entries: HolidayCalendarEntry[] = []
  const errors: string[] = []
  let ev: { start?: string | null; end?: string | null; allDayEnd?: boolean; name?: string } | null = null
  let count = 0

  for (const line of lines) {
    if (/^BEGIN:VEVENT/i.test(line)) { ev = {}; count++; continue }
    if (/^END:VEVENT/i.test(line)) {
      if (ev) {
        const start = ev.start ?? null
        let end = ev.end ?? null
        if (start && end && ev.allDayEnd && end > start) end = addDaysIso(end, -1)
        if (!end || (start && end < start)) end = start
        if (!start) errors.push(`Event ${count}${ev.name ? ` (${ev.name})` : ''}: no start date.`)
        else if (!ev.name) errors.push(`Event ${count}: no title.`)
        else entries.push({ name: ev.name, start_date: start, end_date: end as string })
      }
      ev = null
      continue
    }
    if (!ev) continue
    const colon = line.indexOf(':')
    if (colon < 0) continue
    const key = line.slice(0, colon).toUpperCase()
    const value = line.slice(colon + 1)
    const prop = key.split(';')[0]
    if (prop === 'DTSTART') ev.start = icsDate(value)
    else if (prop === 'DTEND') {
      ev.end = icsDate(value)
      ev.allDayEnd = key.includes('VALUE=DATE') || /^\d{8}$/.test(value.trim())
    } else if (prop === 'SUMMARY') ev.name = unescapeIcsText(value)
  }
  if (count === 0) errors.push('No events found in this calendar file.')
  return { entries: normalizeEntries(entries), errors }
}

/** Picks the parser by file name, then by content. */
export function parseHolidayFile(fileName: string, text: string): ParsedHolidayFile {
  if (/\.ics$/i.test(fileName) || /BEGIN:VCALENDAR/i.test(text)) return parseHolidayIcs(text)
  return parseHolidayCsv(text)
}

function csvCell(s: string): string {
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** A calendar's holidays as a CSV the upload reads back unchanged. */
export function entriesToCsv(entries: HolidayCalendarEntry[]): string {
  const rows = normalizeEntries(entries).map(e => [e.start_date, e.end_date, csvCell(e.name)].join(','))
  return ['Start date,End date,Holiday', ...rows].join('\n') + '\n'
}

export const HOLIDAY_CSV_TEMPLATE = [
  'Start date,End date,Holiday',
  '2026-08-15,,Independence Day',
  '2026-10-02,,Gandhi Jayanti',
  '2026-11-07,2026-11-11,Diwali break',
  '2026-12-24,2027-01-01,Winter vacation',
].join('\n') + '\n'

// ============================================
// Who a calendar covers on a date (pure)
// ============================================

/** The entry or weekly off that makes `date` a holiday under this calendar, if any. */
export function calendarHolidayOn(cal: Pick<HolidayCalendar, 'is_active' | 'weekly_offs' | 'entries'>, date: string): string | null {
  if (!cal.is_active) return null
  const entry = cal.entries.find(e => e.start_date <= date && date <= e.end_date)
  if (entry) return entry.name
  if (cal.weekly_offs.includes(weekdayOfIso(date))) return 'Weekly off'
  return null
}

/**
 * The holiday a student calendar set gives one homeroom on one date: the first
 * active calendar that covers the homeroom (everyone, or through one of its
 * groups) and marks the date off. Dated entries win over weekly offs, so a
 * Saturday that is also a festival reads as the festival.
 */
export function resolveStudentHoliday(
  calendars: HolidayCalendar[],
  groups: AttendanceGroup[],
  homeroomId: string,
  date: string,
): { name: string; calendar: string } | null {
  const groupsOfHomeroom = new Set(groups.filter(g => g.member_ids.includes(homeroomId)).map(g => g.id))
  const covering = calendars.filter(c =>
    c.is_active && (c.group_ids.length === 0 || c.group_ids.some(id => groupsOfHomeroom.has(id))))
  for (const c of covering) {
    const entry = c.entries.find(e => e.start_date <= date && date <= e.end_date)
    if (entry) return { name: entry.name, calendar: c.name }
  }
  for (const c of covering) {
    if (c.weekly_offs.includes(weekdayOfIso(date))) return { name: 'Weekly off', calendar: c.name }
  }
  return null
}

// ============================================
// Groups
// ============================================

interface GroupRow {
  id: string
  audience: AttendanceAudience
  name: string
  description: string | null
  attendance_group_members: { staff_id: string | null; homeroom_id: string | null }[] | null
}

export async function fetchAttendanceGroups(audience: AttendanceAudience): Promise<AttendanceGroup[]> {
  const { data, error } = await supabase
    .from('attendance_groups')
    .select('id, audience, name, description, attendance_group_members(staff_id, homeroom_id)')
    .eq('audience', audience)
    .order('name', { ascending: true })
  if (error) {
    // A deployment without the migration lands here; the page shows no groups.
    console.error('fetchAttendanceGroups error:', error)
    return []
  }
  return ((data ?? []) as unknown as GroupRow[]).map(g => ({
    id: g.id,
    audience: g.audience,
    name: g.name,
    description: g.description,
    member_ids: (g.attendance_group_members ?? [])
      .map(m => (audience === 'staff' ? m.staff_id : m.homeroom_id))
      .filter((id): id is string => !!id),
  }))
}

/** Creates or updates a group and replaces its members. Returns the group id, or null on failure. */
export async function saveAttendanceGroup(
  audience: AttendanceAudience,
  input: AttendanceGroupInput,
  createdBy: string,
): Promise<string | null> {
  const fields = { name: input.name.trim(), description: input.description?.trim() || null }
  let id = input.id
  if (id) {
    const { error } = await supabase.from('attendance_groups').update(fields).eq('id', id)
    if (error) { console.error('saveAttendanceGroup update error:', error); return null }
    const { error: delErr } = await supabase.from('attendance_group_members').delete().eq('group_id', id)
    if (delErr) { console.error('saveAttendanceGroup members delete error:', delErr); return null }
  } else {
    id = crypto.randomUUID()
    const { error } = await supabase.from('attendance_groups').insert({ id, audience, ...fields, created_by: createdBy })
    if (error) { console.error('saveAttendanceGroup insert error:', error); return null }
  }

  const memberIds = [...new Set(input.member_ids)]
  if (memberIds.length > 0) {
    const rows = memberIds.map(m => audience === 'staff'
      ? { group_id: id, staff_id: m }
      : { group_id: id, homeroom_id: m })
    const { error } = await supabase.from('attendance_group_members').insert(rows)
    if (error) { console.error('saveAttendanceGroup members insert error:', error); return null }
  }

  // Staff calendars hold a copy of who each group covered; bring them up to date.
  if (audience === 'staff') await resyncStaffCalendarsForGroup(id, createdBy)
  return id
}

export async function deleteAttendanceGroup(audience: AttendanceAudience, groupId: string, actorId: string): Promise<boolean> {
  // Read which calendars used the group before the link rows cascade away.
  const affected = audience === 'staff' ? await calendarIdsForGroup(groupId) : []
  const { error } = await supabase.from('attendance_groups').delete().eq('id', groupId)
  if (error) { console.error('deleteAttendanceGroup error:', error); return false }
  if (affected.length > 0) {
    for (const calId of affected) await syncStaffCalendar(calId, actorId, { recompute: false })
    await recomputePendingAttendance()
  }
  return true
}

async function calendarIdsForGroup(groupId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('attendance_holiday_calendar_groups')
    .select('calendar_id')
    .eq('group_id', groupId)
  if (error) { console.error('calendarIdsForGroup error:', error); return [] }
  return (data ?? []).map(r => r.calendar_id as string)
}

async function resyncStaffCalendarsForGroup(groupId: string, actorId: string): Promise<void> {
  const ids = await calendarIdsForGroup(groupId)
  if (ids.length === 0) return
  for (const calId of ids) await syncStaffCalendar(calId, actorId, { recompute: false })
  await recomputePendingAttendance()
}

// ============================================
// Calendars
// ============================================

interface CalendarRow {
  id: string
  audience: AttendanceAudience
  name: string
  description: string | null
  weekly_offs: number[] | null
  is_active: boolean
  attendance_holiday_calendar_groups: { group_id: string }[] | null
  attendance_holiday_calendar_entries: HolidayCalendarEntry[] | null
}

const CALENDAR_SELECT =
  'id, audience, name, description, weekly_offs, is_active, ' +
  'attendance_holiday_calendar_groups(group_id), ' +
  'attendance_holiday_calendar_entries(name, start_date, end_date)'

function toCalendar(r: CalendarRow): HolidayCalendar {
  return {
    id: r.id,
    audience: r.audience,
    name: r.name,
    description: r.description,
    weekly_offs: [...(r.weekly_offs ?? [])].sort(),
    is_active: r.is_active,
    group_ids: (r.attendance_holiday_calendar_groups ?? []).map(g => g.group_id),
    entries: normalizeEntries(r.attendance_holiday_calendar_entries ?? []),
  }
}

export async function fetchHolidayCalendars(audience: AttendanceAudience): Promise<HolidayCalendar[]> {
  const { data, error } = await supabase
    .from('attendance_holiday_calendars')
    .select(CALENDAR_SELECT)
    .eq('audience', audience)
    .order('name', { ascending: true })
  if (error) {
    console.error('fetchHolidayCalendars error:', error)
    return []
  }
  return ((data ?? []) as unknown as CalendarRow[]).map(toCalendar)
}

async function fetchHolidayCalendar(id: string): Promise<HolidayCalendar | null> {
  const { data, error } = await supabase
    .from('attendance_holiday_calendars')
    .select(CALENDAR_SELECT)
    .eq('id', id)
    .maybeSingle()
  if (error) { console.error('fetchHolidayCalendar error:', error); return null }
  return data ? toCalendar(data as unknown as CalendarRow) : null
}

/** Creates or updates a calendar, replacing its groups and entries. Returns its id, or null on failure. */
export async function saveHolidayCalendar(
  audience: AttendanceAudience,
  input: HolidayCalendarInput,
  createdBy: string,
): Promise<string | null> {
  const fields = {
    name: input.name.trim(),
    description: input.description?.trim() || null,
    weekly_offs: [...new Set(input.weekly_offs)].filter(d => d >= 0 && d <= 6).sort(),
    is_active: input.is_active,
  }
  let id = input.id
  if (id) {
    const { error } = await supabase.from('attendance_holiday_calendars').update(fields).eq('id', id)
    if (error) { console.error('saveHolidayCalendar update error:', error); return null }
    const [g, e] = await Promise.all([
      supabase.from('attendance_holiday_calendar_groups').delete().eq('calendar_id', id),
      supabase.from('attendance_holiday_calendar_entries').delete().eq('calendar_id', id),
    ])
    if (g.error || e.error) { console.error('saveHolidayCalendar clear error:', g.error ?? e.error); return null }
  } else {
    id = crypto.randomUUID()
    const { error } = await supabase.from('attendance_holiday_calendars').insert({ id, audience, ...fields, created_by: createdBy })
    if (error) { console.error('saveHolidayCalendar insert error:', error); return null }
  }

  const groupIds = [...new Set(input.group_ids)]
  if (groupIds.length > 0) {
    const { error } = await supabase.from('attendance_holiday_calendar_groups')
      .insert(groupIds.map(group_id => ({ calendar_id: id, group_id })))
    if (error) { console.error('saveHolidayCalendar groups insert error:', error); return null }
  }

  const entries = normalizeEntries(input.entries)
  if (entries.length > 0) {
    const { error } = await supabase.from('attendance_holiday_calendar_entries')
      .insert(entries.map(e => ({ calendar_id: id, ...e })))
    if (error) { console.error('saveHolidayCalendar entries insert error:', error); return null }
  }

  if (audience === 'staff' && !(await syncStaffCalendar(id, createdBy))) return null
  return id
}

export async function setHolidayCalendarActive(
  audience: AttendanceAudience, id: string, active: boolean, actorId: string,
): Promise<boolean> {
  const { error } = await supabase.from('attendance_holiday_calendars').update({ is_active: active }).eq('id', id)
  if (error) { console.error('setHolidayCalendarActive error:', error); return false }
  return audience === 'staff' ? syncStaffCalendar(id, actorId) : true
}

export async function deleteHolidayCalendar(audience: AttendanceAudience, id: string): Promise<boolean> {
  // A staff calendar's attendance_holidays rows go with it (ON DELETE CASCADE);
  // the rule triggers queue the days they covered for re-scoring.
  const { error } = await supabase.from('attendance_holiday_calendars').delete().eq('id', id)
  if (error) { console.error('deleteHolidayCalendar error:', error); return false }
  if (audience === 'staff') await recomputePendingAttendance()
  return true
}

// ============================================
// Staff calendars → attendance_holidays
// ============================================

const INSERT_CHUNK = 500

async function insertChunked(table: string, rows: Record<string, unknown>[]): Promise<boolean> {
  for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
    const { error } = await supabase.from(table).insert(rows.slice(i, i + INSERT_CHUNK))
    if (error) { console.error(`insertChunked(${table}) error:`, error); return false }
  }
  return true
}

/**
 * Rebuilds the attendance_holidays rows a staff calendar stands for: one per
 * holiday date, one per weekly off (a weekday-scoped rule, the same shape a
 * hand-made "every Sunday" holiday takes). A calendar for everyone writes
 * "everyone" rows; a group calendar writes rows covering the current members
 * of its groups. An inactive calendar, or one whose groups are empty, writes
 * nothing.
 */
export async function syncStaffCalendar(
  calendarId: string, actorId: string, opts: { recompute?: boolean } = {},
): Promise<boolean> {
  const cal = await fetchHolidayCalendar(calendarId)
  if (!cal || cal.audience !== 'staff') return false

  const { error: delErr } = await supabase.from('attendance_holidays').delete().eq('calendar_id', calendarId)
  if (delErr) { console.error('syncStaffCalendar delete error:', delErr); return false }

  let staffIds: string[] = []
  if (cal.group_ids.length > 0) {
    const { data, error } = await supabase
      .from('attendance_group_members')
      .select('staff_id')
      .in('group_id', cal.group_ids)
      .not('staff_id', 'is', null)
    if (error) { console.error('syncStaffCalendar members error:', error); return false }
    staffIds = [...new Set((data ?? []).map(r => r.staff_id as string))]
  }

  const everyone = cal.group_ids.length === 0
  if (cal.is_active && (everyone || staffIds.length > 0)) {
    const byDate = new Map<string, string>()
    for (const e of cal.entries) {
      for (const d of expandEntryDates(e)) if (!byDate.has(d)) byDate.set(d, e.name)
    }
    const base = { calendar_id: calendarId, is_default: everyone, created_by: actorId }
    const rows: Record<string, unknown>[] = [
      ...[...byDate].map(([date, name]) => ({
        ...base, id: crypto.randomUUID(), scope_type: 'date', scope_date: date, scope_weekday: null, name,
      })),
      ...cal.weekly_offs.map(w => ({
        ...base, id: crypto.randomUUID(), scope_type: 'weekday', scope_date: null, scope_weekday: w,
        name: `${cal.name} — weekly off`,
      })),
    ]
    if (!(await insertChunked('attendance_holidays', rows))) return false
    if (!everyone) {
      const memberRows = rows.flatMap(r => staffIds.map(staff_id => ({ holiday_id: r.id, staff_id })))
      if (!(await insertChunked('attendance_holiday_members', memberRows))) return false
    }
  }

  if (opts.recompute !== false) await recomputePendingAttendance()
  return true
}

// ============================================
// Student holidays
// ============================================

/**
 * The holiday, if any, the student calendars give one homeroom on one date —
 * for the attendance sheet to say so before a teacher marks a register on a
 * day off. Null when nothing covers it (or the tables don't exist yet).
 */
export async function fetchStudentHolidayForHomeroom(
  homeroomId: string, date: string,
): Promise<{ name: string; calendar: string } | null> {
  const [calendars, groups] = await Promise.all([
    fetchHolidayCalendars('student'),
    fetchAttendanceGroups('student'),
  ])
  if (calendars.length === 0) return null
  return resolveStudentHoliday(calendars, groups, homeroomId, date)
}
