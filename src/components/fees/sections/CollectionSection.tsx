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
  AlertTriangle, ArrowLeft, Ban, Check, Clock, FileText, Loader2, Play, Printer,
  Receipt, RotateCcw, Search, Sparkles, X,
} from 'lucide-react'
import ModalShell from '@/components/ui/ModalShell'
import FeeToolModal from '@/components/fees/FeeToolModal'
import { useAcademicYear } from '@/contexts/AcademicYearContext'
import { useFeePermissions } from '@/hooks/useFeePermissions'
import { ADMIN, INVOICE_CHIP, INVOICE_LABEL, fmtDate, inr } from '@/components/fees/ui'
import { DateRangeBar, MultiSelect } from '@/components/fees/controls'
import NoAccess from '@/components/fees/NoAccess'
import CollectSheet, { CollectedReceipt } from '@/components/fees/counter/CollectSheet'
import PostDatedCheques from '@/components/fees/counter/PostDatedCheques'
import { gradeLabel } from '@/lib/grades'
import { supabase } from '@/lib/supabase'
import { DEFAULT_FEE_SETTINGS, fetchFeeSettings, type PaymentRuleSettings } from '@/lib/fees/settings'
import { buildReceipt, printSpec } from '@/components/fees/statements/invoiceGenerate'
import { downloadStatement } from '@/components/fees/statements/generate'
import { fetchFeeConfig, setAutogen, type FeeConfigBundle } from '@/lib/fees/config'
import {
  cancelInvoice, createProfiles, fetchAllocations, fetchInvoices, fetchPayments,
  fetchProfileList, generateInvoices, reversePayment,
  type CollectResult, type CreateProfilesResult, type GenerateResult, type InvoiceRow,
  type PaymentRow, type ProfileListRow,
} from '@/lib/fees/invoices'
import {
  inRange, matchesStatus, payModeOf, todayISO, PAY_MODES, STATUS_FACETS,
  type LedgerFilters, type PayMode, type StatusFacet,
} from '@/lib/fees/ledger'

interface Props {
  /** Driven by the summary cards above, so a card click narrows the ledger. */
  filters: LedgerFilters
  onFiltersChange: (f: LedgerFilters) => void
  /** Told when money moved, so the summary strip can re-read itself. */
  onChanged?: () => void
}

export default function CollectionSection({ filters, onFiltersChange, onChanged }: Props) {
  const { year } = useAcademicYear()
  const perms = useFeePermissions()

  const [people, setPeople] = useState<ProfileListRow[]>([])
  const [invoices, setInvoices] = useState<InvoiceRow[]>([])
  const [extraNames, setExtraNames] = useState<Map<string, string>>(new Map())
  const [config, setConfig] = useState<FeeConfigBundle | null>(null)
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
  const [generating, setGenerating] = useState(false)
  const [cheques, setCheques] = useState(false)

  /**
   * bill id → the modes it has been paid by.
   *
   * Loaded only once somebody actually filters by mode. Working it out needs
   * every payment in the session plus its allocations, which is several
   * requests; making the screen pay for them on every open, so that a filter
   * most people never touch is instant, is the wrong trade.
   */
  const [modeMap, setModeMap] = useState<Map<string, Set<PayMode>> | null>(null)
  const [loadingModes, setLoadingModes] = useState(false)

  const showAmounts = !perms.amountsHidden
  const canCollect = perms.can('fees.collect')

  const load = useCallback(async () => {
    if (!year) return
    setLoading(true)
    try {
      const [list, inv, settings, cfg] = await Promise.all([
        fetchProfileList(year.id),
        fetchInvoices({ academicYearId: year.id }),
        fetchFeeSettings(year.id),
        fetchFeeConfig(year.id),
      ])
      setPeople(list)
      setInvoices(inv)
      setRules(settings.payment_rules)
      setConfig(cfg)

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

  // Built the first time a mode is ticked, and kept for the rest of the visit.
  // A reversed payment is deliberately left out: that money came back, so the
  // bill it was against was not, in the end, paid that way.
  useEffect(() => {
    if (filters.modes.size === 0 || modeMap || loadingModes || !year) return
    let cancelled = false
    setLoadingModes(true)
    void (async () => {
      try {
        const pays = await fetchPayments({ academicYearId: year.id, limit: 5000 })
        const live = pays.filter(p => p.status !== 'reversed')
        const byPayment = new Map(live.map(p => [p.id, p.method]))
        const allocs = await fetchAllocations(live.map(p => p.id))
        const map = new Map<string, Set<PayMode>>()
        for (const a of allocs) {
          const method = byPayment.get(a.payment_id)
          const mode = method ? payModeOf(method) : null
          if (!mode) continue
          const set = map.get(a.invoice_id) ?? new Set<PayMode>()
          set.add(mode)
          map.set(a.invoice_id, set)
        }
        if (!cancelled) setModeMap(map)
      } catch {
        // A ledger that cannot answer "how was it paid" should still show the
        // bills. An empty map means the mode filter matches nothing, which the
        // toolbar says out loud rather than pretending to have filtered.
        if (!cancelled) setModeMap(new Map())
      } finally {
        if (!cancelled) setLoadingModes(false)
      }
    })()
    return () => { cancelled = true }
  }, [filters.modes.size, modeMap, loadingModes, year])

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

  // Four independent narrowings, all of them widening within themselves: any
  // ticked status matches, any ticked mode matches. See src/lib/fees/ledger.ts
  // for why a bill's status is a set rather than a word.
  const today = todayISO()
  const filtered = useMemo(() => invoices.filter(i => {
    if (!matchesStatus(i, filters.statuses, today)) return false
    if (!inRange(i.issue_date, filters.range)) return false
    if (filters.modes.size > 0) {
      const modes = modeMap?.get(i.id)
      if (!modes) return false
      let hit = false
      for (const m of modes) if (filters.modes.has(m)) { hit = true; break }
      if (!hit) return false
    }
    return !q || i.number.toLowerCase().includes(q)
      || nameOf(i.student_id).toLowerCase().includes(q)
  }), [invoices, filters, modeMap, today, q, nameOf])

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
        <div className="mb-3 bg-[#FCECEC] border border-[#EFCCCC] text-[#A93232] text-sm px-4 py-3">{error}</div>
      )}

      {/* ── Toolbar ─────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-2 items-start mb-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search size={14} className="absolute left-3 top-[13px] -translate-y-1/2 text-[#8C8878]" />
          <input value={query} onChange={e => setQuery(e.target.value)}
                 placeholder="Student, admission number or bill number"
                 className={ADMIN.input} />
          {query && (
            <button onClick={() => setQuery('')} aria-label="Clear the search"
                    className="absolute right-3 top-[13px] -translate-y-1/2 text-[#A8A395] hover:text-[#18181B]">
              <X size={14} />
            </button>
          )}
        </div>
        {!selected && (
          <>
            <DateRangeBar
              label="Issued"
              value={filters.range}
              onChange={range => onFiltersChange({ ...filters, range })}
            />
            <MultiSelect<StatusFacet>
              label="Status"
              options={STATUS_FACETS}
              selected={filters.statuses}
              onChange={statuses => onFiltersChange({ ...filters, statuses })}
            />
            <MultiSelect<PayMode>
              label="Paid by"
              options={PAY_MODES}
              selected={filters.modes}
              onChange={modes => onFiltersChange({ ...filters, modes })}
              allLabel="Any"
            />
          </>
        )}
        {perms.can('fees.invoice.generate') && (
          <button onClick={() => setGenerating(true)} className={ADMIN.ghostBtn}>
            <Sparkles size={13} /> Generate bills
          </button>
        )}
        <button onClick={() => setCheques(true)} className={ADMIN.ghostBtn}>
          <Clock size={13} /> Cheques
        </button>
      </div>

      {!selected && filters.modes.size > 0 && loadingModes && (
        <p className="mb-3 text-[11.5px] text-[#8C8878] flex items-center gap-1.5">
          <Loader2 size={12} className="animate-spin" /> Reading how each bill was paid…
        </p>
      )}

      {/* People the search found — the way into the counter. */}
      {!selected && peopleMatches.length > 0 && (
        <div className={`${ADMIN.card} mb-3`}>
          <div className="px-3 py-1.5 border-b border-[#F0ECE2]">
            <span className={ADMIN.label}>Students</span>
          </div>
          <div className="divide-y divide-[#F0ECE2]">
            {peopleMatches.map(p => (
              <button key={p.id} onClick={() => void openStudent(p)}
                      className="w-full flex flex-wrap items-center gap-3 text-left px-3 py-2 hover:bg-[#FAF8F2]">
                <span className="text-sm text-[#18181B] flex-1 min-w-[160px]">
                  {p.full_name}
                  <span className="text-[#8C8878]">
                    {' · '}{p.grade === null ? '—' : gradeLabel(p.grade)}{p.section ?? ''}
                    {p.admission_no ? ` · ${p.admission_no}` : ''}
                  </span>
                </span>
                {(p.outstanding ?? 0) > 0 && (
                  <span className="text-sm font-semibold text-[#7A6220]">
                    {inr(p.outstanding, showAmounts)} due
                  </span>
                )}
                <span className={ADMIN.ghostBtn}><Receipt size={13} /> Open counter</span>
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
              <div className={`${ADMIN.card} p-4`}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-base font-bold text-[#18181B]">{selected.full_name}</h2>
                    <p className="text-xs text-[#8C8878]">
                      {selected.grade === null ? '—' : gradeLabel(selected.grade)}
                      {selected.section ? ` ${selected.section}` : ''}
                      {selected.admission_no ? ` · ${selected.admission_no}` : ''}
                      {selected.is_rte ? ' · RTE' : ''}
                    </p>
                  </div>
                  <div className="text-right">
                    <div className={ADMIN.label}>Outstanding</div>
                    <div className="text-xl font-bold text-[#18181B]">
                      {inr(selected.outstanding, showAmounts)}
                    </div>
                  </div>
                  {canCollect && (
                    <button
                      onClick={() => setCollecting(true)}
                      disabled={outstanding.length === 0 && !rules.allow_overpayment}
                      className={`${ADMIN.darkBtn} px-4 py-2.5`}
                    >
                      <Receipt size={14} /> Collect
                    </button>
                  )}
                </div>
                <Link href={`/more/fees/students/${selected.student_id}`}
                      className="text-xs text-[#6B675A] hover:text-[#18181B] hover:underline mt-3 inline-flex items-center gap-1">
                  <FileText size={12} /> Open the full fee profile
                </Link>
              </div>

              <Panel title="Unpaid bills" empty="Nothing outstanding — this family is fully paid up.">
                {outstanding.map(i => (
                  <div key={i.id} className="flex flex-wrap items-center gap-3 py-2.5 px-3 border-b border-[#F0ECE2] last:border-0">
                    <span className="font-mono text-xs text-[#6B675A] flex-1 min-w-[150px]">{i.number}</span>
                    <span className="text-xs text-[#8C8878]">due {fmtDate(i.due_date)}</span>
                    <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${INVOICE_CHIP[i.status]}`}>
                      {INVOICE_LABEL[i.status]}
                    </span>
                    <span className="text-sm font-semibold text-[#18181B] w-24 text-right">
                      {inr(i.balance, showAmounts)}
                    </span>
                    {perms.can('fees.invoice.cancel') && i.status !== 'cancelled' && (i.paid ?? 0) === 0 && (
                      <button onClick={() => setCancelling(i)} title="Cancel this bill"
                              className="p-1.5 text-[#C9C4B4] hover:text-[#A93232]">
                        <Ban size={13} />
                      </button>
                    )}
                  </div>
                ))}
              </Panel>

              <Panel title="Receipts" empty="No payments taken yet this session.">
                {payments.map(p => (
                  <div key={p.id} className="flex flex-wrap items-center gap-3 py-2.5 px-3 border-b border-[#F0ECE2] last:border-0">
                    <span className="font-mono text-xs text-[#6B675A] flex-1 min-w-[150px]">
                      {p.receipt_no ?? '—'}
                    </span>
                    <span className="text-xs text-[#8C8878]">{fmtDate(p.paid_on)} · {p.method}</span>
                    {p.status !== 'verified' && (
                      <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${
                        p.status === 'reversed'
                          ? 'bg-[#FCECEC] text-[#A93232] border border-[#EFCCCC]'
                          : 'bg-[#FAF3DF] text-[#7A6220] border border-[#E7D9AE]'
                      }`}>
                        {p.status === 'reversed' ? 'Reversed' : 'Not cleared'}
                      </span>
                    )}
                    <span className={`text-sm font-semibold w-24 text-right ${
                      p.status === 'reversed' ? 'text-[#8C8878] line-through' : 'text-[#18181B]'}`}>
                      {inr(p.amount, showAmounts)}
                    </span>
                    {perms.can('fees.receipt.print') && (
                      <>
                        <button onClick={() => void printReceipt(p, true)}
                                title="Print on the thermal printer"
                                className="p-1.5 text-[#8C8878] hover:text-[#18181B]">
                          <Printer size={14} />
                        </button>
                        <button onClick={() => void printReceipt(p, false)}
                                title="Download the A4 receipt"
                                className="p-1.5 text-[#8C8878] hover:text-[#18181B]">
                          <FileText size={14} />
                        </button>
                      </>
                    )}
                    {perms.can('fees.payment.reverse') && p.status === 'verified' && (
                      <button onClick={() => setReversing(p)}
                              title="Reverse this payment"
                              className="p-1.5 text-[#8C8878] hover:text-[#A93232]">
                        <RotateCcw size={14} />
                      </button>
                    )}
                  </div>
                ))}
              </Panel>
            </>
          )}
        </div>
      ) : filtered.length === 0 ? (
        /* ── The ledger ───────────────────────────────────────────────── */
        <div className={`${ADMIN.card} py-16 text-center`}>
          <p className="text-sm text-[#8C8878]">
            {invoices.length === 0 ? 'No bills issued yet this session.' : 'No bills match that.'}
          </p>
        </div>
      ) : (
        <div className={`${ADMIN.card} overflow-hidden`}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[#FAF8F2] border-b border-[#E3DFD3]">
                  <th className="text-left px-4 py-2.5 text-[10px] font-bold uppercase tracking-widest text-[#6B675A]">Bill</th>
                  <th className="text-left px-4 py-2.5 text-[10px] font-bold uppercase tracking-widest text-[#6B675A]">Student</th>
                  <th className="text-left px-4 py-2.5 text-[10px] font-bold uppercase tracking-widest text-[#6B675A]">Due</th>
                  <th className="text-left px-4 py-2.5 text-[10px] font-bold uppercase tracking-widest text-[#6B675A]">Status</th>
                  <th className="text-right px-4 py-2.5 text-[10px] font-bold uppercase tracking-widest text-[#6B675A]">Total</th>
                  <th className="text-right px-4 py-2.5 text-[10px] font-bold uppercase tracking-widest text-[#6B675A]">Owing</th>
                  <th className="w-28" />
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0, 300).map(i => (
                  <tr key={i.id} className="border-b border-[#F0ECE2] last:border-0 hover:bg-[#FAF8F2]">
                    <td className="px-4 py-2.5 font-mono text-xs text-[#6B675A]">{i.number}</td>
                    <td className="px-4 py-2.5">
                      <button onClick={() => openStudentById(i.student_id)}
                              className="text-[#18181B] hover:underline text-left">
                        {nameOf(i.student_id)}
                      </button>
                    </td>
                    <td className="px-4 py-2.5 text-[#6B675A]">{fmtDate(i.due_date)}</td>
                    <td className="px-4 py-2.5">
                      <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${INVOICE_CHIP[i.status]}`}>
                        {INVOICE_LABEL[i.status]}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right text-[#6B675A]">{inr(i.net, showAmounts)}</td>
                    <td className={`px-4 py-2.5 text-right font-semibold ${
                      (i.balance ?? 0) > 0 ? 'text-[#7A6220]' : 'text-[#8C8878]'}`}>
                      {inr(i.balance, showAmounts)}
                    </td>
                    <td className="px-2 py-1.5">
                      <div className="flex items-center justify-end gap-1">
                        {canCollect && (i.balance ?? 0) > 0 && i.status !== 'cancelled' && (
                          <button onClick={() => openStudentById(i.student_id)}
                                  title="Take a payment against this bill"
                                  className={ADMIN.ghostBtn}>
                            <Receipt size={13} /> Collect
                          </button>
                        )}
                        {perms.can('fees.invoice.cancel') && i.status !== 'cancelled' && (i.paid ?? 0) === 0 && (
                          <button onClick={() => setCancelling(i)} title="Cancel this bill"
                                  className="p-1.5 text-[#C9C4B4] hover:text-[#A93232]">
                            <Ban size={13} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {filtered.length > 300 && (
            <p className="px-4 py-3 text-xs text-[#8C8878] border-t border-[#F0ECE2]">
              Showing the first 300 of {filtered.length}. Narrow the search to see the rest.
            </p>
          )}
        </div>
      )}

      {/* ── Popups ──────────────────────────────────────────────────────── */}
      {generating && (
        <FeeToolModal title="Generate bills" subtitle="Preview first — it writes nothing"
                      icon={<Sparkles size={15} />} onClose={() => setGenerating(false)}>
          {config && year ? (
            <GenerationPanel
              config={config}
              academicYearId={year.id}
              canAutogen={perms.can('fees.invoice.autogen')}
              canCreateProfiles={perms.can('fees.profile.create')}
              showAmounts={showAmounts}
              onDone={() => void afterWrite()}
            />
          ) : (
            <div className="py-10 flex justify-center"><Loader2 className="animate-spin text-[#8C8878]" /></div>
          )}
        </FeeToolModal>
      )}

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
  const isEmpty = React.Children.count(children) === 0
  return (
    <div className={ADMIN.card}>
      <div className="px-4 py-2.5 border-b border-[#F0ECE2]">
        <h3 className="text-[10px] font-bold uppercase tracking-widest text-[#6B675A]">{title}</h3>
      </div>
      {isEmpty ? <p className="px-4 py-6 text-sm text-[#8C8878]">{empty}</p> : <div>{children}</div>}
    </div>
  )
}

// ── Generating bills ────────────────────────────────────────────────────────
//
// There used to be a "Create profiles" button on the Students screen, and a
// run here would quietly skip anybody who had not been through it — a class
// admitted in July got no bill and nothing said so. A fee account is not a
// decision anybody makes; it is bookkeeping the structure already implies. So
// this run opens the accounts it needs and then bills them, and the preview
// says how many of each before anything is written.
function GenerationPanel({
  config, academicYearId, canAutogen, canCreateProfiles, showAmounts, onDone,
}: {
  config: FeeConfigBundle
  academicYearId: string
  canAutogen: boolean
  canCreateProfiles: boolean
  showAmounts: boolean
  onDone: () => void
}) {
  const [preview, setPreview] = useState<Record<string, GenerateResult>>({})
  const [missing, setMissing] = useState<CreateProfilesResult | null>(null)
  const [generating, setGenerating] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const published = config.structures.filter(s => s.status === 'published')
  const rows = config.installments
    .filter(i => published.some(s => s.id === i.structure_id))
    .sort((a, b) => a.due_date.localeCompare(b.due_date))

  const structureName = (id: string) => config.structures.find(s => s.id === id)?.name ?? '—'

  const run = async (installmentId: string, commit: boolean) => {
    setGenerating(installmentId); setError(null)
    try {
      if (commit) {
        // Accounts first, then the bills — in that order, so students who only
        // just got an account are in the same run rather than the next one.
        if (canCreateProfiles && (missing?.created ?? 0) > 0) {
          await createProfiles({ academic_year_id: academicYearId, commit: true })
        }
        await generateInvoices(installmentId, true)
        setPreview(p => { const next = { ...p }; delete next[installmentId]; return next })
        setMissing(null)
        onDone()
        return
      }

      // Both previews write nothing, and they do not depend on each other.
      const [result, profiles] = await Promise.all([
        generateInvoices(installmentId, false),
        canCreateProfiles
          ? createProfiles({ academic_year_id: academicYearId, commit: false })
          : Promise.resolve(null),
      ])
      setPreview(p => ({ ...p, [installmentId]: result }))
      setMissing(profiles)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not generate those bills.')
    } finally {
      setGenerating(null)
    }
  }

  if (rows.length === 0) {
    return (
      <div className={`${ADMIN.card} p-5`}>
        <p className="text-sm text-[#6B675A]">
          No published structure has an installment to bill. Build the price list in{' '}
          <Link href="/more/fees?tab=config" className="underline">Fee Configuration</Link>, then publish it.
        </p>
      </div>
    )
  }

  return (
    <>
      <p className="text-xs text-[#8C8878]">
        Preview first — it counts exactly what a run would do without writing anything. Running
        twice never bills a family twice.
      </p>

      {error && (
        <div className="bg-[#FCECEC] border border-[#EFCCCC] text-[#A93232] text-sm px-4 py-3">{error}</div>
      )}

      {rows.map(i => {
        const p = preview[i.id]
        const busy = generating === i.id
        return (
          <div key={i.id} className="bg-white border border-[#E3DFD3] p-3">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex-1 min-w-[200px]">
                <div className="text-sm font-medium text-[#18181B]">
                  {i.name} <span className="text-[#8C8878] font-normal">· {structureName(i.structure_id)}</span>
                </div>
                <div className="text-xs text-[#8C8878]">
                  due {fmtDate(i.due_date)}
                  {i.percent !== null ? ` · ${Number(i.percent)}% of the year` : ''}
                  {i.amount !== null ? ` · ${inr(i.amount, showAmounts)}` : ''}
                </div>
              </div>

              {canAutogen && (
                <button
                  onClick={() => void setAutogen(i.id, !i.autogen_enabled, i.autogen_days_before).then(onDone)}
                  title={i.autogen_enabled
                    ? `Generates itself ${i.autogen_days_before} days before the due date`
                    : 'Generated by hand'}
                  className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded ${
                    i.autogen_enabled
                      ? 'bg-[#EAF5EE] text-[#1F6B42] border border-[#C6E3D2]'
                      : 'bg-white text-[#8C8878] border border-[#E3DFD3] hover:border-[#C9C4B4]'
                  }`}
                >
                  {i.autogen_enabled ? `Auto −${i.autogen_days_before}d` : 'Manual'}
                </button>
              )}

              {p ? (
                <button
                  onClick={() => void run(i.id, true)}
                  disabled={busy || (p.will_create === 0 && (missing?.created ?? 0) === 0)}
                  className={ADMIN.darkBtn}>
                  {busy ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                  Generate {p.will_create}{(missing?.created ?? 0) > 0 ? '+' : ''}
                </button>
              ) : (
                <button onClick={() => void run(i.id, false)} disabled={busy} className={ADMIN.ghostBtn}>
                  {busy ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
                  Preview
                </button>
              )}
            </div>

            {p && (
              <div className="mt-2.5 pt-2.5 border-t border-[#F0ECE2] text-xs text-[#6B675A] space-y-1">
                <p>
                  <strong className="text-[#18181B]">{p.will_create}</strong> new bill
                  {p.will_create === 1 ? '' : 's'} at {inr(p.per_student, showAmounts)} each
                  {showAmounts && p.total_amount > 0 ? ` — ${inr(p.total_amount)} in total` : ''}.
                </p>
                {Object.keys(p.by_group).length > 0 && (
                  <p>By group: {Object.entries(p.by_group).map(([g, n]) => `${g} ${n}`).join(' · ')}</p>
                )}
                {(missing?.created ?? 0) > 0 && (
                  <p className="text-[#7A6220]">
                    <strong>{missing?.created}</strong> student
                    {missing?.created === 1 ? ' has' : 's have'} no fee account for this session
                    yet. {missing?.created === 1 ? 'It' : 'They'} will be opened from the price
                    list and billed in the same run.
                    {(missing?.without_structure ?? 0) > 0
                      ? ` ${missing?.without_structure} of them have no published structure covering their class, so nothing can be billed to them until one exists.`
                      : ''}
                  </p>
                )}
                {p.already_billed > 0 && <p>Skipping {p.already_billed} already billed.</p>}
                {p.skipped_rte > 0 && <p>Skipping {p.skipped_rte} RTE.</p>}
                {p.skipped_joined_late > 0 && (
                  <p>Skipping {p.skipped_joined_late} who joined after this term ended.</p>
                )}
                {p.will_create === 0 && (missing?.created ?? 0) === 0 && (
                  <p className="text-[#8C8878]">Nothing to do — everyone eligible already has this bill.</p>
                )}
              </div>
            )}
          </div>
        )
      })}
    </>
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
        <div className="bg-[#FAF3DF] border border-[#E7D9AE] text-[#7A6220] text-sm px-4 py-3 flex items-start gap-2">
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
          <p className="text-xs text-[#8C8878] mt-1.5">
            This goes on the permanent record with your name and the time.
          </p>
        </div>
        {error && (
          <div className="bg-[#FCECEC] border border-[#EFCCCC] text-[#A93232] text-sm px-4 py-3">{error}</div>
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
        <div className="bg-[#FAF3DF] border border-[#E7D9AE] text-[#7A6220] text-sm px-4 py-3 flex items-start gap-2">
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
          <div className="bg-[#FCECEC] border border-[#EFCCCC] text-[#A93232] text-sm px-4 py-3">{error}</div>
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
