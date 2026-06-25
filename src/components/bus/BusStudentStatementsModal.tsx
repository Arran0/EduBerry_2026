'use client'

import React, { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import dynamic from 'next/dynamic'
import {
  X, Receipt, AlertTriangle, BadgeCheck, CalendarRange, Loader2, ChevronLeft, Download,
} from 'lucide-react'
import Avatar from '@/components/Avatar'
import { UserProfile, getRoleDisplayName } from '@/lib/supabase'
import { SchoolFee, SchoolFeePayment } from '@/lib/fees'
import {
  BusFee, PassengerPayment, academicYearOf, currentAcademicYear,
  BUS_METHOD_LABELS, fetchFeesForPassenger, fetchVerifiedPaymentsForPassenger,
} from '@/lib/bus'
import { formatINR } from '@/components/bus/FeeCollectionSummary'
import {
  StatementSpec, buildOutstanding, buildNoDue, buildAnnual, buildFeeReceipt, hasNoDue,
} from '@/components/fees/statements/generate'

const StatementPreviewModal = dynamic(() => import('@/components/fees/statements/StatementPreviewModal'))

interface Props {
  passenger: UserProfile
  onClose: () => void
}

/** Short, human-readable receipt number derived from a payment / fee id. */
function shortId(id: string): string { return id.replace(/-/g, '').slice(0, 10).toUpperCase() }

function fmtDate(d?: string | null): string {
  if (!d) return '—'
  const dt = new Date(d)
  return isNaN(dt.getTime()) ? '—' : dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

/** Bus fees mirror the school fee shape closely enough to reuse the school
 *  statement builders — map a BusFee onto the SchoolFee fields they read. */
function toSchoolFee(f: BusFee, student?: UserProfile | null): SchoolFee {
  return {
    id: f.id,
    fee_head_id: f.fee_head_id,
    student_id: f.passenger_id,
    amount: f.amount,
    description: f.description,
    due_date: f.due_date,
    status: f.status,
    academic_year: academicYearOf(f.due_date ?? f.created_at),
    upi_reference: f.upi_reference,
    created_by: f.created_by ?? null,
    created_at: f.created_at,
    updated_at: f.updated_at,
    student: student ?? null,
    fee_head: f.fee_head ?? null,
  }
}

/** Build a SchoolFee from the partial fee carried on a verified payment. */
function paymentFeeToSchoolFee(p: PassengerPayment, student?: UserProfile | null): SchoolFee | null {
  if (!p.fee) return null
  return {
    id: p.fee.id,
    fee_head_id: p.fee.fee_head_id,
    student_id: p.fee.passenger_id,
    amount: p.fee.amount,
    description: p.fee.description,
    due_date: p.fee.due_date,
    status: 'paid',
    academic_year: academicYearOf(p.fee.due_date ?? p.fee.created_at),
    upi_reference: p.fee.upi_reference,
    created_by: null,
    created_at: p.fee.created_at,
    updated_at: p.fee.updated_at,
    student: student ?? null,
    fee_head: p.fee.fee_head ?? null,
  }
}

/** Passenger "financial statements" popup for the Bus Manager — mirrors the
 *  school StudentStatementsModal so both fee surfaces feel like one product. */
export default function BusStudentStatementsModal({ passenger, onClose }: Props) {
  const capturedYear = currentAcademicYear()
  const [allFees, setAllFees] = useState<BusFee[]>([])
  const [loadingFees, setLoadingFees] = useState(true)
  const [preview, setPreview] = useState<{ spec: StatementSpec; title: string } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  // Fee Receipt picker — the passenger's verified payments, loaded on demand.
  const [receiptMode, setReceiptMode] = useState(false)
  const [payments, setPayments] = useState<PassengerPayment[]>([])
  const [loadingPayments, setLoadingPayments] = useState(false)

  useEffect(() => {
    setLoadingFees(true)
    fetchFeesForPassenger(passenger.id).then(f => { setAllFees(f); setLoadingFees(false) })
  }, [passenger.id])

  const schoolFees = allFees.map(f => toSchoolFee(f, passenger))
  const yearFees = schoolFees.filter(f => f.academic_year === capturedYear)
  const noDue = !loadingFees && hasNoDue(schoolFees)

  const openPreview = async (key: string, title: string, builder: () => Promise<StatementSpec>) => {
    setBusy(key)
    try { setPreview({ spec: await builder(), title }) }
    catch (e) { console.error('bus statement generation failed:', e) }
    setBusy(null)
  }

  const openReceipts = () => {
    setReceiptMode(true)
    setLoadingPayments(true)
    fetchVerifiedPaymentsForPassenger(passenger.id).then(p => { setPayments(p); setLoadingPayments(false) })
  }

  const openReceipt = async (p: PassengerPayment) => {
    const fee = paymentFeeToSchoolFee(p, passenger)
    if (!fee) return
    setBusy(p.id)
    try {
      const spec = await buildFeeReceipt(fee, passenger, p as unknown as SchoolFeePayment)
      setPreview({ spec, title: `Fee Receipt · ${passenger.full_name}` })
    } catch (e) { console.error('receipt generation failed:', e) }
    setBusy(null)
  }

  const DOCS = [
    {
      key: 'r', label: 'Receipt', sub: 'Per payment',
      icon: <Receipt size={15} />,
      onClick: openReceipts,
    },
    {
      key: 'd', label: 'Dues', sub: 'All years',
      icon: <AlertTriangle size={15} />,
      onClick: () => openPreview('d', `Outstanding Dues · ${passenger.full_name}`, () => buildOutstanding(passenger, undefined, schoolFees)),
    },
    {
      key: 'a', label: 'Annual', sub: capturedYear,
      icon: <CalendarRange size={15} />,
      onClick: () => openPreview('a', `Annual Statement · ${passenger.full_name}`, () => buildAnnual(passenger, capturedYear, yearFees)),
    },
    {
      key: 'n', label: 'No-Due', sub: 'All years',
      icon: <BadgeCheck size={15} />, disabled: !noDue,
      title: noDue ? 'Preview No-Due Certificate' : 'Blocked — outstanding dues exist',
      onClick: () => openPreview('n', `No-Due Certificate · ${passenger.full_name}`, () => buildNoDue(passenger, capturedYear)),
    },
  ]

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4 bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 40, opacity: 0 }}
        transition={{ type: 'spring', damping: 25, stiffness: 300 }}
        className="bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl w-full sm:max-w-2xl max-h-[92dvh] sm:max-h-[88vh] overflow-hidden flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="w-10 h-1 bg-slate-200 rounded-full mx-auto mt-3 mb-1 sm:hidden" />
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#E4E4E7] flex-shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            {receiptMode && (
              <button onClick={() => setReceiptMode(false)} title="Back"
                className="p-1.5 -ml-1.5 text-[#A1A1AA] hover:text-[#27272A] hover:bg-[#F4F4F5] rounded-lg flex-shrink-0">
                <ChevronLeft size={18} />
              </button>
            )}
            <Avatar avatarUrl={passenger.avatar_url} name={passenger.full_name} size={36} userId={passenger.id} />
            <div className="min-w-0">
              <p className="font-bold text-[#18181B] text-sm truncate">{passenger.full_name}</p>
              <p className="text-[11px] text-[#71717A]">
                {passenger.grade != null
                  ? `Grade ${passenger.grade}${passenger.section ? ` ${passenger.section}` : ''}`
                  : getRoleDisplayName(passenger.role)}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 text-[#A1A1AA] hover:text-[#27272A] hover:bg-[#F4F4F5] rounded-lg flex-shrink-0">
            <X size={16} />
          </button>
        </div>

        {receiptMode ? (
          /* ── Fee Receipt picker ── */
          <div className="p-4 overflow-y-auto">
            <p className="text-[10px] font-bold uppercase tracking-widest text-[#71717A] mb-3">Bus Fee Receipts</p>
            {loadingPayments ? (
              <div className="flex items-center justify-center gap-2 py-8 text-[#A1A1AA]">
                <Loader2 size={18} className="animate-spin" />
                <span className="text-sm">Loading payments…</span>
              </div>
            ) : payments.length === 0 ? (
              <div className="py-10 text-center">
                <Receipt size={28} className="mx-auto mb-3 text-[#D4D4D8]" />
                <p className="text-sm text-[#71717A]">No payments recorded yet.</p>
                <p className="text-[11px] text-[#A1A1AA] mt-1">Receipts appear here once a payment is verified.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {payments.map(p => {
                  const ref = p.upi_txn_ref || p.razorpay_payment_id || p.fee?.upi_reference || '—'
                  const particulars = p.fee?.description || p.fee?.fee_head?.name || 'Bus fee'
                  return (
                    <button key={p.id} onClick={() => openReceipt(p)} disabled={busy === p.id}
                      className="w-full flex items-center gap-3 p-3 rounded-xl border border-[#E4E4E7] bg-white hover:border-[#A8896B] hover:bg-[#FBFAF7] transition-all text-left disabled:opacity-50">
                      <div className="w-9 h-9 rounded-lg bg-[#27272A] flex items-center justify-center flex-shrink-0">
                        <Receipt size={16} className="text-[#B8983C]" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-[#18181B] truncate">
                          {formatINR(Number(p.amount) || 0)} · {BUS_METHOD_LABELS[p.method] ?? p.method}
                        </p>
                        <p className="text-[11px] text-[#71717A] truncate">
                          No. {shortId(p.id)} · {fmtDate(p.verified_at)} · {particulars}
                        </p>
                        <p className="text-[10px] text-[#A1A1AA] truncate">Proof of payment: {ref}</p>
                      </div>
                      {busy === p.id
                        ? <Loader2 size={16} className="animate-spin text-[#A8896B] flex-shrink-0" />
                        : <Download size={16} className="text-[#A8896B] flex-shrink-0" />}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        ) : (
          /* ── Statement buttons ── */
          <div className="p-4 overflow-y-auto">
            <p className="text-[10px] font-bold uppercase tracking-widest text-[#71717A] mb-3">Financial Statements</p>
            {loadingFees ? (
              <div className="flex items-center justify-center gap-2 py-8 text-[#A1A1AA]">
                <Loader2 size={18} className="animate-spin" />
                <span className="text-sm">Loading…</span>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {DOCS.map(doc => (
                  <button
                    key={doc.key}
                    onClick={doc.onClick}
                    disabled={busy === doc.key || doc.disabled}
                    title={doc.title}
                    className={`flex flex-col items-center justify-center gap-1 py-3 rounded-xl border transition-all ${
                      doc.disabled
                        ? 'bg-[#FAFAFA] border-[#E4E4E7] text-[#C4C4C8] cursor-not-allowed'
                        : 'bg-white border-[#E4E4E7] text-[#27272A] hover:border-[#A8896B] hover:bg-[#FBFAF7] hover:-translate-y-0.5 shadow-sm disabled:opacity-50'
                    }`}
                  >
                    <span className={doc.disabled ? 'text-[#C4C4C8]' : 'text-[#A8896B]'}>{doc.icon}</span>
                    <span className="text-[11px] font-semibold">{busy === doc.key ? '…' : doc.label}</span>
                    <span className={`text-[9px] font-normal leading-none ${doc.disabled ? 'text-[#D4D4D8]' : 'text-[#A1A1AA]'}`}>{doc.sub}</span>
                  </button>
                ))}
              </div>
            )}
            {!loadingFees && !noDue && (
              <p className="text-[11px] text-[#A1A1AA] mt-2.5">
                No-Due unlocks once all bus dues across all years are cleared.
              </p>
            )}
          </div>
        )}
      </motion.div>

      <AnimatePresence>
        {preview && (
          <StatementPreviewModal
            spec={preview.spec}
            title={preview.title}
            onClose={() => setPreview(null)}
          />
        )}
      </AnimatePresence>
    </motion.div>
  )
}
