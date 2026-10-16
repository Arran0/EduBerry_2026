'use client'

import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { AnimatePresence } from 'framer-motion'
import {
  Plus, Check, Ban, QrCode, X, Tag, Pencil, ListChecks, Search, ChevronRight, Archive,
  Trash2, Wallet,
} from 'lucide-react'
import Avatar from '@/components/Avatar'
import FeeCollectionSummary, { formatINR, SummaryCardKey } from '@/components/bus/FeeCollectionSummary'
import FeeIssueModal from '@/components/bus/FeeIssueModal'
import BusFeeHeadFormModal from '@/components/bus/BusFeeHeadFormModal'
import FeeStatusBadge from '@/components/bus/FeeStatusBadge'
import BusCollectionSection from '@/components/bus/sections/BusCollectionSection'
import BusRecordPaymentModal from '@/components/bus/BusRecordPaymentModal'
import BusStudentStatementsModal from '@/components/bus/BusStudentStatementsModal'
import YearToggler from '@/components/fees/YearToggler'
import { ADMIN, Sheet, SHEET } from '@/components/bus/adminUI'
import { UserProfile } from '@/lib/supabase'
import {
  BusFee, BusFeeHead, PendingPayment, BusCollectionRow,
  fetchAllFees, fetchAssignablePassengers, summarizeFees, setFeeStatus, cancelFee,
  fetchPendingPayments, verifyPayment, rejectPayment,
  fetchBusFeeHeads, setBusFeeHeadActive, deleteBusFeeHead,
  fetchBusCollectionReport,
  academicYearOf, currentAcademicYear, listBusAcademicYears,
} from '@/lib/bus'

// Bulk issue (monthly drafts) used to live here too. Bills are now raised from
// each route's fee grid in Configuration, which knows every rider's stops and
// trips, so a hand-assembled draft list had nothing left to do.
type SectionKey = 'issued' | 'heads' | 'collection'

const SECTIONS = [
  { key: 'collection' as const, label: 'Collection', icon: <Wallet size={15} /> },
  { key: 'issued' as const, label: 'Issued Fees', icon: <ListChecks size={15} /> },
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
    case 'collected': return f.status === 'paid' || f.status === 'partial'
    case 'outstanding': return f.status === 'unpaid' || f.status === 'partial'
    case 'partial': return f.status === 'partial'
    case 'cancelled': return f.status === 'cancelled'
  }
}

// Billed / collected / outstanding figures for a fee head — collected in green,
// outstanding in red. Mirrors the Fee Manager's HeadStatRow.
function HeadStatRow({ billed, collected }: { billed: number; collected: number }) {
  const due = Math.max(0, billed - collected)
  return (
    <div className="flex items-center gap-x-3 gap-y-0.5 text-[11px] tabular-nums flex-wrap min-w-0">
      <span className="text-[#71717A] whitespace-nowrap">Billed <span className="font-bold text-[#27272A]">{formatINR(billed)}</span></span>
      <span className="text-[#16A34A] font-semibold whitespace-nowrap">Collected {formatINR(collected)}</span>
      <span className="text-[#DC2626] font-semibold whitespace-nowrap">Outstanding {formatINR(due)}</span>
    </div>
  )
}

const PAGE_SIZE = 40

interface BusFeesSectionProps {
  initialSection?: string | null
  initialFilter?: string | null
}

export default function BusFeesSection({ initialSection, initialFilter }: BusFeesSectionProps) {
  const [loading, setLoading] = useState(true)
  const [fees, setFees] = useState<BusFee[]>([])
  const [assignable, setAssignable] = useState<UserProfile[]>([])
  const [heads, setHeads] = useState<BusFeeHead[]>([])
  const [pending, setPending] = useState<PendingPayment[]>([])
  const [busPayments, setBusPayments] = useState<BusCollectionRow[]>([])

  // Academic year scoping — only the 4 summary cards use this; all other lists show all years.
  const [acadYear, setAcadYear] = useState<string>(currentAcademicYear())
  const [acadYears, setAcadYears] = useState<string[]>([currentAcademicYear()])

  const VALID_SECTIONS: SectionKey[] = ['collection', 'issued', 'heads']
  const VALID_FILTERS: IssuedFilter[] = ['all', 'collected', 'outstanding', 'cancelled', 'partial']
  const [section, setSection] = useState<SectionKey>(
    initialSection && VALID_SECTIONS.includes(initialSection as SectionKey)
      ? (initialSection as SectionKey) : 'collection'
  )
  const [statusFilter, setStatusFilter] = useState<IssuedFilter>(
    initialFilter && VALID_FILTERS.includes(initialFilter as IssuedFilter)
      ? (initialFilter as IssuedFilter) : 'all'
  )
  const [headFilter, setHeadFilter] = useState<string | 'all'>('all')
  const [query, setQuery] = useState('')
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  const [inactiveQuery, setInactiveQuery] = useState('')

  const [showIssue, setShowIssue] = useState(false)
  const [showNewHead, setShowNewHead] = useState(false)
  const [editHead, setEditHead] = useState<BusFeeHead | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [deletingHeadId, setDeletingHeadId] = useState<string | null>(null)
  const [recordingFee, setRecordingFee] = useState<BusFee | null>(null)
  const [statementPassenger, setStatementPassenger] = useState<UserProfile | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const [f, a, h, p, pay] = await Promise.all([
      fetchAllFees(), fetchAssignablePassengers(), fetchBusFeeHeads(),
      fetchPendingPayments(), fetchBusCollectionReport(),
    ])
    setFees(f); setAssignable(a); setHeads(h); setPending(p)
    setBusPayments(pay)
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => { listBusAcademicYears().then(setAcadYears) }, [])

  useEffect(() => { setVisibleCount(PAGE_SIZE) }, [statusFilter, headFilter, query])
  useEffect(() => { setDeletingHeadId(null) }, [section])

  const toggleHeadActive = async (head: BusFeeHead) => {
    setHeads(prev => prev.map(h => h.id === head.id ? { ...h, active: !h.active } : h))
    await setBusFeeHeadActive(head.id, !head.active)
  }

  const openHeadInIssued = (head: BusFeeHead) => {
    setHeadFilter(head.id); setStatusFilter('all'); setSection('issued')
  }

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

  // Two-click delete for a fee head — only offered when nothing was ever collected.
  const handleDeleteHead = async (head: BusFeeHead) => {
    if (deletingHeadId !== head.id) { setDeletingHeadId(head.id); return }
    setBusyId(head.id); setDeletingHeadId(null)
    const res = await deleteBusFeeHead(head.id)
    if (res.success) setHeads(prev => prev.filter(h => h.id !== head.id))
    else window.alert(res.error ?? 'Could not delete fee head')
    setBusyId(null)
  }

  // Verified amount collected per fee id — drives partial fee breakdowns.
  const paidByFee = useMemo(() => {
    const m = new Map<string, number>()
    for (const p of busPayments) {
      const id = p.fee?.id
      if (!id) continue
      m.set(id, (m.get(id) ?? 0) + (Number(p.amount) || 0))
    }
    return m
  }, [busPayments])

  // Per-fee-head billed / collected breakdown for the Fee Heads tab.
  const headStats = useMemo(() => {
    const m = new Map<string, { billed: number; collected: number }>()
    for (const f of fees) {
      if (f.status === 'cancelled') continue
      const id = f.fee_head_id ?? f.fee_head?.id
      if (!id) continue
      const cur = m.get(id) ?? { billed: 0, collected: 0 }
      const amt = Number(f.amount) || 0
      cur.billed += amt
      cur.collected += f.status === 'paid' ? amt : (paidByFee.get(f.id) ?? 0)
      m.set(id, cur)
    }
    return m
  }, [fees, paidByFee])

  // Fees scoped to the selected academic year — only the 4 summary cards use this.
  const acadFees = useMemo(
    () => fees.filter(f => academicYearOf(f.due_date ?? f.created_at) === acadYear),
    [fees, acadYear],
  )
  const summary = useMemo(() => summarizeFees(acadFees, paidByFee), [acadFees, paidByFee])

  const todayCollected = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10)
    return acadFees
      .filter(f => f.status === 'paid' && f.updated_at?.slice(0, 10) === today)
      .reduce((s, f) => s + (Number(f.amount) || 0), 0)
  }, [acadFees])

  const studentsWithDue = useMemo(
    () => new Set(acadFees.filter(f => f.status === 'unpaid' || f.status === 'partial').map(f => f.passenger_id)).size,
    [acadFees],
  )

  const q = query.trim().toLowerCase()
  const filtered = useMemo(() => fees.filter(f =>
    matchIssuedFilter(f, statusFilter) &&
    (headFilter === 'all' || (f.fee_head_id ?? f.fee_head?.id) === headFilter) &&
    (q === '' ||
      (f.passenger?.full_name ?? '').toLowerCase().includes(q) ||
      (f.description ?? '').toLowerCase().includes(q) ||
      (f.fee_head?.name ?? '').toLowerCase().includes(q) ||
      (f.route?.name ?? '').toLowerCase().includes(q) ||
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

  // One Excel-style fee-head line — mirrors the Fee Manager's FeeHeadRow:
  // a clean desktop ledger row plus a stacked card below `sm`.
  const renderHeadRow = (head: BusFeeHead, opts?: { inactiveLook?: boolean }) => {
    const inactiveLook = opts?.inactiveLook ?? false
    const st = headStats.get(head.id) ?? { billed: 0, collected: 0 }
    const canDelete = st.collected === 0
    const confirmingDelete = deletingHeadId === head.id
    const busy = busyId === head.id
    const nameCls = inactiveLook ? 'text-[#52525B]' : 'text-[#18181B]'
    const barClass = head.active ? 'bg-[#27272A]' : 'bg-[#E4E4E7]'
    const iconWrapClass = head.active ? 'bg-[#27272A]' : 'bg-[#F4F4F5] border border-[#E4E4E7]'
    const icon = <Tag size={13} className={head.active ? 'text-[#B8983C]' : 'text-[#A1A1AA]'} />

    const editBtn = (
      <button onClick={() => setEditHead(head)} title="Edit"
        className="p-1.5 text-[#A1A1AA] hover:text-[#27272A] hover:bg-[#F4F4F5] rounded-lg transition-colors">
        <Pencil size={13} />
      </button>
    )
    const deleteBtn = canDelete ? (
      confirmingDelete ? (
        <button onClick={() => handleDeleteHead(head)} disabled={busy} title="Confirm delete"
          className="p-1.5 text-rose-600 hover:bg-rose-50 rounded-lg transition-colors disabled:opacity-50">
          <Check size={13} />
        </button>
      ) : (
        <button onClick={() => handleDeleteHead(head)} disabled={busy} title="Delete fee head"
          className="p-1.5 text-[#A1A1AA] hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors disabled:opacity-50">
          <Trash2 size={13} />
        </button>
      )
    ) : null

    return (
      <div key={head.id} className="border-b border-[#F4F4F5] last:border-b-0 hover:bg-[#FAFAFA] transition-colors">
        {/* ── Desktop row ── */}
        <div className="hidden sm:flex items-stretch">
          <div className={`w-1 flex-shrink-0 ${barClass}`} />
          <button onClick={() => openHeadInIssued(head)} className="group/hd flex items-center gap-2.5 w-60 px-3 py-2.5 min-w-0 text-left flex-shrink-0">
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${iconWrapClass}`}>{icon}</div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 min-w-0">
                <p className={`text-sm font-semibold truncate group-hover/hd:underline underline-offset-2 ${nameCls}`}>{head.name}</p>
                {!head.active && (
                  <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[#F4F4F5] text-[#A1A1AA] font-semibold uppercase tracking-wide flex-shrink-0">Inactive</span>
                )}
              </div>
              <p className="text-[10px] text-[#A1A1AA] tabular-nums">Default {formatINR(head.default_amount)}</p>
            </div>
          </button>
          <button onClick={() => openHeadInIssued(head)} className="flex items-center flex-1 px-3 min-w-0">
            <HeadStatRow billed={st.billed} collected={st.collected} />
          </button>
          <div className="flex items-center justify-center w-14 px-1 flex-shrink-0">
            <label className="relative inline-flex items-center cursor-pointer" title={head.active ? 'Active' : 'Inactive'}>
              <input type="checkbox" checked={head.active} onChange={() => toggleHeadActive(head)} className="sr-only peer" />
              <div className="w-9 h-5 bg-[#D4D4D8] rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all after:shadow peer-checked:bg-[#27272A]" />
            </label>
          </div>
          <div className="flex items-center justify-end gap-0.5 w-20 pr-2 flex-shrink-0">
            {editBtn}{deleteBtn}
          </div>
        </div>

        {/* ── Mobile card ── */}
        <div className="sm:hidden flex items-stretch">
          <div className={`w-1 flex-shrink-0 ${barClass}`} />
          <div className="flex-1 min-w-0 px-3 py-2.5">
            <button onClick={() => openHeadInIssued(head)} className="group/hd flex items-center gap-2.5 w-full text-left min-w-0">
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${iconWrapClass}`}>{icon}</div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 min-w-0">
                  <p className={`text-sm font-semibold truncate ${nameCls}`}>{head.name}</p>
                  {!head.active && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[#F4F4F5] text-[#A1A1AA] font-semibold uppercase tracking-wide flex-shrink-0">Inactive</span>
                  )}
                </div>
                <p className="text-[10px] text-[#A1A1AA] tabular-nums">Default {formatINR(head.default_amount)}</p>
              </div>
              <ChevronRight size={14} className="text-[#D4D4D8] flex-shrink-0" />
            </button>
            <div className="mt-1.5 ml-[42px]"><HeadStatRow billed={st.billed} collected={st.collected} /></div>
            <div className="mt-2 ml-[42px] flex items-center justify-between gap-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <span className="relative inline-flex items-center">
                  <input type="checkbox" checked={head.active} onChange={() => toggleHeadActive(head)} className="sr-only peer" />
                  <span className="w-9 h-5 bg-[#D4D4D8] rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all after:shadow peer-checked:bg-[#27272A]" />
                </span>
                <span className="text-[11px] text-[#71717A]">{head.active ? 'Active' : 'Inactive'}</span>
              </label>
              <div className="flex items-center gap-1 flex-shrink-0">{editBtn}{deleteBtn}</div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <>
      {/* Academic year toggler + summary cards */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-3">
          <span className={ADMIN.label}>Academic year</span>
          <YearToggler years={acadYears} value={acadYear} onChange={setAcadYear} />
        </div>
        <FeeCollectionSummary
          summary={summary}
          activeKey={section === 'issued' ? (statusFilter as SummaryCardKey) : undefined}
          onSelect={key => { setSection('issued'); setStatusFilter(key) }}
          todayCollected={todayCollected}
          studentsWithDue={studentsWithDue}
        />
      </div>

      {/* Section toggler — pill segmented control */}
      <div className="flex gap-1 mb-5 p-1 rounded-xl bg-white border border-[#E4E4E7] shadow-sm">
        {SECTIONS.map(s => {
          const active = section === s.key
          return (
            <button key={s.key} onClick={() => setSection(s.key)}
              className={`flex-1 flex items-center justify-center gap-1 sm:gap-1.5 px-1.5 sm:px-2 py-2 rounded-lg text-xs sm:text-sm font-semibold transition-all ${
                active ? 'bg-[#27272A] text-white shadow-sm' : 'text-[#71717A] hover:text-[#27272A] hover:bg-[#F4F4F5]'
              }`}>
              {s.icon}
              <span className="truncate">{s.label}</span>
            </button>
          )
        })}
      </div>

      {/* ══ ISSUED FEES ══════════════════════════════════════════════ */}
      {section === 'issued' ? (
        <>
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
                      {claim.fee?.passenger ? (
                        <button onClick={() => setStatementPassenger(claim.fee!.passenger!)}
                          className="text-sm font-medium text-[#18181B] truncate hover:underline underline-offset-2 text-left max-w-full"
                          title="View financial statements">
                          {claim.fee.passenger.full_name}
                        </button>
                      ) : (
                        <p className="text-sm font-medium text-[#18181B] truncate">Unknown</p>
                      )}
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

          <div className="flex items-center justify-between mb-3">
            <h2 className={ADMIN.label}>Issued fees</h2>
            <button onClick={() => setShowIssue(true)} className={ADMIN.darkBtn}>
              <Plus size={14} /> Issue Fee
            </button>
          </div>

          <div className="flex border-b border-[#E4E4E7] mb-3">
            {STATUS_FILTERS.map(f => {
              const active = statusFilter === f.key
              return (
                <button key={f.key} onClick={() => setStatusFilter(f.key)}
                  className={`flex-1 text-center pb-2 text-[11px] sm:text-xs font-semibold border-b-2 -mb-px transition-colors truncate ${
                    active ? 'border-[#27272A] text-[#18181B]' : 'border-transparent text-[#A1A1AA] hover:text-[#71717A]'
                  }`}>
                  {f.label}
                </button>
              )
            })}
          </div>

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
            <div className={`${ADMIN.card} p-8 text-center text-sm text-[#71717A]`}>No fees in this view.</div>
          ) : (
            <>
              <p className="text-xs text-[#A1A1AA] mb-2">
                Showing {shown.length} of {filtered.length} fee{filtered.length === 1 ? '' : 's'}
              </p>
              <Sheet
                columns={
                  <>
                    <span className="flex-1 ml-12 text-[10px] font-bold uppercase tracking-widest text-[#A1A1AA]">Passenger / Fee</span>
                    <span className="w-24 sm:w-36 text-right text-[10px] font-bold uppercase tracking-widest text-[#A1A1AA] flex-shrink-0 pr-2">Amount / Status</span>
                    <span className="w-32 text-[10px] font-bold uppercase tracking-widest text-[#A1A1AA] text-right flex-shrink-0">Actions</span>
                  </>
                }
              >
                {shown.map(f => {
                  const actionable = f.status !== 'paid' && f.status !== 'cancelled'
                  const barColor = f.status === 'paid' ? 'bg-[#27272A]'
                    : f.status === 'cancelled' ? 'bg-[#E4E4E7]'
                    : f.status === 'partial' ? 'bg-[#B8983C]' : 'bg-[#D4D4D8]'
                  const amt = Number(f.amount) || 0
                  const paid = f.status === 'paid' ? amt : (paidByFee.get(f.id) ?? 0)
                  const due = Math.max(0, amt - paid)
                  const partial = f.status === 'partial'
                  return (
                    <div key={f.id} className={SHEET.row}>
                      <div className={`${SHEET.bar} ${barColor}`} />
                      <div className="flex items-center gap-2.5 sm:gap-3 flex-1 min-w-0 px-3 py-2.5">
                        <Avatar avatarUrl={f.passenger?.avatar_url} name={f.passenger?.full_name ?? '?'} size={34} userId={f.passenger_id} />
                        <div className="flex-1 min-w-0">
                          {f.passenger ? (
                            <button onClick={() => setStatementPassenger(f.passenger!)}
                              className="font-semibold text-[#18181B] text-sm truncate hover:underline underline-offset-2 hover:text-[#27272A] text-left max-w-full"
                              title="View financial statements">
                              {f.passenger.full_name}
                            </button>
                          ) : (
                            <p className="font-semibold text-[#18181B] text-sm truncate">Unknown</p>
                          )}
                          <p className="text-[11px] text-[#71717A] truncate">
                            {f.description || f.fee_head?.name || 'Bus fee'}{f.route?.name ? ` · ${f.route.name}` : ''}{f.due_date ? ` · due ${f.due_date}` : ''}
                            {f.upi_reference ? ` · ref ${f.upi_reference}` : ''}
                          </p>
                        </div>
                        <div className="flex flex-col items-end justify-center w-24 sm:w-36 px-2 flex-shrink-0">
                          <p className="text-sm font-bold text-[#18181B] tabular-nums">{formatINR(amt)}</p>
                          {partial ? (
                            <div className="flex flex-col items-end gap-0.5 mt-0.5">
                              <span className="text-[10px] font-semibold text-[#16A34A] tabular-nums">Paid {formatINR(paid)}</span>
                              <span className="text-[10px] font-semibold text-[#DC2626] tabular-nums">Due {formatINR(due)}</span>
                              <FeeStatusBadge status={f.status} />
                            </div>
                          ) : (
                            <FeeStatusBadge status={f.status} />
                          )}
                        </div>
                        <div className="w-auto sm:w-32 flex items-center justify-end gap-1.5 flex-shrink-0">
                          {actionable ? (
                            <>
                              <button onClick={() => setRecordingFee(f)} disabled={busyId === f.id}
                                className={`${ADMIN.darkBtn} !px-2.5 !py-1.5`} title="Record payment">
                                <Check size={13} /> <span className="hidden sm:inline">Record</span>
                              </button>
                              <button onClick={() => act(f.id, 'cancel')} disabled={busyId === f.id}
                                className="flex items-center justify-center gap-1 px-2.5 bg-white border border-[#E4E4E7] text-[#71717A] hover:text-rose-600 hover:border-rose-200 text-xs font-semibold py-1.5 rounded-lg transition-colors disabled:opacity-50">
                                <Ban size={13} />
                              </button>
                            </>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </Sheet>
              {visibleCount < filtered.length && (
                <button onClick={() => setVisibleCount(c => c + PAGE_SIZE)}
                  className="w-full mt-3 py-2.5 text-sm font-semibold text-[#27272A] bg-white border border-[#E4E4E7] hover:border-[#D4D4D8] hover:bg-[#FAFAFA] rounded-xl transition-colors">
                  Load {Math.min(PAGE_SIZE, filtered.length - visibleCount)} more
                </button>
              )}
            </>
          )}
        </>

      /* ══ COLLECTION REPORT ══════════════════════════════════════ */
      ) : section === 'collection' ? (
        <BusCollectionSection />

      /* ══ FEE HEADS ═══════════════════════════════════════════════ */
      ) : (
        <>
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
              <p className="text-sm text-[#71717A] mb-4 max-w-sm mx-auto">No fee heads yet. Create a reusable bus fee type (e.g. &ldquo;Monthly Bus Fee&rdquo;) to issue from.</p>
              <button onClick={() => setShowNewHead(true)} className={`${ADMIN.darkBtn} mx-auto`}>
                <Plus size={14} /> New Fee Head
              </button>
            </div>
          ) : (
            <>
              {/* Excel-style fee head table — mirrors the Fee Manager */}
              <div className="border border-[#E4E4E7] rounded-xl overflow-hidden bg-white">
                {/* Column headers (desktop only) */}
                <div className="bg-[#27272A] py-2.5 hidden sm:flex items-center">
                  <span className="w-1 flex-shrink-0" />
                  <span className="w-60 px-3 text-[10px] font-bold uppercase tracking-widest text-[#A1A1AA] flex-shrink-0">Fee Head</span>
                  <span className="flex-1 px-3 text-[10px] font-bold uppercase tracking-widest text-[#A1A1AA]">Billed · Collected · Outstanding</span>
                  <span className="w-14 px-1 text-[10px] font-bold uppercase tracking-widest text-[#A1A1AA] text-center flex-shrink-0">Active</span>
                  <span className="w-20 pr-2 text-[10px] font-bold uppercase tracking-widest text-[#A1A1AA] text-right flex-shrink-0">Actions</span>
                </div>

                {activeHeads.length === 0 ? (
                  <div className="pl-2 pr-3 py-5 text-center text-sm text-[#71717A]">
                    No active fee heads. {inactiveHeads.length > 0 && 'Search below to reactivate.'}
                  </div>
                ) : (
                  activeHeads.map(head => renderHeadRow(head))
                )}
              </div>

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
                    <p className="text-xs text-[#A1A1AA] px-1">No inactive fee head matches &ldquo;{inactiveQuery}&rdquo;.</p>
                  ) : (
                    <div className="border border-[#E4E4E7] rounded-xl overflow-hidden bg-white">
                      {matchingInactive.map(head => renderHeadRow(head, { inactiveLook: true }))}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </>
      )}

      <AnimatePresence>
        {recordingFee && (
          <BusRecordPaymentModal
            key="record-payment"
            fee={recordingFee}
            paid={paidByFee.get(recordingFee.id) ?? 0}
            onClose={() => setRecordingFee(null)}
            onRecorded={() => { setRecordingFee(null); load() }}
          />
        )}
        {showIssue && (
          <FeeIssueModal
            key="fee-issue"
            assignable={assignable}
            feeHeads={heads}
            onClose={() => setShowIssue(false)}
            onIssued={() => { setShowIssue(false); load() }}
          />
        )}
        {(showNewHead || editHead) && (
          <BusFeeHeadFormModal
            key="fee-head-form"
            head={editHead}
            onClose={() => { setShowNewHead(false); setEditHead(null) }}
            onSaved={() => { setShowNewHead(false); setEditHead(null); load() }}
          />
        )}
        {statementPassenger && (
          <BusStudentStatementsModal
            key="student-statements"
            passenger={statementPassenger}
            onClose={() => setStatementPassenger(null)}
          />
        )}
      </AnimatePresence>
    </>
  )
}
