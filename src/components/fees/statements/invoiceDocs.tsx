'use client'

// ─────────────────────────────────────────────────────────────────────────────
// The bill and the receipt, as real documents.
//
// Both carry a verification QR. That is the point of the whole thing: a parent,
// a bank or an auditor can scan the paper and get the school's own answer
// without a login, and the answer re-computes the receipt's hash rather than
// only checking a row exists — so an altered record reads ALTERED.
//
// Two receipt layouts: A4 for filing, and 58 mm for the thermal printer at the
// counter. The thermal one is a separate Document rather than a CSS variant
// because a shrunk A4 is unreadable on a shop-style slip.
// ─────────────────────────────────────────────────────────────────────────────

import React from 'react'
import { Document, Page, View, Text, Image, StyleSheet } from '@react-pdf/renderer'
import type { SiteBranding } from '@/lib/pageConfig'
import { pdfINR, fmtDate, styles, type StudentLike } from './StatementShell'
import { amountInWords } from '@/lib/fees/engine/words'

const INK = '#27272A'
const MUTED = '#71717A'
const LINE = '#E4E4E7'

export interface InvoiceDocLine {
  label: string
  amount: number
  kind: string
}

export interface InvoiceDocData {
  number: string
  issue_date: string
  due_date: string
  gross: number
  discount_total: number
  late_fee_total: number
  fine_total: number
  net: number
  paid: number
  balance: number
  status: string
  lines: InvoiceDocLine[]
  /** Data URL of the QR pointing at /verify/receipt/<token>. */
  qr?: string | null
  verifyUrl?: string
}

export interface ReceiptDocData {
  receipt_no: string
  paid_on: string
  method: string
  amount: number
  reference?: string | null
  status: string
  collected_by_name?: string | null
  /** Which bills this settled, and by how much. */
  against: { number: string; amount: number }[]
  qr?: string | null
  verifyUrl?: string
}

function Letterhead({ branding, title }: { branding: SiteBranding; title: string }) {
  return (
    <>
      <View style={styles.header}>
        {branding.logoUrl ? <Image src={branding.logoUrl} style={styles.logo} /> : null}
        <View>
          <Text style={styles.school}>{branding.schoolName}</Text>
            {branding.tagline ? <Text style={styles.tagline}>{branding.tagline}</Text> : null}
        </View>
      </View>
      <View style={styles.titleBar}>
        <Text style={styles.title}>{title}</Text>
      </View>
    </>
  )
}

const extra = StyleSheet.create({
  qrBox: { alignItems: 'center', marginTop: 18 },
  qr: { width: 78, height: 78 },
  qrNote: { fontSize: 7.5, color: MUTED, marginTop: 4, textAlign: 'center', maxWidth: 200 },
  words: { marginTop: 10, padding: 8, backgroundColor: '#FAFAFA', borderWidth: 1, borderColor: LINE, borderRadius: 3 },
  wordsLabel: { fontSize: 7.5, color: MUTED, textTransform: 'uppercase', letterSpacing: 0.6 },
  wordsValue: { fontSize: 9.5, fontFamily: 'Helvetica-Bold', marginTop: 2 },
  stamp: { marginTop: 14, alignSelf: 'flex-start', paddingVertical: 3, paddingHorizontal: 8, borderWidth: 1.5, borderRadius: 3, fontSize: 10, fontFamily: 'Helvetica-Bold', letterSpacing: 1 },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  // 58 mm thermal roll. 164pt wide; the height grows with the content.
  slip: { width: 164, paddingHorizontal: 8, paddingVertical: 10, fontSize: 7.5, fontFamily: 'Helvetica', color: INK },
  slipCentre: { textAlign: 'center' },
  slipRule: { borderBottomWidth: 0.7, borderBottomColor: '#999', borderBottomStyle: 'dashed', marginVertical: 5 },
  slipRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 1.5 },
  slipQr: { width: 62, height: 62, alignSelf: 'center', marginTop: 6 },
})

/** The bill. Line items, amount in words, and a QR anyone can scan. */
export function InvoiceDoc({
  branding, student, invoice, yearCode,
}: {
  branding: SiteBranding
  student?: StudentLike
  invoice: InvoiceDocData
  yearCode: string
}) {
  const cancelled = invoice.status === 'cancelled'
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Letterhead branding={branding} title="Fee Invoice" />

        <View style={styles.infoGrid}>
          <View style={styles.infoCell}>
            <Text style={styles.infoLabel}>Invoice</Text>
            <Text style={styles.infoValue}>{invoice.number}</Text>
          </View>
          <View style={styles.infoCell}>
            <Text style={styles.infoLabel}>Session</Text>
            <Text style={styles.infoValue}>{yearCode}</Text>
          </View>
          <View style={styles.infoCell}>
            <Text style={styles.infoLabel}>Student</Text>
            <Text style={styles.infoValue}>{student?.full_name ?? '—'}</Text>
          </View>
          <View style={styles.infoCell}>
            <Text style={styles.infoLabel}>Class</Text>
            <Text style={styles.infoValue}>
              {student?.grade ?? '—'}{student?.section ? ` ${student.section}` : ''}
            </Text>
          </View>
          <View style={styles.infoCell}>
            <Text style={styles.infoLabel}>Issued</Text>
            <Text style={styles.infoValue}>{fmtDate(invoice.issue_date)}</Text>
          </View>
          <View style={styles.infoCell}>
            <Text style={styles.infoLabel}>Due</Text>
            <Text style={styles.infoValue}>{fmtDate(invoice.due_date)}</Text>
          </View>
        </View>

        <View style={styles.tHead}>
          <Text style={[styles.th, { flex: 5 }]}>Particulars</Text>
          <Text style={[styles.th, { flex: 2, textAlign: 'right' }]}>Amount</Text>
        </View>
        {invoice.lines.map((l, i) => (
          <View key={i} style={styles.tRow}>
            <Text style={[styles.td, { flex: 5 }]}>{l.label}</Text>
            <Text style={[styles.td, { flex: 2, textAlign: 'right' }]}>{pdfINR(l.amount)}</Text>
          </View>
        ))}

        <View style={styles.tTotal}>
          <Text style={[styles.th, { flex: 5, color: INK }]}>Total payable</Text>
          <Text style={[styles.th, { flex: 2, textAlign: 'right', color: INK }]}>
            {pdfINR(invoice.net)}
          </Text>
        </View>

        {invoice.paid > 0 && (
          <>
            <View style={extra.row}>
              <Text style={{ fontSize: 9, color: MUTED }}>Already paid</Text>
              <Text style={{ fontSize: 9 }}>{pdfINR(invoice.paid)}</Text>
            </View>
            <View style={extra.row}>
              <Text style={{ fontSize: 10, fontFamily: 'Helvetica-Bold' }}>Balance due</Text>
              <Text style={{ fontSize: 10, fontFamily: 'Helvetica-Bold' }}>{pdfINR(invoice.balance)}</Text>
            </View>
          </>
        )}

        <View style={extra.words}>
          <Text style={extra.wordsLabel}>Amount in words</Text>
          <Text style={extra.wordsValue}>
            {amountInWords(Math.round((invoice.balance > 0 ? invoice.balance : invoice.net) * 100))}
          </Text>
        </View>

        {cancelled && (
          <Text style={[extra.stamp, { color: '#b91c1c', borderColor: '#b91c1c' }]}>CANCELLED</Text>
        )}

        {invoice.qr ? (
          <View style={extra.qrBox}>
            <Image src={invoice.qr} style={extra.qr} />
            <Text style={extra.qrNote}>
              Scan to verify this bill against the school&apos;s records. No login needed.
            </Text>
            {invoice.verifyUrl ? (
              <Text style={[extra.qrNote, { fontSize: 6.5 }]}>{invoice.verifyUrl}</Text>
            ) : null}
          </View>
        ) : null}
      </Page>
    </Document>
  )
}

/** The A4 receipt, for filing. */
export function ReceiptDoc({
  branding, student, receipt, yearCode,
}: {
  branding: SiteBranding
  student?: StudentLike
  receipt: ReceiptDocData
  yearCode: string
}) {
  const reversed = receipt.status === 'reversed'
  const pending = receipt.status === 'pending'
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Letterhead branding={branding} title="Fee Receipt" />

        <View style={styles.infoGrid}>
          <View style={styles.infoCell}>
            <Text style={styles.infoLabel}>Receipt</Text>
            <Text style={styles.infoValue}>{receipt.receipt_no}</Text>
          </View>
          <View style={styles.infoCell}>
            <Text style={styles.infoLabel}>Session</Text>
            <Text style={styles.infoValue}>{yearCode}</Text>
          </View>
          <View style={styles.infoCell}>
            <Text style={styles.infoLabel}>Student</Text>
            <Text style={styles.infoValue}>{student?.full_name ?? '—'}</Text>
          </View>
          <View style={styles.infoCell}>
            <Text style={styles.infoLabel}>Received</Text>
            <Text style={styles.infoValue}>{fmtDate(receipt.paid_on)}</Text>
          </View>
          <View style={styles.infoCell}>
            <Text style={styles.infoLabel}>Method</Text>
            <Text style={styles.infoValue}>{receipt.method}</Text>
          </View>
          <View style={styles.infoCell}>
            <Text style={styles.infoLabel}>Reference</Text>
            <Text style={styles.infoValue}>{receipt.reference || '—'}</Text>
          </View>
        </View>

        {receipt.against.length > 0 && (
          <>
            <View style={styles.tHead}>
              <Text style={[styles.th, { flex: 5 }]}>Applied to</Text>
              <Text style={[styles.th, { flex: 2, textAlign: 'right' }]}>Amount</Text>
            </View>
            {receipt.against.map((a, i) => (
              <View key={i} style={styles.tRow}>
                <Text style={[styles.td, { flex: 5 }]}>{a.number}</Text>
                <Text style={[styles.td, { flex: 2, textAlign: 'right' }]}>{pdfINR(a.amount)}</Text>
              </View>
            ))}
          </>
        )}

        <View style={styles.tTotal}>
          <Text style={[styles.th, { flex: 5, color: INK }]}>Received</Text>
          <Text style={[styles.th, { flex: 2, textAlign: 'right', color: INK }]}>
            {pdfINR(receipt.amount)}
          </Text>
        </View>

        <View style={extra.words}>
          <Text style={extra.wordsLabel}>Amount in words</Text>
          <Text style={extra.wordsValue}>{amountInWords(Math.round(receipt.amount * 100))}</Text>
        </View>

        {reversed && (
          <Text style={[extra.stamp, { color: '#b91c1c', borderColor: '#b91c1c' }]}>REVERSED</Text>
        )}
        {pending && (
          <Text style={[extra.stamp, { color: '#a16207', borderColor: '#a16207' }]}>
            SUBJECT TO REALISATION
          </Text>
        )}

        {receipt.collected_by_name ? (
          <Text style={{ fontSize: 8.5, color: MUTED, marginTop: 12 }}>
            Received by {receipt.collected_by_name}
          </Text>
        ) : null}

        {receipt.qr ? (
          <View style={extra.qrBox}>
            <Image src={receipt.qr} style={extra.qr} />
            <Text style={extra.qrNote}>
              Scan to verify this receipt against the school&apos;s records. No login needed.
            </Text>
          </View>
        ) : null}
      </Page>
    </Document>
  )
}

/**
 * The 58 mm thermal slip.
 *
 * Deliberately terse: a counter slip is read once, standing up, and every line
 * costs paper. Everything a parent needs to challenge it later — the number and
 * the QR — is still on it.
 */
export function ThermalReceiptDoc({
  branding, student, receipt,
}: {
  branding: SiteBranding
  student?: StudentLike
  receipt: ReceiptDocData
}) {
  return (
    <Document>
      {/* Height grows with content; 164pt is 58 mm at 72dpi. */}
      <Page size={[164, 340]} style={extra.slip}>
        <Text style={[extra.slipCentre, { fontSize: 9, fontFamily: 'Helvetica-Bold' }]}>
          {branding.schoolName}
        </Text>
        {branding.tagline ? (
          <Text style={[extra.slipCentre, { fontSize: 6.5, color: MUTED }]}>{branding.tagline}</Text>
        ) : null}
        <Text style={[extra.slipCentre, { fontSize: 7, marginTop: 3, letterSpacing: 1 }]}>
          FEE RECEIPT
        </Text>

        <View style={extra.slipRule} />

        <View style={extra.slipRow}>
          <Text>No.</Text><Text style={{ fontFamily: 'Helvetica-Bold' }}>{receipt.receipt_no}</Text>
        </View>
        <View style={extra.slipRow}>
          <Text>Date</Text><Text>{fmtDate(receipt.paid_on)}</Text>
        </View>
        <View style={extra.slipRow}>
          <Text>Student</Text>
          <Text style={{ maxWidth: 92, textAlign: 'right' }}>{student?.full_name ?? '—'}</Text>
        </View>
        <View style={extra.slipRow}>
          <Text>Mode</Text><Text>{receipt.method}</Text>
        </View>

        <View style={extra.slipRule} />

        {receipt.against.map((a, i) => (
          <View key={i} style={extra.slipRow}>
            <Text style={{ maxWidth: 86 }}>{a.number}</Text>
            <Text>{pdfINR(a.amount)}</Text>
          </View>
        ))}

        <View style={extra.slipRule} />

        <View style={extra.slipRow}>
          <Text style={{ fontFamily: 'Helvetica-Bold', fontSize: 8.5 }}>PAID</Text>
          <Text style={{ fontFamily: 'Helvetica-Bold', fontSize: 8.5 }}>{pdfINR(receipt.amount)}</Text>
        </View>
        <Text style={{ fontSize: 6.5, color: MUTED, marginTop: 2 }}>
          {amountInWords(Math.round(receipt.amount * 100))}
        </Text>

        {receipt.status === 'pending' && (
          <Text style={[extra.slipCentre, { fontSize: 7, marginTop: 4, fontFamily: 'Helvetica-Bold' }]}>
            SUBJECT TO REALISATION
          </Text>
        )}
        {receipt.status === 'reversed' && (
          <Text style={[extra.slipCentre, { fontSize: 8, marginTop: 4, fontFamily: 'Helvetica-Bold', color: '#b91c1c' }]}>
            *** REVERSED ***
          </Text>
        )}

        {receipt.qr ? <Image src={receipt.qr} style={extra.slipQr} /> : null}
        <Text style={[extra.slipCentre, { fontSize: 6, color: MUTED, marginTop: 3 }]}>
          Scan to verify
        </Text>
      </Page>
    </Document>
  )
}
