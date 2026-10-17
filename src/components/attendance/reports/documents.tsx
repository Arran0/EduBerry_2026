'use client'
/* eslint-disable jsx-a11y/alt-text -- <Image> here is @react-pdf/renderer's PDF
   primitive, not an <img>: it draws into the PDF and has no alt concept, so the
   prop jsx-a11y asks for would be inert. */

import React from 'react'
import { Document, Page, View, Text, Image, StyleSheet } from '@react-pdf/renderer'
import type { SiteBranding } from '@/lib/pageConfig'
import { LateSummaryRow, formatMinutesAsHM, STAFF_ATTENDANCE_STATUS_LABELS } from '@/lib/attendance'
import {
  AbsenceIrregularReport,
  AbsenceIrregularRow,
  TimeTrackingReport,
  ABSENCE_CATEGORY_LABELS,
  DAY_STATE_LABELS,
  formatClock,
  formatReportDate,
  formatReportWeekday,
  formatWorked,
} from '@/lib/attendanceReports'

const INK = '#27272A'
const MUTED = '#71717A'
const LINE = '#E4E4E7'
const GOLD = '#A8896B'
const BAND = '#F4F2EC'

const CATEGORY_INK: Record<string, string> = {
  absent: '#B91C1C',
  on_leave: '#1D4ED8',
  half_day: '#C2410C',
  e: '#6D28D9',
  late: '#B45309',
  holiday: '#7C3AED',
  non_working: MUTED,
}

const styles = StyleSheet.create({
  page: { paddingTop: 36, paddingBottom: 52, paddingHorizontal: 36, fontSize: 9, color: INK, fontFamily: 'Helvetica' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: 2, borderBottomColor: INK, paddingBottom: 10, marginBottom: 14 },
  logo: { width: 40, height: 40, objectFit: 'contain' },
  school: { fontSize: 15, fontFamily: 'Helvetica-Bold', color: INK },
  tagline: { fontSize: 8.5, color: MUTED, marginTop: 2 },
  titleBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  title: { fontSize: 13, fontFamily: 'Helvetica-Bold', textTransform: 'uppercase', letterSpacing: 1 },
  period: { fontSize: 10, color: GOLD, fontFamily: 'Helvetica-Bold' },
  summary: { fontSize: 9, color: MUTED, marginBottom: 10 },
  sectionTitle: { fontSize: 10, fontFamily: 'Helvetica-Bold', marginTop: 14, marginBottom: 6 },
  tHead: { flexDirection: 'row', backgroundColor: INK, color: '#fff', paddingVertical: 6, paddingHorizontal: 5 },
  tRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#F1F1F1', paddingVertical: 4.5, paddingHorizontal: 5 },
  band: { flexDirection: 'row', justifyContent: 'space-between', backgroundColor: BAND, paddingVertical: 5, paddingHorizontal: 5, marginTop: 8 },
  bandName: { fontSize: 9.5, fontFamily: 'Helvetica-Bold' },
  bandMeta: { fontSize: 8.5, color: MUTED },
  th: { fontSize: 7.5, fontFamily: 'Helvetica-Bold', textTransform: 'uppercase', letterSpacing: 0.3 },
  td: { fontSize: 8.5 },
  footer: { position: 'absolute', bottom: 20, left: 36, right: 36, flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: LINE, paddingTop: 6, fontSize: 8, color: MUTED },
})

interface Col { key: string; label: string; flex: number; align?: 'left' | 'right' | 'center' }

function periodLabel(startDate: string, endDate: string) {
  return startDate === endDate ? formatReportDate(startDate) : `${formatReportDate(startDate)} – ${formatReportDate(endDate)}`
}

/** Letterhead, title bar and the running footer every document shares. */
function ReportPage({ branding, title, period, summary, children }: {
  branding: SiteBranding
  title: string
  period: string
  summary: string
  children: React.ReactNode
}) {
  return (
    <Page size="A4" orientation="landscape" style={styles.page}>
      <View style={styles.header}>
        {branding.logoUrl ? <Image src={branding.logoUrl} style={styles.logo} /> : null}
        <View style={{ flex: 1 }}>
          <Text style={styles.school}>{branding.schoolName}</Text>
          {branding.tagline ? <Text style={styles.tagline}>{branding.tagline}</Text> : null}
        </View>
      </View>

      <View style={styles.titleBar}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.period}>{period}</Text>
      </View>
      <Text style={styles.summary}>{summary}</Text>

      {children}

      <View style={styles.footer} fixed>
        <Text>Generated on {formatReportDate(new Date().toISOString().split('T')[0])} · {branding.schoolName}</Text>
        <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
      </View>
    </Page>
  )
}

/** `fixed` repeats the head on every page the table runs onto. */
function TableHead({ cols, fixed = true }: { cols: Col[]; fixed?: boolean }) {
  return (
    <View style={styles.tHead} fixed={fixed}>
      {cols.map(c => (
        <Text key={c.key} style={[styles.th, { flex: c.flex, textAlign: c.align ?? 'left' }]}>{c.label}</Text>
      ))}
    </View>
  )
}

function TableRow({ cols, row, tint }: { cols: Col[]; row: Record<string, string>; tint?: Record<string, string> }) {
  return (
    <View style={styles.tRow} wrap={false}>
      {cols.map(c => (
        <Text key={c.key} style={[styles.td, { flex: c.flex, textAlign: c.align ?? 'left' }, tint?.[c.key] ? { color: tint[c.key], fontFamily: 'Helvetica-Bold' } : {}]}>
          {row[c.key]}
        </Text>
      ))}
    </View>
  )
}

function EmptyRow({ text }: { text: string }) {
  return <View style={styles.tRow}><Text style={styles.td}>{text}</Text></View>
}

// ── Late summary ─────────────────────────────────────────────────────────────

const LATE_COLS: Col[] = [
  { key: 'date', label: 'Date', flex: 1.3 },
  { key: 'code', label: 'Emp. Code', flex: 1.2 },
  { key: 'name', label: 'Employee Name', flex: 2.3 },
  { key: 'department', label: 'Department', flex: 1.4 },
  { key: 'inTime', label: 'In Time', flex: 1, align: 'right' },
  { key: 'outTime', label: 'Out Time', flex: 1, align: 'right' },
  { key: 'lateBy', label: 'Late By', flex: 1, align: 'right' },
  { key: 'status', label: 'Status', flex: 1.3 },
]

export function LateSummaryReportDoc({ branding, rows, startDate, endDate, scopeLabel, timezone }: {
  branding: SiteBranding
  rows: LateSummaryRow[]
  startDate: string
  endDate: string
  scopeLabel?: string
  timezone?: string | null
}) {
  const staffCount = new Set(rows.map(r => r.staff_id)).size
  return (
    <Document title="Late Summary Report" author={branding.schoolName}>
      <ReportPage
        branding={branding}
        title="Late Summary Report"
        period={periodLabel(startDate, endDate)}
        summary={`${scopeLabel ?? 'All staff'} · ${rows.length} late arrival${rows.length === 1 ? '' : 's'} by ${staffCount} staff`}
      >
        <TableHead cols={LATE_COLS} />
        {rows.length === 0 ? <EmptyRow text="No late arrivals in this date range." /> : rows.map((r, i) => (
          <TableRow key={i} cols={LATE_COLS} row={{
            date: formatReportDate(r.date),
            code: r.employee_code,
            name: r.employee_name,
            department: r.department,
            inTime: formatClock(r.check_in_time, timezone ?? null) || '—',
            outTime: formatClock(r.check_out_time, timezone ?? null) || '—',
            lateBy: formatMinutesAsHM(r.late_by_minutes),
            status: STAFF_ATTENDANCE_STATUS_LABELS[r.status],
          }} />
        ))}
      </ReportPage>
    </Document>
  )
}

// ── Absence & irregular summary ──────────────────────────────────────────────

const ABSENCE_TOTAL_COLS: Col[] = [
  { key: 'name', label: 'Employee Name', flex: 2.4 },
  { key: 'code', label: 'Emp. Code', flex: 1.1 },
  { key: 'department', label: 'Department', flex: 1.5 },
  { key: 'absent', label: 'Absent', flex: 0.8, align: 'right' },
  { key: 'on_leave', label: 'On Leave', flex: 0.8, align: 'right' },
  { key: 'half_day', label: 'Half Day', flex: 0.8, align: 'right' },
  { key: 'e', label: 'Exception', flex: 0.8, align: 'right' },
  { key: 'total', label: 'Total', flex: 0.8, align: 'right' },
]

const ABSENCE_DAY_COLS: Col[] = [
  { key: 'date', label: 'Date', flex: 1.2 },
  { key: 'code', label: 'Emp. Code', flex: 1.1 },
  { key: 'name', label: 'Employee Name', flex: 2.2 },
  { key: 'department', label: 'Department', flex: 1.4 },
  { key: 'category', label: 'Status', flex: 1.1 },
  { key: 'detail', label: 'Detail', flex: 3 },
]

/** What the day's row says beyond its category. */
export function absenceDetail(row: AbsenceIrregularRow, timezone: string | null): string {
  const r = row.record
  if (row.derived || !r) return 'No check-in recorded'
  const t = (iso: string | null) => formatClock(iso, timezone)
  if (row.category === 'half_day') {
    return [r.check_in_time && `In ${t(r.check_in_time)}`, r.check_out_time && `Out ${t(r.check_out_time)}`].filter(Boolean).join(' · ') || (r.remarks ?? 'Half day')
  }
  if (row.category === 'e') {
    return [r.check_out_time && `Left ${t(r.check_out_time)}`, r.check_in_time_2 && `Back ${t(r.check_in_time_2)}`].filter(Boolean).join(' · ') || (r.remarks ?? 'Permission break')
  }
  if (row.category === 'on_leave') return r.remarks || (r.leave_application_id ? 'Approved leave application' : 'Marked on leave')
  return r.remarks || 'Marked absent'
}

export function AbsenceIrregularReportDoc({ branding, report, scopeLabel }: {
  branding: SiteBranding
  report: AbsenceIrregularReport
  scopeLabel?: string
}) {
  const { rows, totals, startDate, endDate, timezone } = report
  const absences = rows.filter(r => r.category === 'absent' || r.category === 'on_leave').length
  const irregular = rows.length - absences
  return (
    <Document title="Absence & Irregular Summary" author={branding.schoolName}>
      <ReportPage
        branding={branding}
        title="Absence & Irregular Summary"
        period={periodLabel(startDate, endDate)}
        summary={`${scopeLabel ?? 'All staff'} · ${absences} absence${absences === 1 ? '' : 's'} and ${irregular} irregular day${irregular === 1 ? '' : 's'} across ${totals.length} staff`}
      >
        <Text style={[styles.sectionTitle, { marginTop: 0 }]}>By staff member</Text>
        {/* Not fixed: it would repeat over the day-by-day table on later pages. */}
        <TableHead cols={ABSENCE_TOTAL_COLS} fixed={false} />
        {totals.length === 0 ? <EmptyRow text="No absences or irregular days in this date range." /> : totals.map(t => (
          <TableRow key={t.staff.id} cols={ABSENCE_TOTAL_COLS} row={{
            name: t.staff.full_name,
            code: t.staff.employee_code,
            department: t.staff.department,
            absent: String(t.absent || '—'),
            on_leave: String(t.on_leave || '—'),
            half_day: String(t.half_day || '—'),
            e: String(t.e || '—'),
            total: String(t.total),
          }} />
        ))}

        {rows.length > 0 && (
          <View break={totals.length > 12}>
            <Text style={styles.sectionTitle}>Day by day</Text>
            <TableHead cols={ABSENCE_DAY_COLS} />
            {rows.map((r, i) => (
              <TableRow
                key={i}
                cols={ABSENCE_DAY_COLS}
                tint={{ category: CATEGORY_INK[r.category] }}
                row={{
                  date: formatReportDate(r.date),
                  code: r.staff.employee_code,
                  name: r.staff.full_name,
                  department: r.staff.department,
                  category: ABSENCE_CATEGORY_LABELS[r.category],
                  detail: absenceDetail(r, timezone),
                }}
              />
            ))}
          </View>
        )}
      </ReportPage>
    </Document>
  )
}

// ── Time tracking ────────────────────────────────────────────────────────────

const TIME_COLS: Col[] = [
  { key: 'date', label: 'Date', flex: 1.3 },
  { key: 'day', label: 'Day', flex: 0.6 },
  { key: 'status', label: 'Status', flex: 1.1 },
  { key: 'in1', label: 'Check In', flex: 1, align: 'right' },
  { key: 'out1', label: 'Check Out', flex: 1, align: 'right' },
  { key: 'in2', label: 'Return In', flex: 1, align: 'right' },
  { key: 'out2', label: 'Final Out', flex: 1, align: 'right' },
  { key: 'worked', label: 'Worked', flex: 1, align: 'right' },
]

export function TimeTrackingReportDoc({ branding, report, scopeLabel }: {
  branding: SiteBranding
  report: TimeTrackingReport
  scopeLabel?: string
}) {
  const { staff, startDate, endDate, timezone } = report
  const t = (iso: string | null) => formatClock(iso, timezone) || '—'
  return (
    <Document title="Time Tracking Report" author={branding.schoolName}>
      <ReportPage
        branding={branding}
        title="Time Tracking Report"
        period={periodLabel(startDate, endDate)}
        summary={`${scopeLabel ?? 'All staff'} · ${staff.length} staff · check-in and check-out times for every day in the range`}
      >
        <TableHead cols={TIME_COLS} />
        {staff.length === 0 ? <EmptyRow text="No staff in this selection." /> : staff.map(s => (
          <View key={s.staff.id}>
            {/* minPresenceAhead keeps a name from being stranded at a page foot. */}
            <View style={styles.band} wrap={false} minPresenceAhead={40}>
              <Text style={styles.bandName}>{s.staff.full_name}  <Text style={styles.bandMeta}>{s.staff.employee_code} · {s.staff.department}</Text></Text>
              <Text style={styles.bandMeta}>{s.daysAttended} day{s.daysAttended === 1 ? '' : 's'} attended · {formatWorked(s.totalWorkedMinutes)} worked</Text>
            </View>
            {s.days.map(d => (
              <TableRow
                key={d.date}
                cols={TIME_COLS}
                tint={d.state && d.state !== 'present' && d.state !== 'wfh' ? { status: CATEGORY_INK[d.state] ?? INK } : undefined}
                row={{
                  date: formatReportDate(d.date),
                  day: formatReportWeekday(d.date),
                  status: d.state ? DAY_STATE_LABELS[d.state] : '—',
                  in1: t(d.checkIn),
                  out1: d.checkIn && !d.checkOut ? 'Not out' : t(d.checkOut),
                  in2: t(d.checkIn2),
                  out2: d.checkIn2 && !d.checkOut2 ? 'Not out' : t(d.checkOut2),
                  worked: formatWorked(d.workedMinutes) || '—',
                }}
              />
            ))}
          </View>
        ))}
      </ReportPage>
    </Document>
  )
}
