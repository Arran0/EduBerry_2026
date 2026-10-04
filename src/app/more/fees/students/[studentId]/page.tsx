'use client'

// ─────────────────────────────────────────────────────────────────────────────
// One student's money story.
//
// The summary strip answers the question a parent actually asks at the counter
// — what do I owe — and the bills and receipts below hold the evidence for it.
// Those two are the page, because they are what the counter is looking at while
// somebody stands in front of it.
//
// Four more views exist and are each a button: the ledger (the authoritative
// one — every debit and credit in order with a running balance, which is what
// the reports are computed from), the cheques being held, the concessions that
// came off a bill and the fines and late fees added to one. They were six tabs,
// which meant the answer to "what do I owe" arrived with five folders stacked
// on top of it.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import {
  BadgePercent, Clock, Download, FileText, Landmark, Loader2, Printer, Receipt,
  Scale, ScrollText, Undo2, User,
} from 'lucide-react'
import ModalShell from '@/components/ui/ModalShell'
import ProtectedLayout from '@/components/ProtectedLayout'
import { AcademicYearProvider, useAcademicYear } from '@/contexts/AcademicYearContext'
import { useFeePermissions } from '@/hooks/useFeePermissions'
import { ADMIN, INVOICE_CHIP, INVOICE_LABEL, fmtDate, inr } from '@/components/fees/ui'
import YearScope from '@/components/fees/config/YearScope'
import { Btn, CELL, Col, FeeScreen, List, ListHead, Row, StatStrip, TAP } from '@/components/fees/shell'
import NoAccess from '@/components/fees/NoAccess'
import { gradeLabel } from '@/lib/grades'
import { supabase } from '@/lib/supabase'
import { buildInvoice, buildReceipt, printSpec } from '@/components/fees/statements/invoiceGenerate'
import { downloadStatement } from '@/components/fees/statements/generate'
import {
  fetchAllocations, fetchInstruments, fetchInvoiceLines, fetchInvoices, fetchLedger,
  fetchPayments, fetchProfile,
  type FeeProfileRow, type InstrumentRow, type InvoiceLineRow, type InvoiceRow,
  type LedgerRow, type PaymentRow,
} from '@/lib/fees/invoices'
import ApplyConcessionSheet from '@/components/fees/concessions/ApplyConcessionSheet'
import RequestRefundSheet from '@/components/fees/reports/RequestRefundSheet'
import {
  fetchConcessions, fetchDiscountTypes, fetchFineCategories, fetchFines,
  fetchLateFeeCharges, fetchScholarships,
  type ConcessionRow, type DiscountTypeRow, type FineCategoryRow, type FineRow,
  type LateFeeChargeRow, type ScholarshipRow,
} from '@/lib/fees/charges'

/**
 * The lists on this page, column by column, once there is a screen wide enough
 * to have columns. A phone gets the card `Row` falls back to.
 */
const BILL_COLS = 'sm:grid-cols-[minmax(0,1fr)_120px_104px_104px_auto]'
const RECEIPT_COLS = 'sm:grid-cols-[minmax(0,1fr)_minmax(0,170px)_112px_104px_auto]'
const CHEQUE_COLS = 'sm:grid-cols-[minmax(0,1fr)_minmax(0,150px)_104px_104px]'
const LEDGER_COLS = 'sm:grid-cols-[96px_minmax(0,1fr)_100px_100px_108px]'
const CONCESSION_COLS = 'sm:grid-cols-[minmax(0,1fr)_112px_132px_108px]'
const CHARGE_COLS = 'sm:grid-cols-[minmax(0,1fr)_112px_minmax(0,140px)_108px]'

/** The four views kept behind a button rather than a tab. */
type Sheet = 'cheques' | 'ledger' | 'concessions' | 'charges'

const SHEETS: { key: Sheet; label: string; icon: React.ElementType; blurb: string }[] = [
  { key: 'ledger',      label: 'Ledger',            icon: ScrollText,
    blurb: 'Every debit and credit in order, with a running balance' },
  { key: 'cheques',     label: 'Cheques',           icon: Landmark,
    blurb: 'What the school is holding for this student' },
  { key: 'concessions', label: 'Concessions',       icon: BadgePercent,
    blurb: 'What has come off a bill, and who approved it' },
  { key: 'charges',     label: 'Fines & late fees', icon: Receipt,
    blurb: 'What has been added to a bill since it was issued' },
]

interface Student {
  id: string; full_name: string; grade: number | null; section: string | null
  admission_no: string | null; guardian_phone: string | null
}

function ProfileInner() {
  const params = useParams<{ studentId: string }>()
  const studentId = String(params?.studentId ?? '')
  const { year } = useAcademicYear()
  const perms = useFeePermissions()

  const [student, setStudent] = useState<Student | null>(null)
  const [profile, setProfile] = useState<FeeProfileRow | null>(null)
  const [invoices, setInvoices] = useState<InvoiceRow[]>([])
  const [lines, setLines] = useState<InvoiceLineRow[]>([])
  const [payments, setPayments] = useState<PaymentRow[]>([])
  const [allocations, setAllocations] = useState<{ payment_id: string; invoice_id: string; amount: number }[]>([])
  const [instruments, setInstruments] = useState<InstrumentRow[]>([])
  const [ledger, setLedger] = useState<LedgerRow[]>([])
  const [concessions, setConcessions] = useState<ConcessionRow[]>([])
  const [discountTypes, setDiscountTypes] = useState<DiscountTypeRow[]>([])
  const [scholarships, setScholarships] = useState<ScholarshipRow[]>([])
  const [fines, setFines] = useState<FineRow[]>([])
  const [fineCategories, setFineCategories] = useState<FineCategoryRow[]>([])
  const [lateFees, setLateFees] = useState<LateFeeChargeRow[]>([])
  const [sheet, setSheet] = useState<Sheet | null>(null)
  const [applying, setApplying] = useState(false)
  const [refunding, setRefunding] = useState(false)
  const [loading, setLoading] = useState(true)

  const showAmounts = !perms.amountsHidden

  const load = useCallback(async () => {
    if (!year || !studentId) return
    setLoading(true)
    try {
      const [{ data: p }, { data: d }] = await Promise.all([
        supabase.from('profiles').select('id, full_name, grade, section').eq('id', studentId).maybeSingle(),
        supabase.from('student_details').select('admission_no, guardian_phone').eq('student_id', studentId).maybeSingle(),
      ])
      if (p) {
        setStudent({
          id: p.id as string,
          full_name: p.full_name as string,
          grade: p.grade as number | null,
          section: p.section as string | null,
          admission_no: (d?.admission_no as string) ?? null,
          guardian_phone: (d?.guardian_phone as string) ?? null,
        })
      }

      const [prof, inv, pay, instr, led, conc, types, schols, fs, cats] = await Promise.all([
        fetchProfile(studentId, year.id),
        fetchInvoices({ academicYearId: year.id, studentId }),
        fetchPayments({ academicYearId: year.id, studentId }),
        fetchInstruments({ studentId }),
        fetchLedger(studentId, year.id),
        fetchConcessions({ yearId: year.id, studentId }),
        fetchDiscountTypes(year.id),
        fetchScholarships(year.id),
        fetchFines(year.id, studentId),
        fetchFineCategories(),
      ])
      setProfile(prof); setInvoices(inv); setPayments(pay); setInstruments(instr); setLedger(led)
      setConcessions(conc); setDiscountTypes(types); setScholarships(schols)
      setFines(fs); setFineCategories(cats)
      // Three round trips that each need the bills or the payments, and none
      // of which needs another's answer — so they go together rather than one
      // after the next.
      const [ln, alloc, lf] = await Promise.all([
        fetchInvoiceLines(inv.map(i => i.id)),
        fetchAllocations(pay.map(p2 => p2.id)),
        fetchLateFeeCharges(inv.map(i => i.id)),
      ])
      setLines(ln); setAllocations(alloc); setLateFees(lf)
    } finally {
      setLoading(false)
    }
  }, [studentId, year])

  useEffect(() => { void load() }, [load])

  const totals = useMemo(() => {
    const live = invoices.filter(i => i.status !== 'cancelled')
    return {
      billed: live.reduce((a, i) => a + (i.gross ?? 0), 0),
      concessions: live.reduce((a, i) => a + (i.discount_total ?? 0), 0),
      paid: live.reduce((a, i) => a + (i.paid ?? 0), 0),
      due: live.reduce((a, i) => a + (i.balance ?? 0), 0),
    }
  }, [invoices])

  const printReceipt = async (payment: PaymentRow, thermal: boolean) => {
    if (!student || !year || !payment.receipt_no) return
    const against = allocations.filter(a => a.payment_id === payment.id).map(a => ({
      number: invoices.find(i => i.id === a.invoice_id)?.number ?? '—',
      amount: a.amount,
    }))
    const spec = await buildReceipt({
      receipt_no: payment.receipt_no, paid_on: payment.paid_on, method: payment.method,
      amount: payment.amount ?? 0, reference: payment.reference, status: payment.status,
      against, verify_token: payment.receipt_hash ?? payment.id,
    }, student, year.code, thermal)
    if (thermal) await printSpec(spec); else await downloadStatement(spec)
  }

  const printInvoice = async (invoice: InvoiceRow) => {
    if (!student || !year) return
    const spec = await buildInvoice({
      number: invoice.number, issue_date: invoice.issue_date, due_date: invoice.due_date,
      gross: invoice.gross ?? 0, discount_total: invoice.discount_total ?? 0,
      late_fee_total: invoice.late_fee_total ?? 0, fine_total: invoice.fine_total ?? 0,
      net: invoice.net ?? 0, paid: invoice.paid ?? 0, balance: invoice.balance ?? 0,
      status: invoice.status,
      lines: lines.filter(l => l.invoice_id === invoice.id)
        .map(l => ({ label: l.label, amount: l.amount, kind: l.kind })),
      verify_token: invoice.verify_token,
    }, student, year.code)
    await downloadStatement(spec)
  }

  if (perms.loading) {
    return <div className="p-10 flex justify-center"><Loader2 className="animate-spin text-[#8C8878]" /></div>
  }
  if (!perms.can('fees.profile.view')) return <NoAccess what="see student fee profiles" />

  return (
    <FeeScreen
      title={student?.full_name ?? 'Student'}
      subtitle={<>
        {student?.grade === null || student?.grade === undefined ? '—' : gradeLabel(student.grade)}
        {student?.section ? ` ${student.section}` : ''}
        {student?.admission_no ? ` · ${student.admission_no}` : ''}
      </>}
      icon={<User size={17} style={{ color: '#B8983C' }} />}
      back={{ href: '/more/fees?tab=collection&section=students', label: 'Student fees' }}
      actions={<>
        {perms.can('fees.collect') && profile && (
          <Btn tone="dark" onClick={() => setRefunding(true)} className="max-sm:py-2">
            <Undo2 size={12} /> Refund
          </Btn>
        )}
        <YearScope />
      </>}
    >
      {loading ? (
        <div className={`${ADMIN.card} py-16 flex justify-center`}><Loader2 className="animate-spin text-[#8C8878]" /></div>
      ) : !profile ? (
        <div className={`${ADMIN.card} py-14 px-6 text-center`}>
          <p className="text-sm text-[#6B675A] max-w-md mx-auto">
            This student has no fee profile for {year?.code}. Nothing can be billed or collected
            until they do — create one from the{' '}
            <Link href="/more/fees?tab=collection&section=students" className="underline">Students screen</Link>.
          </p>
        </div>
      ) : (
        // The gutter the rest of the module gets on phones. Without it the
        // summary strip's full-bleed negative margin had nothing to cancel and
        // hung 12px off both edges of the screen, which is a horizontal scroll
        // on a page that has nothing to scroll sideways to.
        <div className="px-3 sm:px-0 space-y-2.5">
          <StatStrip stats={[
            { label: 'Billed', value: inr(totals.billed, showAmounts) },
            { label: 'Concessions', value: inr(totals.concessions, showAmounts) },
            { label: 'Paid', value: inr(totals.paid, showAmounts) },
            { label: 'Still due', value: inr(totals.due, showAmounts),
              tone: totals.due > 0 ? '#7A6220' : undefined, strong: true },
          ]} />

          {profile.structure_source && (
            <div className={`${ADMIN.card} px-4 py-3 flex items-start gap-2`}>
              <Scale size={14} className="mt-0.5 text-[#8C8878] flex-shrink-0" />
              <p className="text-xs text-[#6B675A]">
                <span className="font-semibold text-[#52525B]">Why this price: </span>
                {profile.structure_source.why}
                {profile.prorate_from
                  ? ` Charged only from ${fmtDate(profile.prorate_from)}, as a mid-year joiner.`
                  : ''}
              </p>
            </div>
          )}

          <div className="flex flex-wrap gap-1.5">
            {SHEETS.map(sh => {
              const Icon = sh.icon
              return (
                <button key={sh.key} onClick={() => setSheet(sh.key)} title={sh.blurb}
                        className={`${ADMIN.ghostBtn} max-sm:py-2`}>
                  <Icon size={13} /> {sh.label}
                </button>
              )
            })}
          </div>

          <Heading icon={FileText}>Bills</Heading>
          {(
            <Panel empty={invoices.length === 0 ? 'No bills issued to this student yet.' : null}>
              {invoices.map(i => (
                <Row key={i.id} cols={BILL_COLS} trailing below={<>
                  <div className="space-y-0.5">
                    {lines.filter(l => l.invoice_id === i.id).map(l => (
                      <div key={l.id} className="flex justify-between gap-3 text-[11px] sm:text-xs">
                        <span className={`truncate ${l.amount < 0 ? 'text-[#1F6B42]' : 'text-[#8C8878]'}`}>
                          {l.label}
                        </span>
                        <span className={`tabular-nums flex-shrink-0 ${l.amount < 0 ? 'text-[#1F6B42]' : 'text-[#6B675A]'}`}>
                          {inr(l.amount, showAmounts)}
                        </span>
                      </div>
                    ))}
                  </div>
                  {i.cancelled_reason && (
                    <p className="text-[11px] sm:text-xs text-[#A93232] mt-1.5">Cancelled: {i.cancelled_reason}</p>
                  )}
                </>}>
                  <span className={`${CELL.A1} font-mono text-[11.5px] sm:text-xs text-[#6B675A] truncate`}>
                    {i.number}
                  </span>
                  <span className={`${CELL.A2} text-[11px] sm:text-xs text-[#8C8878] whitespace-nowrap`}>
                    due {fmtDate(i.due_date)}
                  </span>
                  <span className={CELL.B2}>
                    <span className={`inline-block text-[9.5px] sm:text-[10px] font-bold uppercase tracking-wider px-1.5 sm:px-2 py-0.5 rounded ${INVOICE_CHIP[i.status]}`}>
                      {INVOICE_LABEL[i.status]}
                    </span>
                  </span>
                  <span className={`${CELL.B1} text-[14px] sm:text-sm font-semibold text-[#18181B] text-right tabular-nums`}>
                    {inr(i.net, showAmounts)}
                  </span>
                  <span className={CELL.END}>
                    <button onClick={() => void printInvoice(i)} title="Download the bill"
                            aria-label="Download the bill"
                            className={`${TAP} text-[#8C8878] hover:text-[#18181B]`}>
                      <Download size={14} />
                    </button>
                  </span>
                </Row>
              ))}
            </Panel>
          )}

          <Heading icon={Printer}>Receipts</Heading>
          {(
            <Panel empty={payments.length === 0 ? 'No payments taken from this student yet.' : null}>
              {payments.map(p => (
                <Row key={p.id} cols={RECEIPT_COLS} trailing
                     below={p.reversal_reason ? (
                       <p className="text-[11px] sm:text-xs text-[#A93232]">Reversed: {p.reversal_reason}</p>
                     ) : null}>
                  <span className={`${CELL.A1} font-mono text-[11.5px] sm:text-xs text-[#6B675A] truncate`}>
                    {p.receipt_no ?? '—'}
                  </span>
                  <span className={`${CELL.A2} text-[11px] sm:text-xs text-[#8C8878] truncate`}>
                    {fmtDate(p.paid_on)} · {p.method}
                  </span>
                  <span className={CELL.B2}>
                    {p.status !== 'verified' && (
                      <span className={`inline-block text-[9.5px] sm:text-[10px] font-bold uppercase tracking-wider px-1.5 sm:px-2 py-0.5 rounded ${
                        p.status === 'reversed'
                          ? 'bg-[#FCECEC] text-[#A93232] border border-[#EFCCCC]'
                          : 'bg-[#FAF3DF] text-[#7A6220] border border-[#E7D9AE]'}`}>
                        {p.status === 'reversed' ? 'Reversed' : 'Not cleared'}
                      </span>
                    )}
                  </span>
                  <span className={`${CELL.B1} text-[14px] sm:text-sm font-semibold text-right tabular-nums ${
                    p.status === 'reversed' ? 'text-[#8C8878] line-through' : 'text-[#18181B]'}`}>
                    {inr(p.amount, showAmounts)}
                  </span>
                  <span className={`${CELL.END} flex items-center gap-0.5 sm:gap-1`}>
                    {perms.can('fees.receipt.print') && (
                      <>
                        <button onClick={() => void printReceipt(p, true)} title="Thermal print"
                                aria-label="Print on the thermal printer"
                                className={`${TAP} text-[#8C8878] hover:text-[#18181B]`}><Printer size={14} /></button>
                        <button onClick={() => void printReceipt(p, false)} title="Download A4"
                                aria-label="Download the A4 receipt"
                                className={`${TAP} text-[#8C8878] hover:text-[#18181B]`}><FileText size={14} /></button>
                      </>
                    )}
                  </span>
                </Row>
              ))}
            </Panel>
          )}

          {sheet && (
            <ModalShell
              onClose={() => setSheet(null)}
              sharp size="2xl"
              title={SHEETS.find(x => x.key === sheet)!.label}
              subtitle={SHEETS.find(x => x.key === sheet)!.blurb}
              icon={React.createElement(SHEETS.find(x => x.key === sheet)!.icon, { size: 15 })}
              iconClassName="bg-[#27272A] text-[#B8983C]"
              bodyClassName="bg-[#FDFCF9] !px-3 sm:!px-4 !py-3"
            >
          {sheet === 'cheques' && (
            <Panel empty={instruments.length === 0 ? 'No cheques or drafts from this student.' : null}>
              {instruments.map(r => (
                <Row key={r.id} cols={CHEQUE_COLS}
                     below={r.bounce_reason ? (
                       <p className="text-[11px] sm:text-xs text-[#A93232]">
                         Bounced: {r.bounce_reason}
                         {r.bounce_charge ? ` · ${inr(r.bounce_charge, showAmounts)} charge passed on` : ''}
                       </p>
                     ) : null}>
                  <span className={`${CELL.A1} text-[12.5px] sm:text-sm text-[#18181B] truncate`}>
                    {r.kind === 'dd' ? 'DD' : 'Cheque'} {r.number}
                    {r.bank ? <span className="text-[#8C8878]"> · {r.bank}</span> : null}
                  </span>
                  <span className={`${CELL.A2} text-[11px] sm:text-xs text-[#8C8878]`}>
                    {r.is_postdated && r.present_on && (
                      <span className="inline-flex items-center gap-1">
                        <Clock size={11} /> present {fmtDate(r.present_on)}
                      </span>
                    )}
                  </span>
                  <span className={CELL.B2}>
                    <span className={`inline-block text-[9.5px] sm:text-[10px] font-bold uppercase tracking-wider px-1.5 sm:px-2 py-0.5 rounded ${
                      r.status === 'cleared' ? 'bg-[#EAF5EE] text-[#1F6B42] border border-[#C6E3D2]'
                      : r.status === 'bounced' ? 'bg-[#FCECEC] text-[#A93232] border border-[#EFCCCC]'
                      : 'bg-[#F4F1E7] text-[#6B675A] border border-[#E3DFD3]'}`}>
                      {r.status}
                    </span>
                  </span>
                  <span className={`${CELL.B1} text-[14px] sm:text-sm font-semibold text-[#18181B] text-right tabular-nums`}>
                    {inr(r.amount, showAmounts)}
                  </span>
                </Row>
              ))}
            </Panel>
          )}

          {sheet === 'ledger' && (
            <List className="max-sm:border-x">
              <ListHead cols={LEDGER_COLS}>
                <Col>Date</Col><Col>Entry</Col>
                <Col right>Charged</Col><Col right>Paid</Col><Col right>Balance</Col>
              </ListHead>
              {ledger.length === 0 ? (
                <p className="px-4 py-10 text-sm text-[#8C8878] text-center">Nothing on the ledger yet.</p>
              ) : ledger.map(l => (
                <Row key={l.id} cols={LEDGER_COLS}>
                  <span className={`${CELL.A2} text-[11px] sm:text-xs text-[#8C8878] whitespace-nowrap`}>
                    {fmtDate(l.entry_date)}
                  </span>
                  <span className={`${CELL.A1} text-[12.5px] sm:text-sm text-[#52525B] truncate`}>
                    {l.note ?? l.kind}
                  </span>
                  {/* Charged and paid are the two sides of one entry and an
                      entry is almost always one or the other, so on a phone
                      each takes a line only when it has something to say. */}
                  <span className={`${CELL.B2} text-[11px] sm:text-sm text-right text-[#6B675A] tabular-nums`}>
                    {(l.debit ?? 0) > 0 ? <>{inr(l.debit, showAmounts)}<span className="sm:hidden"> charged</span></> : ''}
                  </span>
                  <span className={`${CELL.B3} text-[11px] sm:text-sm text-right text-[#1F6B42] tabular-nums`}>
                    {(l.credit ?? 0) > 0 ? <>{inr(l.credit, showAmounts)}<span className="sm:hidden"> paid</span></> : ''}
                  </span>
                  <span className={`${CELL.B1} text-[14px] sm:text-sm text-right font-semibold text-[#18181B] tabular-nums`}>
                    {inr(l.balance_after, showAmounts)}
                  </span>
                </Row>
              ))}
            </List>
          )}

          {sheet === 'concessions' && (
            <>
              {perms.can('fees.discount.apply') && (
                <div className="flex justify-end mb-3">
                  <button onClick={() => setApplying(true)} className={ADMIN.ghostBtn}>
                    <BadgePercent size={13} /> Apply a concession
                  </button>
                </div>
              )}
              <List className="max-sm:border-x">
                <ListHead cols={CONCESSION_COLS}>
                  <Col>What</Col><Col>Asked</Col><Col>State</Col><Col right>Amount</Col>
                </ListHead>
                {concessions.length === 0 ? (
                  <p className="px-4 py-10 text-sm text-[#8C8878] text-center">
                    No concessions for this student. Each one, when granted, is a named line on the
                    bill it comes off.
                  </p>
                ) : concessions.map(c => (
                  <Row key={c.id} cols={CONCESSION_COLS}>
                    <span className={`${CELL.A1} min-w-0 text-[12.5px] sm:text-sm text-[#18181B]`}>
                      <span className="block truncate">
                        {discountTypes.find(t => t.id === c.type_id)?.name
                          ?? scholarships.find(s => s.id === c.scholarship_id)?.name
                          ?? (c.kind === 'waiver' ? 'Waiver' : 'Concession')}
                      </span>
                      {c.reason && (
                        <span className="block text-[11px] text-[#8C8878] truncate">{c.reason}</span>
                      )}
                    </span>
                    <span className={`${CELL.A2} text-[11px] sm:text-sm text-[#8C8878] sm:text-[#6B675A] whitespace-nowrap`}>
                      {fmtDate(c.created_at.slice(0, 10))}
                    </span>
                    <span className={CELL.B2}>
                      <span className={`inline-block text-[9.5px] sm:text-[10px] font-bold uppercase tracking-wider px-1.5 sm:px-2 py-0.5 ${
                        c.status === 'applied'
                          ? 'bg-[#EAF5EE] text-[#1F6B42] border border-[#C6E3D2]'
                          : c.status === 'pending'
                            ? 'bg-[#FAF3DF] text-[#7A6220] border border-[#E7D9AE]'
                            : 'bg-[#F4F1E7] text-[#6B675A] border border-[#E3DFD3]'}`}>
                        {c.status === 'applied' ? 'On the bill'
                          : c.status === 'pending' ? 'Waiting'
                          : c.status === 'declined' ? 'Declined' : 'Removed'}
                      </span>
                    </span>
                    <span className={`${CELL.B1} text-[14px] sm:text-sm text-right font-semibold text-[#1F6B42] tabular-nums`}>
                      −{inr(c.amount, showAmounts)}
                    </span>
                  </Row>
                ))}
              </List>
            </>
          )}

          {sheet === 'charges' && (
            <List className="max-sm:border-x">
              <ListHead cols={CHARGE_COLS}>
                <Col>What</Col><Col>When</Col><Col>Bill</Col><Col right>Amount</Col>
              </ListHead>
              {fines.length === 0 && lateFees.length === 0 && (
                <p className="px-4 py-10 text-sm text-[#8C8878] text-center">
                  Nothing has been added to this student&rsquo;s bills since they were issued.
                </p>
              )}
              {fines.map(f => (
                <Row key={f.id} cols={CHARGE_COLS}>
                  <span className={`${CELL.A1} text-[12.5px] sm:text-sm text-[#18181B]`}>
                    <span className="block truncate">
                      {fineCategories.find(c => c.id === f.category_id)?.name ?? 'Fine'}
                    </span>
                    {f.reason && <span className="block text-[11px] text-[#8C8878] truncate">{f.reason}</span>}
                  </span>
                  <span className={`${CELL.A2} text-[11px] sm:text-sm text-[#8C8878] sm:text-[#6B675A] whitespace-nowrap`}>
                    {fmtDate(f.created_at.slice(0, 10))}
                  </span>
                  <span className={`${CELL.B2} font-mono text-[10.5px] sm:text-[11px] text-[#8C8878] sm:text-[#6B675A] truncate`}>
                    {invoices.find(i => i.id === f.invoice_id)?.number ?? '—'}
                  </span>
                  <span className={`${CELL.B1} text-[14px] sm:text-sm text-right font-semibold tabular-nums ${
                    f.status === 'waived' ? 'text-[#8C8878] line-through' : 'text-[#18181B]'}`}>
                    {inr(f.amount, showAmounts)}
                  </span>
                </Row>
              ))}
              {lateFees.map(c => (
                <Row key={c.id} cols={CHARGE_COLS}>
                  <span className={`${CELL.A1} text-[12.5px] sm:text-sm text-[#18181B]`}>
                    <span className="block">Late fee</span>
                    <span className="block text-[11px] text-[#8C8878]">{c.days_late} days past due</span>
                  </span>
                  <span className={`${CELL.A2} text-[11px] sm:text-sm text-[#8C8878] sm:text-[#6B675A] whitespace-nowrap`}>
                    {fmtDate(c.as_of)}
                  </span>
                  <span className={`${CELL.B2} font-mono text-[10.5px] sm:text-[11px] text-[#8C8878] sm:text-[#6B675A] truncate`}>
                    {invoices.find(i => i.id === c.invoice_id)?.number ?? '—'}
                  </span>
                  <span className={`${CELL.B1} text-[14px] sm:text-sm text-right font-semibold tabular-nums ${
                    c.status === 'waived' ? 'text-[#8C8878] line-through' : 'text-[#18181B]'}`}>
                    {inr(c.amount, showAmounts)}
                  </span>
                </Row>
              ))}
            </List>
          )}
            </ModalShell>
          )}
        </div>
      )}


      {applying && year && student && (
        <ApplyConcessionSheet
          yearId={year.id}
          people={[{
            ...(profile ?? {} as FeeProfileRow),
            student_id: student.id,
            full_name: student.full_name,
            grade: student.grade,
            section: student.section,
            admission_no: student.admission_no,
            billed: null, paid: null, outstanding: null,
          }]}
          invoices={invoices}
          types={discountTypes}
          scholarships={scholarships}
          showAmounts={showAmounts}
          canApprove={perms.canAny('fees.discount.approve', 'fees.waiver.approve')}
          fixedStudentId={student.id}
          onClose={() => setApplying(false)}
          onDone={() => { setApplying(false); void load() }}
        />
      )}

      {refunding && year && student && (
        <RequestRefundSheet
          studentId={student.id}
          studentName={student.full_name}
          yearId={year.id}
          payments={payments}
          stillOwing={totals.due}
          showAmounts={showAmounts}
          onClose={() => setRefunding(false)}
          onDone={() => { setRefunding(false); void load() }}
        />
      )}
    </FeeScreen>
  )
}

/** A hairline heading over one of the two lists the page always shows. */
function Heading({ icon: Icon, children }: { icon: React.ElementType; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 border-b border-[#E3DFD3] pb-1.5 pt-1">
      <Icon size={14} className="text-[#B8983C]" />
      <h2 className="text-[11px] font-bold uppercase tracking-[0.1em] text-[#6B675A]">{children}</h2>
    </div>
  )
}

function Panel({ empty, children }: { empty: string | null; children: React.ReactNode }) {
  return (
    <div className={`${ADMIN.card} overflow-hidden`}>
      {empty ? <p className="px-4 py-10 text-sm text-[#8C8878] text-center">{empty}</p> : children}
    </div>
  )
}

export default function FeeProfilePage() {
  return (
    <ProtectedLayout staffOnly>
      <AcademicYearProvider>
        <ProfileInner />
      </AcademicYearProvider>
    </ProtectedLayout>
  )
}
