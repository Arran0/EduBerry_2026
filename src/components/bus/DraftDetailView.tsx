'use client'

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { AnimatePresence } from 'framer-motion'
import {
  ArrowLeft, Send, RefreshCw, Users, Search, X, Pencil, Download, AlertCircle, Calendar, ChevronUp,
} from 'lucide-react'
import Avatar from '@/components/Avatar'
import MonthlyDraftModal from '@/components/bus/MonthlyDraftModal'
import { ADMIN } from '@/components/bus/adminUI'
import { formatINR } from '@/components/bus/FeeCollectionSummary'
import { UserProfile } from '@/lib/supabase'
import {
  BusTrip, BusFeeHead, BusFeeDraft, BusFeeDraftPassenger,
  fetchDraftPassengersWithAmounts,
  addDraftPassenger, removeDraftPassenger,
  updateDraftPassengerFee,
  fetchTripPassengers,
  issueDraft,
} from '@/lib/bus'

interface DraftDetailViewProps {
  draft: BusFeeDraft
  trips: BusTrip[]
  feeHeads: BusFeeHead[]
  assignable: UserProfile[]
  onBack: () => void
  onIssued: () => void
  onDraftUpdated: (updated: BusFeeDraft) => void
  /** Rendered inline inside an expanded Bulk Issue row — drops the big page
   *  header (the row already shows the title) for a compact action bar. */
  embedded?: boolean
}

function formatDraftMonth(ym: string): string {
  const [y, m] = ym.split('-')
  return new Date(Number(y), Number(m) - 1, 1)
    .toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })
}

export default function DraftDetailView({
  draft: initialDraft, trips, feeHeads, assignable, onBack, onIssued, onDraftUpdated, embedded = false,
}: DraftDetailViewProps) {
  const [draft, setDraft] = useState<BusFeeDraft>(initialDraft)
  const [passengers, setPassengers] = useState<BusFeeDraftPassenger[]>([])
  const [amounts, setAmounts] = useState<Record<string, string>>({})
  const [descs, setDescs] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [removingId, setRemovingId] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const [issuing, setIssuing] = useState(false)
  const [issueError, setIssueError] = useState<string | null>(null)
  const [showEdit, setShowEdit] = useState(false)

  const [addQuery, setAddQuery] = useState('')
  const [addOpen, setAddOpen] = useState(false)
  const addRef = useRef<HTMLDivElement>(null)

  const loadPassengers = useCallback(async () => {
    setLoading(true)
    const rows = await fetchDraftPassengersWithAmounts(draft.id)
    setPassengers(rows)
    const a: Record<string, string> = {}
    const d: Record<string, string> = {}
    rows.forEach(r => {
      a[r.passenger_id] = r.amount != null ? String(r.amount) : ''
      d[r.passenger_id] = r.description ?? ''
    })
    setAmounts(a)
    setDescs(d)
    setLoading(false)
  }, [draft.id])

  useEffect(() => { loadPassengers() }, [loadPassengers])

  // Close add-student dropdown on outside click.
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (addRef.current && !addRef.current.contains(e.target as Node)) {
        setAddOpen(false)
        setAddQuery('')
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const existingIds = useMemo(() => new Set(passengers.map(p => p.passenger_id)), [passengers])

  const addCandidates = useMemo(() => {
    const q = addQuery.trim().toLowerCase()
    return assignable
      .filter(p => !existingIds.has(p.id))
      .filter(p => !q || p.full_name.toLowerCase().includes(q) || p.email.toLowerCase().includes(q))
  }, [assignable, existingIds, addQuery])

  const handleAdd = async (p: UserProfile) => {
    setAddOpen(false); setAddQuery('')
    await addDraftPassenger(draft.id, p.id)
    setPassengers(prev => [...prev, {
      id: '', draft_id: draft.id, passenger_id: p.id,
      amount: null, description: null, created_at: '', passenger: p,
    }])
    setAmounts(prev => ({ ...prev, [p.id]: '' }))
    setDescs(prev => ({ ...prev, [p.id]: '' }))
  }

  const handleImportTrip = async () => {
    if (!draft.trip_id) return
    setImporting(true)
    const tripPax = await fetchTripPassengers(draft.trip_id)
    const toAdd = tripPax.filter(p => !existingIds.has(p.id))
    for (const p of toAdd) await addDraftPassenger(draft.id, p.id)
    setImporting(false)
    loadPassengers()
  }

  const handleRemove = async (passengerId: string) => {
    setRemovingId(passengerId)
    await removeDraftPassenger(draft.id, passengerId)
    setPassengers(prev => prev.filter(p => p.passenger_id !== passengerId))
    setRemovingId(null)
  }

  const persist = async (passengerId: string) => {
    const raw = amounts[passengerId] ?? ''
    const n = parseFloat(raw)
    const amount = raw !== '' && !isNaN(n) && n > 0 ? n : null
    const desc = descs[passengerId]?.trim() || null
    setSavingId(passengerId)
    await updateDraftPassengerFee(draft.id, passengerId, amount, desc)
    setSavingId(null)
  }

  const missingCount = passengers.filter(p => {
    const n = parseFloat(amounts[p.passenger_id] ?? '')
    return isNaN(n) || n <= 0
  }).length

  const totalAmount = passengers.reduce((sum, p) => {
    const n = parseFloat(amounts[p.passenger_id] ?? '')
    return sum + (isNaN(n) ? 0 : n)
  }, 0)

  const handleIssue = async () => {
    setIssueError(null)
    setIssuing(true)
    const result = await issueDraft(draft.id)
    setIssuing(false)
    if (result.success) {
      if (isIssued) {
        // Re-issue: stay on page, just refresh the issued_at timestamp
        const now = new Date().toISOString()
        const updated = { ...draft, status: 'issued' as const, issued_at: now }
        setDraft(updated)
        onDraftUpdated(updated)
      } else {
        onIssued()
      }
    } else {
      setIssueError(result.error ?? 'Failed to issue fees')
    }
  }

  const isIssued = draft.status === 'issued'

  const actionButtons = (
    <>
      <button onClick={() => setShowEdit(true)} className={ADMIN.ghostBtn} title="Edit details">
        <Pencil size={13} /> {embedded && <span className="hidden sm:inline">Edit</span>}
      </button>
      <button
        onClick={handleIssue}
        disabled={issuing || passengers.length === 0 || missingCount > 0}
        className={ADMIN.darkBtn}
        title={missingCount > 0 ? `${missingCount} student${missingCount === 1 ? ' has' : 's have'} no amount` : undefined}
      >
        {issuing ? null : isIssued ? <RefreshCw size={13} /> : <Send size={13} />}
        {issuing ? 'Issuing…' : isIssued ? 'Issue Again' : 'Issue All'}
      </button>
    </>
  )

  return (
    <>
      {/* ── Header ─────────────────────────────────────────── */}
      {embedded ? (
        <div className="flex items-center gap-2 mb-4 flex-wrap justify-end">
          {actionButtons}
          <button onClick={onBack} className={ADMIN.ghostBtn} title="Collapse">
            <ChevronUp size={14} /> Collapse
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-3 mb-5 flex-wrap">
          <button onClick={onBack} className={ADMIN.ghostBtn}>
            <ArrowLeft size={14} /> Back
          </button>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="font-bold text-[#18181B] text-base truncate">{draft.title}</h2>
              {isIssued ? (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-bold uppercase tracking-wide flex-shrink-0">
                  Issued
                </span>
              ) : (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#F4F4F5] text-[#71717A] font-bold uppercase tracking-wide flex-shrink-0">
                  Draft
                </span>
              )}
            </div>
            <p className="text-xs text-[#71717A] mt-0.5">
              <span className="inline-flex items-center gap-1"><Calendar size={11} /> {formatDraftMonth(draft.month)}</span>
              {draft.trip?.name && <span> · {draft.trip.name}</span>}
              {draft.due_date && <span> · Due {draft.due_date}</span>}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {actionButtons}
          </div>
        </div>
      )}

      {/* ── Stats bar ──────────────────────────────────────── */}
      {!loading && passengers.length > 0 && (
        <div className="flex items-center gap-4 mb-4 px-4 py-3 bg-white border border-[#E4E4E7] rounded-xl text-xs flex-wrap">
          <span className="flex items-center gap-1.5 text-[#71717A]">
            <Users size={13} className="text-[#B8983C]" />
            <span className="font-bold text-[#27272A]">{passengers.length}</span>
            &nbsp;student{passengers.length === 1 ? '' : 's'}
          </span>
          {missingCount > 0 ? (
            <span className="flex items-center gap-1 text-amber-600 font-medium">
              <AlertCircle size={13} />
              {missingCount} amount{missingCount === 1 ? '' : 's'} missing
            </span>
          ) : (
            <span className="text-emerald-600 font-medium">All amounts set ✓</span>
          )}
          {totalAmount > 0 && (
            <span className="ml-auto text-[#71717A]">
              Total: <span className="font-bold text-[#27272A] tabular-nums">{formatINR(totalAmount)}</span>
            </span>
          )}
          {isIssued && draft.issued_at && (
            <span className="text-[#A1A1AA]">
              Last issued: {new Date(draft.issued_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
            </span>
          )}
        </div>
      )}

      {/* ── Issue error ────────────────────────────────────── */}
      {issueError && (
        <div className="flex items-center gap-2 p-3 mb-4 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-xs">
          <AlertCircle size={14} className="flex-shrink-0" /> {issueError}
          <button onClick={() => setIssueError(null)} className="ml-auto p-0.5 hover:bg-rose-100 rounded">
            <X size={12} />
          </button>
        </div>
      )}

      {/* ── Add students toolbar ────────────────────────────── */}
      <div className="flex gap-2 mb-4">
          <div className="relative flex-1" ref={addRef}>
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#A1A1AA] pointer-events-none" />
            <input
              value={addQuery}
              onChange={e => { setAddQuery(e.target.value); setAddOpen(true) }}
              onFocus={() => setAddOpen(true)}
              placeholder="Search to add students…"
              className="w-full bg-white border border-[#E4E4E7] rounded-lg pl-9 pr-3 py-2.5 text-sm text-[#27272A] placeholder:text-[#A1A1AA] focus:outline-none focus:border-[#27272A] transition-colors"
            />
            {addOpen && (
              <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-white border border-[#E4E4E7] rounded-xl shadow-xl max-h-52 overflow-y-auto">
                {addCandidates.length === 0 ? (
                  <p className="text-sm text-[#A1A1AA] text-center py-4">
                    {addQuery ? 'No matches' : 'All students already added'}
                  </p>
                ) : (
                  <>
                    {addCandidates.slice(0, 20).map(p => (
                      <button key={p.id} type="button" onClick={() => handleAdd(p)}
                        className="w-full flex items-center gap-2.5 px-3 py-2.5 hover:bg-[#F4F4F5] text-left transition-colors">
                        <Avatar avatarUrl={p.avatar_url} name={p.full_name} size={28} userId={p.id} />
                        <span className="text-sm font-medium text-[#27272A] truncate">{p.full_name}</span>
                      </button>
                    ))}
                    {addCandidates.length > 20 && (
                      <p className="text-xs text-[#A1A1AA] text-center py-2 border-t border-[#F4F4F5]">
                        +{addCandidates.length - 20} more · refine search
                      </p>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
          {draft.trip_id && (
            <button onClick={handleImportTrip} disabled={importing} className={ADMIN.ghostBtn} title="Import all passengers from linked trip">
              <Download size={13} />
              {importing ? 'Importing…' : 'Import trip'}
            </button>
          )}
        </div>

      {/* ── Student fee table ───────────────────────────────── */}
      {loading ? (
        <div className="text-center py-12">
          <div className="spinner mx-auto mb-3" />
          <p className="text-sm text-[#71717A]">Loading…</p>
        </div>
      ) : passengers.length === 0 ? (
        <div className={`${ADMIN.card} p-8 text-center`}>
          <Users size={32} className="text-[#D4D4D8] mx-auto mb-3" strokeWidth={1.5} />
          <p className="text-sm text-[#71717A] mb-1">No students in this draft yet.</p>
          {!isIssued && (
            <p className="text-xs text-[#A1A1AA]">
              Search above to add students{draft.trip_id ? ', or click "Import trip"' : ''}.
            </p>
          )}
        </div>
      ) : (
        <div className={`${ADMIN.card} overflow-hidden`}>
          {/* Table header */}
          <div className="hidden sm:grid sm:grid-cols-[1fr_128px_1fr_32px] gap-x-3 px-4 py-2.5 bg-[#F4F4F5] border-b border-[#E4E4E7]">
            <span className="text-[10px] font-bold uppercase tracking-widest text-[#71717A]">Student</span>
            <span className="text-[10px] font-bold uppercase tracking-widest text-[#71717A]">Amount (₹)</span>
            <span className="text-[10px] font-bold uppercase tracking-widest text-[#71717A]">Note / Pickup point</span>
            <span />
          </div>

          <div className="divide-y divide-[#F4F4F5]">
            {passengers.map(p => {
              const pid = p.passenger_id
              const isSaving = savingId === pid
              const isRemoving = removingId === pid
              const rawAmt = amounts[pid] ?? ''
              const hasAmt = rawAmt !== '' && parseFloat(rawAmt) > 0

              return (
                <div key={pid} className={`transition-opacity ${isRemoving ? 'opacity-30 pointer-events-none' : ''}`}>
                  {/* Mobile layout */}
                  <div className="sm:hidden px-4 py-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <Avatar avatarUrl={p.passenger?.avatar_url} name={p.passenger?.full_name ?? '?'} size={32} userId={pid} />
                      <p className="flex-1 text-sm font-medium text-[#18181B] truncate">{p.passenger?.full_name ?? 'Unknown'}</p>
                      {isSaving && <span className="text-[10px] text-[#A1A1AA]">Saving…</span>}
                      <button onClick={() => handleRemove(pid)} disabled={!!savingId}
                        className="w-7 h-7 flex items-center justify-center text-[#D4D4D8] hover:text-rose-500 hover:bg-rose-50 rounded-lg transition-colors disabled:opacity-40">
                        <X size={13} />
                      </button>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <AmountInput
                        value={rawAmt} hasAmt={hasAmt}
                        onChange={v => setAmounts(prev => ({ ...prev, [pid]: v }))}
                        onBlur={() => persist(pid)}
                      />
                      <input type="text" value={descs[pid] ?? ''} placeholder="Note (optional)"
                        onChange={e => setDescs(prev => ({ ...prev, [pid]: e.target.value }))}
                        onBlur={() => persist(pid)}
                        className="w-full px-2.5 py-1.5 text-sm border border-[#E4E4E7] rounded-lg bg-white focus:outline-none focus:border-[#27272A] placeholder:text-[#D4D4D8] transition-colors" />
                    </div>
                  </div>

                  {/* Desktop layout */}
                  <div className="hidden sm:grid sm:grid-cols-[1fr_128px_1fr_32px] gap-x-3 px-4 py-3 items-center">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <Avatar avatarUrl={p.passenger?.avatar_url} name={p.passenger?.full_name ?? '?'} size={32} userId={pid} />
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-[#18181B] truncate">{p.passenger?.full_name ?? 'Unknown'}</p>
                        {isSaving && <p className="text-[10px] text-[#A1A1AA]">Saving…</p>}
                      </div>
                    </div>
                    <AmountInput
                      value={rawAmt} hasAmt={hasAmt}
                      onChange={v => setAmounts(prev => ({ ...prev, [pid]: v }))}
                      onBlur={() => persist(pid)}
                    />
                    <input type="text" value={descs[pid] ?? ''} placeholder="e.g. Pickup point A"
                      onChange={e => setDescs(prev => ({ ...prev, [pid]: e.target.value }))}
                      onBlur={() => persist(pid)}
                      className="w-full px-2.5 py-1.5 text-sm border border-[#E4E4E7] rounded-lg bg-white focus:outline-none focus:border-[#27272A] placeholder:text-[#D4D4D8] transition-colors" />
                    <button onClick={() => handleRemove(pid)} disabled={!!savingId}
                      className="w-8 h-8 flex items-center justify-center text-[#D4D4D8] hover:text-rose-500 hover:bg-rose-50 rounded-lg transition-colors disabled:opacity-40">
                      <X size={14} />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ── Edit draft modal ────────────────────────────────── */}
      <AnimatePresence>
        {showEdit && (
          <MonthlyDraftModal
            draft={draft}
            trips={trips}
            feeHeads={feeHeads}
            onClose={() => setShowEdit(false)}
            onSaved={updated => {
              setDraft(updated)
              onDraftUpdated(updated)
              setShowEdit(false)
            }}
          />
        )}
      </AnimatePresence>
    </>
  )
}

function AmountInput({
  value, hasAmt, onChange, onBlur,
}: {
  value: string
  hasAmt: boolean
  onChange: (v: string) => void
  onBlur: () => void
}) {
  return (
    <div className="relative">
      <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#71717A] text-xs pointer-events-none select-none">₹</span>
      <input
        type="number" min="0" step="0.01"
        value={value}
        onChange={e => onChange(e.target.value)}
        onBlur={onBlur}
        placeholder="0.00"
        className={`w-full pl-6 pr-2 py-1.5 text-sm border rounded-lg text-right tabular-nums focus:outline-none transition-colors ${
          hasAmt
            ? 'bg-white border-[#E4E4E7] focus:border-[#27272A]'
            : 'bg-amber-50 border-amber-300 focus:border-amber-500'
        }`}
      />
    </div>
  )
}
