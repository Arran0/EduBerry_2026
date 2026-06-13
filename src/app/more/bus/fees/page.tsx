'use client'

import React, { useState, useEffect, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { AnimatePresence } from 'framer-motion'
import { ArrowLeft, Plus, IndianRupee, Check, Ban } from 'lucide-react'
import ProtectedLayout from '@/components/ProtectedLayout'
import Avatar from '@/components/Avatar'
import FeeCollectionSummary, { formatINR } from '@/components/bus/FeeCollectionSummary'
import FeeIssueModal from '@/components/bus/FeeIssueModal'
import { FeeStatusBadge } from '@/app/more/bus/page'
import { UserProfile } from '@/lib/supabase'
import {
  BusTrip, BusFee, BusFeeStatus,
  fetchAllFees, fetchTrips, fetchAssignablePassengers, summarizeFees, setFeeStatus, cancelFee,
} from '@/lib/bus'

const FILTERS: { key: BusFeeStatus | 'all'; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'unpaid', label: 'Unpaid' },
  { key: 'partial', label: 'Partial' },
  { key: 'paid', label: 'Paid' },
  { key: 'cancelled', label: 'Cancelled' },
]

export default function BusFeesPage() {
  const [loading, setLoading] = useState(true)
  const [fees, setFees] = useState<BusFee[]>([])
  const [trips, setTrips] = useState<BusTrip[]>([])
  const [assignable, setAssignable] = useState<UserProfile[]>([])
  const [filter, setFilter] = useState<BusFeeStatus | 'all'>('all')
  const [showIssue, setShowIssue] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const [f, t, a] = await Promise.all([fetchAllFees(), fetchTrips(), fetchAssignablePassengers()])
    setFees(f); setTrips(t); setAssignable(a)
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

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
        <Link href="/more/bus" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 mb-4">
          <ArrowLeft size={16} /> Bus Manager
        </Link>

        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-gradient-to-br from-emerald-500 to-green-600 rounded-xl shadow">
              <IndianRupee className="text-white" size={20} />
            </div>
            <div>
              <h1 className="font-display text-2xl font-bold text-slate-800">Fees & Collection</h1>
              <p className="text-xs text-slate-500">{fees.length} fee{fees.length === 1 ? '' : 's'} issued</p>
            </div>
          </div>
          <button onClick={() => setShowIssue(true)} className="btn-primary flex items-center gap-2 text-sm">
            <Plus size={16} /> Issue Fee
          </button>
        </div>

        <div className="mb-5"><FeeCollectionSummary summary={summary} /></div>

        {/* Filters */}
        <div className="flex flex-wrap gap-1.5 mb-4">
          {FILTERS.map(f => (
            <button key={f.key} onClick={() => setFilter(f.key)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                filter === f.key ? 'bg-orange-500 text-white border-orange-500' : 'bg-white text-slate-600 border-slate-200 hover:border-orange-300'
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
                  <Avatar avatarUrl={f.passenger?.avatar_url} name={f.passenger?.full_name ?? '?'} size={38} userId={f.passenger_id} />
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-slate-800 text-sm truncate">{f.passenger?.full_name ?? 'Unknown'}</p>
                    <p className="text-[11px] text-slate-400 truncate">
                      {f.description || 'Bus fee'}{f.trip?.name ? ` · ${f.trip.name}` : ''}{f.due_date ? ` · due ${f.due_date}` : ''}
                    </p>
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
              onClose={() => setShowIssue(false)}
              onIssued={() => { setShowIssue(false); load() }}
            />
          )}
        </AnimatePresence>
      </div>
    </ProtectedLayout>
  )
}
