'use client'

import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { AnimatePresence } from 'framer-motion'
import {
  CreditCard, Plus, Tag, Pencil, Receipt, ListChecks,
  Check, Ban, QrCode, X, ChevronRight, Search, Archive, Wallet, BarChart3, Download, Bus, ExternalLink,
} from 'lucide-react'
import ProtectedLayout from '@/components/ProtectedLayout'
import PageBanner from '@/components/PageBanner'
import Avatar from '@/components/Avatar'
import FeeCollectionSummary, { formatINR, SummaryCardKey } from '@/components/fees/FeeCollectionSummary'
import FeeStatusBadge from '@/components/fees/FeeStatusBadge'
import YearToggler from '@/components/fees/YearToggler'
import dynamic from 'next/dynamic'
const FeeHeadFormModal   = dynamic(() => import('@/components/fees/FeeHeadFormModal'))
const IssueFeeModal      = dynamic(() => import('@/components/fees/IssueFeeModal'))
const PaySchoolFeeModal  = dynamic(() => import('@/components/fees/PaySchoolFeeModal'))
const RecordPaymentModal = dynamic(() => import('@/components/fees/RecordPaymentModal'))
const CollectionReportSection = dynamic(() => import('@/components/fees/CollectionReportSection'))
const ReportsSection = dynamic(() => import('@/components/fees/ReportsSection'))
import { useAuth } from '@/contexts/AuthContext'
import { isAdminRole, UserProfile } from '@/lib/supabase'
import { FEES_BANNER_DEFAULT } from '@/lib/pageConfig'
import { Homeroom, fetchAllHomerooms } from '@/lib/homerooms'
import {
  FeeHead, SchoolFee, PendingPayment, CollectionRow, FeeStatus,
  fetchFeeHeads, fetchAllFees, summarizeFees, setFeeHeadActive, fetchFeesForStudent,
  setFeeStatus, cancelFee, fetchPendingPayments, verifyPayment, rejectPayment,
  listAcademicYears, currentAcademicYear, summarizeDashboard, fetchCollectionReport, academicYearOf,
} from '@/lib/fees'
import {
  BusFee, BusFeeHead, fetchAllFees as fetchAllBusFees, fetchBusFeeHeads,
} from '@/lib/bus'

export default function FeesPage() {
  const { profile } = useAuth()
  const router = useRouter()
  const isAdmin = profile ? isAdminRole(profile.role) : false

  return (
    <ProtectedLayout>
      <div data-page-theme="fees">
        {isAdmin
          ? <AdminFeeHub onBack={() => router.back()} />
          : <StudentFeeView onBack={() => router.push('/home')} />}
      </div>
    </ProtectedLayout>
  )
}

// ──────────────────────────────────────────────────────────────
// Admin hub — inline sections: Issued Fees / Fee Heads
// ──────────────────────────────────────────────────────────────

type SectionKey = 'issued' | 'heads' | 'collection' | 'reports'

const SECTIONS: { key: SectionKey; label: string; icon: React.ReactNode }[] = [
  { key: 'issued', label: 'Issued Fees', icon: <ListChecks size={15} /> },
  { key: 'heads', label: 'Fee Heads', icon: <Tag size={15} /> },
  { key: 'collection', label: 'Collection', icon: <Wallet size={15} /> },
  { key: 'reports', label: 'Reports', icon: <BarChart3 size={15} /> },
]

type IssuedFilter = 'all' | 'collected' | 'outstanding' | 'cancelled' | 'partial'

const STATUS_FILTERS: { key: IssuedFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'collected', label: 'Collected' },
  { key: 'outstanding', label: 'Outstanding' },
  { key: 'cancelled', label: 'Cancelled' },
  { key: 'partial', label: 'Partial' },
]

// A normalized issued-fee row so School and Bus fee lines render in one table.
type FeeSource = 'school' | 'bus'
interface IssuedRow {
  id: string
  source: FeeSource
  student?: UserProfile | null
  student_id: string
  amount: number
  description: string | null
  headId: string | null
  headName: string | null
  due_date: string | null
  status: FeeStatus
  reference: string
  academic_year: string | null
  /** The underlying school fee — present (and actionable) only for school rows. */
  school?: SchoolFee
}

function schoolToRow(f: SchoolFee): IssuedRow {
  return {
    id: f.id, source: 'school', student: f.student, student_id: f.student_id,
    amount: Number(f.amount) || 0, description: f.description,
    headId: f.fee_head_id ?? f.fee_head?.id ?? null, headName: f.fee_head?.name ?? null,
    due_date: f.due_date, status: f.status, reference: f.upi_reference,
    academic_year: f.academic_year, school: f,
  }
}

function busToRow(f: BusFee): IssuedRow {
  return {
    id: f.id, source: 'bus', student: f.passenger, student_id: f.passenger_id,
    amount: Number(f.amount) || 0, description: f.description,
    headId: f.fee_head_id ?? f.fee_head?.id ?? null,
    headName: f.fee_head?.name ?? f.trip?.name ?? null,
    due_date: f.due_date, status: f.status as FeeStatus, reference: f.upi_reference,
    // Bus fees carry no academic_year column — derive it for year scoping.
    academic_year: academicYearOf(f.due_date || f.created_at),
  }
}

function matchRowFilter(f: IssuedRow, key: IssuedFilter): boolean {
  switch (key) {
    case 'all': return true
    case 'collected': return f.status === 'paid'
    case 'outstanding': return f.status === 'unpaid' || f.status === 'partial'
    case 'partial': return f.status === 'partial'
    case 'cancelled': return f.status === 'cancelled'
  }
}

// Left status bar colour (Excel-style row accent).
const STATUS_BAR: Record<FeeStatus, string> = {
  paid: 'bg-[#16A34A]', partial: 'bg-[#D97706]', unpaid: 'bg-[#A1A1AA]', cancelled: 'bg-[#E4E4E7]',
}

// Render an initial slice of the (potentially large) issued-fees list and reveal
// more on demand — keeps the DOM light even when thousands of fees exist.
const PAGE_SIZE = 40

// Shared admin-aesthetic tokens (zinc + honey gold, sharp cards).
const ADMIN = {
  card: 'bg-white border border-[#E4E4E7] rounded-xl',
  input: 'w-full bg-white border border-[#E4E4E7] rounded-lg pl-9 pr-9 py-2.5 text-sm text-[#27272A] placeholder:text-[#A1A1AA] focus:outline-none focus:border-[#27272A] transition-colors',
  label: 'text-[10px] font-bold uppercase tracking-widest text-[#71717A]',
  darkBtn: 'flex items-center justify-center gap-1.5 bg-[#27272A] hover:bg-[#18181B] text-white text-xs font-semibold px-3 py-2 rounded-lg transition-colors disabled:opacity-50',
  ghostBtn: 'flex items-center justify-center gap-1.5 bg-white border border-[#E4E4E7] text-[#71717A] hover:text-[#27272A] hover:border-[#D4D4D8] text-xs font-semibold px-3 py-2 rounded-lg transition-colors disabled:opacity-50',
}

function AdminFeeHub({ onBack }: { onBack: () => void }) {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [heads, setHeads] = useState<FeeHead[]>([])
  const [homerooms, setHomerooms] = useState<Homeroom[]>([])
  const [fees, setFees] = useState<SchoolFee[]>([])
  const [pending, setPending] = useState<PendingPayment[]>([])
  const [payments, setPayments] = useState<CollectionRow[]>([])
  // Bus module fee lines + heads, surfaced read-only alongside school fees.
  const [busFees, setBusFees] = useState<BusFee[]>([])
  const [busHeads, setBusHeads] = useState<BusFeeHead[]>([])
  // Bumped when a card deep-links into Reports, to scroll the defaulter list.
  const [defaultersFocus, setDefaultersFocus] = useState(0)

  // Academic-year scoping — every fetch/summary below is for the selected year.
  const [year, setYear] = useState<string>(currentAcademicYear())
  const [years, setYears] = useState<string[]>([currentAcademicYear()])

  // Fee currently being settled at the office (cash/cheque/card/bank/UPI).
  const [recordingFee, setRecordingFee] = useState<SchoolFee | null>(null)

  // Issued Fees is the default landing section.
  const [section, setSection] = useState<SectionKey>('issued')
  const [statusFilter, setStatusFilter] = useState<IssuedFilter>('all')
  const [headFilter, setHeadFilter] = useState<string | 'all'>('all')
  const [query, setQuery] = useState('')
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  const [inactiveQuery, setInactiveQuery] = useState('')

  const [bannerEditing, setBannerEditing] = useState(false)
  const [showIssue, setShowIssue] = useState(false)
  const [editHead, setEditHead] = useState<FeeHead | null>(null)
  const [showNewHead, setShowNewHead] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const [h, hr, f, p, pay, bf, bh] = await Promise.all([
      fetchFeeHeads(), fetchAllHomerooms(), fetchAllFees(year), fetchPendingPayments(),
      fetchCollectionReport({ year }), fetchAllBusFees(), fetchBusFeeHeads(),
    ])
    setHeads(h); setHomerooms(hr); setFees(f); setPending(p); setPayments(pay)
    setBusFees(bf); setBusHeads(bh)
    setLoading(false)
  }, [year])

  useEffect(() => { load() }, [load])

  // Discover the academic years that actually have data (newest first).
  useEffect(() => { listAcademicYears().then(setYears) }, [])

  // Reset the reveal window whenever the issued-fees view is re-filtered.
  useEffect(() => { setVisibleCount(PAGE_SIZE) }, [statusFilter, headFilter, query])

  const toggleHeadActive = async (head: FeeHead) => {
    setHeads(prev => prev.map(h => h.id === head.id ? { ...h, active: !h.active } : h))
    await setFeeHeadActive(head.id, !head.active)
  }

  // Clicking a fee head jumps to Issued Fees with that head pre-filtered.
  const openHeadInIssued = (head: FeeHead) => {
    setHeadFilter(head.id)
    setStatusFilter('all')
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
  const dashboard = useMemo(() => summarizeDashboard(fees, payments), [fees, payments])

  // Merge school + bus fee lines (bus scoped to the selected year via its
  // derived academic year) into one issued list.
  const rows = useMemo<IssuedRow[]>(() => {
    const busRows = busFees.map(busToRow).filter(r => r.academic_year === year)
    return [...fees.map(schoolToRow), ...busRows]
  }, [fees, busFees, year])

  const q = query.trim().toLowerCase()
  const filtered = useMemo(() => rows.filter(f =>
    matchRowFilter(f, statusFilter) &&
    (headFilter === 'all' || f.headId === headFilter) &&
    (q === '' ||
      (f.student?.full_name ?? '').toLowerCase().includes(q) ||
      (f.description ?? '').toLowerCase().includes(q) ||
      (f.headName ?? '').toLowerCase().includes(q) ||
      (f.reference ?? '').toLowerCase().includes(q))
  ), [rows, statusFilter, headFilter, q])

  const shown = filtered.slice(0, visibleCount)
  // Head-filter options: school heads first, then bus heads (labelled).
  const headOptions = useMemo(() => [
    ...heads.map(h => ({ id: h.id, label: h.name })),
    ...busHeads.map(h => ({ id: h.id, label: `Bus · ${h.name}` })),
  ], [heads, busHeads])
  const activeHeadName = headFilter === 'all' ? null : headOptions.find(h => h.id === headFilter)?.label ?? null

  const activeHeads = heads.filter(h => h.active)
  const inactiveHeads = heads.filter(h => !h.active)
  const iq = inactiveQuery.trim().toLowerCase()
  const matchingInactive = iq === '' ? [] : inactiveHeads.filter(h =>
    h.name.toLowerCase().includes(iq) || (h.description ?? '').toLowerCase().includes(iq)
  )

  // ── Reusable fee-head row (used for active + inactive heads) ──────────────
  const renderHeadRow = (head: FeeHead) => (
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
    <div style={{ minHeight: '100vh' }}>
      <PageBanner
        settingKey="fees_banner"
        defaultBanner={FEES_BANNER_DEFAULT}
        icon={<CreditCard size={26} className="text-white" />}
        title="Fee Manager"
        subtitle={`${heads.length} fee head${heads.length === 1 ? '' : 's'} · issue & track collections`}
        isAdmin
        onBack={onBack}
        onEditingChange={setBannerEditing}
        maxWidth="max-w-6xl"
        backgroundIcon={<CreditCard size={150} className="text-white" />}
        actions={<YearToggler years={years} value={year} onChange={setYear} tone="light" />}
      />

      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pb-10">
        {/* Everything but the banner fades while the banner is being edited */}
        <div style={{ opacity: bannerEditing ? 0.35 : 1, filter: bannerEditing ? 'blur(1.5px)' : 'none', pointerEvents: bannerEditing ? 'none' : 'auto', userSelect: bannerEditing ? 'none' : 'auto', transition: 'opacity 0.25s ease, filter 0.25s ease' }}>

          {/* Six summary cards. The first four filter the issued-fees view;
              the last two open the Collection and Reports sections. */}
          <div className="relative z-10 -mt-6 sm:-mt-8 mb-5">
            <FeeCollectionSummary
              summary={summary}
              activeKey={section === 'issued' ? (statusFilter as SummaryCardKey) : undefined}
              onSelect={(key) => { setSection('issued'); setStatusFilter(key) }}
              todayCollection={dashboard.today_collection}
              studentsWithDues={dashboard.students_with_dues}
              onOpenCollection={() => setSection('collection')}
              onOpenDefaulters={() => { setSection('reports'); setDefaultersFocus(n => n + 1) }}
            />
          </div>

          {/* Section toggler — inline tabs, full width, below the cards */}
          <div className="flex gap-1 mb-5 p-1 rounded-xl bg-white border border-[#E4E4E7] shadow-sm">
            {SECTIONS.map(s => {
              const active = section === s.key
              return (
                <button key={s.key} onClick={() => setSection(s.key)}
                  className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-2.5 rounded-lg text-sm font-semibold transition-all ${
                    active ? 'bg-[#27272A] text-white shadow-sm' : 'text-[#71717A] hover:text-[#27272A] hover:bg-[#F4F4F5]'
                  }`}>
                  {s.icon} <span className="truncate">{s.label}</span>
                </button>
              )
            })}
          </div>

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
                        <Avatar avatarUrl={claim.fee?.student?.avatar_url} name={claim.fee?.student?.full_name ?? '?'} size={34} userId={claim.payer_id ?? undefined} />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-[#18181B] truncate">{claim.fee?.student?.full_name ?? 'Unknown'}</p>
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

              {/* Wide status nav — full width, as wide as the section toggler */}
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
                    className={ADMIN.input} placeholder="Search student, description, or reference…" />
                  {query && (
                    <button onClick={() => setQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#A1A1AA] hover:text-[#27272A]">
                      <X size={14} />
                    </button>
                  )}
                </div>
                {headOptions.length > 0 && (
                  <div className="relative sm:w-56 flex-shrink-0">
                    <select value={headFilter} onChange={e => setHeadFilter(e.target.value)}
                      className="w-full appearance-none bg-white border border-[#E4E4E7] rounded-lg pl-3 pr-9 py-2.5 text-sm text-[#27272A] font-medium focus:outline-none focus:border-[#27272A] transition-colors">
                      <option value="all">All fee heads</option>
                      {headOptions.map(h => <option key={h.id} value={h.id}>{h.label}</option>)}
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

                  {/* Excel-style ledger: bordered container, dark header, thin rows */}
                  <div className="border border-[#E4E4E7] rounded-xl overflow-hidden bg-white">
                    {/* Column headers */}
                    <div className="bg-[#27272A] pl-1 pr-3 py-2.5 hidden sm:flex items-center gap-3">
                      <span className="w-9 flex-shrink-0" />
                      <span className="flex-1 text-[10px] font-bold uppercase tracking-widest text-[#A1A1AA]">Student</span>
                      <span className="flex-1 text-[10px] font-bold uppercase tracking-widest text-[#A1A1AA]">Particulars</span>
                      <span className="w-24 text-[10px] font-bold uppercase tracking-widest text-[#A1A1AA] flex-shrink-0">Due</span>
                      <span className="w-28 text-[10px] font-bold uppercase tracking-widest text-[#A1A1AA] text-right flex-shrink-0">Amount</span>
                      <span className="w-24 text-[10px] font-bold uppercase tracking-widest text-[#A1A1AA] text-right flex-shrink-0">Actions</span>
                    </div>

                    {shown.map(f => {
                      const open = f.status !== 'paid' && f.status !== 'cancelled'
                      return (
                        <div key={`${f.source}-${f.id}`} className="flex items-stretch border-b border-[#F4F4F5] last:border-b-0 hover:bg-[#FAFAFA] transition-colors">
                          {/* Status colour bar */}
                          <div className={`w-1 flex-shrink-0 ${STATUS_BAR[f.status]}`} />

                          {/* Student */}
                          <div className="flex items-center gap-2.5 flex-1 px-3 py-2.5 min-w-0">
                            <Avatar avatarUrl={f.student?.avatar_url} name={f.student?.full_name ?? '?'} size={30} userId={f.student_id} />
                            <div className="min-w-0">
                              <p className="text-sm font-semibold text-[#18181B] truncate">{f.student?.full_name ?? 'Unknown'}</p>
                              <p className="text-[10px] text-[#C4C4C8] truncate sm:hidden">{f.description || f.headName || 'School fee'}</p>
                            </div>
                          </div>

                          {/* Particulars */}
                          <div className="hidden sm:flex flex-col justify-center flex-1 px-2 min-w-0">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <p className="text-sm text-[#27272A] truncate">{f.description || f.headName || 'School fee'}</p>
                              {f.source === 'bus' && (
                                <span className="inline-flex items-center gap-0.5 text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-[#F4F2EC] text-[#8B6F47] border border-[#E7E2D8] flex-shrink-0">
                                  <Bus size={9} /> Bus
                                </span>
                              )}
                            </div>
                            <p className="text-[10px] text-[#C4C4C8] truncate">Ref: {f.reference}</p>
                          </div>

                          {/* Due */}
                          <div className="hidden sm:flex items-center w-24 px-2 text-xs text-[#71717A] flex-shrink-0">
                            {f.due_date || '—'}
                          </div>

                          {/* Amount + status */}
                          <div className="flex flex-col items-end justify-center w-24 sm:w-28 px-2 flex-shrink-0">
                            <p className="text-sm font-bold text-[#18181B] tabular-nums">{formatINR(f.amount)}</p>
                            <FeeStatusBadge status={f.status} />
                          </div>

                          {/* Actions */}
                          <div className="flex items-center justify-end gap-1 w-16 sm:w-24 pr-2 flex-shrink-0">
                            {f.source === 'bus' ? (
                              <button onClick={() => router.push('/more/bus')} title="Manage in Bus Manager"
                                className="p-2 text-[#A1A1AA] hover:text-[#27272A] hover:bg-[#F4F4F5] rounded-lg transition-colors">
                                <ExternalLink size={15} />
                              </button>
                            ) : open && f.school ? (
                              <>
                                <button onClick={() => setRecordingFee(f.school!)} disabled={busyId === f.id} title="Record payment"
                                  className="p-2 bg-[#27272A] hover:bg-[#18181B] text-white rounded-lg transition-colors disabled:opacity-50">
                                  <Check size={15} />
                                </button>
                                <button onClick={() => act(f.id, 'cancel')} disabled={busyId === f.id} title="Cancel fee"
                                  className="p-2 text-[#A1A1AA] hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors disabled:opacity-50">
                                  <Ban size={15} />
                                </button>
                              </>
                            ) : null}
                          </div>
                        </div>
                      )
                    })}
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
          ) : section === 'heads' ? (
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
              ) : heads.length === 0 && busHeads.length === 0 ? (
                <div className={`${ADMIN.card} shadow-sm p-8 text-center`}>
                  <div className="w-16 h-16 mx-auto mb-4 rounded-xl bg-[#27272A] flex items-center justify-center">
                    <Tag size={28} className="text-[#B8983C]" strokeWidth={1.6} />
                  </div>
                  <p className="text-sm text-[#71717A] mb-4 max-w-sm mx-auto">No fee heads yet. Create a reusable fee type to issue from.</p>
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

                  {/* Inactive fee heads — collapsed, reachable only via search */}
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

              {/* Bus fee heads — read-only mirror from the Bus module */}
              {busHeads.length > 0 && (
                <div className="mt-6 pt-5 border-t border-[#E7E2D8]">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <Bus size={14} className="text-[#8B6F47]" />
                      <h3 className={ADMIN.label}>Bus fee heads · {busHeads.length}</h3>
                    </div>
                    <button onClick={() => router.push('/more/bus')} className={ADMIN.ghostBtn}>
                      <ExternalLink size={13} /> Bus Manager
                    </button>
                  </div>
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-2.5">
                    {busHeads.map(h => (
                      <div key={h.id} className={`${ADMIN.card} flex items-center gap-3 p-3.5`}>
                        <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 bg-[#F4F2EC] border border-[#E7E2D8]">
                          <Bus size={17} className="text-[#8B6F47]" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="font-semibold text-[#18181B] truncate">{h.name}</p>
                            {!h.active && <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#F4F4F5] text-[#A1A1AA] font-semibold uppercase tracking-wide flex-shrink-0">Inactive</span>}
                          </div>
                          <p className="text-xs text-[#71717A] truncate">
                            <span className="font-bold text-[#27272A] tabular-nums">{formatINR(h.default_amount)}</span>{h.description ? ` · ${h.description}` : ''}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : section === 'collection' ? (
            <CollectionReportSection year={year} />
          ) : (
            <ReportsSection year={year} fees={fees} homerooms={homerooms} focusNonce={defaultersFocus} />
          )}
        </div>
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
        {recordingFee && (
          <RecordPaymentModal
            fee={recordingFee}
            onClose={() => setRecordingFee(null)}
            onRecorded={() => { setRecordingFee(null); load() }}
          />
        )}
      </AnimatePresence>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────
// Student view
// ──────────────────────────────────────────────────────────────

function StudentFeeView({ onBack }: { onBack: () => void }) {
  const { user } = useAuth()
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [fees, setFees] = useState<SchoolFee[]>([])
  const [payingFee, setPayingFee] = useState<SchoolFee | null>(null)
  const year = currentAcademicYear()

  const load = useCallback(async () => {
    if (!user) return
    setLoading(true)
    const f = await fetchFeesForStudent(user.id, year)
    setFees(f)
    setLoading(false)
  }, [user, year])

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
        actions={
          <button
            onClick={() => router.push('/more/fees/downloads')}
            className="inline-flex items-center gap-2 rounded-xl bg-white/20 border border-white/30 backdrop-blur-sm px-3 py-2.5 text-xs font-semibold text-white hover:bg-white/30 transition-colors"
          >
            <Download size={14} /> Download Center
          </button>
        }
      />

      <div className="relative z-0 max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 -mt-8 pb-10">

        {/* Outstanding summary */}
        {!loading && fees.length > 0 && (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 mb-4 flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl page-icon-bg flex items-center justify-center flex-shrink-0 shadow-sm">
              <Receipt size={22} className="text-white" />
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Total outstanding · {year}</p>
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
