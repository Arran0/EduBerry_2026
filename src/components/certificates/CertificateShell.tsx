'use client'
/* eslint-disable jsx-a11y/alt-text -- <Image> here is @react-pdf/renderer's PDF
   primitive, not an <img>: it draws into the PDF and has no alt concept, so the
   prop jsx-a11y asks for would be inert. */

import React from 'react'
import { Document, Page, View, Text, Image, StyleSheet } from '@react-pdf/renderer'
import type { SiteBranding } from '@/lib/pageConfig'
import type { SchoolProfile } from '@/lib/schoolProfile'
import { formatSchoolAddress } from '@/lib/schoolProfile'

// Formal certificate letterhead + signature block + QR footer. Mirrors the fee
// StatementShell pattern but laid out for prescribed school documents: a centred
// institutional header (name / affiliation / address), an underlined title, a
// body slot, a principal signature + seal block, and the certificate number with
// a verification QR in the footer.

const INK = '#1F2937'
const MUTED = '#6B7280'
const LINE = '#D1D5DB'
const GOLD = '#A8896B'

export const certStyles = StyleSheet.create({
  page: { paddingTop: 36, paddingBottom: 72, paddingHorizontal: 44, fontSize: 11, color: INK, fontFamily: 'Times-Roman' },
  frame: { borderWidth: 2, borderColor: GOLD, borderRadius: 4, padding: 18, flexGrow: 1 },
  innerFrame: { borderWidth: 0.75, borderColor: LINE, borderRadius: 2, padding: 18, flexGrow: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: 1.5, borderBottomColor: INK, paddingBottom: 10, marginBottom: 6 },
  logo: { width: 52, height: 52, objectFit: 'contain' },
  school: { fontSize: 19, fontFamily: 'Times-Bold', color: INK, textAlign: 'center' },
  tagline: { fontSize: 9, color: MUTED, marginTop: 2, textAlign: 'center' },
  instLine: { fontSize: 8.5, color: MUTED, marginTop: 2, textAlign: 'center' },
  titleWrap: { alignItems: 'center', marginTop: 18, marginBottom: 14 },
  title: { fontSize: 15, fontFamily: 'Times-Bold', textTransform: 'uppercase', letterSpacing: 2, borderBottomWidth: 1.5, borderBottomColor: INK, paddingBottom: 3 },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 14 },
  meta: { fontSize: 10, fontFamily: 'Times-Bold' },
  // Body primitives
  para: { fontSize: 12, lineHeight: 1.8, marginBottom: 10, textAlign: 'justify' },
  fieldRow: { flexDirection: 'row', marginBottom: 6, alignItems: 'flex-start' },
  fieldNo: { width: 20, fontSize: 10.5, color: MUTED },
  fieldLabel: { width: 200, fontSize: 10.5, color: INK },
  fieldValue: { flex: 1, fontSize: 10.5, fontFamily: 'Times-Bold', borderBottomWidth: 0.5, borderBottomColor: LINE, paddingBottom: 1 },
  // Tables
  tHead: { flexDirection: 'row', backgroundColor: INK, color: '#fff', paddingVertical: 6, paddingHorizontal: 6 },
  tRow: { flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: '#E5E7EB', paddingVertical: 5, paddingHorizontal: 6 },
  th: { fontSize: 9, fontFamily: 'Times-Bold', textTransform: 'uppercase', letterSpacing: 0.4 },
  td: { fontSize: 10 },
  // Signature
  signRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 40 },
  signBox: { width: 180, alignItems: 'center' },
  seal: { width: 64, height: 64, objectFit: 'contain', marginBottom: 4 },
  signLine: { fontSize: 9.5, color: INK, borderTopWidth: 1, borderTopColor: INK, paddingTop: 4, width: 170, textAlign: 'center' },
  // Footer
  footer: { position: 'absolute', bottom: 24, left: 44, right: 44, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', borderTopWidth: 0.75, borderTopColor: LINE, paddingTop: 6 },
  footText: { fontSize: 7.5, color: MUTED, maxWidth: 360 },
  qr: { width: 56, height: 56 },
})

export interface CertShellProps {
  branding: SiteBranding
  school: SchoolProfile
  title: string
  certificateNo?: string
  issueDate?: string          // already-formatted display string
  qrDataUrl?: string
  verifyUrl?: string
  /** Override the right-hand signature caption (defaults to "Principal"). */
  signatory?: string
  children: React.ReactNode
}

/** Shared certificate letterhead every document composes. */
export function CertificateShell({
  branding, school, title, certificateNo, issueDate, qrDataUrl, verifyUrl, signatory, children,
}: CertShellProps) {
  const address = formatSchoolAddress(school)
  const instBits = [
    school.affiliation_no ? `Affiliation No: ${school.affiliation_no}` : null,
    school.school_code ? `School Code: ${school.school_code}` : null,
    school.recognition_no ? `Recognition No: ${school.recognition_no}` : null,
  ].filter(Boolean).join('   |   ')
  const contactBits = [school.phone, school.email, school.website].filter(Boolean).join('   |   ')

  return (
    <Document title={title} author={branding.schoolName}>
      <Page size="A4" style={certStyles.page}>
        <View style={certStyles.frame}>
          <View style={certStyles.innerFrame}>
            <View style={certStyles.header}>
              {branding.logoUrl ? <Image src={branding.logoUrl} style={certStyles.logo} /> : null}
              <View style={{ flex: 1 }}>
                <Text style={certStyles.school}>{branding.schoolName}</Text>
                {branding.tagline ? <Text style={certStyles.tagline}>{branding.tagline}</Text> : null}
                {address ? <Text style={certStyles.instLine}>{address}</Text> : null}
                {instBits ? <Text style={certStyles.instLine}>{instBits}</Text> : null}
                {contactBits ? <Text style={certStyles.instLine}>{contactBits}</Text> : null}
              </View>
              {branding.logoUrl ? <View style={{ width: 52 }} /> : null}
            </View>

            <View style={certStyles.titleWrap}>
              <Text style={certStyles.title}>{title}</Text>
            </View>

            <View style={certStyles.metaRow}>
              <Text style={certStyles.meta}>No: {certificateNo || '—'}</Text>
              <Text style={certStyles.meta}>Date: {issueDate || '—'}</Text>
            </View>

            <View style={{ flexGrow: 1 }}>{children}</View>

            <View style={certStyles.signRow}>
              <View style={certStyles.signBox}>
                <Text style={certStyles.signLine}>Class Teacher</Text>
              </View>
              <View style={certStyles.signBox}>
                {school.seal_url ? <Image src={school.seal_url} style={certStyles.seal} /> : null}
                <Text style={certStyles.signLine}>
                  {school.principal_name ? `${school.principal_name}\n${signatory ?? 'Principal'}` : signatory ?? 'Principal'}
                </Text>
              </View>
            </View>
          </View>
        </View>

        <View style={certStyles.footer} fixed>
          <Text style={certStyles.footText}>
            {certificateNo ? `Certificate No: ${certificateNo}. ` : ''}
            {verifyUrl ? `Verify the authenticity of this document at ${verifyUrl}` : 'This is a digitally issued document.'}
          </Text>
          {qrDataUrl ? <Image src={qrDataUrl} style={certStyles.qr} /> : null}
        </View>
      </Page>
    </Document>
  )
}

// ---- Body primitives shared by the document components ----------------------

/** A numbered "label .......... value" row used by the CBSE field grids. */
export function Field({ no, label, value }: { no?: number; label: string; value?: string }) {
  return (
    <View style={certStyles.fieldRow}>
      {no != null ? <Text style={certStyles.fieldNo}>{no}.</Text> : null}
      <Text style={certStyles.fieldLabel}>{label}</Text>
      <Text style={certStyles.fieldValue}>{value || '—'}</Text>
    </View>
  )
}

export interface CertCol { key: string; label: string; flex: number; align?: 'left' | 'right' | 'center' }

export function CertTable({ cols, rows }: { cols: CertCol[]; rows: Record<string, string>[] }) {
  return (
    <View>
      <View style={certStyles.tHead}>
        {cols.map(c => (
          <Text key={c.key} style={[certStyles.th, { flex: c.flex, textAlign: c.align ?? 'left' }]}>{c.label}</Text>
        ))}
      </View>
      {rows.map((r, i) => (
        <View key={i} style={certStyles.tRow}>
          {cols.map(c => (
            <Text key={c.key} style={[certStyles.td, { flex: c.flex, textAlign: c.align ?? 'left' }]}>{r[c.key] ?? ''}</Text>
          ))}
        </View>
      ))}
    </View>
  )
}
