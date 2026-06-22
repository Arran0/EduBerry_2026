'use client'

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AnimatePresence } from 'framer-motion'
import dynamic from 'next/dynamic'
import { ArrowLeft, BadgeCheck, CalendarRange, ScrollText, Banknote } from 'lucide-react'
import ProtectedLayout from '@/components/ProtectedLayout'
import { useAuth } from '@/contexts/AuthContext'
import {
  SalaryRecord, StaffBankAccount, StaffSalaryBase,
  fetchSalaryForStaff, fetchMyBankAccount, fetchMyBaseSalary, salaryNet, formatPeriod,
} from '@/lib/salary'
import {
  StatementSpec, buildPayslip, buildSalaryLedger, buildSalaryCertificate, buildAnnualStatement,
} from '@/components/salary/statements/generate'
import { formatINR } from '@/components/bus/FeeCollectionSummary'

const StatementPreviewModal = dynamic(() => import('@/components/salary/statements/StatementPreviewModal'))

const STATUS_CHIP: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-500',
  approved: 'bg-blue-100 text-blue-700',
  paid: 'bg-emerald-100 text-emerald-700',
}

export default function SalaryDownloadsPage() {
  const router = useRouter()
  const { profile } = useAuth()
  const [loading, setLoading] = useState(true)
  const [records, setRecords] = useState<SalaryRecord[]>([])
  const [bank, setBank] = useState<StaffBankAccount | null>(null)
  const [base, setBase] = useState<StaffSalaryBase | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [preview, setPreview] = useState<{ spec: StatementSpec; title: string } | null>(null)
  const [selectedYear, setSelectedYear] = useState<number>(new Date().getFullYear())

  const load = useCallback(async () => {
    if (!profile) return
    setLoading(true)
    const [recs, acc, baseSal] = await Promise.all([
      fetchSalaryForStaff(profile.id),
      fetchMyBankAccount(profile.id),
      fetchMyBaseSalary(profile.id),
    ])
    setRecords(recs)
    setBank(acc)
    setBase(baseSal)
    setLoading(false)
  }, [profile])

  useEffect(() => { load() }, [load])

  const availableYears = useMemo(() => {
    const years = new Set<number>()
    for (const r of records) if (r.cycle?.period_year) years.add(r.cycle.period_year)
    if (!years.size) years.add(new Date().getFullYear())
    return [...years].sort((a, b) => b - a)
  }, [records])

  useEffect(() => {
    if (availableYears.length) setSelectedYear(availableYears[0])
  }, [availableYears])

  const staff = useMemo(() => profile ? {
    full_name: profile.full_name, email: profile.email, role: profile.role,
  } : undefined, [profile])

  const open = async (key: string, title: string, builder: () => Promise<StatementSpec>) => {
    setBusy(key)
    try { setPreview({ spec: await builder(), title }) }
    catch (e) { console.error('preview failed:', e) }
    setBusy(null)
  }

  return (
    <ProtectedLayout staffOnly>
      <div data-page-theme="salary" className="min-h-screen bg-[#F8F8F8]">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 pt-5 pb-12">

          {/* Back nav */}
          <button onClick={() => router.push('/more/salary')}
            className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 transition-colors mb-5">
            <ArrowLeft size={15} /> My Salary
          </button>

          <h1 className="text-lg font-bold text-slate-800 mb-4">Salary Documents</h1>

          {loading ? (
            <div className="text-center py-16"><div className="spinner mx-auto" /></div>
          ) : (
            <>
              {/* ── Rectangle with 3 square statement buttons ── */}
              <div className="bg-[#EFEFEF] rounded-2xl p-3 mb-2">
                <div className="flex gap-2">
                  {/* Salary Certificate */}
                  <button
                    disabled={busy === 'cert' || !staff}
                    onClick={() => open('cert', 'Salary Certificate', () => buildSalaryCertificate(staff!, base?.base_amount))}
                    className="flex-1 flex flex-col items-center justify-center gap-2 bg-white rounded-xl py-5 px-2 text-center hover:bg-slate-50 transition-colors disabled:opacity-40"
                  >
                    <BadgeCheck size={22} className="text-slate-600" strokeWidth={1.5} />
                    <span className="text-[11px] font-semibold text-slate-600 leading-tight">
                      {busy === 'cert' ? '…' : 'Certificate'}
                    </span>
                  </button>

                  {/* Annual Salary Statement */}
                  <div className="flex-1 flex flex-col gap-1.5">
                    <button
                      disabled={busy === 'annual' || records.filter(r => r.cycle?.period_year === selectedYear).length === 0}
                      onClick={() => open('annual', 'Annual Salary Statement', () => buildAnnualStatement(staff!, selectedYear, records))}
                      className="flex-1 flex flex-col items-center justify-center gap-2 bg-white rounded-xl py-4 px-2 text-center hover:bg-slate-50 transition-colors disabled:opacity-40"
                    >
                      <CalendarRange size={22} className="text-slate-600" strokeWidth={1.5} />
                      <span className="text-[11px] font-semibold text-slate-600 leading-tight">
                        {busy === 'annual' ? '…' : 'Annual'}
                      </span>
                    </button>
                    <select
                      value={selectedYear}
                      onChange={e => setSelectedYear(Number(e.target.value))}
                      className="w-full text-[11px] text-slate-500 bg-white border-0 rounded-lg px-2 py-1.5 text-center focus:outline-none focus:ring-1 focus:ring-slate-300 cursor-pointer"
                    >
                      {availableYears.map(y => <option key={y} value={y}>{y}</option>)}
                    </select>
                  </div>

                  {/* Salary Ledger */}
                  <button
                    disabled={busy === 'ledger' || records.length === 0}
                    onClick={() => open('ledger', 'Salary Ledger', () => buildSalaryLedger(staff!, records))}
                    className="flex-1 flex flex-col items-center justify-center gap-2 bg-white rounded-xl py-5 px-2 text-center hover:bg-slate-50 transition-colors disabled:opacity-40"
                  >
                    <ScrollText size={22} className="text-slate-600" strokeWidth={1.5} />
                    <span className="text-[11px] font-semibold text-slate-600 leading-tight">
                      {busy === 'ledger' ? '…' : 'Ledger'}
                    </span>
                  </button>
                </div>
              </div>

              {/* ── Payslips ── */}
              <div className="mt-6">
                <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400 mb-2 px-1">
                  Payslips
                </p>
                {records.length === 0 ? (
                  <p className="text-sm text-slate-400 text-center py-8">No payslips yet.</p>
                ) : (
                  <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
                    {records.map((r, i) => {
                      const period = r.cycle ? formatPeriod(r.cycle.period_month, r.cycle.period_year) : 'Salary'
                      const key = `payslip-${r.id}`
                      return (
                        <button
                          key={r.id}
                          disabled={busy === key}
                          onClick={() => open(key, `Payslip — ${period}`, () => buildPayslip(r, staff, bank))}
                          className={`w-full flex items-center justify-between px-4 py-3.5 text-left hover:bg-slate-50 transition-colors disabled:opacity-50 ${
                            i < records.length - 1 ? 'border-b border-slate-100' : ''
                          }`}
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <Banknote size={15} className="text-slate-300 flex-shrink-0" />
                            <span className="text-sm font-medium text-slate-700 truncate">{period}</span>
                          </div>
                          <div className="flex items-center gap-3 flex-shrink-0">
                            <span className="text-sm font-semibold text-slate-800 tabular-nums">{formatINR(salaryNet(r))}</span>
                            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${STATUS_CHIP[r.status] ?? 'bg-slate-100 text-slate-500'}`}>
                              {r.status[0].toUpperCase() + r.status.slice(1)}
                            </span>
                          </div>
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            </>
          )}
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
