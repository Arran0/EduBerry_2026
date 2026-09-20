'use client'
/* eslint-disable jsx-a11y/alt-text -- <Image> here is @react-pdf/renderer's PDF
   primitive, not an <img>: it draws into the PDF and has no alt concept, so the
   prop jsx-a11y asks for would be inert. */

import React from 'react'
import { Document, Page, View, Text, Image, StyleSheet } from '@react-pdf/renderer'
import type { SiteBranding } from '@/lib/pageConfig'

// react-pdf's built-in Helvetica has no ₹ glyph — use "Rs." prefix.
export function pdfINR(n: number): string {
  return 'Rs. ' + (Number(n) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function fmtDate(d?: string | null): string {
  if (!d) return '—'
  const dt = new Date(d)
  if (isNaN(dt.getTime())) return '—'
  return dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

export interface StaffLike {
  full_name?: string | null
  email?: string | null
  role?: string | null
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
  period: { fontSize: 10, color: GOLD, fontFamily: 'Helvetica-Bold' },
  infoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginBottom: 14, padding: 10, backgroundColor: '#FAFAFA', borderWidth: 1, borderColor: LINE, borderRadius: 4 },
  infoCell: { width: '50%', flexDirection: 'row', marginBottom: 3 },
  infoLabel: { width: 70, color: MUTED, fontSize: 9 },
  infoValue: { flex: 1, fontFamily: 'Helvetica-Bold', fontSize: 9 },
  tHead: { flexDirection: 'row', backgroundColor: INK, color: '#fff', paddingVertical: 6, paddingHorizontal: 6 },
  tRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#F1F1F1', paddingVertical: 5, paddingHorizontal: 6 },
  th: { fontSize: 8.5, fontFamily: 'Helvetica-Bold', textTransform: 'uppercase', letterSpacing: 0.4 },
  td: { fontSize: 9 },
  tTotal: { flexDirection: 'row', borderTopWidth: 1.5, borderTopColor: INK, paddingVertical: 7, paddingHorizontal: 6, marginTop: 2 },
  para: { fontSize: 11, lineHeight: 1.7, marginBottom: 10 },
  stampRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 48 },
  sign: { fontSize: 9, color: MUTED, borderTopWidth: 1, borderTopColor: INK, paddingTop: 4, width: 160, textAlign: 'center' },
  footer: { position: 'absolute', bottom: 24, left: 44, right: 44, flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: LINE, paddingTop: 6, fontSize: 8, color: MUTED },
})

export interface ShellProps {
  branding: SiteBranding
  title: string
  refNo?: string
  staff?: StaffLike
  period?: string
  signatory?: string
  children: React.ReactNode
}

/** Shared letterhead + footer for salary documents — mirrors fee StatementShell. */
export function SalaryStatementShell({ branding, title, refNo, staff, period, signatory, children }: ShellProps) {
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
          {period ? <Text style={styles.period}>{period}</Text> : null}
        </View>

        {(staff || refNo) && (
          <View style={styles.infoGrid}>
            {staff?.full_name ? <Info label="Employee" value={staff.full_name} /> : null}
            {staff?.role ? <Info label="Designation" value={staff.role} /> : null}
            {staff?.email ? <Info label="Email" value={staff.email} /> : null}
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

export function TotalRow({ label, value, flexLabel = 4, flexValue = 1 }: { label: string; value: string; flexLabel?: number; flexValue?: number }) {
  return (
    <View style={styles.tTotal}>
      <Text style={[{ flex: flexLabel }, styles.th]}>{label}</Text>
      <Text style={[{ flex: flexValue, textAlign: 'right' }, styles.th]}>{value}</Text>
    </View>
  )
}
