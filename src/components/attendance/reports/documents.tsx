'use client'
/* eslint-disable jsx-a11y/alt-text -- <Image> here is @react-pdf/renderer's PDF
   primitive, not an <img>: it draws into the PDF and has no alt concept, so the
   prop jsx-a11y asks for would be inert. */

import React from 'react'
import { Document, Page, View, Text, Image, StyleSheet } from '@react-pdf/renderer'
import type { SiteBranding } from '@/lib/pageConfig'
import { LateSummaryRow, formatMinutesAsHM, STAFF_ATTENDANCE_STATUS_LABELS } from '@/lib/attendance'

const INK = '#27272A'
const MUTED = '#71717A'
const LINE = '#E4E4E7'
const GOLD = '#A8896B'

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
  tHead: { flexDirection: 'row', backgroundColor: INK, color: '#fff', paddingVertical: 6, paddingHorizontal: 5 },
  tRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#F1F1F1', paddingVertical: 4.5, paddingHorizontal: 5 },
  th: { fontSize: 7.5, fontFamily: 'Helvetica-Bold', textTransform: 'uppercase', letterSpacing: 0.3 },
  td: { fontSize: 8.5 },
  footer: { position: 'absolute', bottom: 20, left: 36, right: 36, flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: LINE, paddingTop: 6, fontSize: 8, color: MUTED },
})

function fmtDate(d: string): string {
  const dt = new Date(d + 'T12:00:00')
  return dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

function fmtTime(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
}

interface Col { key: string; label: string; flex: number; align?: 'left' | 'right' }

const COLS: Col[] = [
  { key: 'date', label: 'Date', flex: 1.3 },
  { key: 'code', label: 'Emp. Code', flex: 1.2 },
  { key: 'name', label: 'Employee Name', flex: 2.3 },
  { key: 'department', label: 'Department', flex: 1.4 },
  { key: 'inTime', label: 'In Time', flex: 1, align: 'right' },
  { key: 'outTime', label: 'Out Time', flex: 1, align: 'right' },
  { key: 'lateBy', label: 'Late By', flex: 1, align: 'right' },
  { key: 'status', label: 'Status', flex: 1.3 },
]

export function LateSummaryReportDoc({ branding, rows, startDate, endDate }: {
  branding: SiteBranding
  rows: LateSummaryRow[]
  startDate: string
  endDate: string
}) {
  const period = startDate === endDate ? fmtDate(startDate) : `${fmtDate(startDate)} – ${fmtDate(endDate)}`
  const tableRows = rows.map(r => ({
    date: fmtDate(r.date),
    code: r.employee_code,
    name: r.employee_name,
    department: r.department,
    inTime: fmtTime(r.check_in_time),
    outTime: fmtTime(r.check_out_time),
    lateBy: formatMinutesAsHM(r.late_by_minutes),
    status: STAFF_ATTENDANCE_STATUS_LABELS[r.status],
  }))

  return (
    <Document title="Late Summary Report" author={branding.schoolName}>
      <Page size="A4" orientation="landscape" style={styles.page}>
        <View style={styles.header}>
          {branding.logoUrl ? <Image src={branding.logoUrl} style={styles.logo} /> : null}
          <View style={{ flex: 1 }}>
            <Text style={styles.school}>{branding.schoolName}</Text>
            {branding.tagline ? <Text style={styles.tagline}>{branding.tagline}</Text> : null}
          </View>
        </View>

        <View style={styles.titleBar}>
          <Text style={styles.title}>Late Summary Report</Text>
          <Text style={styles.period}>{period}</Text>
        </View>
        <Text style={styles.summary}>{rows.length} late arrival{rows.length === 1 ? '' : 's'} recorded</Text>

        <View>
          <View style={styles.tHead} fixed>
            {COLS.map(c => (
              <Text key={c.key} style={[styles.th, { flex: c.flex, textAlign: c.align ?? 'left' }]}>{c.label}</Text>
            ))}
          </View>
          {tableRows.length === 0 ? (
            <View style={styles.tRow}>
              <Text style={styles.td}>No late arrivals in this date range.</Text>
            </View>
          ) : tableRows.map((r, i) => (
            <View key={i} style={styles.tRow} wrap={false}>
              {COLS.map(c => (
                <Text key={c.key} style={[styles.td, { flex: c.flex, textAlign: c.align ?? 'left' }]}>
                  {(r as unknown as Record<string, string>)[c.key]}
                </Text>
              ))}
            </View>
          ))}
        </View>

        <View style={styles.footer} fixed>
          <Text>Generated on {fmtDate(new Date().toISOString().split('T')[0])} · {branding.schoolName}</Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  )
}
