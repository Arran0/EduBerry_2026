'use client'

// ─────────────────────────────────────────────────────────────────────────────
// One student's money story.
//
// The summary strip answers the question a parent actually asks at the counter
// — what do I owe — and the tabs below hold the evidence for it. The Ledger tab
// is the authoritative one: every debit and credit in order with a running
// balance, which is what the reports are computed from.
//
// The Concessions and Charges tabs show what has come off a bill and what has
// been added to it after issue. Both are also lines on the invoice itself —
// this is the same story told per-student rather than per-bill.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import {
  BadgePercent, Clock, Download, FileText, Loader2, Printer, Scale, Undo2, User,
} from 'lucide-react'
import ProtectedLayout from '@/components/ProtectedLayout'
import { AcademicYearProvider, useAcademicYear } from '@/contexts/AcademicYearContext'
import { useFeePermissions } from '@/hooks/useFeePermissions'
import { ADMIN, INVOICE_CHIP, INVOICE_LABEL, fmtDate, inr } from '@/components/fees/ui'
import YearScope from '@/components/fees/config/YearScope'
import { FeeScreen, StatStrip, Btn } from '@/components/fees/shell'
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

type Tab = 'invoices' | 'payments' | 'cheques' | 'ledger' | 'concessions' | 'charges'

const TABS: { key: Tab; label: string }[] = [
  { key: 'invoices',    label: 'Bills' },
  { key: 'payments',    label: 'Payments' },
  { key: 'cheques',     label: 'Cheques' },
  { key: 'ledger',      label: 'Ledger' },
  { key: 'concessions', label: 'Concessions' },
  { key: 'charges',     label: 'Fines & late fees' },
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
  const [tab, setTab] = useState<Tab>('invoices')
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
      setLines(await fetchInvoiceLines(inv.map(i => i.id)))
      setAllocations(await fetchAllocations(pay.map(p2 => p2.id)))
      setLateFees(await fetchLateFeeCharges(inv.map(i => i.id)))
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
          <Btn tone="dark" onClick={() => setRefunding(true)}>
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
        <>
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

          <div className="flex gap-1 border-b border-[#E3DFD3] overflow-x-auto">
            {TABS.map(t => (
              <button key={t.key} onClick={() => setTab(t.key)}
                      className={`px-3.5 py-2 text-xs font-semibold whitespace-nowrap border-b-2 -mb-px transition-colors ${
                        tab === t.key
                          ? 'border-[#27272A] text-[#18181B]'
                          : 'border-transparent text-[#8C8878] hover:text-[#6B675A]'}`}>
                {t.label}
              </button>
            ))}
          </div>

          {tab === 'invoices' && (
            <Panel empty={invoices.length === 0 ? 'No bills issued to this student yet.' : null}>
              {invoices.map(i => (
                <div key={i.id} className="px-4 py-3 border-b border-[#F0ECE2] last:border-0">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="font-mono text-xs text-[#6B675A] flex-1 min-w-[150px]">{i.number}</span>
                    <span className="text-xs text-[#8C8878]">due {fmtDate(i.due_date)}</span>
                    <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${INVOICE_CHIP[i.status]}`}>
                      {INVOICE_LABEL[i.status]}
                    </span>
                    <span className="text-sm font-semibold text-[#18181B] w-24 text-right">
                      {inr(i.net, showAmounts)}
                    </span>
                    <button onClick={() => void printInvoice(i)} title="Download the bill"
                            className="p-1.5 text-[#8C8878] hover:text-[#18181B]">
                      <Download size={14} />
                    </button>
                  </div>
                  <div className="mt-1.5 pl-1 space-y-0.5">
                    {lines.filter(l => l.invoice_id === i.id).map(l => (
                      <div key={l.id} className="flex justify-between text-xs">
                        <span className={l.amount < 0 ? 'text-[#1F6B42]' : 'text-[#8C8878]'}>
                          {l.label}
                        </span>
                        <span className={l.amount < 0 ? 'text-[#1F6B42]' : 'text-[#6B675A]'}>
                          {inr(l.amount, showAmounts)}
                        </span>
                      </div>
                    ))}
                  </div>
                  {i.cancelled_reason && (
                    <p className="text-xs text-[#A93232] mt-1.5">Cancelled: {i.cancelled_reason}</p>
                  )}
                </div>
              ))}
            </Panel>
          )}

          {tab === 'payments' && (
            <Panel empty={payments.length === 0 ? 'No payments taken from this student yet.' : null}>
              {payments.map(p => (
                <div key={p.id} className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-[#F0ECE2] last:border-0">
                  <span className="font-mono text-xs text-[#6B675A] flex-1 min-w-[150px]">
                    {p.receipt_no ?? '—'}
                  </span>
                  <span className="text-xs text-[#8C8878]">{fmtDate(p.paid_on)} · {p.method}</span>
                  {p.status !== 'verified' && (
                    <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${
                      p.status === 'reversed'
                        ? 'bg-[#FCECEC] text-[#A93232] border border-[#EFCCCC]'
                        : 'bg-[#FAF3DF] text-[#7A6220] border border-[#E7D9AE]'}`}>
                      {p.status === 'reversed' ? 'Reversed' : 'Not cleared'}
                    </span>
                  )}
                  <span className={`text-sm font-semibold w-24 text-right ${
                    p.status === 'reversed' ? 'text-[#8C8878] line-through' : 'text-[#18181B]'}`}>
                    {inr(p.amount, showAmounts)}
                  </span>
                  {perms.can('fees.receipt.print') && (
                    <>
                      <button onClick={() => void printReceipt(p, true)} title="Thermal print"
                              className="p-1.5 text-[#8C8878] hover:text-[#18181B]"><Printer size={14} /></button>
                      <button onClick={() => void printReceipt(p, false)} title="Download A4"
                              className="p-1.5 text-[#8C8878] hover:text-[#18181B]"><FileText size={14} /></button>
                    </>
                  )}
                  {p.reversal_reason && (
                    <p className="w-full text-xs text-[#A93232]">Reversed: {p.reversal_reason}</p>
                  )}
                </div>
              ))}
            </Panel>
          )}

          {tab === 'cheques' && (
            <Panel empty={instruments.length === 0 ? 'No cheques or drafts from this student.' : null}>
              {instruments.map(r => (
                <div key={r.id} className="px-4 py-3 border-b border-[#F0ECE2] last:border-0">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="text-sm text-[#18181B] flex-1 min-w-[150px]">
                      {r.kind === 'dd' ? 'DD' : 'Cheque'} {r.number}
                      {r.bank ? <span className="text-[#8C8878]"> · {r.bank}</span> : null}
                    </span>
                    {r.is_postdated && r.present_on && (
                      <span className="text-xs text-[#8C8878] inline-flex items-center gap-1">
                        <Clock size={11} /> present {fmtDate(r.present_on)}
                      </span>
                    )}
                    <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${
                      r.status === 'cleared' ? 'bg-[#EAF5EE] text-[#1F6B42] border border-[#C6E3D2]'
                      : r.status === 'bounced' ? 'bg-[#FCECEC] text-[#A93232] border border-[#EFCCCC]'
                      : 'bg-[#F4F1E7] text-[#6B675A] border border-[#E3DFD3]'}`}>
                      {r.status}
                    </span>
                    <span className="text-sm font-semibold text-[#18181B] w-24 text-right">
                      {inr(r.amount, showAmounts)}
                    </span>
                  </div>
                  {r.bounce_reason && (
                    <p className="text-xs text-[#A93232] mt-1">
                      Bounced: {r.bounce_reason}
                      {r.bounce_charge ? ` · ${inr(r.bounce_charge, showAmounts)} charge passed on` : ''}
                    </p>
                  )}
                </div>
              ))}
            </Panel>
          )}

          {tab === 'ledger' && (
            <Panel empty={ledger.length === 0 ? 'Nothing on the ledger yet.' : null}>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-[#FAF8F2] border-b border-[#E3DFD3]">
                      <th className="text-left px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-[#6B675A]">Date</th>
                      <th className="text-left px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-[#6B675A]">Entry</th>
                      <th className="text-right px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-[#6B675A]">Charged</th>
                      <th className="text-right px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-[#6B675A]">Paid</th>
                      <th className="text-right px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-[#6B675A]">Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ledger.map(l => (
                      <tr key={l.id} className="border-b border-[#F0ECE2] last:border-0">
                        <td className="px-4 py-2 text-xs text-[#8C8878] whitespace-nowrap">{fmtDate(l.entry_date)}</td>
                        <td className="px-4 py-2 text-[#52525B]">{l.note ?? l.kind}</td>
                        <td className="px-4 py-2 text-right text-[#6B675A]">
                          {(l.debit ?? 0) > 0 ? inr(l.debit, showAmounts) : ''}
                        </td>
                        <td className="px-4 py-2 text-right text-[#1F6B42]">
                          {(l.credit ?? 0) > 0 ? inr(l.credit, showAmounts) : ''}
                        </td>
                        <td className="px-4 py-2 text-right font-semibold text-[#18181B]">
                          {inr(l.balance_after, showAmounts)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          )}

          {tab === 'concessions' && (
            <>
              {perms.can('fees.discount.apply') && (
                <div className="flex justify-end mb-3">
                  <button onClick={() => setApplying(true)} className={ADMIN.ghostBtn}>
                    <BadgePercent size={13} /> Apply a concession
                  </button>
                </div>
              )}
              <Panel empty={concessions.length === 0
                ? 'No concessions for this student. Each one, when granted, is a named line on the bill it comes off.'
                : null}>
                <table className="w-full text-sm">
                  <thead className="bg-[#FAF8F2] text-[10px] uppercase tracking-widest text-[#8C8878]">
                    <tr>
                      <th className="text-left px-4 py-2 font-bold">What</th>
                      <th className="text-left px-4 py-2 font-bold">Asked</th>
                      <th className="text-left px-4 py-2 font-bold">State</th>
                      <th className="text-right px-4 py-2 font-bold">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {concessions.map(c => (
                      <tr key={c.id} className="border-t border-[#F0ECE2]">
                        <td className="px-4 py-2 text-[#18181B]">
                          {discountTypes.find(t => t.id === c.type_id)?.name
                            ?? scholarships.find(s => s.id === c.scholarship_id)?.name
                            ?? (c.kind === 'waiver' ? 'Waiver' : 'Concession')}
                          {c.reason && (
                            <span className="block text-[11px] text-[#8C8878]">{c.reason}</span>
                          )}
                        </td>
                        <td className="px-4 py-2 text-[#6B675A]">{fmtDate(c.created_at.slice(0, 10))}</td>
                        <td className="px-4 py-2">
                          <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 ${
                            c.status === 'applied'
                              ? 'bg-[#EAF5EE] text-[#1F6B42] border border-[#C6E3D2]'
                              : c.status === 'pending'
                                ? 'bg-[#FAF3DF] text-[#7A6220] border border-[#E7D9AE]'
                                : 'bg-[#F4F1E7] text-[#6B675A] border border-[#E3DFD3]'}`}>
                            {c.status === 'applied' ? 'On the bill'
                              : c.status === 'pending' ? 'Waiting'
                              : c.status === 'declined' ? 'Declined' : 'Removed'}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-right font-semibold text-[#1F6B42]">
                          −{inr(c.amount, showAmounts)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Panel>
            </>
          )}

          {tab === 'charges' && (
            <Panel empty={fines.length === 0 && lateFees.length === 0
              ? 'Nothing has been added to this student’s bills since they were issued.'
              : null}>
              <table className="w-full text-sm">
                <thead className="bg-[#FAF8F2] text-[10px] uppercase tracking-widest text-[#8C8878]">
                  <tr>
                    <th className="text-left px-4 py-2 font-bold">What</th>
                    <th className="text-left px-4 py-2 font-bold">When</th>
                    <th className="text-left px-4 py-2 font-bold">Bill</th>
                    <th className="text-right px-4 py-2 font-bold">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {fines.map(f => (
                    <tr key={f.id} className="border-t border-[#F0ECE2]">
                      <td className="px-4 py-2 text-[#18181B]">
                        {fineCategories.find(c => c.id === f.category_id)?.name ?? 'Fine'}
                        {f.reason && <span className="block text-[11px] text-[#8C8878]">{f.reason}</span>}
                      </td>
                      <td className="px-4 py-2 text-[#6B675A]">{fmtDate(f.created_at.slice(0, 10))}</td>
                      <td className="px-4 py-2 font-mono text-[11px] text-[#6B675A]">
                        {invoices.find(i => i.id === f.invoice_id)?.number ?? '—'}
                      </td>
                      <td className={`px-4 py-2 text-right font-semibold ${
                        f.status === 'waived' ? 'text-[#8C8878] line-through' : 'text-[#18181B]'}`}>
                        {inr(f.amount, showAmounts)}
                      </td>
                    </tr>
                  ))}
                  {lateFees.map(c => (
                    <tr key={c.id} className="border-t border-[#F0ECE2]">
                      <td className="px-4 py-2 text-[#18181B]">
                        Late fee
                        <span className="block text-[11px] text-[#8C8878]">
                          {c.days_late} days past due
                        </span>
                      </td>
                      <td className="px-4 py-2 text-[#6B675A]">{fmtDate(c.as_of)}</td>
                      <td className="px-4 py-2 font-mono text-[11px] text-[#6B675A]">
                        {invoices.find(i => i.id === c.invoice_id)?.number ?? '—'}
                      </td>
                      <td className={`px-4 py-2 text-right font-semibold ${
                        c.status === 'waived' ? 'text-[#8C8878] line-through' : 'text-[#18181B]'}`}>
                        {inr(c.amount, showAmounts)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Panel>
          )}
        </>
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
