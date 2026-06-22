'use client'

import React, { useMemo, useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import dynamic from 'next/dynamic'
import { Download, FileText, Search, X, FileSpreadsheet, ScrollText, AlertTriangle, BadgeCheck, CalendarRange } from 'lucide-react'
import Avatar from '@/components/Avatar'
import { UserProfile } from '@/lib/supabase'
import { SchoolFee } from '@/lib/fees'
import { exportRows } from '@/lib/feeExports'
import { formatINR } from './FeeCollectionSummary'
import {
  StatementSpec, buildTranscript, buildLedger, buildOutstanding, buildNoDue, buildAnnual, hasNoDue,
} from './statements/generate'

const StatementPreviewModal = dynamic(() => import('./statements/StatementPreviewModal'))

const card = 'bg-white border border-[#E4E4E7] rounded-xl'
const darkBtn = 'flex items-center justify-center gap-1.5 bg-[#27272A] hover:bg-[#18181B] text-white text-xs font-semibold px-3 py-2 rounded-lg transition-colors disabled:opacity-50'
const label = 'text-[10px] font-bold uppercase tracking-widest text-[#71717A]'

/**
 * Admin reports: whole-school Defaulter List and Fee Head Breakdown (both
 * Excel-exportable), plus a per-student statement launcher that generates the
 * Transcript / Ledger / Dues / No-Due / Annual PDFs for the selected year.
 * Operates on the year-scoped `fees` already loaded by the parent page.
 */
export default function ReportsSection({ year, fees }: { year: string; fees: SchoolFee[] }) {
  const [picked, setPicked] = useState<UserProfile | null>(null)
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [preview, setPreview] = useState<{ spec: StatementSpec; title: string } | null>(null)

  // Defaulters: students with any unpaid/partial fee this year.
  const defaulters = useMemo(() => {
    const map = new Map<string, { student?: UserProfile | null; due: number; count: number }>()
    for (const f of fees) {
      if (f.status !== 'unpaid' && f.status !== 'partial') continue
      const cur = map.get(f.student_id) ?? { student: f.student, due: 0, count: 0 }
      cur.due += Number(f.amount) || 0
      cur.count += 1
      map.set(f.student_id, cur)
    }
    return [...map.values()].sort((a, b) => b.due - a.due)
  }, [fees])

  // Per fee-head billed / collected / outstanding.
  const breakdown = useMemo(() => {
    const map = new Map<string, { billed: number; paid: number }>()
    for (const f of fees) {
      if (f.status === 'cancelled') continue
      const name = f.fee_head?.name || f.description || 'Other'
      const cur = map.get(name) ?? { billed: 0, paid: 0 }
      const amt = Number(f.amount) || 0
      cur.billed += amt
      if (f.status === 'paid') cur.paid += amt
      map.set(name, cur)
    }
    return [...map.entries()].map(([head, v]) => ({ head, billed: v.billed, paid: v.paid, due: v.billed - v.paid }))
      .sort((a, b) => b.billed - a.billed)
  }, [fees])

  // Student picker pool, derived from the loaded fees (deduped by student).
  const students = useMemo(() => {
    const map = new Map<string, UserProfile>()
    for (const f of fees) if (f.student) map.set(f.student_id, f.student)
    return [...map.values()].sort((a, b) => a.full_name.localeCompare(b.full_name))
  }, [fees])

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    return students.filter(s => !q || s.full_name.toLowerCase().includes(q) || s.email.toLowerCase().includes(q)).slice(0, 30)
  }, [students, query])

  const pickedFees = useMemo(() => picked ? fees.filter(f => f.student_id === picked.id) : [], [picked, fees])
  const noDue = hasNoDue(pickedFees)

  const exportDefaulters = () => {
    exportRows(
      defaulters.map(d => ({
        Student: d.student?.full_name ?? '—',
        Class: d.student?.grade != null ? `Grade ${d.student.grade}${d.student.section ? ` ${d.student.section}` : ''}` : '—',
        'Fees Due': d.count,
        'Amount Due (₹)': d.due,
      })),
      `Defaulters ${year}`, `defaulter-list-${year}`,
    )
  }
  const exportBreakdown = () => {
    exportRows(
      breakdown.map(b => ({ 'Fee Head': b.head, 'Billed (₹)': b.billed, 'Collected (₹)': b.paid, 'Outstanding (₹)': b.due })),
      `Fee Heads ${year}`, `fee-head-breakdown-${year}`,
    )
  }

  // Build a statement and open it in the preview modal (download is offered there).
  const openPreview = async (key: string, title: string, builder: () => Promise<StatementSpec>) => {
    setBusy(key)
    try { setPreview({ spec: await builder(), title }) }
    catch (e) { console.error('statement generation failed:', e) }
    setBusy(null)
  }

  return (
    <div className="space-y-6">
      {/* ── Per-student statements ─────────────────────────────── */}
      <div className={`${card} shadow-sm p-4`}>
        <div className="flex items-center gap-2 mb-3">
          <FileText size={15} className="text-[#A8896B]" />
          <h3 className={label}>Student statements · {year}</h3>
        </div>

        {!picked ? (
          <>
            <div className="relative mb-2">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#A1A1AA] pointer-events-none" />
              <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search a student to generate documents…"
                className="w-full bg-white border border-[#E4E4E7] rounded-lg pl-9 pr-3 py-2.5 text-sm text-[#27272A] placeholder:text-[#A1A1AA] focus:outline-none focus:border-[#27272A]" />
            </div>
            <div className="max-h-56 overflow-y-auto space-y-1">
              {results.length === 0 ? (
                <p className="text-sm text-[#A1A1AA] text-center py-4">No students with fees this year.</p>
              ) : results.map(s => (
                <button key={s.id} onClick={() => { setPicked(s); setQuery('') }}
                  className="w-full flex items-center gap-2.5 rounded-lg p-2 border border-[#E4E4E7] bg-white hover:border-[#D4D4D8] text-left transition-colors">
                  <Avatar avatarUrl={s.avatar_url} name={s.full_name} size={28} userId={s.id} />
                  <span className="flex-1 min-w-0 text-sm font-medium text-[#18181B] truncate">{s.full_name}</span>
                  <FileText size={14} className="text-[#A1A1AA] flex-shrink-0" />
                </button>
              ))}
            </div>
          </>
        ) : (
          <>
            <div className="flex items-center gap-2.5 mb-3 p-2 rounded-lg bg-[#FAFAFA] border border-[#E4E4E7]">
              <Avatar avatarUrl={picked.avatar_url} name={picked.full_name} size={32} userId={picked.id} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-[#18181B] truncate">{picked.full_name}</p>
                <p className="text-[11px] text-[#A1A1AA] truncate">{pickedFees.length} fee{pickedFees.length === 1 ? '' : 's'} · {year}</p>
              </div>
              <button onClick={() => setPicked(null)} className="p-1.5 text-[#A1A1AA] hover:text-[#27272A] hover:bg-[#F4F4F5] rounded-lg">
                <X size={15} />
              </button>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              <DocButton busy={busy === 't'} onClick={() => openPreview('t', `Fee Transcript · ${picked.full_name}`, () => buildTranscript(picked, year, pickedFees))} icon={<ScrollText size={16} />} label="Transcript" />
              <DocButton busy={busy === 'l'} onClick={() => openPreview('l', `Fee Ledger · ${picked.full_name}`, () => buildLedger(picked.id, picked, year))} icon={<FileSpreadsheet size={16} />} label="Ledger" />
              <DocButton busy={busy === 'd'} onClick={() => openPreview('d', `Outstanding Dues · ${picked.full_name}`, () => buildOutstanding(picked, year, pickedFees))} icon={<AlertTriangle size={16} />} label="Dues" />
              <DocButton busy={busy === 'a'} onClick={() => openPreview('a', `Annual Statement · ${picked.full_name}`, () => buildAnnual(picked, year, pickedFees))} icon={<CalendarRange size={16} />} label="Annual" />
              <DocButton busy={busy === 'n'} disabled={!noDue} onClick={() => openPreview('n', `No-Due Certificate · ${picked.full_name}`, () => buildNoDue(picked, year))} icon={<BadgeCheck size={16} />} label="No-Due" title={noDue ? 'Preview No-Due Certificate' : 'Blocked — outstanding dues exist'} />
            </div>
            {!noDue && (
              <p className="text-[11px] text-[#A1A1AA] mt-2.5">No-Due Certificate unlocks once all dues for {year} are cleared.</p>
            )}
          </>
        )}
      </div>

      {/* ── Defaulter list ─────────────────────────────────────── */}
      <div className={`${card} shadow-sm p-4`}>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <AlertTriangle size={15} className="text-[#D97706]" />
            <h3 className={label}>Defaulter list · {defaulters.length}</h3>
          </div>
          <button onClick={exportDefaulters} disabled={defaulters.length === 0} className={darkBtn}>
            <Download size={14} /> Export
          </button>
        </div>
        {defaulters.length === 0 ? (
          <p className="text-sm text-[#A1A1AA] text-center py-4">No defaulters this year.</p>
        ) : (
          <div className="space-y-1.5 max-h-72 overflow-y-auto">
            {defaulters.map(d => (
              <div key={d.student?.id ?? Math.random()} className="flex items-center gap-2.5 p-2 rounded-lg border border-[#F4F4F5]">
                <Avatar avatarUrl={d.student?.avatar_url} name={d.student?.full_name ?? '?'} size={28} userId={d.student?.id} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-[#18181B] truncate">{d.student?.full_name ?? 'Unknown'}</p>
                  <p className="text-[11px] text-[#A1A1AA]">{d.count} fee{d.count === 1 ? '' : 's'} due</p>
                </div>
                <p className="text-sm font-bold text-[#18181B] tabular-nums">{formatINR(d.due)}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Fee head breakdown ─────────────────────────────────── */}
      <div className={`${card} shadow-sm p-4`}>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <FileSpreadsheet size={15} className="text-[#A8896B]" />
            <h3 className={label}>Fee head breakdown</h3>
          </div>
          <button onClick={exportBreakdown} disabled={breakdown.length === 0} className={darkBtn}>
            <Download size={14} /> Export
          </button>
        </div>
        {breakdown.length === 0 ? (
          <p className="text-sm text-[#A1A1AA] text-center py-4">No fees recorded this year.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[#FAFAFA] border-b border-[#E4E4E7] text-left">
                  <th className="px-3 py-2 font-semibold text-[#71717A] text-xs uppercase tracking-wide">Fee head</th>
                  <th className="px-3 py-2 font-semibold text-[#71717A] text-xs uppercase tracking-wide text-right">Billed</th>
                  <th className="px-3 py-2 font-semibold text-[#71717A] text-xs uppercase tracking-wide text-right">Collected</th>
                  <th className="px-3 py-2 font-semibold text-[#71717A] text-xs uppercase tracking-wide text-right">Outstanding</th>
                </tr>
              </thead>
              <tbody>
                {breakdown.map(b => (
                  <tr key={b.head} className="border-b border-[#F4F4F5] last:border-0">
                    <td className="px-3 py-2 text-[#18181B] font-medium truncate max-w-[180px]">{b.head}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-[#52525B]">{formatINR(b.billed)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-[#16A34A]">{formatINR(b.paid)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-[#D97706]">{formatINR(b.due)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <AnimatePresence>
        {preview && (
          <StatementPreviewModal spec={preview.spec} title={preview.title} onClose={() => setPreview(null)} />
        )}
      </AnimatePresence>
    </div>
  )
}

/** A square-ish document action tile used in the statement launcher. */
function DocButton({ icon, label, onClick, busy, disabled, title }: {
  icon: React.ReactNode; label: string; onClick: () => void; busy?: boolean; disabled?: boolean; title?: string
}) {
  const off = disabled
  return (
    <button onClick={onClick} disabled={busy || disabled} title={title}
      className={`flex flex-col items-center justify-center gap-1.5 py-3.5 rounded-xl border text-xs font-semibold transition-all ${
        off
          ? 'bg-[#FAFAFA] border-[#E4E4E7] text-[#C4C4C8] cursor-not-allowed'
          : 'bg-white border-[#E4E4E7] text-[#27272A] hover:border-[#A8896B] hover:bg-[#FBFAF7] hover:-translate-y-0.5 shadow-sm disabled:opacity-50'
      }`}>
      <span className={off ? 'text-[#C4C4C8]' : 'text-[#A8896B]'}>{icon}</span>
      {busy ? '…' : label}
    </button>
  )
}
