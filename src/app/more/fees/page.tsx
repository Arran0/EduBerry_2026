'use client'

import React, { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { AnimatePresence } from 'framer-motion'
import {
  CreditCard, Plus, ChevronRight, Settings, Tag, Pencil, ListChecks, Receipt,
} from 'lucide-react'
import ProtectedLayout from '@/components/ProtectedLayout'
import PageBanner from '@/components/PageBanner'
import FeeCollectionSummary, { formatINR } from '@/components/fees/FeeCollectionSummary'
import FeeStatusBadge from '@/components/fees/FeeStatusBadge'
import FeeHeadFormModal from '@/components/fees/FeeHeadFormModal'
import IssueFeeModal from '@/components/fees/IssueFeeModal'
import PaySchoolFeeModal from '@/components/fees/PaySchoolFeeModal'
import { useAuth } from '@/contexts/AuthContext'
import { isAdminRole } from '@/lib/supabase'
import { FEES_BANNER_DEFAULT } from '@/lib/pageConfig'
import { Homeroom, fetchAllHomerooms } from '@/lib/homerooms'
import {
  FeeHead, SchoolFee, FeeCollectionSummary as Summary,
  fetchFeeHeads, fetchAllFees, summarizeFees, setFeeHeadActive, fetchFeesForStudent,
} from '@/lib/fees'

export default function FeesPage() {
  const { profile } = useAuth()
  const router = useRouter()
  const isAdmin = profile ? isAdminRole(profile.role) : false

  return (
    <ProtectedLayout>
      <div data-page-theme="fees">
        {isAdmin
          ? <AdminFeeHub onBack={() => router.back()} />
          : <StudentFeeView onBack={() => router.back()} />}
      </div>
    </ProtectedLayout>
  )
}

// ──────────────────────────────────────────────────────────────
// Admin hub
// ──────────────────────────────────────────────────────────────

function AdminFeeHub({ onBack }: { onBack: () => void }) {
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
      <PageBanner
        settingKey="fees_banner"
        defaultBanner={FEES_BANNER_DEFAULT}
        icon={<CreditCard size={26} className="text-white" />}
        title="Fee Manager"
        subtitle={`${heads.length} fee head${heads.length === 1 ? '' : 's'} · issue & track collections`}
        isAdmin
        onBack={onBack}
        maxWidth="max-w-3xl"
        backgroundIcon={<CreditCard size={150} className="text-white" />}
        actions={
          <div className="flex items-center gap-2">
            <Link href="/more/fees/settings"
              className="hidden sm:flex items-center gap-1.5 text-sm px-3 py-2.5 rounded-xl border border-white/30 bg-white/15 hover:bg-white/25 backdrop-blur-sm text-white font-medium transition-colors">
              <Settings size={15} /> Payments
            </Link>
            <button onClick={() => setShowIssue(true)}
              className="flex items-center gap-2 text-sm font-semibold px-4 py-2.5 rounded-xl bg-white text-slate-800 hover:bg-slate-50 shadow-md transition-colors">
              <Plus size={16} /> <span className="hidden sm:inline">Issue Fee</span><span className="sm:hidden">Issue</span>
            </button>
          </div>
        }
      />

      <div className="relative z-0 max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 -mt-8 pb-10">
        {/* Mobile payments link */}
        <div className="sm:hidden mb-3">
          <Link href="/more/fees/settings"
            className="flex items-center justify-center gap-1.5 text-sm px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 transition-colors font-medium shadow-sm">
            <Settings size={15} /> Payment Settings
          </Link>
        </div>

        {/* Fee collection at a glance */}
        {summary && (
          <Link href="/more/fees/issued" className="block mb-5 group">
            <FeeCollectionSummary summary={summary} />
            <p className="text-xs page-text-link font-medium mt-2 flex items-center gap-1 group-hover:gap-1.5 transition-all">
              <ListChecks size={12} /> Open issued fees &amp; collection dashboard <ChevronRight size={12} />
            </p>
          </Link>
        )}

        {/* Fee heads catalogue */}
        <div className="flex items-center justify-between mb-2.5">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Fee heads</p>
          <button onClick={() => setShowNewHead(true)} className="text-xs page-text-link font-medium hover:underline flex items-center gap-1">
            <Plus size={13} /> New fee head
          </button>
        </div>

        {loading ? (
          <div className="text-center py-12"><div className="spinner mx-auto mb-3" /><p className="text-sm text-slate-500">Loading…</p></div>
        ) : heads.length === 0 ? (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-8 text-center">
            <div className="w-16 h-16 mx-auto mb-4 rounded-2xl page-accent-bg flex items-center justify-center">
              <Tag size={28} className="page-accent-text" strokeWidth={1.6} />
            </div>
            <p className="text-sm text-slate-500 mb-4 max-w-sm mx-auto">No fee heads yet. Create a reusable fee type to issue from.</p>
            <button onClick={() => setShowNewHead(true)}
              className="page-btn-primary text-sm inline-flex items-center gap-2 !py-2.5">
              <Plus size={15} /> New fee head
            </button>
          </div>
        ) : (
          <div className="space-y-2.5">
            {heads.map(head => (
              <div key={head.id} className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 flex items-center gap-3 hover:shadow-md transition-shadow">
                <div className={`w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 ${
                  head.active ? 'page-icon-bg shadow-sm' : 'bg-slate-200'
                }`}>
                  <Tag size={18} className={head.active ? 'text-white' : 'text-slate-400'} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-slate-800 truncate">{head.name}</p>
                    {!head.active && <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 font-medium">Inactive</span>}
                  </div>
                  <p className="text-xs text-slate-400 truncate">
                    <span className="font-semibold text-slate-500 tabular-nums">{formatINR(head.default_amount)}</span>{head.description ? ` · ${head.description}` : ''}
                  </p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer flex-shrink-0" title={head.active ? 'Active' : 'Inactive'}>
                  <input type="checkbox" checked={head.active} onChange={() => toggleHeadActive(head)} className="sr-only peer" />
                  <div className="w-9 h-5 bg-slate-200 rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all after:shadow peer-checked:bg-[var(--page-primary)]" />
                </label>
                <button onClick={() => setEditHead(head)} className="p-2 text-slate-400 hover:text-[var(--page-primary)] hover:bg-[var(--page-primary-light)] rounded-lg transition-colors flex-shrink-0" title="Edit">
                  <Pencil size={15} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

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

function StudentFeeView({ onBack }: { onBack: () => void }) {
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

  const outstanding = fees
    .filter(f => f.status === 'unpaid' || f.status === 'partial')
    .reduce((s, f) => s + (Number(f.amount) || 0), 0)

  return (
    <>
      <PageBanner
        settingKey="fees_banner"
        defaultBanner={FEES_BANNER_DEFAULT}
        icon={<CreditCard size={26} className="text-white" />}
        title="My Fees"
        subtitle="View and pay your school fees"
        onBack={onBack}
        maxWidth="max-w-2xl"
        backgroundIcon={<CreditCard size={150} className="text-white" />}
      />

      <div className="relative z-0 max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 -mt-8 pb-10">
        {/* Outstanding summary */}
        {!loading && fees.length > 0 && (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 mb-4 flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl page-icon-bg flex items-center justify-center flex-shrink-0 shadow-sm">
              <Receipt size={22} className="text-white" />
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Total outstanding</p>
              <p className="text-2xl font-bold text-slate-800 tabular-nums">{formatINR(outstanding)}</p>
            </div>
          </div>
        )}

        {loading ? (
          <div className="text-center py-12"><div className="spinner mx-auto mb-3" /><p className="text-sm text-slate-500">Loading…</p></div>
        ) : fees.length === 0 ? (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-8 text-center">
            <div className="w-16 h-16 mx-auto mb-4 rounded-2xl page-accent-bg flex items-center justify-center">
              <Receipt size={28} className="page-accent-text" strokeWidth={1.6} />
            </div>
            <h2 className="text-lg font-semibold text-slate-800 mb-1">All clear</h2>
            <p className="text-sm text-slate-500">No fees issued to you.</p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {fees.map(f => (
              <div key={f.id} className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 hover:shadow-md transition-shadow">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-bold text-slate-800 tabular-nums text-lg">{formatINR(f.amount)}</p>
                    <p className="text-xs text-slate-400 truncate">
                      {f.description || f.fee_head?.name || 'School fee'}{f.due_date ? ` · due ${f.due_date}` : ''}
                    </p>
                  </div>
                  <FeeStatusBadge status={f.status} />
                </div>
                {(f.status === 'unpaid' || f.status === 'partial') && (
                  <button onClick={() => setPayingFee(f)}
                    className="page-btn-primary mt-3 w-full flex items-center justify-center gap-2 text-sm !py-2.5">
                    <CreditCard size={15} /> Pay {formatINR(f.amount)}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

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
