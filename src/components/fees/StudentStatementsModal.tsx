'use client'

import React, { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import dynamic from 'next/dynamic'
import {
  X, Receipt, FileSpreadsheet, AlertTriangle, BadgeCheck, CalendarRange, Loader2,
  ChevronLeft, Download,
} from 'lucide-react'
import Avatar from '@/components/Avatar'
import { UserProfile } from '@/lib/supabase'
import {
  SchoolFee, StudentPayment, METHOD_LABELS, fetchFeesForStudent, fetchPaymentsForStudent,
} from '@/lib/fees'
import { formatINR } from './FeeCollectionSummary'
import {
  StatementSpec, buildLedger, buildOutstanding, buildNoDue, buildAnnual, buildFeeReceipt, hasNoDue,
} from './statements/generate'

const StatementPreviewModal = dynamic(() => import('./statements/StatementPreviewModal'))

interface Props {
  student: UserProfile
  year: string
  onClose: () => void
}

/** Short, human-readable receipt number derived from a payment / fee id. */
function shortId(id: string): string { return id.replace(/-/g, '').slice(0, 10).toUpperCase() }

/** Local date formatter — avoids pulling the react-pdf statement shell into this
 *  modal's bundle just for a date string. */
function fmtDate(d?: string | null): string {
  if (!d) return '—'
  const dt = new Date(d)
  return isNaN(dt.getTime()) ? '—' : dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

export default function StudentStatementsModal({ student, year: yearProp, onClose }: Props) {
  // Snapshot the year at open time so toggling the parent year doesn't affect an open popup.
  const [capturedYear] = useState(yearProp)
  const [allFees, setAllFees] = useState<SchoolFee[]>([])
  const [loadingFees, setLoadingFees] = useState(true)
  const [preview, setPreview] = useState<{ spec: StatementSpec; title: string } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  // Fee Receipt picker — the student's verified payments, loaded on demand.
  const [receiptMode, setReceiptMode] = useState(false)
  const [payments, setPayments] = useState<StudentPayment[]>([])
  const [loadingPayments, setLoadingPayments] = useState(false)

  useEffect(() => {
    setLoadingFees(true)
    fetchFeesForStudent(student.id).then(f => { setAllFees(f); setLoadingFees(false) })
  }, [student.id])

  const yearFees = allFees.filter(f => f.academic_year === capturedYear)
  const noDue = !loadingFees && hasNoDue(allFees)

  const openPreview = async (key: string, title: string, builder: () => Promise<StatementSpec>) => {
    setBusy(key)
    try { setPreview({ spec: await builder(), title }) }
    catch (e) { console.error('statement generation failed:', e) }
    setBusy(null)
  }

  const openReceipts = () => {
    setReceiptMode(true)
    setLoadingPayments(true)
    fetchPaymentsForStudent(student.id).then(p => { setPayments(p); setLoadingPayments(false) })
  }

  const openReceipt = async (p: StudentPayment) => {
    if (!p.fee) return
    setBusy(p.id)
    try {
      const spec = await buildFeeReceipt(p.fee as unknown as SchoolFee, student, p)
      setPreview({ spec, title: `Fee Receipt · ${student.full_name}` })
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
      key: 'l', label: 'Ledger', sub: 'All years',
      icon: <FileSpreadsheet size={15} />,
      onClick: () => openPreview('l', `Fee Ledger · ${student.full_name}`, () => buildLedger(student.id, student)),
    },
    {
      key: 'd', label: 'Dues', sub: 'All years',
      icon: <AlertTriangle size={15} />,
      onClick: () => openPreview('d', `Outstanding Dues · ${student.full_name}`, () => buildOutstanding(student, undefined, allFees)),
    },
    {
      key: 'a', label: 'Annual', sub: capturedYear,
      icon: <CalendarRange size={15} />,
      onClick: () => openPreview('a', `Annual Statement · ${student.full_name}`, () => buildAnnual(student, capturedYear, yearFees)),
    },
    {
      key: 'n', label: 'No-Due', sub: 'All years',
      icon: <BadgeCheck size={15} />, disabled: !noDue,
      title: noDue ? 'Preview No-Due Certificate' : 'Blocked — outstanding dues exist',
      onClick: () => openPreview('n', `No-Due Certificate · ${student.full_name}`, () => buildNoDue(student, capturedYear)),
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
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#E3DFD3] flex-shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            {receiptMode && (
              <button onClick={() => setReceiptMode(false)} title="Back"
                className="p-1.5 -ml-1.5 text-[#8C8878] hover:text-[#18181B] hover:bg-[#F4F1E7] flex-shrink-0">
                <ChevronLeft size={18} />
              </button>
            )}
            <Avatar avatarUrl={student.avatar_url} name={student.full_name} size={36} userId={student.id} />
            <div className="min-w-0">
              <p className="font-bold text-[#18181B] text-sm truncate">{student.full_name}</p>
              <p className="text-[11px] text-[#6B675A]">
                {student.grade != null
                  ? `Grade ${student.grade}${student.section ? ` ${student.section}` : ''}`
                  : 'Student'}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 text-[#8C8878] hover:text-[#18181B] hover:bg-[#F4F1E7] flex-shrink-0">
            <X size={16} />
          </button>
        </div>

        {receiptMode ? (
          /* ── Fee Receipt picker ── */
          <div className="p-4 overflow-y-auto">
            <p className="text-[9px] font-bold uppercase tracking-widest text-[#6B675A] mb-3">Fee Receipts</p>
            {loadingPayments ? (
              <div className="flex items-center justify-center gap-2 py-8 text-[#8C8878]">
                <Loader2 size={18} className="animate-spin" />
                <span className="text-sm">Loading payments…</span>
              </div>
            ) : payments.length === 0 ? (
              <div className="py-10 text-center">
                <Receipt size={28} className="mx-auto mb-3 text-[#C9C4B4]" />
                <p className="text-sm text-[#6B675A]">No payments recorded yet.</p>
                <p className="text-[11px] text-[#8C8878] mt-1">Receipts appear here once a payment is verified.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {payments.map(p => {
                  const ref = p.upi_txn_ref || p.razorpay_payment_id || p.utr || p.fee?.upi_reference || '—'
                  const particulars = p.fee?.description || p.fee?.fee_head?.name || 'School fee'
                  return (
                    <button key={p.id} onClick={() => openReceipt(p)} disabled={busy === p.id}
                      className="w-full flex items-center gap-3 p-3 border border-[#E3DFD3] bg-white hover:border-[#A8896B] hover:bg-[#FBFAF7] transition-all text-left disabled:opacity-50">
                      <div className="w-9 h-9 bg-[#27272A] flex items-center justify-center flex-shrink-0">
                        <Receipt size={16} className="text-[#B8983C]" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-[#18181B] truncate">
                          {formatINR(Number(p.amount) || 0)} · {METHOD_LABELS[p.method] ?? p.method}
                        </p>
                        <p className="text-[11px] text-[#6B675A] truncate">
                          No. {shortId(p.id)} · {fmtDate(p.verified_at)} · {particulars}
                        </p>
                        <p className="text-[10px] text-[#8C8878] truncate">Proof of payment: {ref}</p>
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
            <p className="text-[9px] font-bold uppercase tracking-widest text-[#6B675A] mb-3">Financial Statements</p>
            {loadingFees ? (
              <div className="flex items-center justify-center gap-2 py-8 text-[#8C8878]">
                <Loader2 size={18} className="animate-spin" />
                <span className="text-sm">Loading…</span>
              </div>
            ) : (
              <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                {DOCS.map(doc => (
                  <button
                    key={doc.key}
                    onClick={doc.onClick}
                    disabled={busy === doc.key || doc.disabled}
                    title={doc.title}
                    className={`flex flex-col items-center justify-center gap-1 py-3 border transition-all ${
                      doc.disabled
                        ? 'bg-[#FAF8F2] border-[#E3DFD3] text-[#C4C4C8] cursor-not-allowed'
                        : 'bg-white border-[#E3DFD3] text-[#18181B] hover:border-[#A8896B] hover:bg-[#FBFAF7] hover:-translate-y-0.5 shadow-sm disabled:opacity-50'
                    }`}
                  >
                    <span className={doc.disabled ? 'text-[#C4C4C8]' : 'text-[#A8896B]'}>{doc.icon}</span>
                    <span className="text-[11px] font-semibold">{busy === doc.key ? '…' : doc.label}</span>
                    <span className={`text-[9px] font-normal leading-none ${doc.disabled ? 'text-[#C9C4B4]' : 'text-[#8C8878]'}`}>{doc.sub}</span>
                  </button>
                ))}
              </div>
            )}
            {!loadingFees && !noDue && (
              <p className="text-[11px] text-[#8C8878] mt-2.5">
                No-Due unlocks once all dues across all years are cleared.
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
