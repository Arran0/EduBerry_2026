'use client'

// ─────────────────────────────────────────────────────────────────────────────
// The Fee Counter.
//
// Someone is at the desk. The clerk types part of a name, sees the bills, takes
// the money and hands over a slip. Everything else on this page is subordinate
// to that being fast.
//
// Search is client-side over a list loaded once, because a round trip per
// keystroke is exactly the lag that makes staff go back to a register.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  AlertTriangle, ArrowLeft, Clock, FileText, Loader2, Printer, Receipt,
  RotateCcw, Search, Wallet,
} from 'lucide-react'
import ProtectedLayout from '@/components/ProtectedLayout'
import ModalShell from '@/components/ui/ModalShell'
import { AcademicYearProvider, useAcademicYear } from '@/contexts/AcademicYearContext'
import { useFeePermissions } from '@/hooks/useFeePermissions'
import { ADMIN, INVOICE_CHIP, INVOICE_LABEL, fmtDate, inr } from '@/components/fees/ui'
import YearScope from '@/components/fees/config/YearScope'
import NoAccess from '@/components/fees/NoAccess'
import CollectSheet, { CollectedReceipt } from '@/components/fees/counter/CollectSheet'
import { gradeLabel } from '@/lib/grades'
import { DEFAULT_FEE_SETTINGS, fetchFeeSettings, type PaymentRuleSettings } from '@/lib/fees/settings'
import { buildReceipt, printSpec } from '@/components/fees/statements/invoiceGenerate'
import { downloadStatement } from '@/components/fees/statements/generate'
import {
  fetchAllocations, fetchInstruments, fetchInvoices, fetchOutstandingInvoices,
  fetchPayments, fetchProfileList, reversePayment, transitionInstrument,
  type CollectResult, type InstrumentRow, type InvoiceRow, type PaymentRow, type ProfileListRow,
} from '@/lib/fees/invoices'

type Tab = 'counter' | 'pdc'

function CounterInner() {
  const { year } = useAcademicYear()
  const perms = useFeePermissions()
  const [tab, setTab] = useState<Tab>('counter')

  const [people, setPeople] = useState<ProfileListRow[]>([])
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<ProfileListRow | null>(null)
  const [invoices, setInvoices] = useState<InvoiceRow[]>([])
  const [payments, setPayments] = useState<PaymentRow[]>([])
  const [allocations, setAllocations] = useState<{ payment_id: string; invoice_id: string; amount: number }[]>([])
  const [rules, setRules] = useState<PaymentRuleSettings>(DEFAULT_FEE_SETTINGS.payment_rules)
  const [loading, setLoading] = useState(true)
  const [loadingStudent, setLoadingStudent] = useState(false)
  const [collecting, setCollecting] = useState(false)
  const [collected, setCollected] = useState<CollectResult | null>(null)
  const [reversing, setReversing] = useState<PaymentRow | null>(null)
  const [error, setError] = useState<string | null>(null)

  const showAmounts = !perms.amountsHidden

  const load = useCallback(async () => {
    if (!year) return
    setLoading(true)
    try {
      const [list, settings] = await Promise.all([
        fetchProfileList(year.id),
        fetchFeeSettings(year.id),
      ])
      setPeople(list)
      setRules(settings.payment_rules)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the counter.')
    } finally {
      setLoading(false)
    }
  }, [year])

  useEffect(() => { void load() }, [load])

  const openStudent = useCallback(async (person: ProfileListRow) => {
    if (!year) return
    setSelected(person)
    setLoadingStudent(true)
    try {
      const [inv, pay] = await Promise.all([
        fetchInvoices({ academicYearId: year.id, studentId: person.student_id }),
        fetchPayments({ academicYearId: year.id, studentId: person.student_id }),
      ])
      setInvoices(inv)
      setPayments(pay)
      setAllocations(await fetchAllocations(pay.map(p => p.id)))
    } finally {
      setLoadingStudent(false)
    }
  }, [year])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return people.slice(0, 60)
    return people.filter(p =>
      p.full_name.toLowerCase().includes(q) ||
      (p.admission_no ?? '').toLowerCase().includes(q)).slice(0, 60)
  }, [people, query])

  const outstanding = useMemo(
    () => invoices.filter(i => (i.balance ?? 0) > 0), [invoices])

  const printReceipt = async (payment: PaymentRow, thermal: boolean) => {
    if (!selected || !year || !payment.receipt_no) return
    const against = allocations
      .filter(a => a.payment_id === payment.id)
      .map(a => ({
        number: invoices.find(i => i.id === a.invoice_id)?.number ?? '—',
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
    return <div className="p-10 flex justify-center"><Loader2 className="animate-spin text-[#A1A1AA]" /></div>
  }

  if (!perms.can('fees.collect')) {
    return <NoAccess what="take payments" />
  }

  return (
    <div className="min-h-screen bg-[#F5F5F5]">
      <div className="bg-[#27272A] border-b border-[#3F3F46]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-5 flex items-center gap-4">
          <Link href="/more/fees" className="p-1.5 text-zinc-500 hover:text-zinc-300 flex-shrink-0">
            <ArrowLeft size={16} />
          </Link>
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <div className="w-9 h-9 bg-[#3F3F46] flex items-center justify-center flex-shrink-0">
              <Wallet size={16} className="text-[#B8983C]" />
            </div>
            <div className="min-w-0">
              <h1 className="text-base font-bold text-white tracking-tight">Fee Counter</h1>
              <p className="text-xs text-zinc-500">Find a student, take the money, print the slip</p>
            </div>
          </div>
          <YearScope tone="dark" />
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {error && (
          <div className="mb-4 bg-rose-50 border border-rose-200 text-rose-700 text-sm px-4 py-3 rounded-lg">{error}</div>
        )}

        <div className="flex gap-1.5 mb-4">
          <button onClick={() => setTab('counter')}
                  className={tab === 'counter' ? tabOn : tabOff}>
            <Receipt size={13} /> Counter
          </button>
          <button onClick={() => setTab('pdc')} className={tab === 'pdc' ? tabOn : tabOff}>
            <Clock size={13} /> Post-dated cheques
          </button>
        </div>

        {tab === 'pdc' ? (
          <PostDatedCheques
            canManage={perms.can('fees.instrument.manage')}
            showAmounts={showAmounts}
            people={people}
          />
        ) : (
          <div className="grid lg:grid-cols-[300px_1fr] gap-4">
            <div className={`${ADMIN.card} p-3`}>
              <div className="relative mb-2">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#A1A1AA]" />
                <input
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder="Name or admission number"
                  className={ADMIN.input}
                  autoFocus
                />
              </div>
              {loading ? (
                <div className="py-10 flex justify-center"><Loader2 size={16} className="animate-spin text-[#A1A1AA]" /></div>
              ) : people.length === 0 ? (
                <p className="px-3 py-6 text-xs text-[#A1A1AA] text-center">
                  No fee profiles for {year?.code} yet. Create them from the Students screen first.
                </p>
              ) : (
                <div className="max-h-[560px] overflow-y-auto -mx-1">
                  {filtered.map(p => (
                    <button
                      key={p.id}
                      onClick={() => void openStudent(p)}
                      className={`w-full text-left px-3 py-2 rounded-lg transition-colors ${
                        selected?.id === p.id ? 'bg-[#27272A] text-white' : 'hover:bg-[#F4F4F5]'
                      }`}
                    >
                      <div className="text-sm font-medium truncate">{p.full_name}</div>
                      <div className={`text-xs flex items-center gap-2 ${
                        selected?.id === p.id ? 'text-zinc-400' : 'text-[#A1A1AA]'}`}>
                        <span>{p.grade === null ? '—' : gradeLabel(p.grade)}{p.section ? ` ${p.section}` : ''}</span>
                        {(p.outstanding ?? 0) > 0 && (
                          <span className={selected?.id === p.id ? 'text-amber-300' : 'text-amber-600'}>
                            {inr(p.outstanding, showAmounts)} due
                          </span>
                        )}
                      </div>
                    </button>
                  ))}
                  {filtered.length === 0 && (
                    <p className="px-3 py-6 text-xs text-[#A1A1AA] text-center">Nobody matches that.</p>
                  )}
                </div>
              )}
            </div>

            <div className="space-y-4">
              {!selected ? (
                <div className={`${ADMIN.card} py-20 text-center`}>
                  <Search size={22} className="mx-auto text-[#D4D4D8] mb-2" />
                  <p className="text-sm text-[#A1A1AA]">Find a student to see what they owe.</p>
                </div>
              ) : loadingStudent ? (
                <div className={`${ADMIN.card} py-20 flex justify-center`}>
                  <Loader2 className="animate-spin text-[#A1A1AA]" />
                </div>
              ) : (
                <>
                  <div className={`${ADMIN.card} p-4`}>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <h2 className="text-base font-bold text-[#27272A]">{selected.full_name}</h2>
                        <p className="text-xs text-[#A1A1AA]">
                          {selected.grade === null ? '—' : gradeLabel(selected.grade)}
                          {selected.section ? ` ${selected.section}` : ''}
                          {selected.admission_no ? ` · ${selected.admission_no}` : ''}
                          {selected.is_rte ? ' · RTE' : ''}
                        </p>
                      </div>
                      <div className="text-right">
                        <div className="text-[10px] font-bold uppercase tracking-widest text-[#A1A1AA]">
                          Outstanding
                        </div>
                        <div className="text-xl font-bold text-[#27272A]">
                          {inr(selected.outstanding, showAmounts)}
                        </div>
                      </div>
                      <button
                        onClick={() => setCollecting(true)}
                        disabled={outstanding.length === 0 && !rules.allow_overpayment}
                        className={`${ADMIN.darkBtn} px-4 py-2.5`}
                      >
                        <Receipt size={14} /> Collect
                      </button>
                    </div>
                    <Link href={`/more/fees/students/${selected.student_id}`}
                          className="text-xs text-[#71717A] hover:text-[#27272A] hover:underline mt-3 inline-flex items-center gap-1">
                      <FileText size={12} /> Open the full fee profile
                    </Link>
                  </div>

                  <Section title="Unpaid bills" empty="Nothing outstanding — this student is fully paid up.">
                    {outstanding.map(i => (
                      <div key={i.id} className="flex flex-wrap items-center gap-3 py-2.5 px-3 border-b border-[#F4F4F5] last:border-0">
                        <span className="font-mono text-xs text-[#71717A] flex-1 min-w-[150px]">{i.number}</span>
                        <span className="text-xs text-[#A1A1AA]">due {fmtDate(i.due_date)}</span>
                        <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${INVOICE_CHIP[i.status]}`}>
                          {INVOICE_LABEL[i.status]}
                        </span>
                        <span className="text-sm font-semibold text-[#27272A] w-24 text-right">
                          {inr(i.balance, showAmounts)}
                        </span>
                      </div>
                    ))}
                  </Section>

                  <Section title="Receipts" empty="No payments taken yet this session.">
                    {payments.map(p => (
                      <div key={p.id} className="flex flex-wrap items-center gap-3 py-2.5 px-3 border-b border-[#F4F4F5] last:border-0">
                        <span className="font-mono text-xs text-[#71717A] flex-1 min-w-[150px]">
                          {p.receipt_no ?? '—'}
                        </span>
                        <span className="text-xs text-[#A1A1AA]">{fmtDate(p.paid_on)} · {p.method}</span>
                        {p.status !== 'verified' && (
                          <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${
                            p.status === 'reversed'
                              ? 'bg-rose-50 text-rose-700 border border-rose-200'
                              : 'bg-amber-50 text-amber-800 border border-amber-200'
                          }`}>
                            {p.status === 'reversed' ? 'Reversed' : 'Not cleared'}
                          </span>
                        )}
                        <span className={`text-sm font-semibold w-24 text-right ${
                          p.status === 'reversed' ? 'text-[#A1A1AA] line-through' : 'text-[#27272A]'}`}>
                          {inr(p.amount, showAmounts)}
                        </span>
                        {perms.can('fees.receipt.print') && (
                          <>
                            <button onClick={() => void printReceipt(p, true)}
                                    title="Print on the thermal printer"
                                    className="p-1.5 text-[#A1A1AA] hover:text-[#27272A]">
                              <Printer size={14} />
                            </button>
                            <button onClick={() => void printReceipt(p, false)}
                                    title="Download the A4 receipt"
                                    className="p-1.5 text-[#A1A1AA] hover:text-[#27272A]">
                              <FileText size={14} />
                            </button>
                          </>
                        )}
                        {perms.can('fees.payment.reverse') && p.status === 'verified' && (
                          <button onClick={() => setReversing(p)}
                                  title="Reverse this payment"
                                  className="p-1.5 text-[#A1A1AA] hover:text-rose-500">
                            <RotateCcw size={14} />
                          </button>
                        )}
                      </div>
                    ))}
                  </Section>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {collecting && selected && year && (
        <CollectSheet
          onClose={() => setCollecting(false)}
          student={{ id: selected.student_id, full_name: selected.full_name }}
          academicYearId={year.id}
          invoices={invoices}
          rules={rules}
          canBackdate={perms.can('fees.collect.backdate')}
          showAmounts={showAmounts}
          onCollected={result => {
            setCollecting(false)
            setCollected(result)
            void openStudent(selected)
            void load()
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
          onDone={() => {
            setReversing(null)
            if (selected) void openStudent(selected)
            void load()
          }}
        />
      )}
    </div>
  )
}

const tabOn = 'inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg bg-[#27272A] text-white'
const tabOff = 'inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg bg-white border border-[#E4E4E7] text-[#71717A] hover:text-[#27272A]'

function Section({
  title, empty, children,
}: { title: string; empty: string; children: React.ReactNode }) {
  const isEmpty = React.Children.count(children) === 0
  return (
    <div className={ADMIN.card}>
      <div className="px-4 py-2.5 border-b border-[#F4F4F5]">
        <h3 className="text-[10px] font-bold uppercase tracking-widest text-[#71717A]">{title}</h3>
      </div>
      {isEmpty ? <p className="px-4 py-6 text-sm text-[#A1A1AA]">{empty}</p> : <div>{children}</div>}
    </div>
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
        <div className="bg-amber-50 border border-amber-200 text-amber-900 text-sm px-4 py-3 rounded-lg flex items-start gap-2">
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
          <p className="text-xs text-[#A1A1AA] mt-1.5">
            This goes on the permanent record with your name and the time.
          </p>
        </div>
        {error && (
          <div className="bg-rose-50 border border-rose-200 text-rose-700 text-sm px-4 py-3 rounded-lg">{error}</div>
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

function PostDatedCheques({
  canManage, showAmounts, people,
}: { canManage: boolean; showAmounts: boolean; people: ProfileListRow[] }) {
  const [rows, setRows] = useState<InstrumentRow[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [bouncing, setBouncing] = useState<InstrumentRow | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setRows(await fetchInstruments({ status: ['received', 'deposited'] }))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const nameOf = (studentId: string) =>
    people.find(p => p.student_id === studentId)?.full_name ?? 'Student'

  const move = async (row: InstrumentRow, to: InstrumentRow['status']) => {
    setBusy(row.id); setError(null)
    try {
      await transitionInstrument(row.id, to)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update that cheque.')
    } finally {
      setBusy(null)
    }
  }

  if (loading) {
    return <div className={`${ADMIN.card} py-16 flex justify-center`}><Loader2 className="animate-spin text-[#A1A1AA]" /></div>
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-[#A1A1AA]">
        Cheques and drafts the school is holding. A bill stays open until its cheque clears, and
        bouncing one reopens the bill and adds the bank&rsquo;s charge to it automatically.
      </p>

      {error && (
        <div className="bg-rose-50 border border-rose-200 text-rose-700 text-sm px-4 py-3 rounded-lg">{error}</div>
      )}

      <div className={ADMIN.card}>
        {rows.length === 0 ? (
          <p className="px-4 py-10 text-sm text-[#A1A1AA] text-center">
            No cheques or drafts are being held.
          </p>
        ) : rows.map(r => (
          <div key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-[#F4F4F5] last:border-0">
            <div className="flex-1 min-w-[180px]">
              <div className="text-sm font-medium text-[#27272A]">{nameOf(r.student_id)}</div>
              <div className="text-xs text-[#A1A1AA]">
                {r.kind === 'dd' ? 'DD' : 'Cheque'} {r.number}
                {r.bank ? ` · ${r.bank}` : ''}
                {r.is_postdated && r.present_on ? ` · present ${fmtDate(r.present_on)}` : ''}
              </div>
            </div>
            <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${
              r.status === 'deposited'
                ? 'bg-sky-50 text-sky-700 border border-sky-200'
                : 'bg-[#F4F4F5] text-[#71717A] border border-[#E4E4E7]'
            }`}>
              {r.status}
            </span>
            <span className="text-sm font-semibold text-[#27272A] w-24 text-right">
              {inr(r.amount, showAmounts)}
            </span>
            {canManage && (
              <div className="flex gap-1.5">
                {busy === r.id ? <Loader2 size={14} className="animate-spin text-[#A1A1AA]" /> : (
                  <>
                    {r.status === 'received' && (
                      <button onClick={() => void move(r, 'deposited')} className={ADMIN.ghostBtn}>
                        Deposited
                      </button>
                    )}
                    <button onClick={() => void move(r, 'cleared')} className={ADMIN.darkBtn}>
                      Cleared
                    </button>
                    <button onClick={() => setBouncing(r)}
                            className="inline-flex items-center gap-1.5 bg-white border border-rose-200 text-rose-600 hover:bg-rose-50 text-xs font-semibold px-3 py-2 rounded-lg">
                      Bounced
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {bouncing && (
        <BounceDialog
          instrument={bouncing}
          studentName={nameOf(bouncing.student_id)}
          onClose={() => setBouncing(null)}
          onDone={() => { setBouncing(null); void load() }}
        />
      )}
    </div>
  )
}

function BounceDialog({
  instrument, studentName, onClose, onDone,
}: {
  instrument: InstrumentRow
  studentName: string
  onClose: () => void
  onDone: () => void
}) {
  const [reason, setReason] = useState('Insufficient funds')
  const [charge, setCharge] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    setBusy(true); setError(null)
    try {
      await transitionInstrument(instrument.id, 'bounced', reason.trim() || undefined,
        charge ? Number(charge) : undefined)
      onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not record that.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <ModalShell onClose={onClose} sharp size="sm"
                title={`${instrument.kind === 'dd' ? 'Draft' : 'Cheque'} ${instrument.number} bounced`}>
      <div className="space-y-4">
        <p className="text-sm text-[#52525B]">
          {studentName}&rsquo;s bill will reopen for the full amount, and the receipt will read
          cancelled to anyone who scans it.
        </p>
        <div>
          <label className={`${ADMIN.label} block mb-1.5`}>Reason the bank gave</label>
          <input value={reason} onChange={e => setReason(e.target.value)} className={ADMIN.inputPlain} />
        </div>
        <div>
          <label className={`${ADMIN.label} block mb-1.5`}>Bank charge to pass on (₹)</label>
          <input type="number" min={0} value={charge} onChange={e => setCharge(e.target.value)}
                 placeholder="Leave blank to charge nothing"
                 className={`${ADMIN.inputPlain} max-w-[200px]`} />
          <p className="text-xs text-[#A1A1AA] mt-1.5">
            Added as a named line on the bill this cheque was paying, so the family can see what it is.
          </p>
        </div>
        {error && (
          <div className="bg-rose-50 border border-rose-200 text-rose-700 text-sm px-4 py-3 rounded-lg">{error}</div>
        )}
        <div className="flex gap-2">
          <button onClick={() => void submit()} disabled={busy} className={`${ADMIN.darkBtn} flex-1 py-2.5`}>
            {busy ? <Loader2 size={13} className="animate-spin" /> : null} Record the bounce
          </button>
          <button onClick={onClose} className={ADMIN.ghostBtn}>Cancel</button>
        </div>
      </div>
    </ModalShell>
  )
}

export default function FeeCounterPage() {
  return (
    <ProtectedLayout staffOnly>
      <AcademicYearProvider>
        <CounterInner />
      </AcademicYearProvider>
    </ProtectedLayout>
  )
}
