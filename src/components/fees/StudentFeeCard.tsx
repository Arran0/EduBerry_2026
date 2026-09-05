'use client'

// ─────────────────────────────────────────────────────────────────────────────
// What a student sees.
//
// The point is that nobody has to ring the office to ask what they owe. So the
// number is first, the breakdown under it is complete — including what the
// school has given them, itemised, because a concession a family cannot see is
// a concession they do not know they received — and every bill can be opened
// with its receipts attached.
//
// Read through the same RLS as everything else: a student's own policy lets
// them see their rows and nothing else.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import {
  CheckCircle2, ChevronDown, CreditCard, Download, Loader2, Sparkles,
} from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { useAcademicYear } from '@/contexts/AcademicYearContext'
import YearScope from '@/components/fees/config/YearScope'
import { fmtDate } from '@/components/fees/ui'
import { downloadStatement } from '@/components/fees/statements/generate'
import { buildInvoice, buildReceipt } from '@/components/fees/statements/invoiceGenerate'
import {
  fetchAllocations, fetchInvoiceLines, fetchInvoices, fetchPayments,
  type InvoiceLineRow, type InvoiceRow, type PaymentRow,
} from '@/lib/fees/invoices'

const money = (n: number | null | undefined) =>
  `₹${Number(n ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`

export default function StudentFeeCard() {
  const { profile } = useAuth()
  const { year } = useAcademicYear()
  const [invoices, setInvoices] = useState<InvoiceRow[]>([])
  const [lines, setLines] = useState<InvoiceLineRow[]>([])
  const [payments, setPayments] = useState<PaymentRow[]>([])
  const [allocations, setAllocations] = useState<{ payment_id: string; invoice_id: string; amount: number }[]>([])
  const [openId, setOpenId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!profile || !year) return
    setLoading(true)
    try {
      const [inv, pay] = await Promise.all([
        fetchInvoices({ academicYearId: year.id, studentId: profile.id }),
        fetchPayments({ academicYearId: year.id, studentId: profile.id }),
      ])
      setInvoices(inv.filter(i => i.status !== 'draft'))
      setPayments(pay)
      setLines(await fetchInvoiceLines(inv.map(i => i.id)))
      setAllocations(await fetchAllocations(pay.map(p => p.id)))
    } finally {
      setLoading(false)
    }
  }, [profile, year])

  useEffect(() => { void load() }, [load])

  const totals = useMemo(() => {
    const live = invoices.filter(i => i.status !== 'cancelled')
    return {
      gross: live.reduce((a, i) => a + (i.gross ?? 0), 0),
      savings: live.reduce((a, i) => a + (i.discount_total ?? 0), 0),
      extras: live.reduce((a, i) => a + (i.late_fee_total ?? 0) + (i.fine_total ?? 0), 0),
      paid: live.reduce((a, i) => a + (i.paid ?? 0), 0),
      due: live.reduce((a, i) => a + (i.balance ?? 0), 0),
    }
  }, [invoices])

  const downloadReceipt = async (payment: PaymentRow) => {
    if (!payment.receipt_no || !year) return
    const against = allocations.filter(a => a.payment_id === payment.id).map(a => ({
      number: invoices.find(i => i.id === a.invoice_id)?.number ?? '—',
      amount: a.amount,
    }))
    await downloadStatement(await buildReceipt({
      receipt_no: payment.receipt_no, paid_on: payment.paid_on, method: payment.method,
      amount: payment.amount ?? 0, reference: payment.reference, status: payment.status,
      against, verify_token: payment.receipt_hash ?? payment.id,
    }, { full_name: profile?.full_name, grade: profile?.grade, section: profile?.section },
      year.code))
  }

  const downloadInvoice = async (invoice: InvoiceRow) => {
    if (!year) return
    await downloadStatement(await buildInvoice({
      number: invoice.number, issue_date: invoice.issue_date, due_date: invoice.due_date,
      gross: invoice.gross ?? 0, discount_total: invoice.discount_total ?? 0,
      late_fee_total: invoice.late_fee_total ?? 0, fine_total: invoice.fine_total ?? 0,
      net: invoice.net ?? 0, paid: invoice.paid ?? 0, balance: invoice.balance ?? 0,
      status: invoice.status,
      lines: lines.filter(l => l.invoice_id === invoice.id)
        .map(l => ({ label: l.label, amount: l.amount, kind: l.kind })),
      verify_token: invoice.verify_token,
    }, { full_name: profile?.full_name, grade: profile?.grade, section: profile?.section },
      year.code))
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-violet-50 to-white flex items-center justify-center">
        <Loader2 className="animate-spin text-violet-400" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-violet-50 via-white to-white pb-16">
      <div className="max-w-2xl mx-auto px-4 pt-6 space-y-5">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-lg font-bold text-slate-800">My fees</h1>
          <YearScope />
        </div>

        <motion.div
          initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
          className="rounded-2xl bg-gradient-to-br from-violet-500 to-purple-600 text-white p-6 shadow-lg shadow-violet-200"
        >
          {totals.due > 0 ? (
            <>
              <p className="text-violet-100 text-sm">Still to pay</p>
              <p className="text-4xl font-bold mt-1">{money(totals.due)}</p>
              <p className="text-violet-100 text-xs mt-2">
                {invoices.filter(i => (i.balance ?? 0) > 0).length} bill
                {invoices.filter(i => (i.balance ?? 0) > 0).length === 1 ? '' : 's'} outstanding
              </p>
            </>
          ) : (
            <>
              <CheckCircle2 size={28} className="mb-2" />
              <p className="text-2xl font-bold">All paid up</p>
              <p className="text-violet-100 text-sm mt-1">
                {invoices.length === 0
                  ? 'Nothing has been billed to you this session.'
                  : 'Thank you — nothing is outstanding.'}
              </p>
            </>
          )}
        </motion.div>

        {invoices.length > 0 && (
          <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-2.5">
            <h2 className="text-sm font-bold text-slate-800 mb-2">The full picture</h2>
            <Row label="Total fees" value={money(totals.gross)} />
            {totals.savings > 0 && (
              <Row
                label={<span className="inline-flex items-center gap-1.5">
                  <Sparkles size={13} className="text-emerald-500" /> What the school gave you
                </span>}
                value={`− ${money(totals.savings)}`}
                tone="emerald"
              />
            )}
            {totals.extras > 0 && (
              <Row label="Late fees and fines" value={`+ ${money(totals.extras)}`} />
            )}
            <Row label="Paid so far" value={`− ${money(totals.paid)}`} tone="emerald" />
            <div className="pt-2.5 border-t border-slate-100">
              <Row label="Left to pay" value={money(totals.due)} strong />
            </div>
          </div>
        )}

        {totals.savings > 0 && (
          <p className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-xl px-4 py-3">
            {money(totals.savings)} of your fees has been covered by discounts, scholarships or
            waivers the school has given you.
          </p>
        )}

        {invoices.length > 0 && (
          <div className="space-y-2">
            <h2 className="text-sm font-bold text-slate-800">Your bills</h2>
            {invoices.map(inv => {
              const open = openId === inv.id
              const paid = (inv.balance ?? 0) === 0
              const settled = allocations.filter(a => a.invoice_id === inv.id)
              return (
                <div key={inv.id} className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
                  <button onClick={() => setOpenId(open ? null : inv.id)}
                          className="w-full flex items-center gap-3 px-4 py-3.5 text-left">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-slate-800">
                        {inv.number}
                        {inv.status === 'cancelled' && (
                          <span className="ml-2 text-xs font-normal text-rose-600">cancelled</span>
                        )}
                      </div>
                      <div className="text-xs text-slate-400">Due {fmtDate(inv.due_date)}</div>
                    </div>
                    <div className="text-right">
                      <div className={`text-sm font-bold ${paid ? 'text-emerald-600' : 'text-slate-800'}`}>
                        {paid ? 'Paid' : money(inv.balance)}
                      </div>
                      {!paid && (inv.paid ?? 0) > 0 && (
                        <div className="text-xs text-slate-400">of {money(inv.net)}</div>
                      )}
                    </div>
                    <ChevronDown size={16}
                                 className={`text-slate-300 transition-transform ${open ? 'rotate-180' : ''}`} />
                  </button>

                  {open && (
                    <div className="px-4 pb-4 space-y-3 border-t border-slate-100 pt-3">
                      <div className="space-y-1">
                        {lines.filter(l => l.invoice_id === inv.id).map(l => (
                          <div key={l.id} className="flex justify-between text-sm">
                            <span className={l.amount < 0 ? 'text-emerald-600' : 'text-slate-500'}>
                              {l.label}
                            </span>
                            <span className={l.amount < 0 ? 'text-emerald-600' : 'text-slate-700'}>
                              {l.amount < 0 ? `− ${money(Math.abs(l.amount))}` : money(l.amount)}
                            </span>
                          </div>
                        ))}
                      </div>

                      {settled.length > 0 && (
                        <div className="pt-2 border-t border-slate-100 space-y-1.5">
                          <p className="text-xs font-semibold text-slate-500">Payments</p>
                          {settled.map(a => {
                            const p = payments.find(x => x.id === a.payment_id)
                            if (!p) return null
                            return (
                              <div key={a.payment_id} className="flex items-center justify-between gap-2">
                                <span className={`text-xs ${p.status === 'reversed' ? 'text-slate-400 line-through' : 'text-slate-600'}`}>
                                  {fmtDate(p.paid_on)} · {money(a.amount)} · {p.method}
                                </span>
                                {p.status === 'verified' && (
                                  <button onClick={() => void downloadReceipt(p)}
                                          className="text-xs text-violet-600 hover:underline inline-flex items-center gap-1">
                                    <Download size={11} /> Receipt
                                  </button>
                                )}
                              </div>
                            )
                          })}
                        </div>
                      )}

                      <button onClick={() => void downloadInvoice(inv)}
                              className="w-full text-xs text-slate-500 hover:text-slate-700 border border-slate-200 rounded-lg py-2 inline-flex items-center justify-center gap-1.5">
                        <Download size={12} /> Download this bill
                      </button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {totals.due > 0 && (
          <p className="text-xs text-slate-400 text-center leading-relaxed px-4">
            <CreditCard size={12} className="inline mr-1" />
            Paying online arrives shortly. Until then the school office can take this at the counter,
            and every receipt you have already been given is downloadable above.
          </p>
        )}
      </div>
    </div>
  )
}

function Row({
  label, value, tone, strong,
}: {
  label: React.ReactNode; value: string; tone?: 'emerald'; strong?: boolean
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className={`text-sm ${strong ? 'font-bold text-slate-800' : 'text-slate-500'}`}>{label}</span>
      <span className={`text-sm ${
        strong ? 'font-bold text-slate-900 text-base'
        : tone === 'emerald' ? 'text-emerald-600 font-medium'
        : 'text-slate-700 font-medium'}`}>
        {value}
      </span>
    </div>
  )
}
