'use client'

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AnimatePresence } from 'framer-motion'
import dynamic from 'next/dynamic'
import {
  Download, FileText, Eye as EyeIcon, Banknote, ScrollText, CalendarRange, BadgeCheck,
} from 'lucide-react'
import ProtectedLayout from '@/components/ProtectedLayout'
import PageBanner from '@/components/PageBanner'
import { useAuth } from '@/contexts/AuthContext'
import { SALARY_BANNER_DEFAULT } from '@/lib/pageConfig'
import {
  SalaryRecord, StaffBankAccount, StaffSalaryBase,
  fetchSalaryForStaff, fetchMyBankAccount, fetchMyBaseSalary, salaryNet, formatPeriod,
} from '@/lib/salary'
import {
  StatementSpec, buildPayslip, buildSalaryLedger, buildSalaryCertificate, buildAnnualStatement,
} from '@/components/salary/statements/generate'

const StatementPreviewModal = dynamic(() => import('@/components/salary/statements/StatementPreviewModal'))

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

  const cardBtn = 'w-full flex items-center gap-3 p-4 bg-white rounded-2xl border border-slate-200 shadow-sm hover:shadow-md hover:border-slate-300 transition-all text-left disabled:opacity-50'

  return (
    <ProtectedLayout staffOnly>
      <div data-page-theme="salary">
        <PageBanner
          settingKey="salary_banner"
          defaultBanner={SALARY_BANNER_DEFAULT}
          icon={<Download size={26} className="text-white" />}
          title="Salary Documents"
          subtitle="Download your payslips, certificates & statements"
          onBack={() => router.push('/more/salary')}
          maxWidth="max-w-2xl"
          backgroundIcon={<FileText size={150} className="text-white" />}
        />

        <div className="relative z-0 max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 -mt-8 pb-10">
          {loading ? (
            <div className="text-center py-12"><div className="spinner mx-auto mb-3" /><p className="text-sm text-slate-500">Loading…</p></div>
          ) : (
            <div className="space-y-6">

              {/* Certificates & statements */}
              <div>
                <h2 className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-2 px-1">Certificates & Statements</h2>
                <div className="space-y-2.5">
                  <button
                    disabled={busy === 'cert'}
                    onClick={() => open('cert', 'Salary Certificate', () => buildSalaryCertificate(staff!, base?.base_amount))}
                    className={cardBtn}
                  >
                    <Icon><BadgeCheck size={20} /></Icon>
                    <Meta title="Salary Certificate" sub="Official certificate of employment & salary" />
                    <Eye />
                  </button>

                  <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
                    <div className="flex items-center gap-3 mb-3">
                      <Icon><CalendarRange size={20} /></Icon>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-slate-800 text-sm">Annual Salary Statement</p>
                        <p className="text-xs text-slate-400">Month-by-month summary for a selected year</p>
                      </div>
                      <select
                        value={selectedYear}
                        onChange={e => setSelectedYear(Number(e.target.value))}
                        className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white text-slate-600 focus:outline-none focus:ring-1 focus:ring-slate-400"
                      >
                        {availableYears.map(y => <option key={y} value={y}>{y}</option>)}
                      </select>
                    </div>
                    <button
                      disabled={busy === 'annual' || records.filter(r => r.cycle?.period_year === selectedYear).length === 0}
                      onClick={() => open('annual', 'Annual Salary Statement', () => buildAnnualStatement(staff!, selectedYear, records))}
                      className="w-full flex items-center justify-center gap-1.5 bg-slate-800 hover:bg-slate-900 text-white text-xs font-semibold px-3 py-2.5 rounded-lg transition-colors disabled:opacity-50"
                    >
                      <EyeIcon size={14} /> Preview {selectedYear} Statement
                    </button>
                  </div>

                  <button
                    disabled={busy === 'ledger' || records.length === 0}
                    onClick={() => open('ledger', 'Employee Salary Ledger', () => buildSalaryLedger(staff!, records))}
                    className={cardBtn}
                  >
                    <Icon><ScrollText size={20} /></Icon>
                    <Meta title="Salary Ledger" sub="Full history of all salary payments" />
                    <Eye disabled={records.length === 0} />
                  </button>
                </div>
              </div>

              {/* Per-cycle payslips */}
              <div>
                <h2 className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-2 px-1">
                  Payslips · {records.length} cycle{records.length !== 1 ? 's' : ''}
                </h2>
                {records.length === 0 ? (
                  <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 text-center text-sm text-slate-500">
                    No payslips yet. They appear here once a pay cycle is run for you.
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {records.map(r => {
                      const period = r.cycle ? formatPeriod(r.cycle.period_month, r.cycle.period_year) : 'Salary'
                      const key = `payslip-${r.id}`
                      return (
                        <button
                          key={r.id}
                          disabled={busy === key}
                          onClick={() => open(key, `Payslip — ${period}`, () => buildPayslip(r, staff, bank))}
                          className={cardBtn}
                        >
                          <Icon><Banknote size={20} /></Icon>
                          <Meta title={`Payslip · ${period}`} sub={`Net pay Rs. ${salaryNet(r).toLocaleString('en-IN')} · ${r.status}`} />
                          <Eye />
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
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

function Icon({ children }: { children: React.ReactNode }) {
  return <div className="w-11 h-11 rounded-xl page-accent-bg flex items-center justify-center flex-shrink-0 page-accent-text">{children}</div>
}
function Eye({ disabled }: { disabled?: boolean }) {
  return <EyeIcon size={16} className={disabled ? 'text-slate-200' : 'text-slate-400'} />
}
function Meta({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="flex-1 min-w-0">
      <p className="font-semibold text-slate-800 text-sm">{title}</p>
      <p className="text-xs text-slate-400">{sub}</p>
    </div>
  )
}
