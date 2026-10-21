'use client'

// ─────────────────────────────────────────────────────────────────────────────
// One student's fee account.
//
// The figures answer what a parent asks at the counter — what do I owe — and
// the bills and receipts under them are the evidence. A bill opens the same
// popup the Bills tab uses, which is where money is taken, receipts printed
// and cheques cleared. The ledger (every debit and credit in order, with a
// running balance) is one button away.
//
// Concessions are given from Pricing, not here, and late fees and fines are
// lines on the bills they were added to, so neither needs a screen of its own.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import { FileText, Loader2, Printer, ScrollText, Undo2, UserRound } from 'lucide-react'
import ModalShell from '@/components/ui/ModalShell'
import Avatar from '@/components/Avatar'
import ProtectedLayout from '@/components/ProtectedLayout'
import YearToggle from '@/components/transport/YearToggle'
import { AcademicYearProvider, useAcademicYear } from '@/contexts/AcademicYearContext'
import { useFeePermissions } from '@/hooks/useFeePermissions'
import { CHIP, FEE_ICON, fmtDate, fmtDay, inr } from '@/components/fees/ui'
import { Btn, CELL, Col, Empty, FeeScreen, List, ListHead, Notice, Row, StatStrip, TAP, TitledPanel } from '@/components/fees/shell'
import NoAccess from '@/components/fees/NoAccess'
import BillSheet, { BillChips } from '@/components/fees/BillSheet'
import { DocNo } from '@/components/fees/glass'
import { gradeLabel } from '@/lib/grades'
import { supabase } from '@/lib/supabase'
import { todayIn } from '@/lib/fees/engine/dates'
import { MODE_LABEL, billState, modeOf } from '@/lib/fees/bills'
import { buildReceipt, printSpec } from '@/components/fees/statements/invoiceGenerate'
import { downloadStatement } from '@/components/fees/statements/generate'
import {
  fetchAllocations, fetchInvoiceLines, fetchInvoices, fetchLedger, fetchPayments, fetchProfile,
  type FeeProfileRow, type InvoiceLineRow, type InvoiceRow, type LedgerRow, type PaymentRow,
} from '@/lib/fees/invoices'
import RequestRefundSheet from '@/components/fees/reports/RequestRefundSheet'

/** The lists' columns once there is room for columns; a phone gets cards. */
const BILL_COLS = 'sm:grid-cols-[minmax(150px,1fr)_64px_minmax(0,124px)_84px_84px]'
const RECEIPT_COLS = 'sm:grid-cols-[minmax(0,1fr)_minmax(0,150px)_100px_76px]'
const LEDGER_COLS = 'sm:grid-cols-[96px_minmax(0,1fr)_100px_100px_108px]'

interface Student {
  id: string; full_name: string; grade: number | null; section: string | null
  avatar_url: string | null; admission_no: string | null; guardian_phone: string | null
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
  const [ledger, setLedger] = useState<LedgerRow[]>([])
  const [ledgerOpen, setLedgerOpen] = useState(false)
  const [openBill, setOpenBill] = useState<string | null>(null)
  const [refunding, setRefunding] = useState(false)
  const [printing, setPrinting] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const showAmounts = !perms.amountsHidden
  const today = todayIn()

  const load = useCallback(async () => {
    if (!year || !studentId) return
    setLoading(true)
    try {
      const [{ data: p }, { data: d }, prof, inv, pay, led] = await Promise.all([
        supabase.from('profiles').select('id, full_name, grade, section, avatar_url').eq('id', studentId).maybeSingle(),
        supabase.from('student_details').select('admission_no, guardian_phone').eq('student_id', studentId).maybeSingle(),
        fetchProfile(studentId, year.id),
        fetchInvoices({ academicYearId: year.id, studentId }),
        fetchPayments({ academicYearId: year.id, studentId }),
        fetchLedger(studentId, year.id),
      ])
      if (p) {
        setStudent({
          id: p.id as string,
          full_name: p.full_name as string,
          grade: p.grade as number | null,
          section: p.section as string | null,
          avatar_url: (p.avatar_url as string | null) ?? null,
          admission_no: (d?.admission_no as string) ?? null,
          guardian_phone: (d?.guardian_phone as string) ?? null,
        })
      }
      setProfile(prof); setInvoices(inv); setPayments(pay); setLedger(led)
      const [ln, alloc] = await Promise.all([
        fetchInvoiceLines(inv.map(i => i.id)),
        fetchAllocations(pay.map(x => x.id)),
      ])
      setLines(ln); setAllocations(alloc)
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

  /** Each bill's state, worked out the way the Bills tab does it. */
  const states = useMemo(() => {
    const paidOn = new Map(payments.filter(p => p.status === 'verified').map(p => [p.id, p.paid_on]))
    const last = new Map<string, string>()
    for (const a of allocations) {
      const on = paidOn.get(a.payment_id)
      if (on && (!last.has(a.invoice_id) || on > last.get(a.invoice_id)!)) last.set(a.invoice_id, on)
    }
    return new Map(invoices.map(i => [i.id, billState(
      i, lines.filter(l => l.invoice_id === i.id), last.get(i.id) ?? null, today)]))
  }, [invoices, lines, payments, allocations, today])

  const printReceipt = async (payment: PaymentRow, thermal: boolean) => {
    if (!student || !year || !payment.receipt_no) return
    setPrinting(`${thermal ? 't' : 'a'}-${payment.id}`)
    try {
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
    } finally {
      setPrinting(null)
    }
  }

  if (perms.loading) {
    return <div className="p-10 flex justify-center"><Loader2 className="animate-spin text-slate-400" /></div>
  }
  if (!perms.can('fees.profile.view')) return <NoAccess what="see student fee profiles" />

  const cls = student?.grade === null || student?.grade === undefined ? null
    : `${gradeLabel(student.grade)}${student.section ? ` ${student.section}` : ''}`

  return (
    <FeeScreen
      title={student?.full_name ?? 'Student'}
      subtitle={[cls, student?.admission_no ? `Adm. ${student.admission_no}` : null, student?.guardian_phone]
        .filter(Boolean).join(' · ') || undefined}
      icon={<UserRound size={19} />}
      lead={student && (
        <span className="flex-shrink-0" title="Open student profile">
          <Avatar avatarUrl={student.avatar_url} name={student.full_name} size={44} userId={student.id}
                  profileSeed={{ id: student.id, full_name: student.full_name, avatar_url: student.avatar_url ?? undefined }} />
        </span>
      )}
      back={{ href: '/more/fees?section=students', label: 'Students' }}
      actions={<>
        {ledger.length > 0 && (
          <Btn onClick={() => setLedgerOpen(true)}><ScrollText size={14} /> Ledger</Btn>
        )}
        {perms.can('fees.collect') && profile && (
          <Btn tone="dark" onClick={() => setRefunding(true)}><Undo2 size={14} /> Refund</Btn>
        )}
        <YearToggle />
      </>}
    >
      {loading ? (
        <div className="fx-card py-16 flex justify-center"><Loader2 className="animate-spin text-slate-400" /></div>
      ) : !profile ? (
        <div className="fx-card">
          <Empty>
            {student?.full_name ?? 'This student'} has no fee account in {year?.code}. One is made the
            first time a fee is issued to them from Pricing.
          </Empty>
        </div>
      ) : (
        <div className="space-y-3 sm:space-y-4">
          <StatStrip stats={[
            { label: 'Billed', value: inr(totals.billed, showAmounts) },
            { label: 'Concessions', value: inr(totals.concessions, showAmounts) },
            { label: 'Paid', value: inr(totals.paid, showAmounts), tone: '#1F6B42' },
            { label: 'Still owed', value: inr(totals.due, showAmounts),
              tone: totals.due > 0 ? '#8A6A12' : undefined, strong: true },
          ]} />

          {profile.structure_source && (
            <Notice>
              <span className="font-semibold">Why this price: </span>
              {profile.structure_source.why}
              {profile.prorate_from ? ` Charged only from ${fmtDate(profile.prorate_from)}, as a mid-year joiner.` : ''}
            </Notice>
          )}

          {/* Bills and receipts side by side once there is room: the two
              halves of the same account, read against each other. */}
          <div className="grid gap-3 sm:gap-4 xl:grid-cols-2 items-start">
            <TitledPanel title="Bills" count={invoices.length || undefined}
                         right={<span className="text-[12px] text-slate-500">Open a bill to take a payment</span>}>
              {invoices.length === 0 ? (
                <Empty>No bills issued to this student yet.</Empty>
              ) : (
                <>
                  <ListHead cols={BILL_COLS}>
                    <Col>Bill</Col><Col>Due</Col><Col>Status</Col><Col right>Billed</Col><Col right>Owing</Col>
                  </ListHead>
                  {invoices.map(i => {
                    const st = states.get(i.id) ?? { pay: 'unpaid' as const, timing: 'on_time' as const }
                    const first = lines.find(l => l.invoice_id === i.id)
                    const owing = st.pay === 'unpaid' || st.pay === 'partial'
                    const dead = st.pay === 'cancelled'
                    return (
                      <Row key={i.id} cols={BILL_COLS} onClick={() => setOpenBill(i.id)}>
                        <span className={`${CELL.A1} min-w-0`}>
                          <span className="block text-[13px] font-semibold text-slate-900 break-words tabular-nums"><DocNo value={i.number} /></span>
                          <span className="block text-[11.5px] text-slate-500 leading-snug break-words">
                            {first?.label ?? '—'}
                            <span className="sm:hidden"> · due {fmtDay(i.due_date)}</span>
                          </span>
                        </span>
                        <span className={`${CELL.DESKTOP} text-[12.5px] tabular-nums ${st.timing === 'overdue' ? 'text-[#A93232] font-semibold' : 'text-slate-600'}`}>
                          {fmtDay(i.due_date)}
                        </span>
                        <span className={`${CELL.B2} min-w-0`}>
                          <BillChips pay={st.pay} timing={st.timing} className="justify-end sm:justify-start" />
                        </span>
                        <span className={`${CELL.DESKTOP} text-right text-[12.5px] tabular-nums ${dead ? 'text-slate-400 line-through' : 'text-slate-600'}`}>
                          {inr(i.net, showAmounts)}
                        </span>
                        <span className={`${CELL.B1} text-right text-[13.5px] font-bold tabular-nums ${
                          dead ? 'text-slate-400 line-through' : owing ? 'text-[#8A6A12]' : 'text-slate-900'}`}>
                          <span className="sm:hidden">{inr(owing ? i.balance : i.net, showAmounts)}</span>
                          <span className="max-sm:hidden">{dead || st.pay === 'carried' ? '—' : inr(i.balance, showAmounts)}</span>
                        </span>
                      </Row>
                    )
                  })}
                </>
              )}
            </TitledPanel>

            <TitledPanel title="Receipts" count={payments.length || undefined}>
              {payments.length === 0 ? (
                <Empty>No payments taken from this student yet.</Empty>
              ) : (
                <>
                  <ListHead cols={RECEIPT_COLS}>
                    <Col>Receipt</Col><Col>Paid by</Col><Col right>Amount</Col><Col right>&nbsp;</Col>
                  </ListHead>
                  {payments.map(p => (
                    <Row key={p.id} cols={RECEIPT_COLS} trailing={perms.can('fees.receipt.print') ? 2 : undefined}
                         below={p.reversal_reason ? (
                           <p className="text-[12px] text-[#962C2C]">Reversed: {p.reversal_reason}</p>
                         ) : null}>
                      <span className={`${CELL.A1} min-w-0`}>
                        <span className="block text-[13px] font-semibold text-slate-900 break-words tabular-nums">{p.receipt_no ? <DocNo value={p.receipt_no} /> : '—'}</span>
                        <span className="block text-[11.5px] text-slate-500">{fmtDate(p.paid_on)}</span>
                      </span>
                      <span className={`${CELL.A2} text-[12px] text-slate-600 break-words`}>
                        {MODE_LABEL[modeOf(p.method)]}{p.reference ? ` · ${p.reference}` : ''}
                        {p.status !== 'verified' && (
                          <span className={`${CHIP} ml-1.5 ${p.status === 'reversed' ? 'bg-[#FBE7E7] text-[#A93232]' : 'bg-[#FBF1D6] text-[#7A5D12]'}`}>
                            {p.status === 'reversed' ? 'Reversed' : 'Not cleared'}
                          </span>
                        )}
                      </span>
                      <span className={`${CELL.B1} text-right text-[13.5px] font-bold tabular-nums ${
                        p.status === 'reversed' ? 'text-slate-400 line-through' : 'text-slate-900'}`}>
                        {inr(p.amount, showAmounts)}
                      </span>
                      <span className={`${CELL.END} flex items-center justify-end gap-1`}>
                        {perms.can('fees.receipt.print') && p.receipt_no && (
                          <>
                            <button onClick={() => void printReceipt(p, true)} title="Print on the receipt printer"
                                    aria-label="Print on the receipt printer" className={`${TAP} text-slate-500 hover:text-slate-900`}>
                              {printing === `t-${p.id}` ? <Loader2 size={15} className="animate-spin" /> : <Printer size={15} />}
                            </button>
                            <button onClick={() => void printReceipt(p, false)} title="Download the A4 receipt"
                                    aria-label="Download the A4 receipt" className={`${TAP} text-slate-500 hover:text-slate-900`}>
                              {printing === `a-${p.id}` ? <Loader2 size={15} className="animate-spin" /> : <FileText size={15} />}
                            </button>
                          </>
                        )}
                      </span>
                    </Row>
                  ))}
                </>
              )}
            </TitledPanel>
          </div>
        </div>
      )}

      {ledgerOpen && (
        <ModalShell
          onClose={() => setLedgerOpen(false)}
          sharp size="2xl"
          title="Ledger"
          subtitle="Every charge and payment in order, with the running balance"
          icon={<ScrollText size={16} />}
          iconClassName={FEE_ICON}
        >
          <List className="!mx-0 sm:!mx-0 max-sm:!border-x">
            <ListHead cols={LEDGER_COLS}>
              <Col>Date</Col><Col>Entry</Col>
              <Col right>Charged</Col><Col right>Paid</Col><Col right>Balance</Col>
            </ListHead>
            {ledger.map(l => (
              <Row key={l.id} cols={LEDGER_COLS}>
                <span className={`${CELL.A2} text-[12px] text-slate-500 whitespace-nowrap`}>{fmtDate(l.entry_date)}</span>
                <span className={`${CELL.A1} text-[13px] text-slate-800 break-words`}>{l.note ?? l.kind}</span>
                <span className={`${CELL.B2} text-[12px] text-right text-slate-600 tabular-nums`}>
                  {(l.debit ?? 0) > 0 ? <>{inr(l.debit, showAmounts)}<span className="sm:hidden"> charged</span></> : ''}
                </span>
                <span className={`${CELL.B3} text-[12px] text-right text-[#1F6B42] tabular-nums`}>
                  {(l.credit ?? 0) > 0 ? <>{inr(l.credit, showAmounts)}<span className="sm:hidden"> paid</span></> : ''}
                </span>
                <span className={`${CELL.B1} text-[13px] text-right font-bold text-slate-900 tabular-nums`}>
                  {inr(l.balance_after, showAmounts)}
                </span>
              </Row>
            ))}
          </List>
        </ModalShell>
      )}

      {openBill && (
        <BillSheet
          invoiceId={openBill}
          showProfileLink={false}
          onClose={() => setOpenBill(null)}
          onChanged={() => void load()}
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

export default function FeeProfilePage() {
  return (
    <ProtectedLayout staffOnly>
      <AcademicYearProvider>
        <ProfileInner />
      </AcademicYearProvider>
    </ProtectedLayout>
  )
}
