'use client'

import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { AnimatePresence } from 'framer-motion'
import {
  Plus, Check, Ban, QrCode, X, Tag, Pencil, ListChecks, Search, ChevronRight, Archive,
  FileText, Send, Trash2, Calendar, Users,
} from 'lucide-react'
import Avatar from '@/components/Avatar'
import FeeCollectionSummary, { formatINR, SummaryCardKey } from '@/components/bus/FeeCollectionSummary'
import FeeIssueModal from '@/components/bus/FeeIssueModal'
import BusFeeHeadFormModal from '@/components/bus/BusFeeHeadFormModal'
import MonthlyDraftModal from '@/components/bus/MonthlyDraftModal'
import FeeStatusBadge from '@/components/bus/FeeStatusBadge'
import { ADMIN, SegTabs } from '@/components/bus/adminUI'
import { UserProfile } from '@/lib/supabase'
import {
  BusTrip, BusFee, BusFeeHead, BusFeeDraft, PendingPayment,
  fetchAllFees, fetchTrips, fetchAssignablePassengers, summarizeFees, setFeeStatus, cancelFee,
  fetchPendingPayments, verifyPayment, rejectPayment,
  fetchBusFeeHeads, setBusFeeHeadActive,
  fetchBusFeeDrafts, deleteBusFeeDraft, issueDraft,
} from '@/lib/bus'

type SectionKey = 'issued' | 'heads' | 'drafts'

const SECTIONS = [
  { key: 'issued' as const, label: 'Issued Fees', icon: <ListChecks size={15} /> },
  { key: 'drafts' as const, label: 'Monthly Drafts', icon: <FileText size={15} /> },
  { key: 'heads' as const, label: 'Fee Heads', icon: <Tag size={15} /> },
]

type IssuedFilter = 'all' | 'collected' | 'outstanding' | 'cancelled' | 'partial'

const STATUS_FILTERS: { key: IssuedFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'collected', label: 'Collected' },
  { key: 'outstanding', label: 'Outstanding' },
  { key: 'cancelled', label: 'Cancelled' },
  { key: 'partial', label: 'Partial' },
]

function matchIssuedFilter(f: BusFee, key: IssuedFilter): boolean {
  switch (key) {
    case 'all': return true
    case 'collected': return f.status === 'paid'
    case 'outstanding': return f.status === 'unpaid' || f.status === 'partial'
    case 'partial': return f.status === 'partial'
    case 'cancelled': return f.status === 'cancelled'
  }
}

// Reveal an initial slice of the (potentially large) issued-fees list and load
// more on demand — keeps the DOM light even with thousands of fees.
const PAGE_SIZE = 40

function formatDraftMonth(ym: string): string {
  const [y, m] = ym.split('-')
  const d = new Date(Number(y), Number(m) - 1, 1)
  return d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })
}

export default function BusFeesSection() {
  const [loading, setLoading] = useState(true)
  const [fees, setFees] = useState<BusFee[]>([])
  const [trips, setTrips] = useState<BusTrip[]>([])
  const [assignable, setAssignable] = useState<UserProfile[]>([])
  const [heads, setHeads] = useState<BusFeeHead[]>([])
  const [pending, setPending] = useState<PendingPayment[]>([])
  const [drafts, setDrafts] = useState<BusFeeDraft[]>([])

  const [section, setSection] = useState<SectionKey>('issued')
  const [statusFilter, setStatusFilter] = useState<IssuedFilter>('all')
  const [headFilter, setHeadFilter] = useState<string | 'all'>('all')
  const [query, setQuery] = useState('')
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  const [inactiveQuery, setInactiveQuery] = useState('')

  const [showIssue, setShowIssue] = useState(false)
  const [showNewHead, setShowNewHead] = useState(false)
  const [editHead, setEditHead] = useState<BusFeeHead | null>(null)
  const [showNewDraft, setShowNewDraft] = useState(false)
  const [editDraft, setEditDraft] = useState<BusFeeDraft | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const [f, t, a, h, p, dr] = await Promise.all([
      fetchAllFees(), fetchTrips(), fetchAssignablePassengers(), fetchBusFeeHeads(),
      fetchPendingPayments(), fetchBusFeeDrafts(),
    ])
    setFees(f); setTrips(t); setAssignable(a); setHeads(h); setPending(p); setDrafts(dr)
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  // Reset the reveal window whenever the issued-fees view is re-filtered.
  useEffect(() => { setVisibleCount(PAGE_SIZE) }, [statusFilter, headFilter, query])

  // Clear pending delete confirmation when the user navigates away.
  useEffect(() => { setDeletingId(null) }, [section])

  const toggleHeadActive = async (head: BusFeeHead) => {
    setHeads(prev => prev.map(h => h.id === head.id ? { ...h, active: !h.active } : h))
    await setBusFeeHeadActive(head.id, !head.active)
  }

  // Clicking a fee head jumps to Issued Fees with that head pre-filtered.
  const openHeadInIssued = (head: BusFeeHead) => {
    setHeadFilter(head.id)
    setStatusFilter('all')
    setSection('issued')
  }

  // Only UPI claims need manual reconciliation (Razorpay is auto-verified).
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

  const handleIssueDraft = async (draftId: string) => {
    setBusyId(draftId)
    const result = await issueDraft(draftId)
    setBusyId(null)
    if (result.success) {
      setDrafts(prev => prev.map(d => d.id === draftId ? { ...d, status: 'issued', issued_at: new Date().toISOString() } : d))
      load()
    }
  }

  const handleDeleteDraft = async (draftId: string) => {
    if (deletingId !== draftId) { setDeletingId(draftId); return }
    setBusyId(draftId); setDeletingId(null)
    await deleteBusFeeDraft(draftId)
    setDrafts(prev => prev.filter(d => d.id !== draftId))
    setBusyId(null)
  }

  const summary = useMemo(() => summarizeFees(fees), [fees])

  const q = query.trim().toLowerCase()
  const filtered = useMemo(() => fees.filter(f =>
    matchIssuedFilter(f, statusFilter) &&
    (headFilter === 'all' || (f.fee_head_id ?? f.fee_head?.id) === headFilter) &&
    (q === '' ||
      (f.passenger?.full_name ?? '').toLowerCase().includes(q) ||
      (f.description ?? '').toLowerCase().includes(q) ||
      (f.fee_head?.name ?? '').toLowerCase().includes(q) ||
      (f.trip?.name ?? '').toLowerCase().includes(q) ||
      (f.upi_reference ?? '').toLowerCase().includes(q))
  ), [fees, statusFilter, headFilter, q])

  const shown = filtered.slice(0, visibleCount)
  const activeHeadName = headFilter === 'all' ? null : heads.find(h => h.id === headFilter)?.name ?? null

  const activeHeads = heads.filter(h => h.active)
  const inactiveHeads = heads.filter(h => !h.active)
  const iq = inactiveQuery.trim().toLowerCase()
  const matchingInactive = iq === '' ? [] : inactiveHeads.filter(h =>
    h.name.toLowerCase().includes(iq) || (h.description ?? '').toLowerCase().includes(iq)
  )

  // ── Reusable fee-head row (active + inactive) ──────────────────
  const renderHeadRow = (head: BusFeeHead) => (
    <div key={head.id} className={`${ADMIN.card} shadow-sm hover:shadow-md transition-shadow flex items-center gap-3 p-3.5 sm:p-4`}>
      <button onClick={() => openHeadInIssued(head)}
        className="flex items-center gap-3 flex-1 min-w-0 text-left" title="View issued fees for this head">
        <div className={`w-10 h-10 sm:w-11 sm:h-11 rounded-lg flex items-center justify-center flex-shrink-0 ${
          head.active ? 'bg-[#27272A]' : 'bg-[#F4F4F5] border border-[#E4E4E7]'
        }`}>
          <Tag size={18} className={head.active ? 'text-[#B8983C]' : 'text-[#A1A1AA]'} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="font-semibold text-[#18181B] truncate">{head.name}</p>
            {!head.active && <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#F4F4F5] text-[#A1A1AA] font-semibold uppercase tracking-wide flex-shrink-0">Inactive</span>}
          </div>
          <p className="text-xs text-[#71717A] truncate">
            <span className="font-bold text-[#27272A] tabular-nums">{formatINR(head.default_amount)}</span>{head.description ? ` · ${head.description}` : ''}
          </p>
        </div>
        <ChevronRight size={16} className="text-[#D4D4D8] flex-shrink-0" />
      </button>
      <label className="relative inline-flex items-center cursor-pointer flex-shrink-0" title={head.active ? 'Active' : 'Inactive'}>
        <input type="checkbox" checked={head.active} onChange={() => toggleHeadActive(head)} className="sr-only peer" />
        <div className="w-9 h-5 bg-[#D4D4D8] rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all after:shadow peer-checked:bg-[#27272A]" />
      </label>
      <button onClick={() => setEditHead(head)} className="p-2 text-[#A1A1AA] hover:text-[#27272A] hover:bg-[#F4F4F5] rounded-lg transition-colors flex-shrink-0" title="Edit">
        <Pencil size={15} />
      </button>
    </div>
  )

  return (
    <>
      {/* Summary cards — present on both sections. Clicking filters issued fees. */}
      <div className="mb-4">
        <FeeCollectionSummary
          summary={summary}
          activeKey={section === 'issued' ? (statusFilter as SummaryCardKey) : undefined}
          onSelect={(key) => { setSection('issued'); setStatusFilter(key) }}
        />
      </div>

      {/* Sub-section toggler — segmented control (Style B) */}
      <SegTabs tabs={SECTIONS} value={section} onChange={setSection} className="mb-5" />

      {section === 'issued' ? (
        <>
          {/* Pending UPI claims awaiting verification */}
          {upiClaims.length > 0 && (
            <div className="mb-5 bg-[#27272A] rounded-xl p-4">
              <div className="flex items-center gap-2 mb-3">
                <QrCode size={16} className="text-[#B8983C]" />
                <h2 className="font-semibold text-white text-sm">
                  {upiClaims.length} UPI payment{upiClaims.length === 1 ? '' : 's'} to verify
                </h2>
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
                {upiClaims.map(claim => (
                  <div key={claim.id} className="bg-white rounded-lg p-3 flex items-center gap-3">
                    <Avatar avatarUrl={claim.fee?.passenger?.avatar_url} name={claim.fee?.passenger?.full_name ?? '?'} size={34} userId={claim.payer_id ?? undefined} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-[#18181B] truncate">{claim.fee?.passenger?.full_name ?? 'Unknown'}</p>
                      <p className="text-[11px] text-[#A1A1AA] truncate">
                        {formatINR(claim.amount)} · ref {claim.upi_txn_ref || '—'}
                      </p>
                    </div>
                    <button onClick={() => resolveClaim(claim, 'verify')} disabled={busyId === claim.id} className={ADMIN.darkBtn}>
                      <Check size={13} /> Verify
                    </button>
                    <button onClick={() => resolveClaim(claim, 'reject')} disabled={busyId === claim.id}
                      className="flex items-center gap-1 bg-white border border-[#E4E4E7] text-[#71717A] hover:text-rose-600 text-xs font-semibold px-2.5 py-1.5 rounded-lg transition-colors disabled:opacity-50">
                      <X size={13} /> Reject
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Section header + Issue Fee action */}
          <div className="flex items-center justify-between mb-3">
            <h2 className={ADMIN.label}>Issued fees</h2>
            <button onClick={() => setShowIssue(true)} className={ADMIN.darkBtn}>
              <Plus size={14} /> Issue Fee
            </button>
          </div>

          {/* Wide status nav */}
          <div className="grid grid-cols-5 gap-1 mb-3 p-1 rounded-xl bg-white border border-[#E4E4E7] shadow-sm">
            {STATUS_FILTERS.map(f => {
              const active = statusFilter === f.key
              return (
                <button key={f.key} onClick={() => setStatusFilter(f.key)}
                  className={`px-1 py-2 rounded-lg text-[11px] sm:text-xs font-semibold transition-all truncate ${
                    active ? 'bg-[#27272A] text-white shadow-sm' : 'text-[#71717A] hover:text-[#27272A] hover:bg-[#F4F4F5]'
                  }`}>
                  {f.label}
                </button>
              )
            })}
          </div>

          {/* Search + fee-head filter */}
          <div className="flex flex-col sm:flex-row gap-2 mb-4">
            <div className="relative flex-1">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#A1A1AA] pointer-events-none" />
              <input type="text" value={query} onChange={e => setQuery(e.target.value)}
                className={ADMIN.input} placeholder="Search passenger, trip, or reference…" />
              {query && (
                <button onClick={() => setQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#A1A1AA] hover:text-[#27272A]">
                  <X size={14} />
                </button>
              )}
            </div>
            {heads.length > 0 && (
              <div className="relative sm:w-56 flex-shrink-0">
                <select value={headFilter} onChange={e => setHeadFilter(e.target.value)}
                  className="w-full appearance-none bg-white border border-[#E4E4E7] rounded-lg pl-3 pr-9 py-2.5 text-sm text-[#27272A] font-medium focus:outline-none focus:border-[#27272A] transition-colors">
                  <option value="all">All fee heads</option>
                  {heads.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
                </select>
                <ChevronRight size={15} className="absolute right-3 top-1/2 -translate-y-1/2 rotate-90 text-[#A1A1AA] pointer-events-none" />
              </div>
            )}
          </div>

          {activeHeadName && (
            <div className="flex items-center gap-2 mb-3 text-xs text-[#71717A]">
              <span>Filtered by head:</span>
              <button onClick={() => setHeadFilter('all')}
                className="flex items-center gap-1 font-semibold text-[#27272A] bg-[#F4F4F5] hover:bg-[#E7E2D8] px-2.5 py-1 rounded-lg transition-colors">
                {activeHeadName} <X size={12} />
              </button>
            </div>
          )}

          {loading ? (
            <div className="text-center py-12"><div className="spinner mx-auto mb-3" /><p className="text-sm text-[#71717A]">Loading…</p></div>
          ) : filtered.length === 0 ? (
            <div className={`${ADMIN.card} p-8 text-center text-sm text-[#71717A]`}>
              No fees in this view.
            </div>
          ) : (
            <>
              <p className="text-xs text-[#A1A1AA] mb-2">
                Showing {shown.length} of {filtered.length} fee{filtered.length === 1 ? '' : 's'}
              </p>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-2.5">
                {shown.map(f => (
                  <div key={f.id} className={`${ADMIN.card} shadow-sm p-4`}>
                    <div className="flex items-center gap-3">
                      <Avatar avatarUrl={f.passenger?.avatar_url} name={f.passenger?.full_name ?? '?'} size={38} userId={f.passenger_id} />
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-[#18181B] text-sm truncate">{f.passenger?.full_name ?? 'Unknown'}</p>
                        <p className="text-[11px] text-[#71717A] truncate">
                          {f.description || f.fee_head?.name || 'Bus fee'}{f.trip?.name ? ` · ${f.trip.name}` : ''}{f.due_date ? ` · due ${f.due_date}` : ''}
                        </p>
                        <p className="text-[10px] text-[#C4C4C8] truncate">Ref: {f.upi_reference}</p>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="font-bold text-[#18181B] tabular-nums">{formatINR(f.amount)}</p>
                        <FeeStatusBadge status={f.status} />
                      </div>
                    </div>

                    {f.status !== 'paid' && f.status !== 'cancelled' && (
                      <div className="flex gap-2 mt-3">
                        <button onClick={() => act(f.id, 'paid')} disabled={busyId === f.id} className={`${ADMIN.darkBtn} flex-1`}>
                          <Check size={14} /> Mark paid
                        </button>
                        <button onClick={() => act(f.id, 'cancel')} disabled={busyId === f.id}
                          className="flex items-center justify-center gap-1.5 px-3 bg-white border border-[#E4E4E7] text-[#71717A] hover:text-rose-600 hover:border-rose-200 text-xs font-semibold py-2 rounded-lg transition-colors disabled:opacity-50">
                          <Ban size={14} /> Cancel
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
              {visibleCount < filtered.length && (
                <button onClick={() => setVisibleCount(c => c + PAGE_SIZE)}
                  className="w-full mt-3 py-2.5 text-sm font-semibold text-[#27272A] bg-white border border-[#E4E4E7] hover:border-[#D4D4D8] hover:bg-[#FAFAFA] rounded-xl transition-colors">
                  Load {Math.min(PAGE_SIZE, filtered.length - visibleCount)} more
                </button>
              )}
            </>
          )}
        </>
      ) : section === 'drafts' ? (
        <>
          {/* Monthly Drafts section */}
          <div className="flex items-center justify-between mb-3">
            <h2 className={ADMIN.label}>Monthly drafts</h2>
            <button onClick={() => setShowNewDraft(true)} className={ADMIN.darkBtn}>
              <Plus size={14} /> New Draft
            </button>
          </div>

          {loading ? (
            <div className="text-center py-12"><div className="spinner mx-auto mb-3" /><p className="text-sm text-[#71717A]">Loading…</p></div>
          ) : drafts.length === 0 ? (
            <div className={`${ADMIN.card} shadow-sm p-8 text-center`}>
              <div className="w-16 h-16 mx-auto mb-4 rounded-xl bg-[#27272A] flex items-center justify-center">
                <FileText size={28} className="text-[#B8983C]" strokeWidth={1.6} />
              </div>
              <p className="text-sm text-[#71717A] mb-4 max-w-sm mx-auto">
                No monthly drafts yet. Create a draft to prepare a batch of fees before issuing them to students.
              </p>
              <button onClick={() => setShowNewDraft(true)} className={`${ADMIN.darkBtn} mx-auto`}>
                <Plus size={14} /> New Draft
              </button>
            </div>
          ) : (
            <div className="space-y-2.5">
              {drafts.map(d => {
                const isIssued = d.status === 'issued'
                const isBusy = busyId === d.id
                const confirmingDelete = deletingId === d.id
                return (
                  <div key={d.id} className={`${ADMIN.card} shadow-sm p-4`}>
                    <div className="flex items-start gap-3">
                      {/* Icon */}
                      <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${
                        isIssued ? 'bg-emerald-50' : 'bg-[#27272A]'
                      }`}>
                        <FileText size={18} className={isIssued ? 'text-emerald-500' : 'text-[#B8983C]'} />
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-semibold text-[#18181B] text-sm truncate">{d.title}</p>
                          {isIssued ? (
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-semibold uppercase tracking-wide flex-shrink-0">
                              Issued
                            </span>
                          ) : (
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#F4F4F5] text-[#71717A] font-semibold uppercase tracking-wide flex-shrink-0">
                              Draft
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 flex-wrap mt-0.5">
                          <span className="flex items-center gap-1 text-[11px] text-[#71717A]">
                            <Calendar size={11} /> {formatDraftMonth(d.month)}
                          </span>
                          <span className="flex items-center gap-1 text-[11px] text-[#71717A]">
                            <Users size={11} /> {d.passenger_count ?? 0} student{(d.passenger_count ?? 0) === 1 ? '' : 's'}
                          </span>
                          <span className="text-[11px] font-bold text-[#27272A] tabular-nums">{formatINR(d.amount)}</span>
                          {d.trip?.name && (
                            <span className="text-[11px] text-[#71717A] truncate">· {d.trip.name}</span>
                          )}
                        </div>
                        {d.due_date && (
                          <p className="text-[10px] text-[#A1A1AA] mt-0.5">Due {d.due_date}</p>
                        )}
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex gap-2 mt-3">
                      {!isIssued && (
                        <>
                          <button
                            onClick={() => handleIssueDraft(d.id)}
                            disabled={isBusy || (d.passenger_count ?? 0) === 0}
                            className={`${ADMIN.darkBtn} flex-1`}
                            title={(d.passenger_count ?? 0) === 0 ? 'Add students to issue' : `Issue to ${d.passenger_count} student${d.passenger_count === 1 ? '' : 's'}`}
                          >
                            <Send size={13} />
                            {isBusy ? 'Issuing…' : `Issue to ${d.passenger_count ?? 0}`}
                          </button>
                          <button
                            onClick={() => { setEditDraft(d); setDeletingId(null) }}
                            disabled={isBusy}
                            className={ADMIN.ghostBtn}
                            title="Edit draft"
                          >
                            <Pencil size={13} />
                          </button>
                        </>
                      )}
                      {confirmingDelete ? (
                        <button
                          onClick={() => handleDeleteDraft(d.id)}
                          disabled={isBusy}
                          className="flex items-center justify-center gap-1.5 px-3 bg-rose-600 text-white text-xs font-semibold py-2 rounded-lg transition-colors disabled:opacity-50 flex-shrink-0"
                        >
                          <Trash2 size={13} /> Confirm delete
                        </button>
                      ) : (
                        <button
                          onClick={() => handleDeleteDraft(d.id)}
                          disabled={isBusy}
                          className="flex items-center justify-center gap-1.5 px-3 bg-white border border-[#E4E4E7] text-[#71717A] hover:text-rose-600 hover:border-rose-200 text-xs font-semibold py-2 rounded-lg transition-colors disabled:opacity-50 flex-shrink-0"
                          title="Delete draft"
                        >
                          <Trash2 size={13} />
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </>
      ) : (
        <>
          {/* Section header + New Fee Head action */}
          <div className="flex items-center justify-between mb-3">
            <h2 className={ADMIN.label}>Fee heads</h2>
            <button onClick={() => setShowNewHead(true)} className={ADMIN.darkBtn}>
              <Plus size={14} /> New Fee Head
            </button>
          </div>

          {loading ? (
            <div className="text-center py-12"><div className="spinner mx-auto mb-3" /><p className="text-sm text-[#71717A]">Loading…</p></div>
          ) : heads.length === 0 ? (
            <div className={`${ADMIN.card} shadow-sm p-8 text-center`}>
              <div className="w-16 h-16 mx-auto mb-4 rounded-xl bg-[#27272A] flex items-center justify-center">
                <Tag size={28} className="text-[#B8983C]" strokeWidth={1.6} />
              </div>
              <p className="text-sm text-[#71717A] mb-4 max-w-sm mx-auto">No fee heads yet. Create a reusable bus fee type (e.g. “Monthly Bus Fee”) to issue from.</p>
              <button onClick={() => setShowNewHead(true)} className={`${ADMIN.darkBtn} mx-auto`}>
                <Plus size={14} /> New Fee Head
              </button>
            </div>
          ) : (
            <>
              {activeHeads.length === 0 ? (
                <div className={`${ADMIN.card} p-8 text-center text-sm text-[#71717A]`}>
                  No active fee heads. {inactiveHeads.length > 0 && 'Search below to manage inactive heads.'}
                </div>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-2.5">
                  {activeHeads.map(renderHeadRow)}
                </div>
              )}

              {/* Inactive fee heads — collapsed, reachable via search */}
              {inactiveHeads.length > 0 && (
                <div className="mt-6 pt-5 border-t border-[#E7E2D8]">
                  <div className="flex items-center gap-2 mb-3">
                    <Archive size={14} className="text-[#A1A1AA]" />
                    <h3 className={ADMIN.label}>Inactive fee heads · {inactiveHeads.length}</h3>
                  </div>
                  <div className="relative mb-3">
                    <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#A1A1AA] pointer-events-none" />
                    <input type="text" value={inactiveQuery} onChange={e => setInactiveQuery(e.target.value)}
                      className={ADMIN.input} placeholder="Search inactive fee heads to reactivate or edit…" />
                    {inactiveQuery && (
                      <button onClick={() => setInactiveQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#A1A1AA] hover:text-[#27272A]">
                        <X size={14} />
                      </button>
                    )}
                  </div>
                  {iq === '' ? (
                    <p className="text-xs text-[#A1A1AA] px-1">
                      {inactiveHeads.length} inactive head{inactiveHeads.length === 1 ? '' : 's'} hidden. Search by name to manage them.
                    </p>
                  ) : matchingInactive.length === 0 ? (
                    <p className="text-xs text-[#A1A1AA] px-1">No inactive fee head matches “{inactiveQuery}”.</p>
                  ) : (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-2.5">
                      {matchingInactive.map(renderHeadRow)}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </>
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
        {(showNewDraft || editDraft) && (
          <MonthlyDraftModal
            draft={editDraft}
            trips={trips}
            feeHeads={heads}
            assignable={assignable}
            onClose={() => { setShowNewDraft(false); setEditDraft(null) }}
            onSaved={() => { setShowNewDraft(false); setEditDraft(null); load() }}
          />
        )}
      </AnimatePresence>
    </>
  )
}
