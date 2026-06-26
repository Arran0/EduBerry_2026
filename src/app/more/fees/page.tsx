'use client'

import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { AnimatePresence } from 'framer-motion'
import {
  CreditCard, Plus, Tag, Pencil, Receipt, ListChecks,
  Check, Ban, QrCode, X, ChevronRight, Search, Archive, Wallet, Download, Bus, ExternalLink,
  RotateCcw, Trash2,
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
const StudentStatementsModal = dynamic(() => import('@/components/fees/StudentStatementsModal'))
import { useAuth } from '@/contexts/AuthContext'
import { isAdminRole, UserProfile } from '@/lib/supabase'
import { FEES_BANNER_DEFAULT } from '@/lib/pageConfig'
import { Homeroom, fetchAllHomerooms } from '@/lib/homerooms'
import {
  FeeHead, SchoolFee, StudentPayment, PendingPayment, CollectionRow, FeeStatus,
  fetchFeeHeads, fetchAllFees, summarizeFees, setFeeHeadActive, fetchFeesForStudent, fetchPaymentsForStudent,
  setFeeStatus, cancelFee, uncancelFee, deleteFeeHead, fetchPendingPayments, verifyPayment, rejectPayment,
  listAcademicYears, currentAcademicYear, summarizeDashboard, fetchCollectionReport, academicYearOf,
} from '@/lib/fees'
import {
  BusFee, BusFeeHead, BusCollectionRow,
  fetchAllFees as fetchAllBusFees, fetchBusFeeHeads, fetchBusCollectionReport,
  setBusFeeHeadActive, deleteBusFeeHead,
  fetchFeesForPassenger, fetchVerifiedPaymentsForPassenger, PassengerPayment,
} from '@/lib/bus'
const PayBusFeeModal = dynamic(() => import('@/components/bus/PayFeeModal'))

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

type SectionKey = 'issued' | 'heads' | 'collection'

const SECTIONS: { key: SectionKey; label: string; icon: React.ReactNode }[] = [
  { key: 'collection', label: 'Collection', icon: <Wallet size={15} /> },
  { key: 'issued', label: 'Issued Fees', icon: <ListChecks size={15} /> },
  { key: 'heads', label: 'Fee Heads', icon: <Tag size={15} /> },
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
  /** Verified amount collected so far (drives the partial paid/outstanding split). */
  paid: number
  /** The underlying school fee — present (and actionable) only for school rows. */
  school?: SchoolFee
}

function schoolToRow(f: SchoolFee, paid: number): IssuedRow {
  const amount = Number(f.amount) || 0
  return {
    id: f.id, source: 'school', student: f.student, student_id: f.student_id,
    amount, description: f.description,
    headId: f.fee_head_id ?? f.fee_head?.id ?? null, headName: f.fee_head?.name ?? null,
    due_date: f.due_date, status: f.status, reference: f.upi_reference,
    academic_year: f.academic_year,
    paid: f.status === 'paid' ? amount : paid,
    school: f,
  }
}

function busToRow(f: BusFee, paid: number): IssuedRow {
  const amount = Number(f.amount) || 0
  return {
    id: f.id, source: 'bus', student: f.passenger, student_id: f.passenger_id,
    amount, description: f.description,
    headId: f.fee_head_id ?? f.fee_head?.id ?? null,
    headName: f.fee_head?.name ?? f.trip?.name ?? null,
    due_date: f.due_date, status: f.status as FeeStatus, reference: f.upi_reference,
    // Bus fees carry no academic_year column — derive it for year scoping.
    academic_year: academicYearOf(f.due_date || f.created_at),
    paid,
  }
}

function matchRowFilter(f: IssuedRow, key: IssuedFilter): boolean {
  switch (key) {
    case 'all': return true
    // Partial fees have money collected on them, so they belong in Collected too
    // (they also stay under Outstanding for the remaining balance).
    case 'collected': return f.status === 'paid' || f.status === 'partial'
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

// Billed / collected / outstanding figures for a fee head — collected in green,
// outstanding in red, per the Fee Heads breakdown request.
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

// Active/inactive toggle switch shared by school and bus fee-head rows.
function HeadToggle({ checked, onChange, title }: { checked: boolean; onChange: () => void; title?: string }) {
  return (
    <label className="relative inline-flex items-center cursor-pointer" title={title ?? (checked ? 'Active' : 'Inactive')}>
      <input type="checkbox" checked={checked} onChange={onChange} className="sr-only peer" />
      <div className="w-9 h-5 bg-[#D4D4D8] rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all after:shadow peer-checked:bg-[#27272A]" />
    </label>
  )
}

interface HeadRowProps {
  name: string
  defaultAmount: number
  icon: React.ReactNode
  barClass: string
  iconWrapClass: string
  /** Billed/collected breakdown — omitted on the inactive list to keep it light. */
  stats?: { billed: number; collected: number }
  /** Active state; `null` hides the toggle. */
  active: boolean | null
  onToggle?: () => void
  onOpen: () => void
  onEdit?: () => void
  /** Bus rows link out to the Bus Manager instead of an inline edit modal. */
  onExternal?: () => void
  /** Present ⇒ the head can be deleted (no payment interaction). */
  onDelete?: () => void
  busy?: boolean
  inactiveLook?: boolean
}

/** One fee-head row: a clean desktop ledger line plus a dedicated stacked card
 *  below `sm` so the breakdown, toggle and actions never cram on a phone. */
function FeeHeadRow({
  name, defaultAmount, icon, barClass, iconWrapClass, stats, active,
  onToggle, onOpen, onEdit, onExternal, onDelete, busy, inactiveLook,
}: HeadRowProps) {
  const editBtn = onExternal ? (
    <button onClick={onExternal} title="Manage in Bus Manager"
      className="p-1.5 text-[#A1A1AA] hover:text-[#27272A] hover:bg-[#F4F4F5] rounded-lg transition-colors">
      <ExternalLink size={13} />
    </button>
  ) : onEdit ? (
    <button onClick={onEdit} title="Edit"
      className="p-1.5 text-[#A1A1AA] hover:text-[#27272A] hover:bg-[#F4F4F5] rounded-lg transition-colors">
      <Pencil size={13} />
    </button>
  ) : null
  const deleteBtn = onDelete ? (
    <button onClick={onDelete} disabled={busy} title="Delete fee head"
      className="p-1.5 text-[#A1A1AA] hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors disabled:opacity-50">
      <Trash2 size={13} />
    </button>
  ) : null
  const nameCls = inactiveLook ? 'text-[#52525B]' : 'text-[#18181B]'

  return (
    <div className="border-b border-[#F4F4F5] last:border-b-0 hover:bg-[#FAFAFA] transition-colors">
      {/* ── Desktop row ── */}
      <div className="hidden sm:flex items-stretch">
        <div className={`w-1 flex-shrink-0 ${barClass}`} />
        <button onClick={onOpen} className="group/hd flex items-center gap-2.5 w-60 px-3 py-2.5 min-w-0 text-left flex-shrink-0">
          <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${iconWrapClass}`}>{icon}</div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 min-w-0">
              <p className={`text-sm font-semibold truncate group-hover/hd:underline underline-offset-2 ${nameCls}`}>{name}</p>
              {active === false && (
                <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[#F4F4F5] text-[#A1A1AA] font-semibold uppercase tracking-wide flex-shrink-0">Inactive</span>
              )}
            </div>
            <p className="text-[10px] text-[#A1A1AA] tabular-nums">Default {formatINR(defaultAmount)}</p>
          </div>
        </button>
        <button onClick={onOpen} className="flex items-center flex-1 px-3 min-w-0">
          {stats ? <HeadStatRow billed={stats.billed} collected={stats.collected} /> : <span className="text-xs text-[#A1A1AA]">—</span>}
        </button>
        <div className="flex items-center justify-center w-14 px-1 flex-shrink-0">
          {active !== null && onToggle ? <HeadToggle checked={active} onChange={onToggle} /> : <span className="text-[10px] text-[#C4C4C8]">—</span>}
        </div>
        <div className="flex items-center justify-end gap-0.5 w-20 pr-2 flex-shrink-0">
          {editBtn}{deleteBtn}
        </div>
      </div>

      {/* ── Mobile card ── */}
      <div className="sm:hidden flex items-stretch">
        <div className={`w-1 flex-shrink-0 ${barClass}`} />
        <div className="flex-1 min-w-0 px-3 py-2.5">
          <button onClick={onOpen} className="group/hd flex items-center gap-2.5 w-full text-left min-w-0">
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${iconWrapClass}`}>{icon}</div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 min-w-0">
                <p className={`text-sm font-semibold truncate ${nameCls}`}>{name}</p>
                {active === false && (
                  <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[#F4F4F5] text-[#A1A1AA] font-semibold uppercase tracking-wide flex-shrink-0">Inactive</span>
                )}
              </div>
              <p className="text-[10px] text-[#A1A1AA] tabular-nums">Default {formatINR(defaultAmount)}</p>
            </div>
            <ChevronRight size={14} className="text-[#D4D4D8] flex-shrink-0" />
          </button>
          {stats && <div className="mt-1.5 ml-[42px]"><HeadStatRow billed={stats.billed} collected={stats.collected} /></div>}
          <div className="mt-2 ml-[42px] flex items-center justify-between gap-2">
            {active !== null && onToggle ? (
              <label className="flex items-center gap-2 cursor-pointer">
                <HeadToggle checked={active} onChange={onToggle} />
                <span className="text-[11px] text-[#71717A]">{active ? 'Active' : 'Inactive'}</span>
              </label>
            ) : <span />}
            <div className="flex items-center gap-1 flex-shrink-0">{editBtn}{deleteBtn}</div>
          </div>
        </div>
      </div>
    </div>
  )
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
  const [busPayments, setBusPayments] = useState<BusCollectionRow[]>([])
  // Academic-year scoping — every fetch/summary below is for the selected year.
  const [year, setYear] = useState<string>(currentAcademicYear())
  const [years, setYears] = useState<string[]>([currentAcademicYear()])

  // Fee currently being settled at the office (cash/cheque/card/bank/UPI).
  const [recordingFee, setRecordingFee] = useState<SchoolFee | null>(null)

  // Collection is the default landing section.
  const [section, setSection] = useState<SectionKey>('collection')
  // Student whose statements popup is open in the Issued Fees view.
  const [studentPopup, setStudentPopup] = useState<UserProfile | null>(null)
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
    const [h, hr, f, p, pay, bf, bh, bpay] = await Promise.all([
      fetchFeeHeads(), fetchAllHomerooms(), fetchAllFees(year), fetchPendingPayments(),
      fetchCollectionReport({ year }), fetchAllBusFees(), fetchBusFeeHeads(),
      fetchBusCollectionReport(),
    ])
    setHeads(h); setHomerooms(hr); setFees(f); setPending(p); setPayments(pay)
    setBusFees(bf); setBusHeads(bh); setBusPayments(bpay)
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

  const act = async (feeId: string, action: 'paid' | 'cancel' | 'uncancel') => {
    setBusyId(feeId)
    const result =
      action === 'paid' ? await setFeeStatus(feeId, 'paid')
      : action === 'cancel' ? await cancelFee(feeId)
      : await uncancelFee(feeId)
    if (result.success) {
      // Uncancel recomputes status from payments server-side; reload to reflect it.
      if (action === 'uncancel') { setBusyId(null); load(); return }
      setFees(prev => prev.map(f => f.id === feeId ? { ...f, status: action === 'paid' ? 'paid' : 'cancelled' } : f))
    }
    setBusyId(null)
  }

  // Active toggle for a bus fee head (mirrors school heads, but writes bus tables).
  const toggleBusHeadActive = async (head: BusFeeHead) => {
    setBusHeads(prev => prev.map(h => h.id === head.id ? { ...h, active: !h.active } : h))
    await setBusFeeHeadActive(head.id, !head.active)
  }

  const removeHead = async (head: FeeHead) => {
    if (!window.confirm(`Delete fee head “${head.name}”? This can't be undone.`)) return
    setBusyId(head.id)
    const result = await deleteFeeHead(head.id)
    setBusyId(null)
    if (result.success) { setHeads(prev => prev.filter(h => h.id !== head.id)); load() }
    else window.alert(result.error ?? 'Could not delete fee head')
  }

  const removeBusHead = async (head: BusFeeHead) => {
    if (!window.confirm(`Delete bus fee head “${head.name}”? This can't be undone.`)) return
    setBusyId(head.id)
    const result = await deleteBusFeeHead(head.id)
    setBusyId(null)
    if (result.success) { setBusHeads(prev => prev.filter(h => h.id !== head.id)); load() }
    else window.alert(result.error ?? 'Could not delete bus fee head')
  }

  // Action buttons for an issued-fee row (shared by the mobile card and the
  // desktop ledger row): record / cancel for open fees, restore for cancelled.
  const renderActions = (f: IssuedRow) => {
    const open = f.status !== 'paid' && f.status !== 'cancelled'
    if (f.source === 'bus') return (
      <button onClick={() => router.push('/more/bus')} title="Manage in Bus Manager"
        className="p-2 text-[#A1A1AA] hover:text-[#27272A] hover:bg-[#F4F4F5] rounded-lg transition-colors">
        <ExternalLink size={15} />
      </button>
    )
    if (open && f.school) return (
      <>
        <button onClick={() => setRecordingFee(f.school!)} disabled={busyId === f.id} title="Record payment"
          className="flex items-center gap-1.5 px-2.5 py-1.5 bg-[#27272A] hover:bg-[#18181B] text-white text-xs font-semibold rounded-lg transition-colors disabled:opacity-50">
          <Check size={14} /> <span className="hidden sm:inline">Record</span>
        </button>
        <button onClick={() => act(f.id, 'cancel')} disabled={busyId === f.id} title="Cancel fee"
          className="p-2 text-[#A1A1AA] hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors disabled:opacity-50">
          <Ban size={15} />
        </button>
      </>
    )
    if (f.status === 'cancelled' && f.school) return (
      <button onClick={() => act(f.id, 'uncancel')} disabled={busyId === f.id} title="Restore fee (uncancel)"
        className="p-2 text-[#A1A1AA] hover:text-[#16A34A] hover:bg-emerald-50 rounded-lg transition-colors disabled:opacity-50">
        <RotateCcw size={15} />
      </button>
    )
    return null
  }

  // Verified amount collected per school fee (from the year's verified payments).
  const paidByFee = useMemo(() => {
    const m = new Map<string, number>()
    for (const p of payments) {
      const id = p.fee?.id
      if (!id) continue
      m.set(id, (m.get(id) ?? 0) + (Number(p.amount) || 0))
    }
    return m
  }, [payments])

  // Pass paidByFee so partially-collected fees show their received portion under
  // Collected (and only the balance under Outstanding).
  const summary = useMemo(() => summarizeFees(fees, paidByFee), [fees, paidByFee])
  const dashboard = useMemo(() => summarizeDashboard(fees, payments), [fees, payments])

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

  // Verified amount collected per bus fee id — mirrors paidByFee for school fees.
  const busPaidByFee = useMemo(() => {
    const m = new Map<string, number>()
    for (const p of busPayments) {
      const id = p.fee?.id
      if (!id) continue
      m.set(id, (m.get(id) ?? 0) + (Number(p.amount) || 0))
    }
    return m
  }, [busPayments])

  const busHeadStats = useMemo(() => {
    const m = new Map<string, { billed: number; collected: number }>()
    for (const f of busFees) {
      if (f.status === 'cancelled') continue
      const id = f.fee_head_id ?? f.fee_head?.id
      if (!id) continue
      const cur = m.get(id) ?? { billed: 0, collected: 0 }
      const amt = Number(f.amount) || 0
      cur.billed += amt
      cur.collected += f.status === 'paid' ? amt : (busPaidByFee.get(f.id) ?? 0)
      m.set(id, cur)
    }
    return m
  }, [busFees, busPaidByFee])

  // Merge school + bus fee lines (bus scoped to the selected year via its
  // derived academic year) into one issued list.
  const rows = useMemo<IssuedRow[]>(() => {
    const busRows = busFees
      .map(f => busToRow(f, f.status === 'paid' ? (Number(f.amount) || 0) : (busPaidByFee.get(f.id) ?? 0)))
      .filter(r => r.academic_year === year)
    return [...fees.map(f => schoolToRow(f, paidByFee.get(f.id) ?? 0)), ...busRows]
  }, [fees, busFees, year, paidByFee, busPaidByFee])

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
              onOpenDefaulters={() => { setSection('issued'); setStatusFilter('outstanding') }}
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

              {/* Wide status nav */}
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

                  {/* Excel-style ledger: bordered container, dark header, thin rows.
                      A dedicated stacked card layout takes over below `sm` so the
                      columns never cram together on a phone. */}
                  <div className="border border-[#E4E4E7] rounded-xl overflow-hidden bg-white">
                    {/* Column headers (desktop only) */}
                    <div className="bg-[#27272A] pl-1 pr-3 py-2.5 hidden sm:flex items-center gap-3">
                      <span className="w-9 flex-shrink-0" />
                      <span className="flex-1 text-[10px] font-bold uppercase tracking-widest text-[#A1A1AA]">Student</span>
                      <span className="flex-1 text-[10px] font-bold uppercase tracking-widest text-[#A1A1AA]">Particulars</span>
                      <span className="w-24 text-[10px] font-bold uppercase tracking-widest text-[#A1A1AA] flex-shrink-0">Due</span>
                      <span className="w-36 text-[10px] font-bold uppercase tracking-widest text-[#A1A1AA] text-right flex-shrink-0">Amount</span>
                      <span className="w-32 text-[10px] font-bold uppercase tracking-widest text-[#A1A1AA] text-right flex-shrink-0">Actions</span>
                    </div>

                    {shown.map(f => {
                      // Paid/outstanding split only for school rows — bus payments
                      // aren't in the collection map, so their `paid` is unknown.
                      const partial = f.status === 'partial'
                      const due = Math.max(0, f.amount - f.paid)
                      return (
                        <div key={`${f.source}-${f.id}`} className="border-b border-[#F4F4F5] last:border-b-0 hover:bg-[#FAFAFA] transition-colors">
                          {/* ── Desktop ledger row ── */}
                          <div className="hidden sm:flex items-stretch">
                            <div className={`w-1 flex-shrink-0 ${STATUS_BAR[f.status]}`} />
                            <button
                              onClick={() => f.student && setStudentPopup(f.student)}
                              disabled={!f.student}
                              className="group/st flex items-center gap-2.5 flex-1 px-3 py-2.5 min-w-0 text-left"
                            >
                              <Avatar avatarUrl={f.student?.avatar_url} name={f.student?.full_name ?? '?'} size={30} userId={f.student_id} />
                              <p className="text-sm font-semibold text-[#18181B] truncate group-hover/st:underline underline-offset-2 min-w-0">
                                {f.student?.full_name ?? 'Unknown'}
                              </p>
                            </button>
                            <div className="flex flex-col justify-center flex-1 px-2 min-w-0">
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
                            <div className="flex items-center w-24 px-2 text-xs text-[#71717A] flex-shrink-0">
                              {f.due_date || '—'}
                            </div>
                            <div className="flex flex-col items-end justify-center w-36 px-2 flex-shrink-0">
                              <p className="text-sm font-bold text-[#18181B] tabular-nums">{formatINR(f.amount)}</p>
                              {partial ? (
                                <div className="flex flex-col items-end gap-0.5 mt-0.5">
                                  <span className="text-[10px] font-semibold text-[#16A34A] tabular-nums">Paid {formatINR(f.paid)}</span>
                                  <span className="text-[10px] font-semibold text-[#DC2626] tabular-nums">Due {formatINR(due)}</span>
                                  <FeeStatusBadge status={f.status} />
                                </div>
                              ) : (
                                <FeeStatusBadge status={f.status} />
                              )}
                            </div>
                            <div className="flex items-center justify-end gap-1 w-32 pr-2 flex-shrink-0">
                              {renderActions(f)}
                            </div>
                          </div>

                          {/* ── Mobile stacked card ── */}
                          <div className="sm:hidden flex items-stretch">
                            <div className={`w-1 flex-shrink-0 ${STATUS_BAR[f.status]}`} />
                            <div className="flex-1 min-w-0 px-3 py-2.5">
                              <div className="flex items-start gap-2.5">
                                <button
                                  onClick={() => f.student && setStudentPopup(f.student)}
                                  disabled={!f.student}
                                  className="group/st flex items-center gap-2.5 flex-1 min-w-0 text-left"
                                >
                                  <Avatar avatarUrl={f.student?.avatar_url} name={f.student?.full_name ?? '?'} size={32} userId={f.student_id} />
                                  <div className="min-w-0">
                                    <p className="text-sm font-semibold text-[#18181B] truncate group-hover/st:underline underline-offset-2">
                                      {f.student?.full_name ?? 'Unknown'}
                                    </p>
                                    <div className="flex items-center gap-1.5 min-w-0">
                                      <p className="text-[11px] text-[#A1A1AA] truncate">{f.description || f.headName || 'School fee'}</p>
                                      {f.source === 'bus' && (
                                        <span className="inline-flex items-center gap-0.5 text-[8px] font-bold uppercase tracking-wide px-1 py-0.5 rounded bg-[#F4F2EC] text-[#8B6F47] border border-[#E7E2D8] flex-shrink-0">
                                          <Bus size={8} /> Bus
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                </button>
                                <div className="text-right flex-shrink-0">
                                  <p className="text-sm font-bold text-[#18181B] tabular-nums leading-tight">{formatINR(f.amount)}</p>
                                  <div className="mt-0.5"><FeeStatusBadge status={f.status} /></div>
                                </div>
                              </div>

                              {partial && (
                                <div className="mt-1.5 ml-[42px] flex items-center gap-3 text-[11px]">
                                  <span className="font-semibold text-[#16A34A] tabular-nums">Paid {formatINR(f.paid)}</span>
                                  <span className="font-semibold text-[#DC2626] tabular-nums">Due {formatINR(due)}</span>
                                </div>
                              )}

                              <div className="mt-2 ml-[42px] flex items-center justify-between gap-2">
                                <span className="text-[10px] text-[#C4C4C8] truncate min-w-0">
                                  {f.due_date ? `Due ${f.due_date} · ` : ''}Ref: {f.reference}
                                </span>
                                <div className="flex items-center gap-1 flex-shrink-0">
                                  {renderActions(f)}
                                </div>
                              </div>
                            </div>
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
                  {/* Excel-style fee head table */}
                  <div className="border border-[#E4E4E7] rounded-xl overflow-hidden bg-white">
                    {/* Column headers (desktop only) */}
                    <div className="bg-[#27272A] py-2.5 hidden sm:flex items-center">
                      <span className="w-1 flex-shrink-0" />
                      <span className="w-60 px-3 text-[10px] font-bold uppercase tracking-widest text-[#A1A1AA] flex-shrink-0">Fee Head</span>
                      <span className="flex-1 px-3 text-[10px] font-bold uppercase tracking-widest text-[#A1A1AA]">Billed · Collected · Outstanding</span>
                      <span className="w-14 px-1 text-[10px] font-bold uppercase tracking-widest text-[#A1A1AA] text-center flex-shrink-0">Active</span>
                      <span className="w-20 pr-2 text-[10px] font-bold uppercase tracking-widest text-[#A1A1AA] text-right flex-shrink-0">Actions</span>
                    </div>

                    {/* Active school fee head rows */}
                    {activeHeads.map(head => {
                      const st = headStats.get(head.id) ?? { billed: 0, collected: 0 }
                      return (
                        <FeeHeadRow key={head.id}
                          name={head.name} defaultAmount={head.default_amount}
                          icon={<Tag size={13} className="text-[#B8983C]" />}
                          barClass="bg-[#27272A]" iconWrapClass="bg-[#27272A]"
                          stats={st} active={head.active}
                          onToggle={() => toggleHeadActive(head)}
                          onOpen={() => openHeadInIssued(head)}
                          onEdit={() => setEditHead(head)}
                          onDelete={st.collected === 0 ? () => removeHead(head) : undefined}
                          busy={busyId === head.id}
                        />
                      )
                    })}

                    {activeHeads.length === 0 && (
                      <div className="pl-2 pr-3 py-5 text-center text-sm text-[#71717A]">
                        No active fee heads. {inactiveHeads.length > 0 && 'Search below to reactivate.'}
                      </div>
                    )}

                    {/* Bus fee heads — now with active toggle + delete in the same table */}
                    {busHeads.length > 0 && (
                      <>
                        <div className="pl-1 pr-3 py-1.5 bg-[#F4F2EC] flex items-center gap-2 border-t border-[#E7E2D8] border-b border-[#E7E2D8]">
                          <span className="w-1 flex-shrink-0" />
                          <Bus size={12} className="text-[#8B6F47] ml-2" />
                          <span className="flex-1 text-[10px] font-bold uppercase tracking-widest text-[#8B6F47]">Bus Fee Heads</span>
                          <button onClick={() => router.push('/more/bus')} className={ADMIN.ghostBtn}>
                            <ExternalLink size={11} /> Bus Manager
                          </button>
                        </div>
                        {busHeads.map(h => {
                          const st = busHeadStats.get(h.id) ?? { billed: 0, collected: 0 }
                          return (
                            <FeeHeadRow key={h.id}
                              name={h.name} defaultAmount={h.default_amount}
                              icon={<Bus size={13} className="text-[#8B6F47]" />}
                              barClass="bg-[#E7E2D8]" iconWrapClass="bg-[#F4F2EC] border border-[#E7E2D8]"
                              stats={st} active={h.active}
                              onToggle={() => toggleBusHeadActive(h)}
                              onOpen={() => { setHeadFilter(h.id); setStatusFilter('all'); setSection('issued') }}
                              onExternal={() => router.push('/more/bus')}
                              onDelete={st.collected === 0 ? () => removeBusHead(h) : undefined}
                              busy={busyId === h.id}
                            />
                          )
                        })}
                      </>
                    )}
                  </div>

                  {/* Inactive fee heads — collapsed behind search */}
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
                        <p className="text-xs text-[#A1A1AA] px-1">No inactive fee head matches "{inactiveQuery}".</p>
                      ) : (
                        <div className="border border-[#E4E4E7] rounded-xl overflow-hidden bg-white">
                          {matchingInactive.map(head => {
                            const st = headStats.get(head.id) ?? { billed: 0, collected: 0 }
                            return (
                              <FeeHeadRow key={head.id}
                                name={head.name} defaultAmount={head.default_amount}
                                icon={<Tag size={13} className="text-[#A1A1AA]" />}
                                barClass="bg-[#E4E4E7]" iconWrapClass="bg-[#F4F4F5] border border-[#E4E4E7]"
                                stats={st} active={head.active} inactiveLook
                                onToggle={() => toggleHeadActive(head)}
                                onOpen={() => openHeadInIssued(head)}
                                onEdit={() => setEditHead(head)}
                                onDelete={st.collected === 0 ? () => removeHead(head) : undefined}
                                busy={busyId === head.id}
                              />
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
            </>
          ) : (
            <CollectionReportSection year={year} onStudentClick={setStudentPopup} />
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
            paid={paidByFee.get(recordingFee.id) ?? 0}
            onClose={() => setRecordingFee(null)}
            onRecorded={() => { setRecordingFee(null); load() }}
          />
        )}
        {studentPopup && (
          <StudentStatementsModal
            student={studentPopup}
            year={year}
            onClose={() => setStudentPopup(null)}
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
  const { user, profile } = useAuth()
  const [loading, setLoading] = useState(true)
  const [fees, setFees] = useState<SchoolFee[]>([])
  const [payments, setPayments] = useState<StudentPayment[]>([])
  const [busFees, setBusFees] = useState<BusFee[]>([])
  const [busPayments, setBusPayments] = useState<PassengerPayment[]>([])
  const [payingFee, setPayingFee] = useState<SchoolFee | null>(null)
  const [payingBusFee, setPayingBusFee] = useState<BusFee | null>(null)
  const [showStatements, setShowStatements] = useState(false)
  const year = currentAcademicYear()

  const load = useCallback(async () => {
    if (!user) return
    setLoading(true)
    const [f, p, bf, bp] = await Promise.all([
      fetchFeesForStudent(user.id, year),
      fetchPaymentsForStudent(user.id, year),
      fetchFeesForPassenger(user.id),
      fetchVerifiedPaymentsForPassenger(user.id),
    ])
    setFees(f); setPayments(p); setBusFees(bf); setBusPayments(bp)
    setLoading(false)
  }, [user, year])

  useEffect(() => { load() }, [load])

  // Verified amount paid per school fee → drives remaining balance for partial fees.
  const paidByFee = useMemo(() => {
    const m = new Map<string, number>()
    for (const p of payments) {
      const id = p.fee?.id
      if (id) m.set(id, (m.get(id) ?? 0) + (Number(p.amount) || 0))
    }
    return m
  }, [payments])

  // Verified amount paid per bus fee → drives remaining balance for partial bus fees.
  const busPaidByFee = useMemo(() => {
    const m = new Map<string, number>()
    for (const p of busPayments) {
      const id = p.fee?.id
      if (id) m.set(id, (m.get(id) ?? 0) + (Number(p.amount) || 0))
    }
    return m
  }, [busPayments])

  // What's still due on a school fee.
  const remainingOf = useCallback((f: SchoolFee) => {
    const amt = Number(f.amount) || 0
    if (f.status === 'paid' || f.status === 'cancelled') return 0
    return Math.max(0, amt - (paidByFee.get(f.id) ?? 0))
  }, [paidByFee])

  // What's still due on a bus fee.
  const remainingOfBus = useCallback((f: BusFee) => {
    const amt = Number(f.amount) || 0
    if (f.status === 'paid' || f.status === 'cancelled') return 0
    return Math.max(0, amt - (busPaidByFee.get(f.id) ?? 0))
  }, [busPaidByFee])

  const payable = fees.filter(f => f.status === 'unpaid' || f.status === 'partial')
  const history = fees.filter(f => f.status === 'paid' || f.status === 'cancelled')
  const busPayable = busFees.filter(f => f.status === 'unpaid' || f.status === 'partial')
  const busHistory = busFees.filter(f => f.status === 'paid' || f.status === 'cancelled')

  const outstanding = payable.reduce((s, f) => s + remainingOf(f), 0)
    + busPayable.reduce((s, f) => s + remainingOfBus(f), 0)
  const totalPending = payable.length + busPayable.length
  const hasAnyFee = fees.length > 0 || busFees.length > 0
  const todayStr = new Date().toISOString().slice(0, 10)

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
            onClick={() => setShowStatements(true)}
            className="inline-flex items-center gap-2 rounded-xl bg-white/20 border border-white/30 backdrop-blur-sm px-3 py-2.5 text-xs font-semibold text-white hover:bg-white/30 transition-colors"
          >
            <Download size={14} /> Download Center
          </button>
        }
      />

      <div className="relative z-0 max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 -mt-8 pb-10">

        {/* Outstanding hero — single quiet statement header instead of a card stack */}
        {!loading && hasAnyFee && (
          <div className="page-icon-bg rounded-3xl shadow-sm p-6 mb-6 text-white relative overflow-hidden">
            <div className="absolute -right-6 -bottom-8 opacity-10">
              <Wallet size={140} />
            </div>
            <div className="relative">
              <p className="text-[11px] font-semibold uppercase tracking-widest text-white/70">Total outstanding · {year}</p>
              <p className="text-4xl font-bold tabular-nums mt-1">{formatINR(outstanding)}</p>
              <div className="flex items-center gap-1.5 mt-2 text-xs text-white/80">
                {outstanding > 0 ? (
                  <>
                    <span className="inline-block w-1.5 h-1.5 rounded-full bg-white/80" />
                    {totalPending} fee{totalPending === 1 ? "" : "s"} pending
                  </>
                ) : (
                  <>
                    <Check size={14} className="text-white" /> {"You’re all paid up — nothing due."}
                  </>
                )}
              </div>
            </div>
          </div>
        )}

        {loading ? (
          <div className="text-center py-12"><div className="spinner mx-auto mb-3" /><p className="text-sm text-slate-500">Loading…</p></div>
        ) : !hasAnyFee ? (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-8 text-center">
            <div className="w-16 h-16 mx-auto mb-4 rounded-2xl page-accent-bg flex items-center justify-center">
              <Receipt size={28} className="page-accent-text" strokeWidth={1.6} />
            </div>
            <h2 className="text-lg font-semibold text-slate-800 mb-1">All clear</h2>
            <p className="text-sm text-slate-500">No fees issued to you.</p>
          </div>
        ) : (
          <div className="space-y-6">
            {/* ── To pay ── */}
            {(payable.length > 0 || busPayable.length > 0) && (
              <section>
                <h2 className="text-[11px] font-bold uppercase tracking-widest text-slate-400 mb-2 px-1">To pay</h2>
                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm divide-y divide-slate-100 overflow-hidden">
                  {payable.map(f => {
                    const amt = Number(f.amount) || 0
                    const remaining = remainingOf(f)
                    const paid = amt - remaining
                    const pct = amt > 0 ? Math.min(100, Math.round((paid / amt) * 100)) : 0
                    const overdue = !!f.due_date && f.due_date < todayStr
                    return (
                      <div key={`school-${f.id}`} className="p-4">
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="w-10 h-10 rounded-xl page-accent-bg flex items-center justify-center flex-shrink-0">
                              <Receipt size={18} className="page-accent-text" />
                            </div>
                            <div className="min-w-0">
                              <p className="text-sm font-semibold text-slate-800 truncate">
                                {f.description || f.fee_head?.name || 'School fee'}
                              </p>
                              <p className={`text-xs mt-0.5 ${overdue ? 'text-rose-500 font-medium' : 'text-slate-400'}`}>
                                {f.due_date ? `${overdue ? 'Overdue · due' : 'Due'} ${f.due_date}` : 'No due date'}
                              </p>
                            </div>
                          </div>
                          <div className="text-right flex-shrink-0">
                            <p className="text-lg font-bold text-slate-900 tabular-nums leading-tight">{formatINR(remaining)}</p>
                            <p className="text-[10px] text-slate-400">{f.status === 'partial' ? 'remaining' : 'due'}</p>
                          </div>
                        </div>

                        {f.status === 'partial' && (
                          <div className="mt-3">
                            <div className="flex items-center justify-between text-[11px] mb-1 tabular-nums">
                              <span className="font-semibold text-emerald-600">{formatINR(paid)} paid</span>
                              <span className="text-slate-400">of {formatINR(amt)}</span>
                            </div>
                            <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
                              <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />
                            </div>
                          </div>
                        )}

                        <button onClick={() => setPayingFee(f)}
                          className="page-btn-primary mt-3 w-full flex items-center justify-center gap-2 text-sm !py-2.5">
                          <CreditCard size={15} /> Pay {formatINR(remaining)}
                        </button>
                      </div>
                    )
                  })}

                  {busPayable.map(f => {
                    const amt = Number(f.amount) || 0
                    const remaining = remainingOfBus(f)
                    const paid = amt - remaining
                    const pct = amt > 0 ? Math.min(100, Math.round((paid / amt) * 100)) : 0
                    const overdue = !!f.due_date && f.due_date < todayStr
                    return (
                      <div key={`bus-${f.id}`} className="p-4">
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="w-10 h-10 rounded-xl bg-[#F4F2EC] border border-[#E7E2D8] flex items-center justify-center flex-shrink-0">
                              <Bus size={18} className="text-[#8B6F47]" />
                            </div>
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5 min-w-0">
                                <p className="text-sm font-semibold text-slate-800 truncate">
                                  {f.description || f.fee_head?.name || 'Bus fee'}
                                </p>
                                <span className="inline-flex items-center gap-0.5 text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-[#F4F2EC] text-[#8B6F47] border border-[#E7E2D8] flex-shrink-0">
                                  <Bus size={9} /> Bus
                                </span>
                              </div>
                              <p className={`text-xs mt-0.5 ${overdue ? 'text-rose-500 font-medium' : 'text-slate-400'}`}>
                                {f.due_date ? `${overdue ? 'Overdue · due' : 'Due'} ${f.due_date}` : 'No due date'}
                              </p>
                            </div>
                          </div>
                          <div className="text-right flex-shrink-0">
                            <p className="text-lg font-bold text-slate-900 tabular-nums leading-tight">{formatINR(remaining)}</p>
                            <p className="text-[10px] text-slate-400">{f.status === 'partial' ? 'remaining' : 'due'}</p>
                          </div>
                        </div>

                        {f.status === 'partial' && (
                          <div className="mt-3">
                            <div className="flex items-center justify-between text-[11px] mb-1 tabular-nums">
                              <span className="font-semibold text-emerald-600">{formatINR(paid)} paid</span>
                              <span className="text-slate-400">of {formatINR(amt)}</span>
                            </div>
                            <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
                              <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />
                            </div>
                          </div>
                        )}

                        <button onClick={() => setPayingBusFee(f)}
                          className="mt-3 w-full flex items-center justify-center gap-2 text-sm !py-2.5 bg-[#27272A] hover:bg-[#18181B] text-white font-semibold rounded-xl transition-colors">
                          <CreditCard size={15} /> Pay {formatINR(remaining)}
                        </button>
                      </div>
                    )
                  })}
                </div>
              </section>
            )}

            {/* ── History (paid / cancelled) ── */}
            {(history.length > 0 || busHistory.length > 0) && (
              <section>
                <h2 className="text-[11px] font-bold uppercase tracking-widest text-slate-400 mb-2 px-1">History</h2>
                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm divide-y divide-slate-100 overflow-hidden">
                  {history.map(f => {
                    const amt = Number(f.amount) || 0
                    const cancelled = f.status === 'cancelled'
                    return (
                      <div key={`school-${f.id}`} className="px-4 py-3 flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-9 h-9 rounded-xl bg-slate-100 flex items-center justify-center flex-shrink-0">
                            {cancelled ? <Ban size={15} className="text-slate-400" /> : <Check size={16} className="text-slate-600" />}
                          </div>
                          <div className="min-w-0">
                            <p className={`text-sm font-medium truncate ${cancelled ? 'text-slate-400 line-through' : 'text-slate-700'}`}>
                              {f.description || f.fee_head?.name || 'School fee'}
                            </p>
                            {f.due_date && <p className="text-xs text-slate-400 mt-0.5">Due {f.due_date}</p>}
                          </div>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <p className="text-sm font-semibold text-slate-700 tabular-nums">{formatINR(amt)}</p>
                          <div className="mt-0.5"><FeeStatusBadge status={f.status} /></div>
                        </div>
                      </div>
                    )
                  })}
                  {busHistory.map(f => {
                    const amt = Number(f.amount) || 0
                    const cancelled = f.status === 'cancelled'
                    return (
                      <div key={`bus-${f.id}`} className="px-4 py-3 flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-9 h-9 rounded-xl bg-[#F4F2EC] border border-[#E7E2D8] flex items-center justify-center flex-shrink-0">
                            {cancelled ? <Ban size={15} className="text-[#8B6F47]" /> : <Bus size={15} className="text-[#8B6F47]" />}
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <p className={`text-sm font-medium truncate ${cancelled ? 'text-slate-400 line-through' : 'text-slate-700'}`}>
                                {f.description || f.fee_head?.name || 'Bus fee'}
                              </p>
                              <span className="inline-flex items-center gap-0.5 text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-[#F4F2EC] text-[#8B6F47] border border-[#E7E2D8] flex-shrink-0">
                                <Bus size={9} /> Bus
                              </span>
                            </div>
                            {f.due_date && <p className="text-xs text-slate-400 mt-0.5">Due {f.due_date}</p>}
                          </div>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <p className="text-sm font-semibold text-slate-700 tabular-nums">{formatINR(amt)}</p>
                          <div className="mt-0.5"><FeeStatusBadge status={f.status as FeeStatus} /></div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </section>
            )}
          </div>
        )}
      </div>

      <AnimatePresence>
        {payingFee && (
          <PaySchoolFeeModal
            fee={payingFee}
            payable={remainingOf(payingFee)}
            onClose={() => setPayingFee(null)}
            onPaid={() => { setPayingFee(null); load() }}
          />
        )}
        {payingBusFee && (
          <PayBusFeeModal
            fee={payingBusFee}
            payable={remainingOfBus(payingBusFee)}
            onClose={() => setPayingBusFee(null)}
            onPaid={() => { setPayingBusFee(null); load() }}
          />
        )}
        {showStatements && profile && (
          <StudentStatementsModal
            student={profile}
            year={year}
            onClose={() => setShowStatements(false)}
          />
        )}
      </AnimatePresence>
    </>
  )
}
