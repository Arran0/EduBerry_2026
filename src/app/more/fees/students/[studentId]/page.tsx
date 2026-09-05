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
  ArrowLeft, BadgePercent, Clock, Download, FileText, Loader2, Printer, Receipt,
  Scale, Undo2, User,
} from 'lucide-react'
import ProtectedLayout from '@/components/ProtectedLayout'
import { AcademicYearProvider, useAcademicYear } from '@/contexts/AcademicYearContext'
import { useFeePermissions } from '@/hooks/useFeePermissions'
import { ADMIN, INVOICE_CHIP, INVOICE_LABEL, fmtDate, inr } from '@/components/fees/ui'
import YearScope from '@/components/fees/config/YearScope'
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
    return <div className="p-10 flex justify-center"><Loader2 className="animate-spin text-[#A1A1AA]" /></div>
  }
  if (!perms.can('fees.profile.view')) return <NoAccess what="see student fee profiles" />

  return (
    <div className="min-h-screen bg-[#F5F5F5]">
      <div className="bg-[#27272A] border-b border-[#3F3F46]">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-5 flex items-center gap-4">
          <Link href="/more/fees/students" className="p-1.5 text-zinc-500 hover:text-zinc-300 flex-shrink-0">
            <ArrowLeft size={16} />
          </Link>
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <div className="w-9 h-9 bg-[#3F3F46] flex items-center justify-center flex-shrink-0">
              <User size={16} className="text-[#B8983C]" />
            </div>
            <div className="min-w-0">
              <h1 className="text-base font-bold text-white tracking-tight truncate">
                {student?.full_name ?? 'Student'}
              </h1>
              <p className="text-xs text-zinc-500">
                {student?.grade === null || student?.grade === undefined ? '—' : gradeLabel(student.grade)}
                {student?.section ? ` ${student.section}` : ''}
                {student?.admission_no ? ` · ${student.admission_no}` : ''}
              </p>
            </div>
          </div>
          {perms.can('fees.collect') && profile && (
            <button onClick={() => setRefunding(true)}
                    className="flex items-center gap-1.5 bg-[#3F3F46] hover:bg-[#52525B] text-white
                               text-xs font-semibold px-3 py-2 rounded-lg">
              <Undo2 size={13} /> Refund
            </button>
          )}
          <YearScope tone="dark" />
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-4">
        {loading ? (
          <div className={`${ADMIN.card} py-16 flex justify-center`}><Loader2 className="animate-spin text-[#A1A1AA]" /></div>
        ) : !profile ? (
          <div className={`${ADMIN.card} py-14 px-6 text-center`}>
            <p className="text-sm text-[#71717A] max-w-md mx-auto">
              This student has no fee profile for {year?.code}. Nothing can be billed or collected
              until they do — create one from the{' '}
              <Link href="/more/fees/students" className="underline">Students screen</Link>.
            </p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <Stat label="Billed" value={inr(totals.billed, showAmounts)} />
              <Stat label="Concessions" value={inr(totals.concessions, showAmounts)} />
              <Stat label="Paid" value={inr(totals.paid, showAmounts)} />
              <Stat label="Still due" value={inr(totals.due, showAmounts)}
                    tone={totals.due > 0 ? 'amber' : undefined} />
            </div>

            {profile.structure_source && (
              <div className={`${ADMIN.card} px-4 py-3 flex items-start gap-2`}>
                <Scale size={14} className="mt-0.5 text-[#A1A1AA] flex-shrink-0" />
                <p className="text-xs text-[#71717A]">
                  <span className="font-semibold text-[#52525B]">Why this price: </span>
                  {profile.structure_source.why}
                  {profile.prorate_from
                    ? ` Charged only from ${fmtDate(profile.prorate_from)}, as a mid-year joiner.`
                    : ''}
                </p>
              </div>
            )}

            <div className="flex gap-1 border-b border-[#E4E4E7] overflow-x-auto">
              {TABS.map(t => (
                <button key={t.key} onClick={() => setTab(t.key)}
                        className={`px-3.5 py-2 text-xs font-semibold whitespace-nowrap border-b-2 -mb-px transition-colors ${
                          tab === t.key
                            ? 'border-[#27272A] text-[#27272A]'
                            : 'border-transparent text-[#A1A1AA] hover:text-[#71717A]'}`}>
                  {t.label}
                </button>
              ))}
            </div>

            {tab === 'invoices' && (
              <Panel empty={invoices.length === 0 ? 'No bills issued to this student yet.' : null}>
                {invoices.map(i => (
                  <div key={i.id} className="px-4 py-3 border-b border-[#F4F4F5] last:border-0">
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="font-mono text-xs text-[#71717A] flex-1 min-w-[150px]">{i.number}</span>
                      <span className="text-xs text-[#A1A1AA]">due {fmtDate(i.due_date)}</span>
                      <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${INVOICE_CHIP[i.status]}`}>
                        {INVOICE_LABEL[i.status]}
                      </span>
                      <span className="text-sm font-semibold text-[#27272A] w-24 text-right">
                        {inr(i.net, showAmounts)}
                      </span>
                      <button onClick={() => void printInvoice(i)} title="Download the bill"
                              className="p-1.5 text-[#A1A1AA] hover:text-[#27272A]">
                        <Download size={14} />
                      </button>
                    </div>
                    <div className="mt-1.5 pl-1 space-y-0.5">
                      {lines.filter(l => l.invoice_id === i.id).map(l => (
                        <div key={l.id} className="flex justify-between text-xs">
                          <span className={l.amount < 0 ? 'text-emerald-700' : 'text-[#A1A1AA]'}>
                            {l.label}
                          </span>
                          <span className={l.amount < 0 ? 'text-emerald-700' : 'text-[#71717A]'}>
                            {inr(l.amount, showAmounts)}
                          </span>
                        </div>
                      ))}
                    </div>
                    {i.cancelled_reason && (
                      <p className="text-xs text-rose-600 mt-1.5">Cancelled: {i.cancelled_reason}</p>
                    )}
                  </div>
                ))}
              </Panel>
            )}

            {tab === 'payments' && (
              <Panel empty={payments.length === 0 ? 'No payments taken from this student yet.' : null}>
                {payments.map(p => (
                  <div key={p.id} className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-[#F4F4F5] last:border-0">
                    <span className="font-mono text-xs text-[#71717A] flex-1 min-w-[150px]">
                      {p.receipt_no ?? '—'}
                    </span>
                    <span className="text-xs text-[#A1A1AA]">{fmtDate(p.paid_on)} · {p.method}</span>
                    {p.status !== 'verified' && (
                      <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${
                        p.status === 'reversed'
                          ? 'bg-rose-50 text-rose-700 border border-rose-200'
                          : 'bg-amber-50 text-amber-800 border border-amber-200'}`}>
                        {p.status === 'reversed' ? 'Reversed' : 'Not cleared'}
                      </span>
                    )}
                    <span className={`text-sm font-semibold w-24 text-right ${
                      p.status === 'reversed' ? 'text-[#A1A1AA] line-through' : 'text-[#27272A]'}`}>
                      {inr(p.amount, showAmounts)}
                    </span>
                    {perms.can('fees.receipt.print') && (
                      <>
                        <button onClick={() => void printReceipt(p, true)} title="Thermal print"
                                className="p-1.5 text-[#A1A1AA] hover:text-[#27272A]"><Printer size={14} /></button>
                        <button onClick={() => void printReceipt(p, false)} title="Download A4"
                                className="p-1.5 text-[#A1A1AA] hover:text-[#27272A]"><FileText size={14} /></button>
                      </>
                    )}
                    {p.reversal_reason && (
                      <p className="w-full text-xs text-rose-600">Reversed: {p.reversal_reason}</p>
                    )}
                  </div>
                ))}
              </Panel>
            )}

            {tab === 'cheques' && (
              <Panel empty={instruments.length === 0 ? 'No cheques or drafts from this student.' : null}>
                {instruments.map(r => (
                  <div key={r.id} className="px-4 py-3 border-b border-[#F4F4F5] last:border-0">
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="text-sm text-[#27272A] flex-1 min-w-[150px]">
                        {r.kind === 'dd' ? 'DD' : 'Cheque'} {r.number}
                        {r.bank ? <span className="text-[#A1A1AA]"> · {r.bank}</span> : null}
                      </span>
                      {r.is_postdated && r.present_on && (
                        <span className="text-xs text-[#A1A1AA] inline-flex items-center gap-1">
                          <Clock size={11} /> present {fmtDate(r.present_on)}
                        </span>
                      )}
                      <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${
                        r.status === 'cleared' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                        : r.status === 'bounced' ? 'bg-rose-50 text-rose-700 border border-rose-200'
                        : 'bg-[#F4F4F5] text-[#71717A] border border-[#E4E4E7]'}`}>
                        {r.status}
                      </span>
                      <span className="text-sm font-semibold text-[#27272A] w-24 text-right">
                        {inr(r.amount, showAmounts)}
                      </span>
                    </div>
                    {r.bounce_reason && (
                      <p className="text-xs text-rose-600 mt-1">
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
                      <tr className="bg-[#FAFAFA] border-b border-[#E4E4E7]">
                        <th className="text-left px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-[#71717A]">Date</th>
                        <th className="text-left px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-[#71717A]">Entry</th>
                        <th className="text-right px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-[#71717A]">Charged</th>
                        <th className="text-right px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-[#71717A]">Paid</th>
                        <th className="text-right px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-[#71717A]">Balance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ledger.map(l => (
                        <tr key={l.id} className="border-b border-[#F4F4F5] last:border-0">
                          <td className="px-4 py-2 text-xs text-[#A1A1AA] whitespace-nowrap">{fmtDate(l.entry_date)}</td>
                          <td className="px-4 py-2 text-[#52525B]">{l.note ?? l.kind}</td>
                          <td className="px-4 py-2 text-right text-[#71717A]">
                            {(l.debit ?? 0) > 0 ? inr(l.debit, showAmounts) : ''}
                          </td>
                          <td className="px-4 py-2 text-right text-emerald-700">
                            {(l.credit ?? 0) > 0 ? inr(l.credit, showAmounts) : ''}
                          </td>
                          <td className="px-4 py-2 text-right font-semibold text-[#27272A]">
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
                    <thead className="bg-[#FAFAFA] text-[10px] uppercase tracking-widest text-[#A1A1AA]">
                      <tr>
                        <th className="text-left px-4 py-2 font-bold">What</th>
                        <th className="text-left px-4 py-2 font-bold">Asked</th>
                        <th className="text-left px-4 py-2 font-bold">State</th>
                        <th className="text-right px-4 py-2 font-bold">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {concessions.map(c => (
                        <tr key={c.id} className="border-t border-[#F4F4F5]">
                          <td className="px-4 py-2 text-[#27272A]">
                            {discountTypes.find(t => t.id === c.type_id)?.name
                              ?? scholarships.find(s => s.id === c.scholarship_id)?.name
                              ?? (c.kind === 'waiver' ? 'Waiver' : 'Concession')}
                            {c.reason && (
                              <span className="block text-[11px] text-[#A1A1AA]">{c.reason}</span>
                            )}
                          </td>
                          <td className="px-4 py-2 text-[#71717A]">{fmtDate(c.created_at.slice(0, 10))}</td>
                          <td className="px-4 py-2">
                            <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 ${
                              c.status === 'applied'
                                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                : c.status === 'pending'
                                  ? 'bg-[#FBF6E9] text-[#8A6D1F] border border-[#EFE3C4]'
                                  : 'bg-[#F4F4F5] text-[#71717A] border border-[#E4E4E7]'}`}>
                              {c.status === 'applied' ? 'On the bill'
                                : c.status === 'pending' ? 'Waiting'
                                : c.status === 'declined' ? 'Declined' : 'Removed'}
                            </span>
                          </td>
                          <td className="px-4 py-2 text-right font-semibold text-emerald-700">
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
                  <thead className="bg-[#FAFAFA] text-[10px] uppercase tracking-widest text-[#A1A1AA]">
                    <tr>
                      <th className="text-left px-4 py-2 font-bold">What</th>
                      <th className="text-left px-4 py-2 font-bold">When</th>
                      <th className="text-left px-4 py-2 font-bold">Bill</th>
                      <th className="text-right px-4 py-2 font-bold">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fines.map(f => (
                      <tr key={f.id} className="border-t border-[#F4F4F5]">
                        <td className="px-4 py-2 text-[#27272A]">
                          {fineCategories.find(c => c.id === f.category_id)?.name ?? 'Fine'}
                          {f.reason && <span className="block text-[11px] text-[#A1A1AA]">{f.reason}</span>}
                        </td>
                        <td className="px-4 py-2 text-[#71717A]">{fmtDate(f.created_at.slice(0, 10))}</td>
                        <td className="px-4 py-2 font-mono text-[11px] text-[#71717A]">
                          {invoices.find(i => i.id === f.invoice_id)?.number ?? '—'}
                        </td>
                        <td className={`px-4 py-2 text-right font-semibold ${
                          f.status === 'waived' ? 'text-[#A1A1AA] line-through' : 'text-[#27272A]'}`}>
                          {inr(f.amount, showAmounts)}
                        </td>
                      </tr>
                    ))}
                    {lateFees.map(c => (
                      <tr key={c.id} className="border-t border-[#F4F4F5]">
                        <td className="px-4 py-2 text-[#27272A]">
                          Late fee
                          <span className="block text-[11px] text-[#A1A1AA]">
                            {c.days_late} days past due
                          </span>
                        </td>
                        <td className="px-4 py-2 text-[#71717A]">{fmtDate(c.as_of)}</td>
                        <td className="px-4 py-2 font-mono text-[11px] text-[#71717A]">
                          {invoices.find(i => i.id === c.invoice_id)?.number ?? '—'}
                        </td>
                        <td className={`px-4 py-2 text-right font-semibold ${
                          c.status === 'waived' ? 'text-[#A1A1AA] line-through' : 'text-[#27272A]'}`}>
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
      </div>

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
    </div>
  )
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'amber' }) {
  return (
    <div className={`${ADMIN.card} p-4`}>
      <div className="text-[10px] font-bold uppercase tracking-widest text-[#A1A1AA]">{label}</div>
      <div className={`text-xl font-bold mt-1 ${tone === 'amber' ? 'text-amber-700' : 'text-[#27272A]'}`}>
        {value}
      </div>
    </div>
  )
}

function Panel({ empty, children }: { empty: string | null; children: React.ReactNode }) {
  return (
    <div className={`${ADMIN.card} overflow-hidden`}>
      {empty ? <p className="px-4 py-10 text-sm text-[#A1A1AA] text-center">{empty}</p> : children}
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
