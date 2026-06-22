'use client'

import React from 'react'
import { Document, Page, View, Text, Image, StyleSheet } from '@react-pdf/renderer'
import type { SiteBranding } from '@/lib/pageConfig'

// react-pdf's built-in Helvetica has no ₹ glyph, so official PDFs use a plain
// "Rs." prefix (unambiguous, renders everywhere without bundling a font).
export function pdfINR(n: number): string {
  return 'Rs. ' + (Number(n) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function fmtDate(d?: string | null): string {
  if (!d) return '—'
  const dt = new Date(d)
  if (isNaN(dt.getTime())) return '—'
  return dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

export interface StudentLike {
  full_name?: string | null
  email?: string | null
  grade?: number | null
  section?: string | null
}

const INK = '#27272A'
const MUTED = '#71717A'
const LINE = '#E4E4E7'
const GOLD = '#A8896B'

export const styles = StyleSheet.create({
  page: { paddingTop: 40, paddingBottom: 56, paddingHorizontal: 44, fontSize: 10, color: INK, fontFamily: 'Helvetica' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: 2, borderBottomColor: INK, paddingBottom: 12, marginBottom: 16 },
  logo: { width: 46, height: 46, objectFit: 'contain' },
  school: { fontSize: 17, fontFamily: 'Helvetica-Bold', color: INK },
  tagline: { fontSize: 9, color: MUTED, marginTop: 2 },
  titleBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  title: { fontSize: 13, fontFamily: 'Helvetica-Bold', textTransform: 'uppercase', letterSpacing: 1 },
  year: { fontSize: 10, color: GOLD, fontFamily: 'Helvetica-Bold' },
  infoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginBottom: 14, padding: 10, backgroundColor: '#FAFAFA', borderWidth: 1, borderColor: LINE, borderRadius: 4 },
  infoCell: { width: '50%', flexDirection: 'row', marginBottom: 3 },
  infoLabel: { width: 70, color: MUTED, fontSize: 9 },
  infoValue: { flex: 1, fontFamily: 'Helvetica-Bold', fontSize: 9 },
  // Tables
  tHead: { flexDirection: 'row', backgroundColor: INK, color: '#fff', paddingVertical: 6, paddingHorizontal: 6 },
  tRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#F1F1F1', paddingVertical: 5, paddingHorizontal: 6 },
  th: { fontSize: 8.5, fontFamily: 'Helvetica-Bold', textTransform: 'uppercase', letterSpacing: 0.4 },
  td: { fontSize: 9 },
  tTotal: { flexDirection: 'row', borderTopWidth: 1.5, borderTopColor: INK, paddingVertical: 7, paddingHorizontal: 6, marginTop: 2 },
  // Misc
  para: { fontSize: 11, lineHeight: 1.7, marginBottom: 10 },
  big: { fontSize: 22, fontFamily: 'Helvetica-Bold', marginVertical: 8 },
  stampRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 48 },
  sign: { fontSize: 9, color: MUTED, borderTopWidth: 1, borderTopColor: INK, paddingTop: 4, width: 160, textAlign: 'center' },
  footer: { position: 'absolute', bottom: 24, left: 44, right: 44, flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: LINE, paddingTop: 6, fontSize: 8, color: MUTED },
})

export interface ShellProps {
  branding: SiteBranding
  title: string
  refNo?: string
  student?: StudentLike
  year?: string
  signatory?: string
  children: React.ReactNode
}

/** Shared letterhead + footer wrapper every fee document composes. */
export function StatementShell({ branding, title, refNo, student, year, signatory, children }: ShellProps) {
  const grade = student?.grade != null ? `Grade ${student.grade}${student.section ? ` · ${student.section}` : ''}` : null
  return (
    <Document title={title} author={branding.schoolName}>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          {branding.logoUrl ? <Image src={branding.logoUrl} style={styles.logo} /> : null}
          <View style={{ flex: 1 }}>
            <Text style={styles.school}>{branding.schoolName}</Text>
            {branding.tagline ? <Text style={styles.tagline}>{branding.tagline}</Text> : null}
          </View>
        </View>

        <View style={styles.titleBar}>
          <Text style={styles.title}>{title}</Text>
          {year ? <Text style={styles.year}>AY {year}</Text> : null}
        </View>

        {(student || refNo) && (
          <View style={styles.infoGrid}>
            {student?.full_name ? <Info label="Student" value={student.full_name} /> : null}
            {grade ? <Info label="Class" value={grade} /> : null}
            {student?.email ? <Info label="Email" value={student.email} /> : null}
            {refNo ? <Info label="Ref No." value={refNo} /> : null}
          </View>
        )}

        <View>{children}</View>

        <View style={styles.footer} fixed>
          <Text>Generated on {fmtDate(new Date().toISOString())} · {branding.schoolName}</Text>
          <Text>{signatory ?? 'This is a system-generated document.'}</Text>
        </View>
      </Page>
    </Document>
  )
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoCell}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  )
}

/** A simple table from column defs + rows. Each column has a flex weight + align. */
export interface Col { key: string; label: string; flex: number; align?: 'left' | 'right' }
export function Table({ cols, rows }: { cols: Col[]; rows: Record<string, string>[] }) {
  return (
    <View>
      <View style={styles.tHead}>
        {cols.map(c => (
          <Text key={c.key} style={[styles.th, { flex: c.flex, textAlign: c.align ?? 'left' }]}>{c.label}</Text>
        ))}
      </View>
      {rows.map((r, i) => (
        <View key={i} style={styles.tRow}>
          {cols.map(c => (
            <Text key={c.key} style={[styles.td, { flex: c.flex, textAlign: c.align ?? 'left' }]}>{r[c.key] ?? ''}</Text>
          ))}
        </View>
      ))}
    </View>
  )
}
