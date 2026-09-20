'use client'

import React from 'react'
import { fetchBranding } from '@/lib/pageConfig'
import { LateSummaryRow, formatMinutesAsHM, STAFF_ATTENDANCE_STATUS_LABELS } from '@/lib/attendance'
import { exportRows } from '@/lib/feeExports'

export interface StatementSpec {
  element: React.ReactElement
  fileName: string
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

export async function buildLateSummaryReport(
  rows: LateSummaryRow[],
  startDate: string,
  endDate: string,
): Promise<StatementSpec> {
  const [branding, { LateSummaryReportDoc }] = await Promise.all([fetchBranding(), import('./documents')])
  return {
    element: React.createElement(LateSummaryReportDoc, { branding, rows, startDate, endDate }),
    fileName: `late-summary-${startDate}-to-${endDate}`,
  }
}

function fmtDateCell(d: string): string {
  const dt = new Date(d + 'T12:00:00')
  return dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

function fmtTimeCell(iso: string | null): string {
  if (!iso) return ''
  return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
}

/** Excel/CSV-shaped export of the same rows, mirroring the biometric system's column layout. */
export function downloadLateSummaryExcel(rows: LateSummaryRow[], startDate: string, endDate: string): void {
  void exportRows(
    rows.map(r => ({
      Date: fmtDateCell(r.date),
      'Employee Code': r.employee_code,
      'Employee Name': r.employee_name,
      Department: r.department,
      Designation: r.designation,
      'In Time': fmtTimeCell(r.check_in_time),
      'Out Time': fmtTimeCell(r.check_out_time),
      'Late By': formatMinutesAsHM(r.late_by_minutes),
      Status: STAFF_ATTENDANCE_STATUS_LABELS[r.status],
    })),
    'Late Summary',
    `late-summary-${startDate}-to-${endDate}`,
  )
}
