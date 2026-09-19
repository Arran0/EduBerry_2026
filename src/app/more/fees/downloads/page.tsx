'use client'

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AnimatePresence } from 'framer-motion'
import dynamic from 'next/dynamic'
import {
  ChevronLeft, Receipt, ScrollText, CalendarRange, BadgeCheck, BookOpen,
} from 'lucide-react'
import ProtectedLayout from '@/components/ProtectedLayout'
import YearToggler from '@/components/fees/YearToggler'
import { formatINR } from '@/components/fees/FeeCollectionSummary'
import { useAuth } from '@/contexts/AuthContext'
import {
  SchoolFee, fetchFeesForStudent, listAcademicYears, currentAcademicYear,
} from '@/lib/fees'
import {
  StatementSpec, buildFeeReceipt, buildTranscript,
  buildAnnual, buildNoDue, buildLedger, hasNoDue,
} from '@/components/fees/statements/generate'

const StatementPreviewModal = dynamic(() => import('@/components/fees/statements/StatementPreviewModal'))

export default function DownloadCenterPage() {
  const router = useRouter()
  const { user, profile } = useAuth()
  const [year, setYear] = useState<string>(currentAcademicYear())
  const [years, setYears] = useState<string[]>([currentAcademicYear()])
  const [fees, setFees] = useState<SchoolFee[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [preview, setPreview] = useState<{ spec: StatementSpec; title: string } | null>(null)

  const student = useMemo(() => profile ? {
    full_name: profile.full_name, email: profile.email, grade: profile.grade, section: profile.section,
  } : undefined, [profile])

  const load = useCallback(async () => {
    if (!user) return
    setLoading(true)
    setFees(await fetchFeesForStudent(user.id, year))
    setLoading(false)
  }, [user, year])

  useEffect(() => { load() }, [load])
  useEffect(() => { listAcademicYears().then(setYears) }, [])

  const paidFees = useMemo(() => fees.filter(f => f.status === 'paid'), [fees])
  const noDue = hasNoDue(fees)

  const openPreview = async (key: string, title: string, builder: () => Promise<StatementSpec>) => {
    setBusy(key)
    try { setPreview({ spec: await builder(), title }) }
    catch (e) { console.error('preview failed:', e) }
    setBusy(null)
  }

  return (
    <ProtectedLayout>
      <div data-page-theme="fees" className="min-h-screen bg-slate-50">

        {/* Header — back button + year selector, no banner */}
        <div className="bg-white border-b border-slate-100">
          <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center gap-3">
            <button
              onClick={() => router.push('/more/fees')}
              className="flex items-center gap-1 text-sm font-medium text-slate-500 hover:text-slate-800 transition-colors"
            >
              <ChevronLeft size={16} /> Back
            </button>
            <h1 className="flex-1 font-bold text-slate-800 text-lg">Download Center</h1>
            <YearToggler years={years} value={year} onChange={setYear} tone="light" />
          </div>
        </div>

        <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">

          {/* Dark panel — 4 document tiles */}
          <div className="bg-slate-900 rounded-3xl p-5">
            <p className="text-slate-400 text-[11px] font-bold uppercase tracking-widest mb-4">Documents · {year}</p>
            <div className="grid grid-cols-2 gap-3">
              <DocTile
                icon={<ScrollText size={26} />}
                label="Fee Transcript"
                disabled={busy === 't' || loading || fees.length === 0}
                loading={busy === 't'}
                onClick={() => openPreview('t', 'Fee Transcript', () => buildTranscript(student, year, fees))}
              />
              <DocTile
                icon={<BookOpen size={26} />}
                label="Fee Ledger"
                disabled={busy === 'l' || loading || fees.length === 0}
                loading={busy === 'l'}
                onClick={() => openPreview('l', 'Fee Ledger', () => buildLedger(user!.id, student, year))}
              />
              <DocTile
                icon={<CalendarRange size={26} />}
                label="Annual Fee Statement"
                disabled={busy === 'a' || loading || fees.length === 0}
                loading={busy === 'a'}
                onClick={() => openPreview('a', 'Annual Fee Statement', () => buildAnnual(student, year, fees))}
              />
              <DocTile
                icon={<BadgeCheck size={26} />}
                label="No Due Certificate"
                disabled={busy === 'n' || loading || !noDue}
                loading={busy === 'n'}
                dimmed={!loading && !noDue}
                onClick={() => openPreview('n', 'No-Due Certificate', () => buildNoDue(student, year))}
              />
            </div>
          </div>

          {/* Receipts */}
          <div>
            <h2 className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-3 px-1">
              Receipts · {loading ? '…' : `${paidFees.length} paid`}
            </h2>
            {loading ? (
              <div className="text-center py-10">
                <div className="spinner mx-auto mb-2" />
                <p className="text-sm text-slate-500">Loading…</p>
              </div>
            ) : paidFees.length === 0 ? (
              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 text-center text-sm text-slate-500">
                No paid fees for {year}. Receipts appear here once a payment is confirmed.
              </div>
            ) : (
              <div className="space-y-2.5">
                {paidFees.map(f => (
                  <div key={f.id} className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 page-accent-bg flex items-center justify-center flex-shrink-0 page-accent-text">
                        <Receipt size={18} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-slate-800 text-sm truncate">
                          {f.description || f.fee_head?.name || 'School fee'}
                        </p>
                        <p className="text-xs text-slate-400 tabular-nums">{formatINR(f.amount)} · paid</p>
                      </div>
                      <button
                        disabled={busy === `r-${f.id}`}
                        onClick={() => openPreview(`r-${f.id}`, 'Fee Receipt', () => buildFeeReceipt(f, student))}
                        className="flex-shrink-0 flex items-center gap-1.5 bg-slate-800 hover:bg-slate-900 text-white text-xs font-semibold px-3 py-2 transition-colors disabled:opacity-50"
                      >
                        <Receipt size={13} /> Receipt
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <AnimatePresence>
          {preview && (
            <StatementPreviewModal spec={preview.spec} title={preview.title} onClose={() => setPreview(null)} />
          )}
        </AnimatePresence>
      </div>
    </ProtectedLayout>
  )
}

function DocTile({
  icon, label, disabled, loading, onClick, dimmed,
}: {
  icon: React.ReactNode
  label: string
  disabled?: boolean
  loading?: boolean
  onClick: () => void
  dimmed?: boolean
}) {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      className={`flex flex-col items-center justify-center gap-3 p-5 rounded-2xl transition-all text-center w-full aspect-square
        ${dimmed
          ? 'bg-slate-800/60 text-slate-500 cursor-not-allowed opacity-60'
          : 'bg-slate-800 text-white hover:bg-slate-700 active:scale-95'}
        disabled:opacity-50 disabled:cursor-not-allowed`}
    >
      <div className={loading ? 'animate-pulse' : ''}>{icon}</div>
      <span className={`text-[11px] font-semibold leading-tight ${dimmed ? 'text-slate-500' : 'text-slate-200'}`}>
        {label}
      </span>
    </button>
  )
}
