import { describe, expect, it } from 'vitest'
import {
  AttendanceGroup, HolidayCalendar, entriesToCsv, expandEntryDates, normalizeEntries,
  parseFlexibleDate, parseHolidayCsv, parseHolidayFile, parseHolidayIcs, resolveStudentHoliday,
  HOLIDAY_CSV_TEMPLATE,
} from './attendanceCalendars'

describe('parseFlexibleDate', () => {
  it.each([
    ['2026-08-15', '2026-08-15'],
    ['15/08/2026', '2026-08-15'],
    ['15-08-2026', '2026-08-15'],
    ['15.08.2026', '2026-08-15'],
    ['5/8/26', '2026-08-05'],
    ['2026/8/15', '2026-08-15'],
    ['20260815', '2026-08-15'],
    ['15 Aug 2026', '2026-08-15'],
    ['15-Aug-2026', '2026-08-15'],
    ['15th August 2026', '2026-08-15'],
    ['Saturday, 15 August 2026', '2026-08-15'],
    ['August 15, 2026', '2026-08-15'],
    ['Sept 2 2026', '2026-09-02'],
  ])('reads %s', (raw, iso) => {
    expect(parseFlexibleDate(raw)).toBe(iso)
  })

  it.each(['', 'tomorrow', '31/04/2026', '2026-13-01', '32 Jan 2026'])('rejects %s', raw => {
    expect(parseFlexibleDate(raw)).toBeNull()
  })
})

describe('parseHolidayCsv', () => {
  it('reads the template it hands out', () => {
    const { entries, errors } = parseHolidayCsv(HOLIDAY_CSV_TEMPLATE)
    expect(errors).toEqual([])
    expect(entries).toEqual([
      { name: 'Independence Day', start_date: '2026-08-15', end_date: '2026-08-15' },
      { name: 'Gandhi Jayanti', start_date: '2026-10-02', end_date: '2026-10-02' },
      { name: 'Diwali break', start_date: '2026-11-07', end_date: '2026-11-11' },
      { name: 'Winter vacation', start_date: '2026-12-24', end_date: '2027-01-01' },
    ])
  })

  it('finds columns by header name in any order', () => {
    const csv = 'Occasion;Date\n"Christmas, Day";25/12/2026\nNew Year;01/01/2027\n'
    expect(parseHolidayCsv(csv).entries).toEqual([
      { name: 'Christmas, Day', start_date: '2026-12-25', end_date: '2026-12-25' },
      { name: 'New Year', start_date: '2027-01-01', end_date: '2027-01-01' },
    ])
  })

  it('reads headerless date,name and start,end,name rows', () => {
    const csv = '2026-01-26,Republic Day\n2026-05-01,2026-06-15,Summer vacation\n'
    expect(parseHolidayCsv(csv).entries).toEqual([
      { name: 'Republic Day', start_date: '2026-01-26', end_date: '2026-01-26' },
      { name: 'Summer vacation', start_date: '2026-05-01', end_date: '2026-06-15' },
    ])
  })

  it('reports rows it cannot read and keeps the rest', () => {
    const csv = 'Date,Holiday\nsoon,Mystery\n2026-03-04,\n2026-03-14,Holi\n'
    const { entries, errors } = parseHolidayCsv(csv)
    expect(entries).toHaveLength(1)
    expect(errors).toHaveLength(2)
    expect(errors[0]).toMatch(/Line 2/)
  })
})

describe('parseHolidayIcs', () => {
  it('reads all-day and timed events, pulling all-day DTEND back a day', () => {
    const ics = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'DTSTART;VALUE=DATE:20261102',
      'DTEND;VALUE=DATE:20261103',
      'SUMMARY:Diwali',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'DTSTART;VALUE=DATE:20261224',
      'DTEND;VALUE=DATE:20270102',
      'SUMMARY:Winter\\, break',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'DTSTART:20260815T000000Z',
      'SUMMARY:Independence',
      '  Day',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n')
    const { entries, errors } = parseHolidayIcs(ics)
    expect(errors).toEqual([])
    expect(entries).toEqual([
      { name: 'Independence Day', start_date: '2026-08-15', end_date: '2026-08-15' },
      { name: 'Diwali', start_date: '2026-11-02', end_date: '2026-11-02' },
      { name: 'Winter, break', start_date: '2026-12-24', end_date: '2027-01-01' },
    ])
  })

  it('is picked by parseHolidayFile for .ics files', () => {
    const ics = 'BEGIN:VCALENDAR\nBEGIN:VEVENT\nDTSTART;VALUE=DATE:20260126\nSUMMARY:Republic Day\nEND:VEVENT\nEND:VCALENDAR\n'
    expect(parseHolidayFile('holidays.ics', ics).entries).toHaveLength(1)
  })
})

describe('entries', () => {
  it('expands ranges inclusively, across a month end', () => {
    expect(expandEntryDates({ name: 'x', start_date: '2026-01-30', end_date: '2026-02-02' }))
      .toEqual(['2026-01-30', '2026-01-31', '2026-02-01', '2026-02-02'])
  })

  it('normalises: sorts, trims, drops duplicates and blank names', () => {
    expect(normalizeEntries([
      { name: ' Holi ', start_date: '2026-03-04', end_date: '2026-03-04' },
      { name: 'holi', start_date: '2026-03-04', end_date: '2026-03-04' },
      { name: '', start_date: '2026-01-01', end_date: '2026-01-01' },
      { name: 'Pongal', start_date: '2026-01-14', end_date: '2026-01-10' },
    ])).toEqual([
      { name: 'Pongal', start_date: '2026-01-14', end_date: '2026-01-14' },
      { name: 'Holi', start_date: '2026-03-04', end_date: '2026-03-04' },
    ])
  })

  it('round-trips through CSV', () => {
    const entries = [
      { name: 'Eid, al-Fitr', start_date: '2026-03-20', end_date: '2026-03-20' },
      { name: 'Puja break', start_date: '2026-10-17', end_date: '2026-10-21' },
    ]
    expect(parseHolidayCsv(entriesToCsv(entries)).entries).toEqual(entries)
  })
})

describe('resolveStudentHoliday', () => {
  const groups: AttendanceGroup[] = [
    { id: 'g-primary', audience: 'student', name: 'Primary', description: null, member_ids: ['hr-1'] },
  ]
  const cal = (over: Partial<HolidayCalendar>): HolidayCalendar => ({
    id: 'c', audience: 'student', name: 'School', description: null, weekly_offs: [], is_active: true,
    group_ids: [], entries: [], ...over,
  })

  it('covers every homeroom when the calendar has no groups', () => {
    const cals = [cal({ entries: [{ name: 'Diwali', start_date: '2026-11-08', end_date: '2026-11-08' }] })]
    expect(resolveStudentHoliday(cals, groups, 'hr-9', '2026-11-08')).toEqual({ name: 'Diwali', calendar: 'School' })
  })

  it('covers only homerooms in its groups', () => {
    const cals = [cal({ group_ids: ['g-primary'], entries: [{ name: 'Sports day', start_date: '2026-12-01', end_date: '2026-12-02' }] })]
    expect(resolveStudentHoliday(cals, groups, 'hr-1', '2026-12-02')?.name).toBe('Sports day')
    expect(resolveStudentHoliday(cals, groups, 'hr-2', '2026-12-02')).toBeNull()
  })

  it('prefers a dated holiday over a weekly off, and ignores inactive calendars', () => {
    // 2026-11-07 is a Saturday.
    const cals = [
      cal({ name: 'Weekly', weekly_offs: [6] }),
      cal({ name: 'Festivals', entries: [{ name: 'Diwali break', start_date: '2026-11-07', end_date: '2026-11-11' }] }),
      cal({ name: 'Old', is_active: false, entries: [{ name: 'Old', start_date: '2026-11-12', end_date: '2026-11-12' }] }),
    ]
    expect(resolveStudentHoliday(cals, groups, 'hr-1', '2026-11-07')?.name).toBe('Diwali break')
    expect(resolveStudentHoliday(cals, groups, 'hr-1', '2026-11-14')?.name).toBe('Weekly off')
    expect(resolveStudentHoliday(cals, groups, 'hr-1', '2026-11-12')).toBeNull()
  })
})
