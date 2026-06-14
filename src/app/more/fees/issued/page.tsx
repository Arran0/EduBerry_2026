'use client'

import React, { useState, useEffect, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { ArrowLeft, IndianRupee, Check, Ban, QrCode, X } from 'lucide-react'
import ProtectedLayout from '@/components/ProtectedLayout'
import Avatar from '@/components/Avatar'
import FeeCollectionSummary, { formatINR } from '@/components/fees/FeeCollectionSummary'
import FeeStatusBadge from '@/components/fees/FeeStatusBadge'
import {
  SchoolFee, FeeStatus, PendingPayment,
  fetchAllFees, summarizeFees, setFeeStatus, cancelFee,
  fetchPendingPayments, verifyPayment, rejectPayment,
} from '@/lib/fees'

const FILTERS: { key: FeeStatus | 'all'; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'unpaid', label: 'Unpaid' },
  { key: 'partial', label: 'Partial' },
  { key: 'paid', label: 'Paid' },
  { key: 'cancelled', label: 'Cancelled' },
]

export default function IssuedFeesPage() {
  const [loading, setLoading] = useState(true)
  const [fees, setFees] = useState<SchoolFee[]>([])
  const [pending, setPending] = useState<PendingPayment[]>([])
  const [filter, setFilter] = useState<FeeStatus | 'all'>('all')
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const [f, p] = await Promise.all([fetchAllFees(), fetchPendingPayments()])
    setFees(f); setPending(p)
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  // Only UPI claims need manual reconciliation here (Razorpay & Smart Collect
  // are auto-verified by their webhooks).
  const upiClaims = pending.filter(p => p.method === 'upi_qr')

  const resolveClaim = async (claim: PendingPayment, action: 'verify' | 'reject') => {
    setBusyId(claim.id)
    const result = action === 'verify'
      ? await verifyPayment(claim.id, claim.fee_id)
      : await rejectPayment(claim.id)
    setBusyId(null)
    if (result.success) load()
  }

  const summary = useMemo(() => summarizeFees(fees), [fees])
  const shown = useMemo(
    () => filter === 'all' ? fees : fees.filter(f => f.status === filter),
    [fees, filter],
  )

  const act = async (feeId: string, action: 'paid' | 'cancel') => {
    setBusyId(feeId)
    const result = action === 'paid' ? await setFeeStatus(feeId, 'paid') : await cancelFee(feeId)
    if (result.success) {
      setFees(prev => prev.map(f => f.id === feeId ? { ...f, status: action === 'paid' ? 'paid' : 'cancelled' } : f))
    }
    setBusyId(null)
  }

  return (
    <ProtectedLayout adminOnly>
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6">
        <Link href="/more/fees" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 mb-4">
          <ArrowLeft size={16} /> Fee Manager
        </Link>

        <div className="flex items-center gap-3 mb-5">
          <div className="p-2 bg-gradient-to-br from-slate-700 to-slate-900 rounded-xl shadow">
            <IndianRupee className="text-white" size={20} />
          </div>
          <div>
            <h1 className="font-display text-2xl font-bold text-slate-800">Issued Fees</h1>
            <p className="text-xs text-slate-500">{fees.length} fee{fees.length === 1 ? '' : 's'} issued</p>
          </div>
        </div>

        <div className="mb-5"><FeeCollectionSummary summary={summary} /></div>

        {/* Pending UPI claims awaiting verification */}
        {upiClaims.length > 0 && (
          <div className="mb-5 bg-slate-50 border border-slate-200 rounded-2xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <QrCode size={16} className="text-slate-600" />
              <h2 className="font-semibold text-slate-800 text-sm">
                {upiClaims.length} UPI payment{upiClaims.length === 1 ? '' : 's'} to verify
              </h2>
            </div>
            <div className="space-y-2">
              {upiClaims.map(claim => (
                <div key={claim.id} className="bg-white rounded-xl border border-slate-200 p-3 flex items-center gap-3">
                  <Avatar avatarUrl={claim.fee?.student?.avatar_url} name={claim.fee?.student?.full_name ?? '?'} size={34} userId={claim.payer_id ?? undefined} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-800 truncate">{claim.fee?.student?.full_name ?? 'Unknown'}</p>
                    <p className="text-[11px] text-slate-400 truncate">
                      {formatINR(claim.amount)} · ref {claim.upi_txn_ref || '—'}
                    </p>
                  </div>
                  <button onClick={() => resolveClaim(claim, 'verify')} disabled={busyId === claim.id}
                    className="flex items-center gap-1 bg-slate-800 hover:bg-slate-900 text-white text-xs font-semibold px-2.5 py-1.5 rounded-lg transition-colors disabled:opacity-50">
                    <Check size={13} /> Verify
                  </button>
                  <button onClick={() => resolveClaim(claim, 'reject')} disabled={busyId === claim.id}
                    className="flex items-center gap-1 bg-white border border-slate-200 text-slate-500 hover:text-rose-600 text-xs font-semibold px-2.5 py-1.5 rounded-lg transition-colors disabled:opacity-50">
                    <X size={13} /> Reject
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Filters */}
        <div className="flex flex-wrap gap-1.5 mb-4">
          {FILTERS.map(f => (
            <button key={f.key} onClick={() => setFilter(f.key)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                filter === f.key ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400'
              }`}>
              {f.label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="text-center py-12"><div className="spinner mx-auto mb-3" /><p className="text-sm text-slate-500">Loading…</p></div>
        ) : shown.length === 0 ? (
          <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center text-sm text-slate-500">
            No fees in this view.
          </div>
        ) : (
          <div className="space-y-2">
            {shown.map(f => (
              <div key={f.id} className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
                <div className="flex items-center gap-3">
                  <Avatar avatarUrl={f.student?.avatar_url} name={f.student?.full_name ?? '?'} size={38} userId={f.student_id} />
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-slate-800 text-sm truncate">{f.student?.full_name ?? 'Unknown'}</p>
                    <p className="text-[11px] text-slate-400 truncate">
                      {f.description || f.fee_head?.name || 'School fee'}{f.due_date ? ` · due ${f.due_date}` : ''}
                    </p>
                    <p className="text-[10px] text-slate-300 truncate">Ref: {f.upi_reference}</p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="font-bold text-slate-800 tabular-nums">{formatINR(f.amount)}</p>
                    <FeeStatusBadge status={f.status} />
                  </div>
                </div>

                {f.status !== 'paid' && f.status !== 'cancelled' && (
                  <div className="flex gap-2 mt-3">
                    <button onClick={() => act(f.id, 'paid')} disabled={busyId === f.id}
                      className="flex-1 flex items-center justify-center gap-1.5 bg-slate-800 hover:bg-slate-900 text-white text-xs font-semibold py-2 rounded-lg transition-colors disabled:opacity-50">
                      <Check size={14} /> Mark paid
                    </button>
                    <button onClick={() => act(f.id, 'cancel')} disabled={busyId === f.id}
                      className="flex items-center justify-center gap-1.5 px-3 bg-white border border-slate-200 text-slate-500 hover:text-rose-600 hover:border-rose-200 text-xs font-semibold py-2 rounded-lg transition-colors disabled:opacity-50">
                      <Ban size={14} /> Cancel
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </ProtectedLayout>
  )
}
