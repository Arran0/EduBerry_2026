'use client'

import React from 'react'
import { fetchBranding } from '@/lib/pageConfig'
import { LateSummaryRow, formatMinutesAsHM, STAFF_ATTENDANCE_STATUS_LABELS } from '@/lib/attendance'
import {
  AbsenceIrregularReport,
  TimeTrackingReport,
  ABSENCE_CATEGORY_LABELS,
  DAY_STATE_LABELS,
  formatClock,
  formatReportDate,
  formatReportWeekday,
  formatWorked,
  timeTrackingRowCount,
} from '@/lib/attendanceReports'
import { exportRows } from '@/lib/feeExports'

export interface StatementSpec {
  element: React.ReactElement
  fileName: string
}

export interface LateSummaryReport {
  kind: 'late'
  startDate: string
  endDate: string
  timezone: string | null
  rows: LateSummaryRow[]
}

/** Whatever one of the three documents was generated from. */
export type ReportData = LateSummaryReport | AbsenceIrregularReport | TimeTrackingReport

export const REPORT_TITLES: Record<ReportData['kind'], string> = {
  late: 'Late Summary',
  absence: 'Absence & Irregular Summary',
  time: 'Time Tracking Report',
}

const FILE_STEMS: Record<ReportData['kind'], string> = {
  late: 'late-summary',
  absence: 'absence-irregular-summary',
  time: 'time-tracking',
}

function fileStem(data: ReportData) {
  return `${FILE_STEMS[data.kind]}-${data.startDate}-to-${data.endDate}`
}

/** Table rows the PDF will draw — what decides whether a preview is practical. */
export function reportRowCount(data: ReportData): number {
  switch (data.kind) {
    case 'late': return data.rows.length
    case 'absence': return data.rows.length + data.totals.length
    case 'time': return timeTrackingRowCount(data.staff.length, data.staff[0]?.days.length ?? 0)
  }
}

/** A rough page count for the size flag (≈ 30 table rows on an A4 landscape page). */
export function estimatePages(rows: number): number {
  return Math.max(1, Math.ceil(rows / 30))
}

export async function downloadStatement(spec: StatementSpec): Promise<void> {
  const { pdf } = await import('@react-pdf/renderer')
  const blob = await pdf(spec.element).toBlob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = spec.fileName.endsWith('.pdf') ? spec.fileName : `${spec.fileName}.pdf`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export async function buildReportSpec(data: ReportData, scopeLabel: string): Promise<StatementSpec> {
  const [branding, docs] = await Promise.all([fetchBranding(), import('./documents')])
  const element = data.kind === 'late'
    ? React.createElement(docs.LateSummaryReportDoc, {
      branding, rows: data.rows, startDate: data.startDate, endDate: data.endDate, scopeLabel, timezone: data.timezone,
    })
    : data.kind === 'absence'
      ? React.createElement(docs.AbsenceIrregularReportDoc, { branding, report: data, scopeLabel })
      : React.createElement(docs.TimeTrackingReportDoc, { branding, report: data, scopeLabel })
  return { element, fileName: fileStem(data) }
}

/** The same rows as a spreadsheet, one row per table line of the PDF. */
export async function downloadReportExcel(data: ReportData): Promise<void> {
  const tz = data.timezone
  if (data.kind === 'late') {
    await exportRows(
      data.rows.map(r => ({
        Date: formatReportDate(r.date),
        'Employee Code': r.employee_code,
        'Employee Name': r.employee_name,
        Department: r.department,
        Designation: r.designation,
        'In Time': formatClock(r.check_in_time, tz),
        'Out Time': formatClock(r.check_out_time, tz),
        'Late By': formatMinutesAsHM(r.late_by_minutes),
        Status: STAFF_ATTENDANCE_STATUS_LABELS[r.status],
      })),
      'Late Summary',
      fileStem(data),
    )
    return
  }

  if (data.kind === 'absence') {
    const { absenceDetail } = await import('./documents')
    await exportRows(
      data.rows.map(r => ({
        Date: formatReportDate(r.date),
        'Employee Code': r.staff.employee_code,
        'Employee Name': r.staff.full_name,
        Department: r.staff.department,
        Designation: r.staff.designation,
        Status: ABSENCE_CATEGORY_LABELS[r.category],
        Detail: absenceDetail(r, tz),
      })),
      'Absence & Irregular',
      fileStem(data),
    )
    return
  }

  await exportRows(
    data.staff.flatMap(s => s.days.map(d => ({
      'Employee Code': s.staff.employee_code,
      'Employee Name': s.staff.full_name,
      Department: s.staff.department,
      Date: formatReportDate(d.date),
      Day: formatReportWeekday(d.date),
      Status: d.state ? DAY_STATE_LABELS[d.state] : '',
      'Check In': formatClock(d.checkIn, tz),
      'Check Out': formatClock(d.checkOut, tz),
      'Return In': formatClock(d.checkIn2, tz),
      'Final Out': formatClock(d.checkOut2, tz),
      Worked: formatWorked(d.workedMinutes),
      'Worked (minutes)': d.workedMinutes ?? '',
    }))),
    'Time Tracking',
    fileStem(data),
  )
}
