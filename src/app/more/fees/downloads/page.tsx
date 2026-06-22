'use client'

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Download, Receipt, ScrollText, CalendarRange, BadgeCheck, FileCheck2, FileText,
} from 'lucide-react'
import ProtectedLayout from '@/components/ProtectedLayout'
import PageBanner from '@/components/PageBanner'
import YearToggler from '@/components/fees/YearToggler'
import { formatINR } from '@/components/fees/FeeCollectionSummary'
import { useAuth } from '@/contexts/AuthContext'
import { FEES_BANNER_DEFAULT } from '@/lib/pageConfig'
import {
  SchoolFee, fetchFeesForStudent, listAcademicYears, currentAcademicYear,
} from '@/lib/fees'
import {
  downloadFeeReceipt, downloadPaymentCertificate, downloadTranscript,
  downloadAnnual, downloadNoDue, hasNoDue,
} from '@/components/fees/statements/generate'

/**
 * Self-service Download Center — one screen where a parent/student downloads
 * their own fee documents for the selected academic year without contacting
 * the office: per-fee Receipts & Payment Certificates, plus the whole-year
 * Transcript, Annual Statement and (when dues are clear) No-Due Certificate.
 */
export default function DownloadCenterPage() {
  const router = useRouter()
  const { user, profile } = useAuth()
  const [year, setYear] = useState<string>(currentAcademicYear())
  const [years, setYears] = useState<string[]>([currentAcademicYear()])
  const [fees, setFees] = useState<SchoolFee[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)

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

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key)
    try { await fn() } catch (e) { console.error('download failed:', e) }
    setBusy(null)
  }

  const cardBtn = 'w-full flex items-center gap-3 p-4 bg-white rounded-2xl border border-slate-200 shadow-sm hover:shadow-md hover:border-slate-300 transition-all text-left disabled:opacity-50'

  return (
    <ProtectedLayout>
      <div data-page-theme="fees">
        <PageBanner
          settingKey="fees_banner"
          defaultBanner={FEES_BANNER_DEFAULT}
          icon={<Download size={26} className="text-white" />}
          title="Download Center"
          subtitle="Download your fee documents — no office visit needed"
          onBack={() => router.push('/more/fees')}
          maxWidth="max-w-2xl"
          backgroundIcon={<FileText size={150} className="text-white" />}
        />

        <div className="relative z-0 max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 -mt-8 pb-10">
          <div className="flex items-center justify-end mb-3">
            <YearToggler years={years} value={year} onChange={setYear} tone="dark" />
          </div>

          {loading ? (
            <div className="text-center py-12"><div className="spinner mx-auto mb-3" /><p className="text-sm text-slate-500">Loading…</p></div>
          ) : (
            <div className="space-y-6">
              {/* Whole-year documents */}
              <div>
                <h2 className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-2 px-1">Statements · {year}</h2>
                <div className="space-y-2.5">
                  <button disabled={busy === 't' || fees.length === 0} onClick={() => run('t', () => downloadTranscript(student, year, fees))} className={cardBtn}>
                    <Icon><ScrollText size={20} /></Icon>
                    <Meta title="Fee Transcript" sub="Full statement of all fees & their status" />
                    <Download size={16} className="text-slate-300" />
                  </button>
                  <button disabled={busy === 'a' || fees.length === 0} onClick={() => run('a', () => downloadAnnual(student, year, fees))} className={cardBtn}>
                    <Icon><CalendarRange size={20} /></Icon>
                    <Meta title="Annual Fee Statement" sub="Year summary grouped by fee head" />
                    <Download size={16} className="text-slate-300" />
                  </button>
                  <button disabled={busy === 'n' || !noDue} onClick={() => run('n', () => downloadNoDue(student, year))} className={cardBtn}>
                    <Icon><BadgeCheck size={20} /></Icon>
                    <Meta title="No-Due Certificate" sub={noDue ? 'All dues cleared — certificate available' : 'Available once all dues are cleared'} />
                    <Download size={16} className="text-slate-300" />
                  </button>
                </div>
              </div>

              {/* Per-payment documents */}
              <div>
                <h2 className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-2 px-1">
                  Receipts & certificates · {paidFees.length} paid
                </h2>
                {paidFees.length === 0 ? (
                  <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 text-center text-sm text-slate-500">
                    No paid fees yet for {year}. Receipts appear here once a payment is confirmed.
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {paidFees.map(f => (
                      <div key={f.id} className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
                        <div className="flex items-center gap-3 mb-3">
                          <Icon><Receipt size={20} /></Icon>
                          <div className="flex-1 min-w-0">
                            <p className="font-semibold text-slate-800 text-sm truncate">{f.description || f.fee_head?.name || 'School fee'}</p>
                            <p className="text-xs text-slate-400 tabular-nums">{formatINR(f.amount)} · paid</p>
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <button disabled={busy === `r-${f.id}`} onClick={() => run(`r-${f.id}`, () => downloadFeeReceipt(f, student))}
                            className="flex items-center justify-center gap-1.5 bg-slate-800 hover:bg-slate-900 text-white text-xs font-semibold px-3 py-2 rounded-lg transition-colors disabled:opacity-50">
                            <Receipt size={14} /> Receipt
                          </button>
                          <button disabled={busy === `c-${f.id}`} onClick={() => run(`c-${f.id}`, () => downloadPaymentCertificate(f, student))}
                            className="flex items-center justify-center gap-1.5 bg-white border border-slate-200 text-slate-600 hover:border-slate-300 text-xs font-semibold px-3 py-2 rounded-lg transition-colors disabled:opacity-50">
                            <FileCheck2 size={14} /> Certificate
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </ProtectedLayout>
  )
}

function Icon({ children }: { children: React.ReactNode }) {
  return <div className="w-11 h-11 rounded-xl page-accent-bg flex items-center justify-center flex-shrink-0 page-accent-text">{children}</div>
}
function Meta({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="flex-1 min-w-0">
      <p className="font-semibold text-slate-800 text-sm">{title}</p>
      <p className="text-xs text-slate-400">{sub}</p>
    </div>
  )
}
