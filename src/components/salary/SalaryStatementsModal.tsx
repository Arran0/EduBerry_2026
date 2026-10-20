'use client'

import React, { useEffect, useMemo, useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import dynamic from 'next/dynamic'
import {
  Receipt, FileSpreadsheet, ScrollText, BadgeCheck, FileText, Loader2,
  ChevronLeft, Download, FolderOpen,
} from 'lucide-react'
import ModalShell from '@/components/ui/ModalShell'
import { Chip, SALARY_ICON, SX } from '@/components/salary/ui'
import { UserProfile, getDisplayRole } from '@/lib/supabase'
import {
  SalaryRecord, StaffBankAccount, StaffSalaryBase,
  fetchSalaryForStaff, fetchMyBankAccount, fetchMyBaseSalary, salaryNet, formatPeriod,
} from '@/lib/salary'
import { formatINR } from '@/components/bus/FeeCollectionSummary'
import {
  StatementSpec, buildPayslip, buildSalaryLedger, buildSalaryPaymentStatement,
  buildSalaryCertificate, buildForm16,
} from '@/components/salary/statements/generate'

const StatementPreviewModal = dynamic(() => import('@/components/salary/statements/StatementPreviewModal'))

interface Props {
  staff: UserProfile
  onClose: () => void
}

const STATUS: Record<string, { label: string; tone: 'neutral' | 'gold' | 'good' }> = {
  draft: { label: 'In progress', tone: 'neutral' },
  approved: { label: 'Approved', tone: 'gold' },
  paid: { label: 'Paid', tone: 'good' },
}

/** Staff "Download Centre" — salary documents popup. Mirrors the fee
 *  StudentStatementsModal so the two surfaces feel like one product. */
export default function SalaryStatementsModal({ staff, onClose }: Props) {
  const [records, setRecords] = useState<SalaryRecord[]>([])
  const [bank, setBank] = useState<StaffBankAccount | null>(null)
  const [base, setBase] = useState<StaffSalaryBase | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [preview, setPreview] = useState<{ spec: StatementSpec; title: string } | null>(null)

  // Salary-slip picker (one slip per month).
  const [slipMode, setSlipMode] = useState(false)

  useEffect(() => {
    setLoading(true)
    Promise.all([
      fetchSalaryForStaff(staff.id),
      fetchMyBankAccount(staff.id),
      fetchMyBaseSalary(staff.id),
    ]).then(([recs, acc, baseSal]) => {
      setRecords(recs); setBank(acc); setBase(baseSal); setLoading(false)
    })
  }, [staff.id])

  const availableYears = useMemo(() => {
    const years = new Set<number>()
    for (const r of records) if (r.cycle?.period_year) years.add(r.cycle.period_year)
    if (!years.size) years.add(new Date().getFullYear())
    return [...years].sort((a, b) => b - a)
  }, [records])

  const [selectedYear, setSelectedYear] = useState<number>(new Date().getFullYear())
  useEffect(() => { if (availableYears.length) setSelectedYear(availableYears[0]) }, [availableYears])

  const staffLike = { full_name: staff.full_name, email: staff.email, role: staff.role }

  const openPreview = async (key: string, title: string, builder: () => Promise<StatementSpec>) => {
    setBusy(key)
    try { setPreview({ spec: await builder(), title }) }
    catch (e) { console.error('salary statement generation failed:', e) }
    setBusy(null)
  }

  const openSlip = async (r: SalaryRecord) => {
    const period = r.cycle ? formatPeriod(r.cycle.period_month, r.cycle.period_year) : 'Salary'
    setBusy(r.id)
    try { setPreview({ spec: await buildPayslip(r, staffLike, bank), title: `Salary Slip — ${period}` }) }
    catch (e) { console.error('payslip generation failed:', e) }
    setBusy(null)
  }

  const DOCS = [
    {
      key: 'slip', label: 'Salary slip', sub: 'Pick a month',
      icon: <Receipt size={20} />, disabled: records.length === 0,
      onClick: () => setSlipMode(true),
    },
    {
      key: 'register', label: 'Salary register', sub: 'Every month',
      icon: <FileSpreadsheet size={20} />, disabled: records.length === 0,
      onClick: () => openPreview('register', `Employee Salary Register · ${staff.full_name}`,
        () => buildSalaryLedger(staffLike, records, 'Employee Salary Register')),
    },
    {
      key: 'payment', label: 'Payment statement', sub: `Year ${selectedYear}`,
      icon: <ScrollText size={20} />, disabled: records.length === 0,
      onClick: () => openPreview('payment', `Salary Payment Statement · ${staff.full_name}`,
        () => buildSalaryPaymentStatement(staffLike, selectedYear, records)),
    },
    {
      key: 'cert', label: 'Salary certificate', sub: 'Annual',
      icon: <BadgeCheck size={20} />,
      onClick: () => openPreview('cert', `Annual Salary Certificate · ${staff.full_name}`,
        () => buildSalaryCertificate(staffLike, base?.base_amount)),
    },
    {
      key: 'form16', label: 'Form 16', sub: `Year ${selectedYear}`,
      icon: <FileText size={20} />, disabled: records.length === 0,
      onClick: () => openPreview('form16', `Form 16 · ${staff.full_name}`,
        () => buildForm16(staffLike, selectedYear, records)),
    },
  ]

  return (
    <>
      <ModalShell
        onClose={onClose}
        size="lg"
        sharp
        glass
        title={staff.full_name}
        subtitle={`${getDisplayRole(staff)} · salary documents`}
        icon={<FolderOpen size={16} />}
        iconClassName={SALARY_ICON}
        minHClass="sm:min-h-[22rem]"
      >
        {slipMode ? (
          /* ── Salary slip picker ── */
          <>
            <div className="flex items-center gap-2 mb-3">
              <button onClick={() => setSlipMode(false)} className={`${SX.ghost} !pl-2.5`}>
                <ChevronLeft size={14} /> Documents
              </button>
              <p className={SX.heading}>Salary slips</p>
            </div>
            {records.length === 0 ? (
              <div className="py-10 text-center">
                <Receipt size={26} className="mx-auto mb-2.5 text-slate-300" />
                <p className="text-[13px] text-slate-500">No payslips yet.</p>
              </div>
            ) : (
              <div className="fx-card divide-y divide-[#EEEAE1]">
                {records.map(r => {
                  const period = r.cycle ? formatPeriod(r.cycle.period_month, r.cycle.period_year) : 'Salary'
                  const st = STATUS[r.status] ?? STATUS.draft
                  return (
                    <button key={r.id} onClick={() => openSlip(r)} disabled={busy === r.id}
                      className="w-full flex flex-wrap items-center gap-x-3 gap-y-1 px-3.5 py-2.5 text-left hover:bg-[#FAF7F0] transition-colors disabled:opacity-50">
                      <span className="flex-1 min-w-[8rem]">
                        <span className="block text-[13.5px] font-semibold text-slate-900 break-words">{period}</span>
                        <span className="block text-[12px] text-slate-500 tabular-nums">Net pay {formatINR(salaryNet(r))}</span>
                      </span>
                      <Chip tone={st.tone}>{st.label}</Chip>
                      {busy === r.id
                        ? <Loader2 size={16} className="animate-spin text-[#8B6F47] flex-shrink-0" />
                        : <Download size={16} className="text-[#8B6F47] flex-shrink-0" />}
                    </button>
                  )
                })}
              </div>
            )}
          </>
        ) : (
          /* ── Document buttons ── */
          <>
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <p className={SX.heading}>Documents</p>
              {availableYears.length > 0 && (
                <label className="inline-flex items-center gap-2">
                  <span className="text-[12px] text-slate-500">Year</span>
                  <select value={selectedYear} onChange={e => setSelectedYear(Number(e.target.value))}
                    className={`${SX.field} !w-auto !h-8 cursor-pointer`}>
                    {availableYears.map(y => <option key={y} value={y}>{y}</option>)}
                  </select>
                </label>
              )}
            </div>
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-10 text-slate-400">
                <Loader2 size={18} className="animate-spin" />
                <span className="text-[13px]">Loading…</span>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {DOCS.map(doc => (
                  <button
                    key={doc.key}
                    onClick={doc.onClick}
                    disabled={busy === doc.key || doc.disabled}
                    className={SX.tile}
                  >
                    <span className="text-[#8B6F47]">{busy === doc.key ? <Loader2 size={20} className="animate-spin" /> : doc.icon}</span>
                    <span className="text-[13px] font-semibold text-slate-900 leading-snug">{busy === doc.key ? 'Building…' : doc.label}</span>
                    <span className="text-[11.5px] text-slate-500 leading-snug">{doc.sub}</span>
                  </button>
                ))}
              </div>
            )}
            {!loading && records.length === 0 && (
              <p className="text-[12.5px] text-slate-500 mt-3 leading-snug">
                These open up once the office runs the first pay cycle.
              </p>
            )}
          </>
        )}
      </ModalShell>

      <AnimatePresence>
        {preview && (
          <StatementPreviewModal spec={preview.spec} title={preview.title} onClose={() => setPreview(null)} />
        )}
      </AnimatePresence>
    </>
  )
}
