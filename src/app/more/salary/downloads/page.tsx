'use client'

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { AnimatePresence } from 'framer-motion'
import dynamic from 'next/dynamic'
import { ArrowLeft, BadgeCheck, CalendarRange, ScrollText, FolderOpen, Download, Loader2 } from 'lucide-react'
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
import { Chip, IconChip, Loading, Panel, PanelHead, SX } from '@/components/salary/ui'

const StatementPreviewModal = dynamic(() => import('@/components/salary/statements/StatementPreviewModal'))

const STATUS: Record<string, { label: string; tone: 'neutral' | 'gold' | 'good' }> = {
  draft: { label: 'In progress', tone: 'neutral' },
  approved: { label: 'Approved', tone: 'gold' },
  paid: { label: 'Paid', tone: 'good' },
}

export default function SalaryDownloadsPage() {
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

  const yearHasRecords = records.some(r => r.cycle?.period_year === selectedYear)

  return (
    <ProtectedLayout staffOnly>
      <div data-page-theme="salary" className="overflow-x-clip" style={{ minHeight: '100vh' }}>
        <div className="w-full max-w-3xl mx-auto px-4 sm:px-6 pt-3 sm:pt-6 pb-14">
          <Link href="/more/salary"
            className="lg-pill inline-flex items-center gap-1.5 h-8 pl-2.5 pr-3.5 mb-3 text-[12.5px] font-semibold text-slate-700 hover:text-slate-900 transition-colors">
            <ArrowLeft size={14} /> My salary
          </Link>

          <div className="flex items-center gap-3 mb-4">
            <IconChip icon={FolderOpen} />
            <h1 className="font-display text-[1.3rem] sm:text-[1.6rem] font-bold leading-[1.15] text-slate-900 headline break-words">
              Salary documents
            </h1>
          </div>

          {loading ? (
            <Loading />
          ) : (
            <div className="space-y-4">
              <div className="fx-deck fx-bleed p-2.5 sm:p-3">
                <div className="grid grid-cols-3 gap-2">
                  <button
                    disabled={busy === 'cert' || !staff}
                    onClick={() => open('cert', 'Salary certificate', () => buildSalaryCertificate(staff!, base?.base_amount))}
                    className={SX.tile}
                  >
                    <BadgeCheck size={20} className="text-[#8B6F47]" />
                    <span className="text-[13px] font-semibold text-slate-900 leading-snug">{busy === 'cert' ? 'Building…' : 'Certificate'}</span>
                  </button>
                  <button
                    disabled={busy === 'annual' || !yearHasRecords}
                    onClick={() => open('annual', `Annual statement ${selectedYear}`, () => buildAnnualStatement(staff!, selectedYear, records))}
                    className={SX.tile}
                  >
                    <CalendarRange size={20} className="text-[#8B6F47]" />
                    <span className="text-[13px] font-semibold text-slate-900 leading-snug">{busy === 'annual' ? 'Building…' : 'Annual'}</span>
                    <span className="text-[11.5px] text-slate-500">{selectedYear}</span>
                  </button>
                  <button
                    disabled={busy === 'ledger' || records.length === 0}
                    onClick={() => open('ledger', 'Salary ledger', () => buildSalaryLedger(staff!, records))}
                    className={SX.tile}
                  >
                    <ScrollText size={20} className="text-[#8B6F47]" />
                    <span className="text-[13px] font-semibold text-slate-900 leading-snug">{busy === 'ledger' ? 'Building…' : 'Ledger'}</span>
                  </button>
                </div>
                <label className="flex flex-wrap items-center justify-end gap-2 mt-2.5 px-1">
                  <span className="text-[12px] text-slate-500">Year for the annual statement</span>
                  <select value={selectedYear} onChange={e => setSelectedYear(Number(e.target.value))}
                    className={`${SX.field} !w-auto !h-8 cursor-pointer`}>
                    {availableYears.map(y => <option key={y} value={y}>{y}</option>)}
                  </select>
                </label>
              </div>

              <Panel bleed>
                <PanelHead title="Payslips" />
                {records.length === 0 ? (
                  <p className="text-[13px] text-slate-500 text-center py-8">No payslips yet.</p>
                ) : records.map(r => {
                  const period = r.cycle ? formatPeriod(r.cycle.period_month, r.cycle.period_year) : 'Salary'
                  const key = `payslip-${r.id}`
                  const st = STATUS[r.status] ?? STATUS.draft
                  return (
                    <button
                      key={r.id}
                      disabled={busy === key}
                      onClick={() => open(key, `Payslip · ${period}`, () => buildPayslip(r, staff, bank))}
                      className="w-full flex flex-wrap items-center gap-x-3 gap-y-1 px-3.5 py-2.5 border-b border-[#F0ECE3] last:border-b-0 text-left hover:bg-[#FAF7F0] transition-colors disabled:opacity-50"
                    >
                      <span className="flex-1 min-w-[7rem] text-[13.5px] font-semibold text-slate-900 break-words">{period}</span>
                      <Chip tone={st.tone}>{st.label}</Chip>
                      <span className="text-[13px] font-semibold text-slate-900 tabular-nums">{formatINR(salaryNet(r))}</span>
                      {busy === key
                        ? <Loader2 size={15} className="animate-spin text-[#8B6F47] flex-shrink-0" />
                        : <Download size={15} className="text-[#8B6F47] flex-shrink-0" />}
                    </button>
                  )
                })}
              </Panel>
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
