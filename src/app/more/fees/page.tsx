'use client'

import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { AnimatePresence } from 'framer-motion'
import {
  CreditCard, Plus, Tag, Pencil, Receipt, ListChecks,
  Check, Ban, QrCode, X, ChevronRight, Filter,
} from 'lucide-react'
import ProtectedLayout from '@/components/ProtectedLayout'
import PageBanner from '@/components/PageBanner'
import Avatar from '@/components/Avatar'
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
  FeeHead, SchoolFee, FeeStatus, PendingPayment,
  fetchFeeHeads, fetchAllFees, summarizeFees, setFeeHeadActive, fetchFeesForStudent,
  setFeeStatus, cancelFee, fetchPendingPayments, verifyPayment, rejectPayment,
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
// Admin hub — inline sections: Issued Fees / Fee Heads
// ──────────────────────────────────────────────────────────────

type SectionKey = 'issued' | 'heads'

const SECTIONS: { key: SectionKey; label: string; icon: React.ReactNode }[] = [
  { key: 'issued', label: 'Issued Fees', icon: <ListChecks size={15} /> },
  { key: 'heads', label: 'Fee Heads', icon: <Tag size={15} /> },
]

const STATUS_FILTERS: { key: FeeStatus | 'all'; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'unpaid', label: 'Unpaid' },
  { key: 'partial', label: 'Partial' },
  { key: 'paid', label: 'Paid' },
  { key: 'cancelled', label: 'Cancelled' },
]

function AdminFeeHub({ onBack }: { onBack: () => void }) {
  const [loading, setLoading] = useState(true)
  const [heads, setHeads] = useState<FeeHead[]>([])
  const [homerooms, setHomerooms] = useState<Homeroom[]>([])
  const [fees, setFees] = useState<SchoolFee[]>([])
  const [pending, setPending] = useState<PendingPayment[]>([])

  // Issued Fees is the default landing section.
  const [section, setSection] = useState<SectionKey>('issued')
  const [statusFilter, setStatusFilter] = useState<FeeStatus | 'all'>('all')
  const [headFilter, setHeadFilter] = useState<string | 'all'>('all')

  const [showIssue, setShowIssue] = useState(false)
  const [editHead, setEditHead] = useState<FeeHead | null>(null)
  const [showNewHead, setShowNewHead] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const [h, hr, f, p] = await Promise.all([
      fetchFeeHeads(), fetchAllHomerooms(), fetchAllFees(), fetchPendingPayments(),
    ])
    setHeads(h); setHomerooms(hr); setFees(f); setPending(p)
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const toggleHeadActive = async (head: FeeHead) => {
    setHeads(prev => prev.map(h => h.id === head.id ? { ...h, active: !h.active } : h))
    await setFeeHeadActive(head.id, !head.active)
  }

  // Clicking a fee head jumps to Issued Fees with that head pre-filtered.
  const openHeadInIssued = (head: FeeHead) => {
    setHeadFilter(head.id)
    setSection('issued')
  }

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

  const act = async (feeId: string, action: 'paid' | 'cancel') => {
    setBusyId(feeId)
    const result = action === 'paid' ? await setFeeStatus(feeId, 'paid') : await cancelFee(feeId)
    if (result.success) {
      setFees(prev => prev.map(f => f.id === feeId ? { ...f, status: action === 'paid' ? 'paid' : 'cancelled' } : f))
    }
    setBusyId(null)
  }

  const summary = useMemo(() => summarizeFees(fees), [fees])
  const shown = useMemo(() => fees.filter(f =>
    (statusFilter === 'all' || f.status === statusFilter) &&
    (headFilter === 'all' || (f.fee_head_id ?? f.fee_head?.id) === headFilter)
  ), [fees, statusFilter, headFilter])

  const activeHeadName = headFilter === 'all' ? null : heads.find(h => h.id === headFilter)?.name ?? null

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
      />

      <div className="relative z-0 max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 -mt-8 pb-10">
        {/* Section switcher */}
        <div className="flex gap-1 mb-5 p-1 rounded-2xl glass w-full">
          {SECTIONS.map(s => {
            const active = section === s.key
            return (
              <button key={s.key} onClick={() => setSection(s.key)}
                className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-2 rounded-xl text-sm font-semibold transition-all ${
                  active ? 'bg-white shadow-sm' : 'text-slate-500 hover:text-slate-700'
                }`}
                style={active ? { color: 'var(--page-primary)' } : undefined}>
                {s.icon} <span className="truncate">{s.label}</span>
              </button>
            )
          })}
        </div>

        {section === 'issued' ? (
          <>
            {/* Collection summary */}
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

            {/* Section header + Issue Fee action */}
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Issued fees</h2>
              <button onClick={() => setShowIssue(true)} className="glass-btn" style={{ color: 'var(--page-primary)' }}>
                <Plus size={14} /> Issue Fee
              </button>
            </div>

            {/* Fee head filter */}
            {heads.length > 0 && (
              <div className="flex items-center gap-2 mb-3">
                <Filter size={14} className="text-slate-400 flex-shrink-0" />
                <div className="relative flex-1">
                  <select value={headFilter} onChange={e => setHeadFilter(e.target.value)}
                    className="w-full appearance-none bg-white border border-slate-200 rounded-xl pl-3 pr-9 py-2 text-sm text-slate-700 font-medium focus:outline-none focus:ring-2 focus:ring-[var(--page-primary)]/30 shadow-sm">
                    <option value="all">All fee heads</option>
                    {heads.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
                  </select>
                  <ChevronRight size={15} className="absolute right-3 top-1/2 -translate-y-1/2 rotate-90 text-slate-400 pointer-events-none" />
                </div>
                {activeHeadName && (
                  <button onClick={() => setHeadFilter('all')}
                    className="flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-700 bg-slate-100 hover:bg-slate-200 px-2.5 py-2 rounded-xl transition-colors">
                    <X size={13} /> Clear
                  </button>
                )}
              </div>
            )}

            {/* Status filters */}
            <div className="flex flex-wrap gap-1.5 mb-4">
              {STATUS_FILTERS.map(f => (
                <button key={f.key} onClick={() => setStatusFilter(f.key)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                    statusFilter === f.key ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400'
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
          </>
        ) : (
          <>
            {/* Section header + New Fee Head action */}
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Fee heads</h2>
              <button onClick={() => setShowNewHead(true)} className="glass-btn">
                <Plus size={14} /> New Fee Head
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
                <button onClick={() => setShowNewHead(true)} className="glass-btn mx-auto" style={{ color: 'var(--page-primary)' }}>
                  <Plus size={14} /> New Fee Head
                </button>
              </div>
            ) : (
              <div className="space-y-2.5">
                {heads.map(head => (
                  <div key={head.id} className="bg-white rounded-2xl border border-slate-200 shadow-sm hover:shadow-md transition-shadow flex items-center gap-3 p-4">
                    <button onClick={() => openHeadInIssued(head)}
                      className="flex items-center gap-3 flex-1 min-w-0 text-left" title="View issued fees for this head">
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
                      <ChevronRight size={16} className="text-slate-300 flex-shrink-0" />
                    </button>
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
          </>
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
