'use client'

import React, { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { AnimatePresence } from 'framer-motion'
import {
  CreditCard, Plus, ChevronRight, IndianRupee, Settings, Tag, Pencil, ListChecks,
} from 'lucide-react'
import ProtectedLayout from '@/components/ProtectedLayout'
import FeeCollectionSummary, { formatINR } from '@/components/fees/FeeCollectionSummary'
import FeeStatusBadge from '@/components/fees/FeeStatusBadge'
import FeeHeadFormModal from '@/components/fees/FeeHeadFormModal'
import IssueFeeModal from '@/components/fees/IssueFeeModal'
import PaySchoolFeeModal from '@/components/fees/PaySchoolFeeModal'
import { useAuth } from '@/contexts/AuthContext'
import { isAdminRole } from '@/lib/supabase'
import { Homeroom, fetchAllHomerooms } from '@/lib/homerooms'
import {
  FeeHead, SchoolFee, FeeCollectionSummary as Summary,
  fetchFeeHeads, fetchAllFees, summarizeFees, setFeeHeadActive, fetchFeesForStudent,
} from '@/lib/fees'

export default function FeesPage() {
  const { profile } = useAuth()
  const isAdmin = profile ? isAdminRole(profile.role) : false

  return (
    <ProtectedLayout>
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6">
        {isAdmin ? <AdminFeeHub /> : <StudentFeeView />}
      </div>
    </ProtectedLayout>
  )
}

// ──────────────────────────────────────────────────────────────
// Admin hub
// ──────────────────────────────────────────────────────────────

function AdminFeeHub() {
  const [loading, setLoading] = useState(true)
  const [heads, setHeads] = useState<FeeHead[]>([])
  const [homerooms, setHomerooms] = useState<Homeroom[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [showIssue, setShowIssue] = useState(false)
  const [editHead, setEditHead] = useState<FeeHead | null>(null)
  const [showNewHead, setShowNewHead] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const [h, hr, fees] = await Promise.all([fetchFeeHeads(), fetchAllHomerooms(), fetchAllFees()])
    setHeads(h); setHomerooms(hr); setSummary(summarizeFees(fees))
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const toggleHeadActive = async (head: FeeHead) => {
    setHeads(prev => prev.map(h => h.id === head.id ? { ...h, active: !h.active } : h))
    await setFeeHeadActive(head.id, !head.active)
  }

  return (
    <>
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-gradient-to-br from-slate-700 to-slate-900 rounded-xl shadow">
            <CreditCard className="text-white" size={20} />
          </div>
          <div>
            <h1 className="font-display text-2xl font-bold text-slate-800">Fee Manager</h1>
            <p className="text-xs text-slate-500">{heads.length} fee head{heads.length === 1 ? '' : 's'}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/more/fees/settings"
            className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 transition-colors font-medium">
            <Settings size={15} /> Payments
          </Link>
          <button onClick={() => setShowIssue(true)}
            className="flex items-center gap-2 text-sm font-semibold px-4 py-2 rounded-xl bg-slate-800 text-white hover:bg-slate-900 transition-colors">
            <Plus size={16} /> Issue Fee
          </button>
        </div>
      </div>

      {/* Fee collection at a glance */}
      {summary && (
        <Link href="/more/fees/issued" className="block mb-5">
          <FeeCollectionSummary summary={summary} />
          <p className="text-xs text-slate-600 font-medium mt-2 flex items-center gap-1">
            <ListChecks size={12} /> Open issued fees & collection dashboard <ChevronRight size={12} />
          </p>
        </Link>
      )}

      {/* Fee heads catalogue */}
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Fee heads</p>
        <button onClick={() => setShowNewHead(true)} className="text-xs text-slate-700 font-medium hover:underline flex items-center gap-1">
          <Plus size={13} /> New fee head
        </button>
      </div>

      {loading ? (
        <div className="text-center py-12"><div className="spinner mx-auto mb-3" /><p className="text-sm text-slate-500">Loading…</p></div>
      ) : heads.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center">
          <Tag size={30} className="text-slate-300 mx-auto mb-3" />
          <p className="text-sm text-slate-500 mb-4">No fee heads yet. Create a reusable fee type to issue from.</p>
          <button onClick={() => setShowNewHead(true)}
            className="text-sm font-semibold px-4 py-2 rounded-xl bg-slate-800 text-white hover:bg-slate-900 transition-colors inline-flex items-center gap-2">
            <Plus size={15} /> New fee head
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {heads.map(head => (
            <div key={head.id} className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 flex items-center gap-3">
              <div className={`w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 ${
                head.active ? 'bg-gradient-to-br from-slate-700 to-slate-900' : 'bg-slate-300'
              }`}>
                <Tag size={18} className="text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="font-semibold text-slate-800 truncate">{head.name}</p>
                  {!head.active && <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 font-medium">Inactive</span>}
                </div>
                <p className="text-xs text-slate-400 truncate">
                  {formatINR(head.default_amount)}{head.description ? ` · ${head.description}` : ''}
                </p>
              </div>
              <label className="flex items-center cursor-pointer" title={head.active ? 'Active' : 'Inactive'}>
                <input type="checkbox" checked={head.active} onChange={() => toggleHeadActive(head)} className="w-5 h-5 accent-slate-700" />
              </label>
              <button onClick={() => setEditHead(head)} className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg" title="Edit">
                <Pencil size={15} />
              </button>
            </div>
          ))}
        </div>
      )}

      <AnimatePresence>
        {showIssue && (
          <IssueFeeModal
            feeHeads={heads}
            homerooms={homerooms}
            onClose={() => setShowIssue(false)}
            onIssued={() => { setShowIssue(false); load() }}
          />
        )}
        {(showNewHead || editHead) && (
          <FeeHeadFormModal
            head={editHead}
            onClose={() => { setShowNewHead(false); setEditHead(null) }}
            onSaved={() => { setShowNewHead(false); setEditHead(null); load() }}
          />
        )}
      </AnimatePresence>
    </>
  )
}

// ──────────────────────────────────────────────────────────────
// Student view
// ──────────────────────────────────────────────────────────────

function StudentFeeView() {
  const { user } = useAuth()
  const [loading, setLoading] = useState(true)
  const [fees, setFees] = useState<SchoolFee[]>([])
  const [payingFee, setPayingFee] = useState<SchoolFee | null>(null)

  const load = useCallback(async () => {
    if (!user) return
    setLoading(true)
    const f = await fetchFeesForStudent(user.id)
    setFees(f)
    setLoading(false)
  }, [user])

  useEffect(() => { load() }, [load])

  return (
    <>
      <div className="flex items-center gap-3 mb-5">
        <div className="p-2 bg-gradient-to-br from-slate-700 to-slate-900 rounded-xl shadow">
          <CreditCard className="text-white" size={20} />
        </div>
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-800">My Fees</h1>
          <p className="text-xs text-slate-500">View and pay your school fees</p>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-12"><div className="spinner mx-auto mb-3" /><p className="text-sm text-slate-500">Loading…</p></div>
      ) : fees.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center text-sm text-slate-500">
          No fees issued to you.
        </div>
      ) : (
        <div className="space-y-2">
          {fees.map(f => (
            <div key={f.id} className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold text-slate-800">{formatINR(f.amount)}</p>
                  <p className="text-xs text-slate-400 truncate">
                    {f.description || f.fee_head?.name || 'School fee'}{f.due_date ? ` · due ${f.due_date}` : ''}
                  </p>
                </div>
                <FeeStatusBadge status={f.status} />
              </div>
              {(f.status === 'unpaid' || f.status === 'partial') && (
                <button onClick={() => setPayingFee(f)}
                  className="mt-3 w-full flex items-center justify-center gap-2 text-sm font-semibold py-2.5 rounded-xl bg-slate-800 text-white hover:bg-slate-900 transition-colors">
                  <CreditCard size={15} /> Pay {formatINR(f.amount)}
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <AnimatePresence>
        {payingFee && (
          <PaySchoolFeeModal
            fee={payingFee}
            onClose={() => setPayingFee(null)}
            onPaid={() => { setPayingFee(null); load() }}
          />
        )}
      </AnimatePresence>
    </>
  )
}
