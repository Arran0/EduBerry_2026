'use client'

import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { AnimatePresence } from 'framer-motion'
import { Plus, Check, Ban, QrCode, X, Tag, Pencil } from 'lucide-react'
import Avatar from '@/components/Avatar'
import FeeCollectionSummary, { formatINR } from '@/components/bus/FeeCollectionSummary'
import FeeIssueModal from '@/components/bus/FeeIssueModal'
import BusFeeHeadFormModal from '@/components/bus/BusFeeHeadFormModal'
import FeeStatusBadge from '@/components/bus/FeeStatusBadge'
import { UserProfile } from '@/lib/supabase'
import {
  BusTrip, BusFee, BusFeeHead, PendingPayment,
  fetchAllFees, fetchTrips, fetchAssignablePassengers, summarizeFees, setFeeStatus, cancelFee,
  fetchPendingPayments, verifyPayment, rejectPayment,
  fetchBusFeeHeads, setBusFeeHeadActive,
} from '@/lib/bus'

type FeeFilterKey = 'all' | 'collected' | 'outstanding' | 'cancelled' | 'partial'

const FILTERS: { key: FeeFilterKey; label: string; match: (f: BusFee) => boolean }[] = [
  { key: 'all', label: 'All', match: () => true },
  { key: 'collected', label: 'Collected', match: f => f.status === 'paid' },
  { key: 'outstanding', label: 'Outstanding', match: f => f.status === 'unpaid' },
  { key: 'cancelled', label: 'Cancelled', match: f => f.status === 'cancelled' },
  { key: 'partial', label: 'Partial', match: f => f.status === 'partial' },
]

export default function BusFeesSection() {
  const [loading, setLoading] = useState(true)
  const [fees, setFees] = useState<BusFee[]>([])
  const [trips, setTrips] = useState<BusTrip[]>([])
  const [assignable, setAssignable] = useState<UserProfile[]>([])
  const [heads, setHeads] = useState<BusFeeHead[]>([])
  const [pending, setPending] = useState<PendingPayment[]>([])
  const [filter, setFilter] = useState<FeeFilterKey>('all')
  const [showIssue, setShowIssue] = useState(false)
  const [showNewHead, setShowNewHead] = useState(false)
  const [editHead, setEditHead] = useState<BusFeeHead | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const [f, t, a, h, p] = await Promise.all([
      fetchAllFees(), fetchTrips(), fetchAssignablePassengers(), fetchBusFeeHeads(), fetchPendingPayments(),
    ])
    setFees(f); setTrips(t); setAssignable(a); setHeads(h); setPending(p)
    setLoading(false)
  }, [])

  const toggleHeadActive = async (head: BusFeeHead) => {
    setHeads(prev => prev.map(h => h.id === head.id ? { ...h, active: !h.active } : h))
    await setBusFeeHeadActive(head.id, !head.active)
  }

  // Only UPI claims need manual reconciliation here (Razorpay is auto-verified
  // by the webhook).
  const upiClaims = pending.filter(p => p.method === 'upi_qr')

  const resolveClaim = async (claim: PendingPayment, action: 'verify' | 'reject') => {
    setBusyId(claim.id)
    const result = action === 'verify'
      ? await verifyPayment(claim.id, claim.fee_id)
      : await rejectPayment(claim.id)
    setBusyId(null)
    if (result.success) load()
  }

  useEffect(() => { load() }, [load])

  const summary = useMemo(() => summarizeFees(fees), [fees])
  const shown = useMemo(() => {
    const match = FILTERS.find(f => f.key === filter)?.match ?? (() => true)
    return fees.filter(match)
  }, [fees, filter])

  const act = async (feeId: string, action: 'paid' | 'cancel') => {
    setBusyId(feeId)
    const result = action === 'paid' ? await setFeeStatus(feeId, 'paid') : await cancelFee(feeId)
    if (result.success) {
      setFees(prev => prev.map(f => f.id === feeId ? { ...f, status: action === 'paid' ? 'paid' : 'cancelled' } : f))
    }
    setBusyId(null)
  }

  return (
    <>
      <div className="mb-5"><FeeCollectionSummary summary={summary} /></div>

      {/* Fee heads catalogue */}
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Fee heads</p>
        <button onClick={() => setShowNewHead(true)} className="glass-btn">
          <Tag size={14} /> New Fee Head
        </button>
      </div>
      {heads.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-4 text-center text-xs text-slate-400 mb-5">
          No fee heads yet. Create a reusable bus fee type (e.g. “Monthly Bus Fee”) to issue from.
        </div>
      ) : (
        <div className="space-y-2 mb-5">
          {heads.map(head => (
            <div key={head.id} className="bg-white rounded-2xl border border-slate-200 shadow-sm p-3 flex items-center gap-3">
              <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${
                head.active ? 'bg-gradient-to-br from-emerald-500 to-green-600' : 'bg-slate-300'
              }`}>
                <Tag size={16} className="text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="font-semibold text-slate-800 text-sm truncate">{head.name}</p>
                  {!head.active && <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 font-medium">Inactive</span>}
                </div>
                <p className="text-xs text-slate-400 truncate">
                  {formatINR(head.default_amount)}{head.description ? ` · ${head.description}` : ''}
                </p>
              </div>
              <label className="flex items-center cursor-pointer" title={head.active ? 'Active' : 'Inactive'}>
                <input type="checkbox" checked={head.active} onChange={() => toggleHeadActive(head)} className="w-5 h-5 accent-emerald-600" />
              </label>
              <button onClick={() => setEditHead(head)} className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg" title="Edit">
                <Pencil size={15} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Pending UPI claims awaiting verification */}
      {upiClaims.length > 0 && (
        <div className="mb-5 bg-amber-50 border border-amber-200 rounded-2xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <QrCode size={16} className="text-amber-600" />
            <h2 className="font-semibold text-amber-800 text-sm">
              {upiClaims.length} UPI payment{upiClaims.length === 1 ? '' : 's'} to verify
            </h2>
          </div>
          <div className="space-y-2">
            {upiClaims.map(claim => (
              <div key={claim.id} className="bg-white rounded-xl border border-amber-100 p-3 flex items-center gap-3">
                <Avatar avatarUrl={claim.fee?.passenger?.avatar_url} name={claim.fee?.passenger?.full_name ?? '?'} size={34} userId={claim.payer_id ?? undefined} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-800 truncate">{claim.fee?.passenger?.full_name ?? 'Unknown'}</p>
                  <p className="text-[11px] text-slate-400 truncate">
                    {formatINR(claim.amount)} · ref {claim.upi_txn_ref || '—'}
                  </p>
                </div>
                <button onClick={() => resolveClaim(claim, 'verify')} disabled={busyId === claim.id}
                  className="flex items-center gap-1 bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-semibold px-2.5 py-1.5 rounded-lg transition-colors disabled:opacity-50">
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

      {/* Issued fees */}
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Issued fees</h2>
        <button onClick={() => setShowIssue(true)} className="glass-btn glass-btn-accent">
          <Plus size={14} /> Issue Fee
        </button>
      </div>

      {/* Filters — spread to the full width of the fee rows below */}
      <div className="flex gap-1 mb-4 p-1 rounded-2xl glass w-full">
        {FILTERS.map(f => {
          const count = fees.filter(f.match).length
          const active = filter === f.key
          return (
            <button key={f.key} onClick={() => setFilter(f.key)}
              className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-xl text-xs font-semibold transition-all ${
                active ? 'bg-white text-orange-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}>
              {f.label}
              <span className={`text-[10px] tabular-nums ${active ? 'text-orange-400' : 'text-slate-400'}`}>{count}</span>
            </button>
          )
        })}
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
                <Avatar avatarUrl={f.passenger?.avatar_url} name={f.passenger?.full_name ?? '?'} size={38} userId={f.passenger_id} />
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-slate-800 text-sm truncate">{f.passenger?.full_name ?? 'Unknown'}</p>
                  <p className="text-[11px] text-slate-400 truncate">
                    {f.description || f.fee_head?.name || 'Bus fee'}{f.trip?.name ? ` · ${f.trip.name}` : ''}{f.due_date ? ` · due ${f.due_date}` : ''}
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
                    className="flex-1 flex items-center justify-center gap-1.5 bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-semibold py-2 rounded-lg transition-colors disabled:opacity-50">
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

      <AnimatePresence>
        {showIssue && (
          <FeeIssueModal
            trips={trips}
            assignable={assignable}
            feeHeads={heads}
            onClose={() => setShowIssue(false)}
            onIssued={() => { setShowIssue(false); load() }}
          />
        )}
        {(showNewHead || editHead) && (
          <BusFeeHeadFormModal
            head={editHead}
            onClose={() => { setShowNewHead(false); setEditHead(null) }}
            onSaved={() => { setShowNewHead(false); setEditHead(null); load() }}
          />
        )}
      </AnimatePresence>
    </>
  )
}
