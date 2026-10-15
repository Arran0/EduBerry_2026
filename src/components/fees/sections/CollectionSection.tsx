'use client'

// ─────────────────────────────────────────────────────────────────────────────
// Collection — the counter and the bill ledger, on one screen.
//
// These were two tabs, "Counter" and "Bills", and the split was the office's
// own workflow cut in half: a clerk looks at what a family owes and then takes
// the money, in that order, in one motion. Switching tabs between the two
// meant searching for the same person twice.
//
// So: the ledger is the screen. Every bill in the session, filtered by the
// summary cards above it or by the chips on it. Pick anybody — from a row, or
// from the search, which searches people as well as bill numbers — and the
// ledger is replaced by that family's counter: what they owe, what they have
// paid, and the Collect button. Back returns to the ledger, filters intact.
//
// Generating bills and the cheques being held are both popups. They are real
// work, but they are not what this screen is for, and they each cost a tab.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  AlertTriangle, ArrowLeft, Ban, Clock, FileText, Loader2, Printer,
  Receipt, RotateCcw, Search, Sparkles, X,
} from 'lucide-react'
import ModalShell from '@/components/ui/ModalShell'
import FeeToolModal from '@/components/fees/FeeToolModal'
import { CELL, Col, List, ListHead, Row, Segmented, TAP, TitledPanel } from '@/components/fees/shell'
import { useAcademicYear } from '@/contexts/AcademicYearContext'
import { useFeePermissions } from '@/hooks/useFeePermissions'
import { ADMIN, INVOICE_CHIP, INVOICE_LABEL, fmtDate, inr } from '@/components/fees/ui'
import NoAccess from '@/components/fees/NoAccess'
import CollectSheet, { CollectedReceipt } from '@/components/fees/counter/CollectSheet'
import PostDatedCheques from '@/components/fees/counter/PostDatedCheques'
import { gradeLabel } from '@/lib/grades'
import { supabase } from '@/lib/supabase'
import { DEFAULT_FEE_SETTINGS, fetchFeeSettings, type PaymentRuleSettings } from '@/lib/fees/settings'
import { buildReceipt, printSpec } from '@/components/fees/statements/invoiceGenerate'
import { downloadStatement } from '@/components/fees/statements/generate'
import {
  cancelInvoice, fetchAllocations, fetchInvoices, fetchPayments, fetchProfileList,
  reversePayment,
  type CollectResult, type InvoiceRow, type InvoiceStatus,
  type PaymentRow, type ProfileListRow,
} from '@/lib/fees/invoices'

export type LedgerFilter = InvoiceStatus | 'all'

/**
 * The ledger's columns, on a screen wide enough to have columns. Phones get the
 * two-column card `Row` falls back to, so the name and the balance sit on the
 * same line instead of at opposite ends of a sideways scroll.
 */
// Every column fixed but the name, so a row with a Collect button and a row
// without one put their figures in the same place.
const LEDGER_COLS = 'sm:grid-cols-[minmax(88px,124px)_minmax(0,1fr)_100px_104px_92px_96px_132px]'

/** The counter's two lists: a bill, and a receipt taken against one. */
const BILL_COLS = 'sm:grid-cols-[minmax(0,1fr)_112px_96px_96px_28px]'
const RECEIPT_COLS = 'sm:grid-cols-[minmax(0,1fr)_minmax(0,140px)_96px_92px_92px]'

const FILTERS: { key: LedgerFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'pending', label: 'Pending' },
  { key: 'overdue', label: 'Overdue' },
  { key: 'partly_paid', label: 'Partly paid' },
  { key: 'paid', label: 'Paid' },
  { key: 'cancelled', label: 'Cancelled' },
]

interface Props {
  /** Driven by the summary cards above, so a card click narrows the ledger. */
  filter: LedgerFilter
  onFilterChange: (f: LedgerFilter) => void
  /** Told when money moved, so the summary strip can re-read itself. */
  onChanged?: () => void
}

export default function CollectionSection({ filter, onFilterChange, onChanged }: Props) {
  const { year } = useAcademicYear()
  const perms = useFeePermissions()

  const [people, setPeople] = useState<ProfileListRow[]>([])
  const [invoices, setInvoices] = useState<InvoiceRow[]>([])
  const [extraNames, setExtraNames] = useState<Map<string, string>>(new Map())
  const [rules, setRules] = useState<PaymentRuleSettings>(DEFAULT_FEE_SETTINGS.payment_rules)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  // The counter, for whoever is at the desk.
  const [selected, setSelected] = useState<ProfileListRow | null>(null)
  const [studentInvoices, setStudentInvoices] = useState<InvoiceRow[]>([])
  const [payments, setPayments] = useState<PaymentRow[]>([])
  const [allocations, setAllocations] = useState<{ payment_id: string; invoice_id: string; amount: number }[]>([])
  const [loadingStudent, setLoadingStudent] = useState(false)
  const [collecting, setCollecting] = useState(false)
  const [collected, setCollected] = useState<CollectResult | null>(null)
  const [reversing, setReversing] = useState<PaymentRow | null>(null)
  const [cancelling, setCancelling] = useState<InvoiceRow | null>(null)

  // The two popups this screen owns.
  const [cheques, setCheques] = useState(false)

  const showAmounts = !perms.amountsHidden
  const canCollect = perms.can('fees.collect')

  const load = useCallback(async () => {
    if (!year) return
    setLoading(true)
    try {
      const [list, inv, settings] = await Promise.all([
        fetchProfileList(year.id),
        fetchInvoices({ academicYearId: year.id }),
        fetchFeeSettings(year.id),
      ])
      setPeople(list)
      setInvoices(inv)
      setRules(settings.payment_rules)

      // Almost every bill belongs to somebody with a fee profile, so the roster
      // names them. The handful that do not — a profile archived mid-session —
      // would otherwise render as a dash, so they are looked up by name.
      const known = new Set(list.map(p => p.student_id))
      const missing = [...new Set(inv.map(i => i.student_id))].filter(id => !known.has(id))
      if (missing.length > 0) {
        const map = new Map<string, string>()
        for (let i = 0; i < missing.length; i += 300) {
          const { data } = await supabase.from('profiles')
            .select('id, full_name').in('id', missing.slice(i, i + 300))
          for (const r of data ?? []) map.set(r.id as string, r.full_name as string)
        }
        setExtraNames(map)
      } else {
        setExtraNames(new Map())
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the collection screen.')
    } finally {
      setLoading(false)
    }
  }, [year])

  useEffect(() => { void load() }, [load])

  const nameOf = useCallback((studentId: string) =>
    people.find(p => p.student_id === studentId)?.full_name
    ?? extraNames.get(studentId)
    ?? '—', [people, extraNames])

  const openStudent = useCallback(async (person: ProfileListRow) => {
    if (!year) return
    setSelected(person)
    setLoadingStudent(true)
    try {
      const [inv, pay] = await Promise.all([
        fetchInvoices({ academicYearId: year.id, studentId: person.student_id }),
        fetchPayments({ academicYearId: year.id, studentId: person.student_id }),
      ])
      setStudentInvoices(inv)
      setPayments(pay)
      setAllocations(await fetchAllocations(pay.map(p => p.id)))
    } finally {
      setLoadingStudent(false)
    }
  }, [year])

  /** A ledger row hands back a student id; the counter needs the roster row. */
  const openStudentById = useCallback((studentId: string) => {
    const person = people.find(p => p.student_id === studentId)
    if (person) void openStudent(person)
  }, [people, openStudent])

  const q = query.trim().toLowerCase()

  // People only appear while something is typed: the ledger is the screen, and
  // a nine-hundred-name list above it would bury the bills.
  const peopleMatches = useMemo(() => {
    if (!q) return []
    return people.filter(p =>
      p.full_name.toLowerCase().includes(q) ||
      (p.admission_no ?? '').toLowerCase().includes(q)).slice(0, 8)
  }, [people, q])

  const filtered = useMemo(() => invoices.filter(i =>
    (filter === 'all' || i.status === filter) &&
    (!q || i.number.toLowerCase().includes(q) || nameOf(i.student_id).toLowerCase().includes(q))
  ), [invoices, filter, q, nameOf])

  const counts = useMemo(() => {
    const c = Object.fromEntries(FILTERS.map(f => [f.key, 0])) as Record<LedgerFilter, number>
    for (const i of invoices) {
      c.all += 1
      if (i.status in c) c[i.status as LedgerFilter] += 1
    }
    return c
  }, [invoices])

  const outstanding = useMemo(
    () => studentInvoices.filter(i => (i.balance ?? 0) > 0), [studentInvoices])

  const afterWrite = useCallback(async () => {
    await load()
    if (selected) await openStudent(selected)
    onChanged?.()
  }, [load, openStudent, selected, onChanged])

  const printReceipt = async (payment: PaymentRow, thermal: boolean) => {
    if (!selected || !year || !payment.receipt_no) return
    const against = allocations
      .filter(a => a.payment_id === payment.id)
      .map(a => ({
        number: studentInvoices.find(i => i.id === a.invoice_id)?.number ?? '—',
        amount: a.amount,
      }))
    const spec = await buildReceipt(
      {
        receipt_no: payment.receipt_no,
        paid_on: payment.paid_on,
        method: payment.method,
        amount: payment.amount ?? 0,
        reference: payment.reference,
        status: payment.status,
        against,
        verify_token: payment.receipt_hash ?? payment.id,
      },
      { full_name: selected.full_name, grade: selected.grade, section: selected.section },
      year.code,
      thermal,
    )
    if (thermal) await printSpec(spec)
    else await downloadStatement(spec)
  }

  if (perms.loading) {
    return <div className="p-10 flex justify-center"><Loader2 className="animate-spin text-[#8C8878]" /></div>
  }
  if (!perms.canAny('fees.collect', 'fees.profile.view')) {
    return <NoAccess what="work the collection screen" />
  }

  return (
    <>
      {error && (
        <div className="mb-3 bg-[#FCECEC] border border-[#EFCCCC] text-[#A93232] text-[12.5px] px-4 py-3">{error}</div>
      )}

      {/* ── Toolbar ─────────────────────────────────────────────────────── */}
      {/* Search and the status switch narrow the ledger on the left; the two
          things a clerk goes elsewhere for sit on the right. On a phone the
          switch becomes one native picker beside the search. */}
      <div className="flex flex-wrap gap-2 items-center mb-3">
        <div className="relative flex-1 min-w-[150px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8C8878]" />
          <input value={query} onChange={e => setQuery(e.target.value)}
                 placeholder="Student, admission number or bill number"
                 className={ADMIN.input} />
          {query && (
            <button onClick={() => setQuery('')} aria-label="Clear the search"
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[#A8A395] hover:text-[#18181B]">
              <X size={14} />
            </button>
          )}
        </div>
        {!selected && (
          <>
            <Segmented<LedgerFilter>
              className="max-lg:hidden"
              size="sm"
              value={filter}
              onChange={onFilterChange}
              options={FILTERS.map(f => ({ key: f.key, label: f.label, count: counts[f.key] }))}
            />
            <select value={filter} aria-label="Which bills to show"
                    onChange={e => onFilterChange(e.target.value as LedgerFilter)}
                    className={`lg:hidden flex-shrink-0 ${ADMIN.select} ${filter === 'all' ? '' : '!border-[#27272A]'}`}>
              {FILTERS.map(f => (
                <option key={f.key} value={f.key}>
                  {f.key === 'all' ? 'All bills' : f.label} ({counts[f.key]})
                </option>
              ))}
            </select>
          </>
        )}
        <div className="flex gap-1.5 max-sm:w-full lg:ml-auto">
          {perms.can('fees.invoice.generate') && (
            // Bills are issued from the fee grid, where the cells they lock can
            // be seen.
            <Link href="/more/fees?tab=config" className={`${ADMIN.ghostBtn} max-sm:flex-1`}>
              <Sparkles size={13} /> Issue fees
            </Link>
          )}
          <button onClick={() => setCheques(true)} className={`${ADMIN.ghostBtn} max-sm:flex-1`}>
            <Clock size={13} /> Cheques
          </button>
        </div>
      </div>

      {/* People the search found — the way into the counter. */}
      {!selected && peopleMatches.length > 0 && (
        <div className={`${ADMIN.card} mb-3`}>
          <div className="px-3 py-1.5 border-b border-[#F0ECE2]">
            <span className={ADMIN.label}>Students</span>
          </div>
          <div className="divide-y divide-[#F0ECE2]">
            {/* The whole row is the button, so a phone does not need the
                "Open counter" affordance spelled out beside the name — it is a
                third line there, under a name and an amount that already say
                what the row is. */}
            {peopleMatches.map(p => (
              <button key={p.id} onClick={() => void openStudent(p)}
                      className="w-full grid grid-cols-[minmax(0,1fr)_auto] sm:flex sm:flex-wrap
                                 items-center gap-x-3 gap-y-0.5 text-left px-3 py-2.5 sm:py-2
                                 hover:bg-[#FAF8F2]">
                <span className="text-[12.5px] text-[#18181B] sm:flex-1 sm:min-w-[160px] min-w-0">
                  <span className="font-medium">{p.full_name}</span>
                  <span className="block sm:inline text-[11px] text-[#8C8878] truncate">
                    <span className="max-sm:hidden">{' · '}</span>
                    {p.grade === null ? '—' : gradeLabel(p.grade)}{p.section ?? ''}
                    {p.admission_no ? ` · ${p.admission_no}` : ''}
                  </span>
                </span>
                {(p.outstanding ?? 0) > 0 && (
                  <span className="text-[12.5px] font-semibold text-[#7A6220] tabular-nums
                                   max-sm:row-start-1 max-sm:col-start-2 max-sm:justify-self-end">
                    {inr(p.outstanding, showAmounts)} due
                  </span>
                )}
                <span className={`${ADMIN.ghostBtn} max-sm:hidden`}><Receipt size={13} /> Open counter</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {loading ? (
        <div className={`${ADMIN.card} py-16 flex justify-center`}><Loader2 className="animate-spin text-[#8C8878]" /></div>
      ) : selected ? (
        /* ── The counter, for one family ──────────────────────────────── */
        <div className="space-y-3">
          <button onClick={() => { setSelected(null); setPayments([]); setStudentInvoices([]) }}
                  className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase
                             tracking-[0.08em] text-[#8C8878] hover:text-[#18181B]">
            <ArrowLeft size={13} /> All bills
          </button>

          {loadingStudent ? (
            <div className={`${ADMIN.card} py-20 flex justify-center`}>
              <Loader2 className="animate-spin text-[#8C8878]" />
            </div>
          ) : (
            <>
              {/* The family at the counter. The dark strip says where you are;
                  under it the name on the left and, on the right, the three
                  figures in hairline cells with Collect at the end — the one
                  gold button on the screen, because it is the thing the screen
                  is for. A phone stacks the figures under the name. */}
              <section className="bg-white border border-[#E3DFD3]">
                <div className="flex items-center gap-2 bg-[#27272A] px-3 min-h-[34px] py-1.5">
                  <span className="text-[9.5px] font-bold uppercase tracking-[0.12em] text-[#D4D4D8]">At the counter</span>
                  {selected.is_rte && (
                    <span className="text-[9px] font-bold uppercase tracking-[0.08em] px-1.5 py-[2px] bg-[#EEF2FB] text-[#3A5490]">RTE</span>
                  )}
                  <Link href={`/more/fees/students/${selected.student_id}`} className={`${ADMIN.onDarkBtn} ml-auto`}>
                    <FileText size={11} /> Full fee profile
                  </Link>
                </div>
                <div className="grid gap-3 p-3 sm:p-4 lg:grid-cols-[minmax(0,1fr)_auto] items-center">
                  <div className="min-w-0">
                    <h2 className="font-display text-[17px] font-bold text-[#18181B] truncate leading-tight">
                      {selected.full_name}
                    </h2>
                    <p className="text-[11px] text-[#8C8878] truncate mt-0.5">
                      {selected.grade === null ? 'No class' : gradeLabel(selected.grade)}
                      {selected.section ? ` ${selected.section}` : ''}
                      {selected.admission_no ? ` · ${selected.admission_no}` : ''}
                    </p>
                  </div>
                  <div className="flex items-stretch gap-2 flex-wrap sm:flex-nowrap">
                    <div className="grid grid-cols-3 flex-1 sm:flex-none border border-[#E3DFD3] divide-x divide-[#E3DFD3] bg-[#FDFCF9]">
                      {[
                        { label: 'Billed', value: inr(selected.billed, showAmounts), tone: 'text-[#18181B]' },
                        { label: 'Paid', value: inr(selected.paid, showAmounts), tone: 'text-[#1F6B42]' },
                        { label: 'Outstanding', value: inr(selected.outstanding, showAmounts),
                          tone: (selected.outstanding ?? 0) > 0 ? 'text-[#7A6220]' : 'text-[#18181B]' },
                      ].map(f => (
                        <div key={f.label} className="px-3 py-1.5 sm:min-w-[112px]">
                          <div className={ADMIN.label}>{f.label}</div>
                          <div className={`text-[15px] font-bold tabular-nums leading-tight truncate ${f.tone}`}>{f.value}</div>
                        </div>
                      ))}
                    </div>
                    {canCollect && (
                      <button
                        onClick={() => setCollecting(true)}
                        disabled={outstanding.length === 0 && !rules.allow_overpayment}
                        className={`${ADMIN.goldBtn} max-sm:w-full sm:px-4`}
                      >
                        <Receipt size={13} /> Collect
                      </button>
                    )}
                  </div>
                </div>
              </section>

              <div className="grid gap-3 xl:grid-cols-2 items-start">
              <Panel title="Unpaid bills" empty="Nothing outstanding — this family is fully paid up.">
                {outstanding.map(i => (
                  <Row key={i.id} cols={BILL_COLS} trailing={1}>
                    <span className={`${CELL.A1} font-mono text-[11px] text-[#6B675A] truncate`}>
                      {i.number}
                    </span>
                    <span className={`${CELL.A2} text-[11px] text-[#8C8878] whitespace-nowrap`}>
                      due {fmtDate(i.due_date)}
                    </span>
                    <span className={CELL.B2}>
                      <span className={`inline-block text-[9px] font-bold uppercase tracking-[0.08em] px-1.5 py-[2px] ${INVOICE_CHIP[i.status]}`}>
                        {INVOICE_LABEL[i.status]}
                      </span>
                    </span>
                    <span className={`${CELL.B1} text-[11.5px] font-semibold text-[#18181B] text-right tabular-nums`}>
                      {inr(i.balance, showAmounts)}
                    </span>
                    <span className={CELL.END}>
                      {perms.can('fees.invoice.cancel') && i.status !== 'cancelled' && (i.paid ?? 0) === 0 && (
                        <button onClick={() => setCancelling(i)} title="Cancel this bill"
                                aria-label="Cancel this bill"
                                className={`${TAP} text-[#C9C4B4] hover:text-[#A93232]`}>
                          <Ban size={13} />
                        </button>
                      )}
                    </span>
                  </Row>
                ))}
              </Panel>

              <Panel title="Receipts" empty="No payments taken yet this session.">
                {payments.map(p => (
                  <Row key={p.id} cols={RECEIPT_COLS} trailing={3}>
                    <span className={`${CELL.A1} font-mono text-[11px] text-[#6B675A] truncate`}>
                      {p.receipt_no ?? '—'}
                    </span>
                    <span className={`${CELL.A2} text-[11px] text-[#8C8878] truncate`}>
                      {fmtDate(p.paid_on)} · {p.method}
                    </span>
                    <span className={CELL.B2}>
                      {p.status !== 'verified' && (
                        <span className={`inline-block text-[9px] font-bold uppercase tracking-[0.08em] px-1.5 py-[2px] ${
                          p.status === 'reversed'
                            ? 'bg-[#FCECEC] text-[#A93232] border border-[#EFCCCC]'
                            : 'bg-[#FAF3DF] text-[#7A6220] border border-[#E7D9AE]'
                        }`}>
                          {p.status === 'reversed' ? 'Reversed' : 'Not cleared'}
                        </span>
                      )}
                    </span>
                    <span className={`${CELL.B1} text-[11.5px] font-semibold text-right tabular-nums ${
                      p.status === 'reversed' ? 'text-[#8C8878] line-through' : 'text-[#18181B]'}`}>
                      {inr(p.amount, showAmounts)}
                    </span>
                    {/* Print, download and reverse were three 26px squares with
                        3px between them. On a phone that is how a payment gets
                        reversed by someone reaching for the printer. */}
                    <span className={`${CELL.END} flex items-center gap-1`}>
                      {perms.can('fees.receipt.print') && (
                        <>
                          <button onClick={() => void printReceipt(p, true)}
                                  title="Print on the thermal printer"
                                  aria-label="Print on the thermal printer"
                                  className={`${TAP} text-[#8C8878] hover:text-[#18181B]`}>
                            <Printer size={14} />
                          </button>
                          <button onClick={() => void printReceipt(p, false)}
                                  title="Download the A4 receipt"
                                  aria-label="Download the A4 receipt"
                                  className={`${TAP} text-[#8C8878] hover:text-[#18181B]`}>
                            <FileText size={14} />
                          </button>
                        </>
                      )}
                      {perms.can('fees.payment.reverse') && p.status === 'verified' && (
                        <button onClick={() => setReversing(p)}
                                title="Reverse this payment"
                                aria-label="Reverse this payment"
                                className={`${TAP} text-[#8C8878] hover:text-[#A93232]`}>
                          <RotateCcw size={14} />
                        </button>
                      )}
                    </span>
                  </Row>
                ))}
              </Panel>
              </div>
            </>
          )}
        </div>
      ) : filtered.length === 0 ? (
        /* ── The ledger ───────────────────────────────────────────────── */
        <div className={`${ADMIN.card} py-16 text-center`}>
          <p className="text-[12.5px] text-[#8C8878]">
            {invoices.length === 0 ? 'No bills issued yet this session.' : 'No bills match that.'}
          </p>
        </div>
      ) : (
        <List>
          <ListHead cols={LEDGER_COLS}>
            <Col>Bill</Col>
            <Col>Student</Col>
            <Col>Due</Col>
            <Col>Status</Col>
            <Col right>Total</Col>
            <Col right>Owing</Col>
            <Col right>&nbsp;</Col>
          </ListHead>

          {/* Two lines on a phone, not three. The ledger is scrolled through,
              so every line a row costs is a family the clerk cannot see: the
              name and what they owe on the first, the bill number and its state
              on the second, Collect down the right. The due date and the bill's
              full total are a column on a laptop and nothing here — the chip
              already says whether this one is late, and the figure that matters
              at a counter is the one about to be taken. */}
          {filtered.slice(0, 300).map(i => (
            <Row key={i.id} cols={LEDGER_COLS} trailing={1}>
              <span className={`${CELL.A2} font-mono text-[11px] text-[#6B675A] truncate`}>
                {i.number}
              </span>
              <button onClick={() => openStudentById(i.student_id)}
                      className={`${CELL.A1} text-left truncate text-[12.5px] font-medium
                                  text-[#18181B] hover:underline`}>
                {nameOf(i.student_id)}
              </button>
              <span className={`${CELL.DESKTOP} text-[11px] text-[#6B675A] whitespace-nowrap`}>
                {fmtDate(i.due_date)}
              </span>
              <span className={CELL.B2}>
                <span className={`inline-block text-[9px] font-bold uppercase tracking-[0.08em] px-1.5 py-[2px] ${INVOICE_CHIP[i.status]}`}>
                  {INVOICE_LABEL[i.status]}
                </span>
              </span>
              <span className={`${CELL.DESKTOP} text-right text-[11.5px] text-[#6B675A] tabular-nums`}>
                {inr(i.net, showAmounts)}
              </span>
              <span className={`${CELL.B1} text-right text-[11.5px] font-semibold tabular-nums ${
                (i.balance ?? 0) > 0 ? 'text-[#7A6220]' : 'text-[#8C8878]'}`}>
                {inr(i.balance, showAmounts)}
              </span>
              <span className={`${CELL.END} flex items-center justify-end sm:justify-start gap-1`}>
                {/* Collect and the student's name open the same counter, and on
                    a phone one way in is enough — tapping the name is the way a
                    list is read there, and the button would be a second control
                    competing with it for a 180px row. */}
                {canCollect && (i.balance ?? 0) > 0 && i.status !== 'cancelled' && (
                  <button onClick={() => openStudentById(i.student_id)}
                          title="Take a payment against this bill"
                          className={`${ADMIN.ghostBtn} max-sm:hidden`}>
                    <Receipt size={13} /> Collect
                  </button>
                )}
                {perms.can('fees.invoice.cancel') && i.status !== 'cancelled' && (i.paid ?? 0) === 0 && (
                  <button onClick={() => setCancelling(i)} title="Cancel this bill"
                          aria-label="Cancel this bill"
                          className={`${TAP} text-[#C9C4B4] hover:text-[#A93232]`}>
                    <Ban size={13} />
                  </button>
                )}
              </span>
            </Row>
          ))}
          {filtered.length > 300 && (
            <p className="px-4 py-3 text-[11px] text-[#8C8878] border-t border-[#F0ECE2]">
              Showing the first 300 of {filtered.length}. Narrow the search to see the rest.
            </p>
          )}
        </List>
      )}

      {/* ── Popups ──────────────────────────────────────────────────────── */}
      {cheques && (
        <FeeToolModal title="Cheques and drafts" subtitle="What the school is holding"
                      icon={<Clock size={15} />} onClose={() => setCheques(false)}>
          <PostDatedCheques canManage={perms.can('fees.instrument.manage')}
                            showAmounts={showAmounts} people={people} />
        </FeeToolModal>
      )}

      {collecting && selected && year && (
        <CollectSheet
          onClose={() => setCollecting(false)}
          student={{ id: selected.student_id, full_name: selected.full_name }}
          academicYearId={year.id}
          invoices={studentInvoices}
          rules={rules}
          canBackdate={perms.can('fees.collect.backdate')}
          showAmounts={showAmounts}
          onCollected={result => {
            setCollecting(false)
            setCollected(result)
            void afterWrite()
          }}
        />
      )}

      {collected && selected && (
        <ModalShell onClose={() => setCollected(null)} sharp size="sm" title="Payment taken">
          <CollectedReceipt
            result={collected}
            studentName={selected.full_name}
            showAmounts={showAmounts}
            onPrint={() => {
              const p = payments.find(x => x.id === collected.payment_id)
              if (p) void printReceipt(p, true)
            }}
            onClose={() => setCollected(null)}
          />
        </ModalShell>
      )}

      {reversing && (
        <ReverseDialog
          payment={reversing}
          showAmounts={showAmounts}
          onClose={() => setReversing(null)}
          onDone={() => { setReversing(null); void afterWrite() }}
        />
      )}

      {cancelling && (
        <CancelDialog
          invoice={cancelling}
          showAmounts={showAmounts}
          onClose={() => setCancelling(null)}
          onDone={() => { setCancelling(null); void afterWrite() }}
        />
      )}
    </>
  )
}


function Panel({
  title, empty, children,
}: { title: string; empty: string; children: React.ReactNode }) {
  const count = React.Children.count(children)
  return (
    <TitledPanel title={title} count={count || undefined}>
      {count === 0 ? <p className="px-4 py-6 text-[12.5px] text-[#8C8878]">{empty}</p> : <div>{children}</div>}
    </TitledPanel>
  )
}

function ReverseDialog({
  payment, showAmounts, onClose, onDone,
}: {
  payment: PaymentRow
  showAmounts: boolean
  onClose: () => void
  onDone: () => void
}) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    setBusy(true); setError(null)
    try {
      await reversePayment(payment.id, reason)
      onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not reverse that payment.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <ModalShell onClose={onClose} sharp size="sm" title="Reverse this payment">
      <div className="space-y-4">
        <div className="bg-[#FAF3DF] border border-[#E7D9AE] text-[#7A6220] text-[12.5px] px-4 py-3 flex items-start gap-2">
          <AlertTriangle size={15} className="mt-0.5 flex-shrink-0" />
          <span>
            {payment.receipt_no} for {inr(payment.amount, showAmounts)} will be marked reversed.
            The bills it paid reopen, and anyone scanning the receipt will be told it is cancelled.
            Nothing is deleted.
          </span>
        </div>
        <div>
          <label className={`${ADMIN.label} block mb-1.5`}>Why is this being reversed?</label>
          <textarea
            value={reason}
            onChange={e => setReason(e.target.value)}
            rows={3}
            placeholder="Cash did not tally at end of day"
            className={`${ADMIN.inputPlain} resize-none`}
            autoFocus
          />
          <p className="text-[11px] text-[#8C8878] mt-1.5">
            This goes on the permanent record with your name and the time.
          </p>
        </div>
        {error && (
          <div className="bg-[#FCECEC] border border-[#EFCCCC] text-[#A93232] text-[12.5px] px-4 py-3">{error}</div>
        )}
        <div className="flex gap-2">
          <button onClick={() => void submit()} disabled={busy || reason.trim().length < 3}
                  className={`${ADMIN.darkBtn} flex-1 py-2.5`}>
            {busy ? <Loader2 size={13} className="animate-spin" /> : <RotateCcw size={13} />}
            Reverse
          </button>
          <button onClick={onClose} className={ADMIN.ghostBtn}>Cancel</button>
        </div>
      </div>
    </ModalShell>
  )
}

function CancelDialog({
  invoice, showAmounts, onClose, onDone,
}: { invoice: InvoiceRow; showAmounts: boolean; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    setBusy(true); setError(null)
    try { await cancelInvoice(invoice.id, reason); onDone() }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not cancel that bill.') }
    finally { setBusy(false) }
  }

  return (
    <ModalShell onClose={onClose} sharp size="sm" title={`Cancel ${invoice.number}`}>
      <div className="space-y-4">
        <div className="bg-[#FAF3DF] border border-[#E7D9AE] text-[#7A6220] text-[12.5px] px-4 py-3 flex items-start gap-2">
          <AlertTriangle size={15} className="mt-0.5 flex-shrink-0" />
          <span>
            This bill for {inr(invoice.net, showAmounts)} will be marked cancelled and stop counting
            towards what the family owes. It is kept, not deleted, and its QR will say so.
          </span>
        </div>
        <div>
          <label className={`${ADMIN.label} block mb-1.5`}>Why?</label>
          <textarea value={reason} onChange={e => setReason(e.target.value)} rows={3}
                    placeholder="Issued in error — the student had already withdrawn"
                    className={`${ADMIN.inputPlain} resize-none`} autoFocus />
        </div>
        {error && (
          <div className="bg-[#FCECEC] border border-[#EFCCCC] text-[#A93232] text-[12.5px] px-4 py-3">{error}</div>
        )}
        <div className="flex gap-2">
          <button onClick={() => void submit()} disabled={busy || reason.trim().length < 3}
                  className={`${ADMIN.darkBtn} flex-1 py-2.5`}>
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Ban size={13} />} Cancel the bill
          </button>
          <button onClick={onClose} className={ADMIN.ghostBtn}>Keep it</button>
        </div>
      </div>
    </ModalShell>
  )
}
