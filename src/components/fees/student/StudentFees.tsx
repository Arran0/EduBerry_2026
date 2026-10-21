'use client'

// ─────────────────────────────────────────────────────────────────────────────
// The fee app, as a student (and the family holding their phone) sees it.
//
// Three questions, in the order people ask them:
//   How much do I owe, and by when?  — the dark slab at the top, and one button.
//   What is it for?                  — every bill, opened to its lines, with
//                                      what the school took off shown in green.
//   Can I prove I paid?              — every receipt, downloadable, the same
//                                      sealed PDF the counter prints.
//
// Same frame as the office's side: the banner with the session on it, a glass
// deck you work on, square sheets you read off, capsule controls.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import {
  AlertCircle, CalendarClock, Check, CheckCircle2, Download, IndianRupee, Landmark,
  Loader2, Receipt, ShieldCheck, Sparkles, Wallet,
} from 'lucide-react'
import PageBanner from '@/components/PageBanner'
import YearToggle from '@/components/transport/YearToggle'
import { useAuth } from '@/contexts/AuthContext'
import { useAcademicYear } from '@/contexts/AcademicYearContext'
import { FEES_BANNER_DEFAULT, fetchBranding } from '@/lib/pageConfig'
import { fetchRazorpayConfig } from '@/lib/bus'
import { todayIn } from '@/lib/fees/engine/dates'
import {
  fetchAllocations, fetchInvoiceLines, fetchInvoices, fetchPayments,
  type InvoiceLineRow, type InvoiceRow, type PaymentRow,
} from '@/lib/fees/invoices'
import { fetchOpenOnlineOrders, type OnlineOrderRow } from '@/lib/fees/online'
import { downloadStatement } from '@/components/fees/statements/generate'
import { buildInvoice, buildReceipt } from '@/components/fees/statements/invoiceGenerate'
import { ADMIN, CHIP, INVOICE_CHIP, INVOICE_LABEL, fmtDate, fmtDay, inr } from '@/components/fees/ui'
import { CELL, CELL_LEAD, Col, Empty, List, ListHead, Loading, Notice, Row, SHELL, Segmented, TAP, TitledPanel } from '@/components/fees/shell'
import { DocNo, FeeDeck } from '@/components/fees/glass'
import StudentBillSheet from './StudentBillSheet'
import PaySheet from './PaySheet'
import {
  METHOD_WORD, billFor, daysBetween, dueWords, isOpen, receiptAgainst, sessionTotals, type Allocation,
} from './studentFees'

type Tab = 'due' | 'bills' | 'receipts'

const DUE_COLS = 'sm:grid-cols-[28px_minmax(0,1fr)_130px_110px]'
const BILL_COLS = 'sm:grid-cols-[minmax(0,1fr)_110px_96px_96px]'
const RECEIPT_COLS = 'sm:grid-cols-[minmax(0,1fr)_120px_100px_32px]'

const DUE_TONE = {
  late: 'text-[#A93232]',
  soon: 'text-[#7A5D12]',
  later: 'text-slate-500',
  done: 'text-[#1F6B42]',
}

/** A bill falls in "pay now" when it is due within this many days. */
const SOON_DAYS = 30

export default function StudentFees() {
  const { profile } = useAuth()
  const { year } = useAcademicYear()
  const today = todayIn()

  const [invoices, setInvoices] = useState<InvoiceRow[]>([])
  const [lines, setLines] = useState<InvoiceLineRow[]>([])
  const [payments, setPayments] = useState<PaymentRow[]>([])
  const [allocations, setAllocations] = useState<Allocation[]>([])
  const [pending, setPending] = useState<OnlineOrderRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [online, setOnline] = useState(false)
  const [school, setSchool] = useState('School fees')

  const [tab, setTab] = useState<Tab>('due')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [touched, setTouched] = useState(false)
  const [openBill, setOpenBill] = useState<string | null>(null)
  const [paying, setPaying] = useState<InvoiceRow[] | null>(null)
  const [busyDoc, setBusyDoc] = useState<string | null>(null)

  useEffect(() => {
    void fetchRazorpayConfig().then(c => setOnline(c.enabled && !!c.key_id)).catch(() => setOnline(false))
    void fetchBranding().then(b => setSchool(b.schoolName || b.appSubtitle || 'School fees')).catch(() => {})
  }, [])

  const load = useCallback(async (quiet = false) => {
    if (!profile || !year) return
    if (!quiet) setLoading(true)
    setError(null)
    try {
      const [inv, pay, open] = await Promise.all([
        fetchInvoices({ academicYearId: year.id, studentId: profile.id }),
        fetchPayments({ academicYearId: year.id, studentId: profile.id }),
        fetchOpenOnlineOrders(year.id).catch(() => [] as OnlineOrderRow[]),
      ])
      const [ln, al] = await Promise.all([
        fetchInvoiceLines(inv.map(i => i.id)),
        fetchAllocations(pay.map(p => p.id)),
      ])
      setInvoices(inv.filter(i => i.status !== 'draft'))
      setPayments(pay)
      setPending(open)
      setLines(ln)
      setAllocations(al)
    } catch {
      setError('Your fees could not be loaded. Check your connection and try again.')
    } finally {
      setLoading(false)
    }
  }, [profile, year])

  useEffect(() => { void load() }, [load])
  useEffect(() => { setTouched(false); setTab('due') }, [year?.id])

  const linesOf = useCallback((id: string) => lines.filter(l => l.invoice_id === id), [lines])

  const open = useMemo(() => invoices.filter(isOpen)
    .sort((a, b) => a.due_date.localeCompare(b.due_date) || a.seq - b.seq), [invoices])
  const overdue = open.filter(i => i.due_date < today)
  const totals = useMemo(() => sessionTotals(invoices), [invoices])
  const nextDue = open.find(i => i.due_date >= today)
  const allBills = useMemo(() => [...invoices].sort((a, b) => b.due_date.localeCompare(a.due_date) || b.seq - a.seq), [invoices])
  const receipts = payments.filter(p => p.receipt_no)

  // Until the student changes it, the selection is what needs paying now:
  // anything overdue or due within a month, else simply the next bill.
  useEffect(() => {
    if (touched) return
    const soon = open.filter(i => daysBetween(today, i.due_date) <= SOON_DAYS)
    setPicked(new Set((soon.length ? soon : open.slice(0, 1)).map(i => i.id)))
  }, [open, today, touched])

  const pickedBills = open.filter(i => picked.has(i.id))
  const pickedTotal = pickedBills.reduce((s, i) => s + (i.balance ?? 0), 0)

  const toggle = (id: string) => {
    setTouched(true)
    setPicked(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }
  const pickAll = () => {
    setTouched(true)
    setPicked(prev => prev.size === open.length ? new Set() : new Set(open.map(i => i.id)))
  }

  const student = { full_name: profile?.full_name, grade: profile?.grade, section: profile?.section }

  const downloadBill = async (inv: InvoiceRow) => {
    if (!year) return
    setBusyDoc(inv.id)
    try {
      await downloadStatement(await buildInvoice({
        number: inv.number, issue_date: inv.issue_date, due_date: inv.due_date,
        gross: inv.gross ?? 0, discount_total: inv.discount_total ?? 0,
        late_fee_total: inv.late_fee_total ?? 0, fine_total: inv.fine_total ?? 0,
        net: inv.net ?? 0, paid: inv.paid ?? 0, balance: inv.balance ?? 0, status: inv.status,
        lines: linesOf(inv.id).map(l => ({ label: l.label, amount: l.amount, kind: l.kind })),
        verify_token: inv.verify_token,
      }, student, year.code))
    } finally {
      setBusyDoc(null)
    }
  }

  const downloadReceipt = async (p: PaymentRow, allocs = allocations, invs = invoices) => {
    if (!p.receipt_no || !year) return
    setBusyDoc(p.id)
    try {
      await downloadStatement(await buildReceipt({
        receipt_no: p.receipt_no, paid_on: p.paid_on, method: METHOD_WORD[p.method] ?? p.method,
        amount: p.amount ?? 0, reference: p.reference, status: p.status,
        against: receiptAgainst(p, allocs, invs),
        verify_token: p.receipt_hash ?? p.id,
      }, student, year.code))
    } finally {
      setBusyDoc(null)
    }
  }

  /** From the pay sheet, after a payment: the receipt is newer than the page. */
  const downloadNewReceipt = async (paymentId: string) => {
    if (!profile || !year) return
    const pay = await fetchPayments({ academicYearId: year.id, studentId: profile.id })
    const p = pay.find(x => x.id === paymentId)
    if (!p) return
    const [al, inv] = await Promise.all([
      fetchAllocations([p.id]),
      fetchInvoices({ academicYearId: year.id, studentId: profile.id }),
    ])
    await downloadReceipt(p, al, inv)
  }

  const startPay = (bills: InvoiceRow[]) => {
    if (!bills.length || !online) return
    setOpenBill(null)
    setPaying(bills)
  }

  const bill = openBill ? invoices.find(i => i.id === openBill) ?? null : null

  return (
    <div data-page-theme="fees" className="overflow-x-clip" style={{ minHeight: '100vh' }}>
      <PageBanner
        settingKey="fees_banner"
        defaultBanner={FEES_BANNER_DEFAULT}
        icon={<Landmark size={26} className="text-white" />}
        title="My fees"
        subtitle="Bills, payments and receipts"
        actions={<YearToggle />}
        maxWidth="max-w-7xl 2xl:max-w-[1600px]"
        backgroundIcon={<IndianRupee size={150} className="text-white" />}
      />

      <div className={`${SHELL} px-4 sm:px-6 lg:px-8 pb-14`}>
        <div className="relative z-10 -mt-6 sm:-mt-7">
          {loading ? (
            <div className="fx-tile-dark h-[188px] flex items-center justify-center">
              <Loader2 className="animate-spin text-white/50" />
            </div>
          ) : (
            <Hero
              due={totals.due}
              overdue={overdue}
              nextDue={nextDue}
              paid={totals.paid}
              net={totals.net}
              share={totals.share}
              billed={invoices.some(i => i.status !== 'cancelled')}
              pickedTotal={pickedTotal}
              pickedCount={pickedBills.length}
              openCount={open.length}
              online={online}
              today={today}
              onPay={() => startPay(pickedBills)}
              onChoose={() => { setTab('due'); document.getElementById('fee-list')?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }}
            />
          )}
        </div>

        {error && <div className="mt-4"><Notice tone="error">{error}</Notice></div>}

        {pending.length > 0 && (
          <div className="mt-4">
            {pending.map(o => (
              <Notice key={o.id} tone="warn">
                {o.status === 'review'
                  ? <>Your online payment of {inr(o.amount)} on {fmtDate(o.created_at)} reached the school and is waiting for the office to match it to your bills. You don’t need to pay again.</>
                  : <>We’re confirming your online payment of {inr(o.amount)} with the bank. The receipt will appear here shortly.</>}
              </Notice>
            ))}
          </div>
        )}

        <div className="mt-4 sm:mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px] items-start">
          <div id="fee-list" className="min-w-0 scroll-mt-4">
            <FeeDeck
              title="Your fees"
              icon={Wallet}
              actions={
                <Segmented<Tab>
                  value={tab}
                  onChange={setTab}
                  options={[
                    { key: 'due', label: 'To pay', count: open.length },
                    { key: 'bills', label: 'All bills', count: invoices.length },
                    { key: 'receipts', label: 'Receipts', count: receipts.length },
                  ]}
                />
              }
            >
              {loading ? <Loading /> : tab === 'due' ? (
                <DueList
                  open={open}
                  picked={picked}
                  linesOf={linesOf}
                  today={today}
                  onToggle={toggle}
                  onPickAll={pickAll}
                  onOpen={setOpenBill}
                  pickedTotal={pickedTotal}
                  online={online}
                  onPay={() => startPay(pickedBills)}
                />
              ) : tab === 'bills' ? (
                <List>
                  <ListHead cols={BILL_COLS}>
                    <Col>Bill</Col><Col>Status</Col><Col right>Total</Col><Col right>Left</Col>
                  </ListHead>
                  {allBills.length === 0 ? (
                    <Empty>No bills have been issued to you this session.</Empty>
                  ) : allBills.map(inv => (
                    <Row key={inv.id} cols={BILL_COLS} onClick={() => setOpenBill(inv.id)}>
                      <div className={CELL.A1}>
                        <p className="text-[13.5px] font-medium text-slate-900 leading-snug break-words"><DocNo value={inv.number} /></p>
                        <p className="text-[11.5px] text-slate-500 truncate">{billFor(linesOf(inv.id))} · due {fmtDay(inv.due_date)}</p>
                      </div>
                      <div className={CELL.B2}>
                        <span className={INVOICE_CHIP[isOpen(inv) && inv.due_date < today ? 'overdue' : inv.status]}>
                          {INVOICE_LABEL[isOpen(inv) && inv.due_date < today ? 'overdue' : inv.status]}
                        </span>
                      </div>
                      <p className={`${CELL.B1} text-[12.5px] font-semibold tabular-nums text-slate-900 sm:text-right`}>{inr(inv.net)}</p>
                      <p className={`${CELL.DESKTOP} text-[12.5px] tabular-nums text-right ${isOpen(inv) ? 'font-semibold text-slate-900' : 'text-slate-400'}`}>
                        {isOpen(inv) ? inr(inv.balance) : '—'}
                      </p>
                    </Row>
                  ))}
                </List>
              ) : (
                <List>
                  <ListHead cols={RECEIPT_COLS}>
                    <Col>Receipt</Col><Col>Paid by</Col><Col right>Amount</Col><span />
                  </ListHead>
                  {receipts.length === 0 ? (
                    <Empty>No payments yet this session. Receipts appear here the moment a payment is made, online or at the office.</Empty>
                  ) : receipts.map(p => {
                    const reversed = p.status === 'reversed'
                    return (
                      <Row key={p.id} cols={RECEIPT_COLS} trailing={1}>
                        <div className={CELL.A1}>
                          <p className={`text-[13.5px] font-medium leading-snug break-words ${reversed ? 'text-slate-400 line-through' : 'text-slate-900'}`}>
                            <DocNo value={p.receipt_no!} />
                          </p>
                          <p className="text-[11.5px] text-slate-500">{fmtDate(p.paid_on)}</p>
                        </div>
                        <div className={CELL.A2}>
                          <span className="text-[12px] text-slate-600 sm:text-[12.5px]">{METHOD_WORD[p.method] ?? p.method}</span>
                          {reversed && <span className={`${CHIP} ml-1.5 bg-zinc-200/80 text-zinc-600`}>Reversed</span>}
                          {p.status === 'pending' && <span className={`${CHIP} ml-1.5 bg-[#FBF1D6] text-[#7A5D12]`}>Clearing</span>}
                        </div>
                        <p className={`${CELL.B1} text-[13px] font-semibold tabular-nums text-slate-900 sm:text-right`}>{inr(p.amount)}</p>
                        <div className={CELL.END}>
                          {p.status === 'verified' && (
                            <button type="button" aria-label={`Download receipt ${p.receipt_no}`} title="Download receipt"
                                    onClick={() => void downloadReceipt(p)} className={`${TAP} text-[#8B6F47]`}>
                              {busyDoc === p.id ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
                            </button>
                          )}
                        </div>
                      </Row>
                    )
                  })}
                </List>
              )}
            </FeeDeck>
          </div>

          <aside className="space-y-4 min-w-0">
            <TitledPanel title="This session">
              <div className="px-3.5 py-3 space-y-2">
                <Line label="Total fees" value={inr(totals.gross)} />
                {totals.savings > 0 && (
                  <Line label={<><Sparkles size={12} className="inline mr-1 -mt-0.5" />Concessions</>} value={`− ${inr(totals.savings)}`} tone="good" />
                )}
                {totals.extras > 0 && <Line label="Late fees and fines" value={`+ ${inr(totals.extras)}`} />}
                <Line label="Paid" value={`− ${inr(totals.paid)}`} tone="good" />
                <div className="pt-2 border-t border-[#EEEAE1]">
                  <Line label="Left to pay" value={inr(totals.due)} strong />
                </div>
              </div>
            </TitledPanel>

            {totals.savings > 0 && (
              <Notice tone="good">
                The school has taken {inr(totals.savings)} off your fees this session through discounts, scholarships or waivers.
                Each one is listed on the bill it applies to.
              </Notice>
            )}

            <TitledPanel title="Paying online">
              <ul className="px-3.5 py-3 space-y-2.5 text-[12.5px] text-slate-600 leading-relaxed">
                <li className="flex gap-2"><ShieldCheck size={15} className="text-[#1F6B42] flex-shrink-0 mt-0.5" />UPI, cards and net banking, through Razorpay, straight to the school’s account.</li>
                <li className="flex gap-2"><Receipt size={15} className="text-[#8B6F47] flex-shrink-0 mt-0.5" />Your receipt is made the moment the payment is confirmed, and is the same one the office prints.</li>
                <li className="flex gap-2"><CalendarClock size={15} className="text-[#8B6F47] flex-shrink-0 mt-0.5" />Late fees are added after a bill’s due date, so paying by then costs least.</li>
                <li className="flex gap-2"><AlertCircle size={15} className="text-[#8B6F47] flex-shrink-0 mt-0.5" />Money left your account but no receipt by the end of the day? Tell the school office the payment ID from your bank or UPI app.</li>
              </ul>
            </TitledPanel>
          </aside>
        </div>
      </div>

      <AnimatePresence>
        {bill && (
          <StudentBillSheet
            key={bill.id}
            invoice={bill}
            lines={linesOf(bill.id)}
            payments={payments}
            allocations={allocations}
            today={today}
            canPay={online}
            onPay={() => startPay([bill])}
            onDownloadBill={() => void downloadBill(bill)}
            onDownloadReceipt={p => void downloadReceipt(p)}
            onClose={() => setOpenBill(null)}
          />
        )}
        {paying && (
          <PaySheet
            key="pay"
            bills={paying}
            school={school}
            onClose={() => { setPaying(null); setTouched(false); void load(true) }}
            onPaid={() => void load(true)}
            onDownloadReceipt={downloadNewReceipt}
          />
        )}
      </AnimatePresence>
    </div>
  )
}

// ── The slab ────────────────────────────────────────────────────────────

function Hero({
  due, overdue, nextDue, paid, net, share, billed, pickedTotal, pickedCount, openCount, online, today, onPay, onChoose,
}: {
  due: number
  openCount: number
  overdue: InvoiceRow[]
  nextDue?: InvoiceRow
  paid: number
  net: number
  share: number
  billed: boolean
  pickedTotal: number
  pickedCount: number
  online: boolean
  today: string
  onPay: () => void
  onChoose: () => void
}) {
  const overdueSum = overdue.reduce((s, i) => s + (i.balance ?? 0), 0)
  const settled = due <= 0

  return (
    <section className="fx-tile-dark text-white p-5 sm:p-6 lg:p-7">
      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-5">
        <div className="min-w-0">
          {settled ? (
            <>
              <p className="flex items-center gap-2 text-[13px] text-white/70">
                <CheckCircle2 size={16} className="text-[#7FD3A0]" /> {billed ? 'All paid up' : 'Nothing billed yet'}
              </p>
              <p className="font-display text-[2.2rem] sm:text-[2.8rem] font-bold leading-none tabular-nums mt-2">{inr(0)}</p>
              <p className="text-[13px] text-white/60 mt-2.5">
                {billed ? 'Nothing is owed this session. Thank you.' : 'Bills appear here as soon as the school issues them.'}
              </p>
            </>
          ) : (
            <>
              <p className="text-[13px] text-white/70">Left to pay this session</p>
              <p className="font-display text-[2.4rem] sm:text-[3.1rem] font-bold leading-none tabular-nums mt-2">{inr(due)}</p>
              <p className="text-[13px] mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                {overdue.length > 0 ? (
                  <span className="inline-flex items-center gap-1.5 h-6 px-2.5 rounded-full bg-[#C24141]/25 text-[#FFB4B4] font-semibold text-[12px]">
                    <AlertCircle size={13} /> {inr(overdueSum)} overdue since {fmtDay(overdue[0].due_date)}
                  </span>
                ) : nextDue ? (
                  <span className="text-white/70">
                    Next due {fmtDate(nextDue.due_date)}
                    {daysBetween(today, nextDue.due_date) <= 14 && <span className="text-[#E9DDBB]"> · {dueWords(nextDue, today).text.toLowerCase()}</span>}
                  </span>
                ) : null}
              </p>
            </>
          )}
        </div>

        {!settled && (
          <div className="flex flex-col items-stretch sm:items-end gap-2 w-full sm:w-auto">
            <button
              type="button"
              onClick={onPay}
              disabled={!online || pickedCount === 0}
              className={`${ADMIN.goldBtn} !h-12 !px-6 !text-[15px] w-full sm:w-auto sm:min-w-[220px]`}
            >
              <Wallet size={17} /> {pickedCount ? `Pay ${inr(pickedTotal)}` : 'Pick a bill to pay'}
            </button>
            <button type="button" onClick={onChoose}
                    className="text-[12.5px] font-semibold text-white/70 hover:text-white text-center sm:text-right">
              {pickedCount} of {openCount} {openCount === 1 ? 'bill' : 'bills'} picked · change
            </button>
            {!online && (
              <p className="text-[12px] text-white/55 sm:text-right max-w-[260px]">
                Online payment isn’t switched on yet. The school office can take this at the counter.
              </p>
            )}
          </div>
        )}
      </div>

      {net > 0 && (
        <div className="mt-6">
          <div className="h-[5px] w-full bg-white/10 overflow-hidden" role="progressbar"
               aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(share * 100)}
               aria-label="Share of this session’s fees paid">
            <div className="h-full bg-gradient-to-r from-[#C7A84C] to-[#E9DDBB]" style={{ width: `${share * 100}%` }} />
          </div>
          <p className="text-[12px] text-white/60 mt-2 tabular-nums">
            {inr(paid)} paid of {inr(net)} · {Math.round(share * 100)}%
          </p>
        </div>
      )}
    </section>
  )
}

// ── To pay ──────────────────────────────────────────────────────────────

function DueList({
  open, picked, linesOf, today, onToggle, onPickAll, onOpen, pickedTotal, online, onPay,
}: {
  open: InvoiceRow[]
  picked: Set<string>
  linesOf: (id: string) => InvoiceLineRow[]
  today: string
  onToggle: (id: string) => void
  onPickAll: () => void
  onOpen: (id: string) => void
  pickedTotal: number
  online: boolean
  onPay: () => void
}) {
  if (!open.length) {
    return (
      <List>
        <div className="px-4 py-10 text-center">
          <span className="mx-auto w-11 h-11 rounded-full bg-[#E6F2EA] text-[#1F6B42] flex items-center justify-center">
            <Check size={20} strokeWidth={2.5} />
          </span>
          <p className="text-[14px] font-semibold text-slate-900 mt-3">Nothing to pay</p>
          <p className="text-[12.5px] text-slate-500 mt-1">Every bill this session is settled. Your receipts are under Receipts.</p>
        </div>
      </List>
    )
  }
  const all = picked.size === open.length
  return (
    <>
      <List>
        <ListHead cols={DUE_COLS}>
          <Box on={all} label={all ? 'Unpick all' : 'Pick all'} onClick={onPickAll} />
          <Col>Bill</Col><Col>When</Col><Col right>Amount</Col>
        </ListHead>
        {open.map(inv => {
          const on = picked.has(inv.id)
          const due = dueWords(inv, today)
          return (
            <Row key={inv.id} cols={DUE_COLS} lead onClick={() => onOpen(inv.id)}
                 className={on ? 'bg-[#FBF7EC]' : ''}>
              <div className={CELL_LEAD.PICK}>
                <Box on={on} label={`${on ? 'Unpick' : 'Pick'} ${inv.number}`} onClick={() => onToggle(inv.id)} />
              </div>
              <div className={CELL_LEAD.A1}>
                <p className="text-[13.5px] font-medium text-slate-900 leading-snug break-words">{billFor(linesOf(inv.id))}</p>
                <p className="text-[11.5px] text-slate-500 break-words"><DocNo value={inv.number} /></p>
              </div>
              <div className={CELL_LEAD.A2}>
                <p className={`text-[12px] font-semibold ${DUE_TONE[due.tone]}`}>{due.text}</p>
                <p className="text-[11.5px] text-slate-500 max-sm:hidden">{fmtDate(inv.due_date)}</p>
              </div>
              <div className={`${CELL_LEAD.B1} sm:text-right`}>
                <p className="text-[13.5px] font-semibold tabular-nums text-slate-900">{inr(inv.balance)}</p>
                {(inv.paid ?? 0) > 0 && <p className="text-[11px] text-slate-500 tabular-nums">of {inr(inv.net)}</p>}
              </div>
            </Row>
          )
        })}
      </List>

      {/* The total and the button follow the list down a phone, above the tab bar. */}
      <div className="sticky z-20 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] md:bottom-4 mt-2.5">
        <div className="fx-card fx-bleed flex items-center justify-between gap-3 px-3.5 py-2.5 shadow-[0_18px_40px_-18px_rgba(15,23,42,.55)]">
          <div className="min-w-0">
            <p className="text-[11.5px] text-slate-500">{picked.size} {picked.size === 1 ? 'bill' : 'bills'} picked</p>
            <p className="font-display text-[1.2rem] font-bold tabular-nums text-slate-900 leading-tight">{inr(pickedTotal)}</p>
          </div>
          <button type="button" onClick={onPay} disabled={!online || picked.size === 0} className={`${ADMIN.goldBtn} !h-10 !px-5 !text-[13.5px]`}>
            <Wallet size={15} /> Pay now
          </button>
        </div>
      </div>
    </>
  )
}

function Box({ on, label, onClick }: { on: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={on}
      aria-label={label}
      onClick={e => { e.stopPropagation(); onClick() }}
      className={`w-[22px] h-[22px] rounded-[7px] inline-flex items-center justify-center transition active:scale-90
                  focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B8983C]/60 ${
        on ? 'bg-gradient-to-b from-[#3D3B40] to-[#27272A] text-white shadow-[inset_0_1px_0_rgba(255,255,255,.16)]'
           : 'bg-white border border-slate-300 hover:border-slate-400'}`}
    >
      {on && <Check size={13} strokeWidth={3} />}
    </button>
  )
}

function Line({ label, value, tone, strong }: { label: React.ReactNode; value: string; tone?: 'good'; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className={`text-[13px] ${strong ? 'font-semibold text-slate-900' : tone === 'good' ? 'text-[#1F6B42]' : 'text-slate-500'}`}>{label}</span>
      <span className={`tabular-nums ${strong ? 'font-display text-[17px] font-bold text-slate-900' : 'text-[13px] font-medium'} ${
        tone === 'good' ? 'text-[#1F6B42]' : strong ? '' : 'text-slate-800'}`}>{value}</span>
    </div>
  )
}
