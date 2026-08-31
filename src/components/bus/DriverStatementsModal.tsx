'use client'

import React, { useEffect, useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import dynamic from 'next/dynamic'
import {
  X, Receipt, FileSpreadsheet, ScrollText, BadgeCheck, FileText, Loader2,
  ChevronLeft, Download, Banknote,
} from 'lucide-react'
import Avatar from '@/components/Avatar'
import { UserProfile, getDisplayRole } from '@/lib/supabase'
import {
  DriverSalaryRecord, driverSalaryNet, formatPeriod,
  fetchSalaryForDriver, fetchDriverBaseSalaries,
} from '@/lib/driverSalary'
import { DriverBankAccount, fetchMyDriverBankAccount } from '@/lib/bus'
import { SalaryRecord, SalaryCycle, StaffBankAccount } from '@/lib/salary'
import { formatINR } from '@/components/bus/FeeCollectionSummary'
import {
  StatementSpec, buildPayslip, buildSalaryLedger, buildSalaryPaymentStatement,
  buildSalaryCertificate, buildForm16,
} from '@/components/salary/statements/generate'

const StatementPreviewModal = dynamic(() => import('@/components/salary/statements/StatementPreviewModal'))

interface Props {
  driver: UserProfile
  onClose: () => void
}

const STATUS_CHIP: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-500',
  approved: 'bg-blue-100 text-blue-700',
  paid: 'bg-emerald-100 text-emerald-700',
}

// Driver records/banks mirror the staff salary shapes; mapping them lets drivers
// reuse the staff salary statement builders (payslip / register / certificate / etc.).
function toSalaryRecord(r: DriverSalaryRecord): SalaryRecord {
  return {
    id: r.id, cycle_id: r.cycle_id, staff_id: r.driver_id,
    base_amount: r.base_amount, status: r.status,
    payout_status: r.payout_status, payout_reference: r.payout_reference,
    notes: r.notes, created_at: r.created_at, updated_at: r.updated_at,
    working_days_override: r.working_days_override,
    leave_override: r.leave_override,
    late_override: r.late_override,
    half_day_override: r.half_day_override,
    pf_amount_override: r.pf_amount_override,
    esi_amount_override: r.esi_amount_override,
    items: r.items, cycle: (r.cycle as unknown as SalaryCycle) ?? null,
  }
}

/** Driver "Download Centre" — salary documents popup for a single driver.
 *  Mirrors the staff SalaryStatementsModal so both surfaces feel like one product. */
export default function DriverStatementsModal({ driver, onClose }: Props) {
  const [records, setRecords] = useState<DriverSalaryRecord[]>([])
  const [bank, setBank] = useState<DriverBankAccount | null>(null)
  const [baseAmount, setBaseAmount] = useState<number | undefined>(undefined)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [preview, setPreview] = useState<{ spec: StatementSpec; title: string } | null>(null)
  const [slipMode, setSlipMode] = useState(false)

  useEffect(() => {
    setLoading(true)
    Promise.all([
      fetchSalaryForDriver(driver.id),
      fetchMyDriverBankAccount(driver.id),
      fetchDriverBaseSalaries(),
    ]).then(([recs, acc, bases]) => {
      setRecords(recs)
      setBank(acc)
      setBaseAmount(bases.find(b => b.driver_id === driver.id)?.base_amount)
      setLoading(false)
    })
  }, [driver.id])

  const salaryRecords = useMemo(() => records.map(toSalaryRecord), [records])
  const bankLike = bank ? ({ ...bank, staff_id: bank.driver_id } as unknown as StaffBankAccount) : null

  const availableYears = useMemo(() => {
    const years = new Set<number>()
    for (const r of records) if (r.cycle?.period_year) years.add(r.cycle.period_year)
    if (!years.size) years.add(new Date().getFullYear())
    return [...years].sort((a, b) => b - a)
  }, [records])

  const [selectedYear, setSelectedYear] = useState<number>(new Date().getFullYear())
  useEffect(() => { if (availableYears.length) setSelectedYear(availableYears[0]) }, [availableYears])

  const driverLike = { full_name: driver.full_name, email: driver.email, role: driver.role }

  const openPreview = async (key: string, title: string, builder: () => Promise<StatementSpec>) => {
    setBusy(key)
    try { setPreview({ spec: await builder(), title }) }
    catch (e) { console.error('driver statement generation failed:', e) }
    setBusy(null)
  }

  const openSlip = async (r: DriverSalaryRecord) => {
    const period = r.cycle ? formatPeriod(r.cycle.period_month, r.cycle.period_year) : 'Salary'
    setBusy(r.id)
    try { setPreview({ spec: await buildPayslip(toSalaryRecord(r), driverLike, bankLike), title: `Salary Slip — ${period}` }) }
    catch (e) { console.error('payslip generation failed:', e) }
    setBusy(null)
  }

  const DOCS = [
    {
      key: 'slip', label: 'Salary Slip', sub: 'Per month',
      icon: <Receipt size={15} />, disabled: records.length === 0,
      onClick: () => setSlipMode(true),
    },
    {
      key: 'register', label: 'Salary Register', sub: 'All months',
      icon: <FileSpreadsheet size={15} />, disabled: records.length === 0,
      onClick: () => openPreview('register', `Driver Salary Register · ${driver.full_name}`,
        () => buildSalaryLedger(driverLike, salaryRecords, 'Driver Salary Register')),
    },
    {
      key: 'payment', label: 'Payment Statement', sub: `FY ${selectedYear}`,
      icon: <ScrollText size={15} />, disabled: records.length === 0,
      onClick: () => openPreview('payment', `Salary Payment Statement · ${driver.full_name}`,
        () => buildSalaryPaymentStatement(driverLike, selectedYear, salaryRecords)),
    },
    {
      key: 'cert', label: 'Annual Certificate', sub: 'Salary',
      icon: <BadgeCheck size={15} />,
      onClick: () => openPreview('cert', `Annual Salary Certificate · ${driver.full_name}`,
        () => buildSalaryCertificate(driverLike, baseAmount)),
    },
    {
      key: 'form16', label: 'Form 16', sub: `FY ${selectedYear}`,
      icon: <FileText size={15} />, disabled: records.length === 0,
      onClick: () => openPreview('form16', `Form 16 · ${driver.full_name}`,
        () => buildForm16(driverLike, selectedYear, salaryRecords)),
    },
  ]

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4 bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 40, opacity: 0 }}
        transition={{ type: 'spring', damping: 25, stiffness: 300 }}
        className="bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl w-full sm:max-w-2xl max-h-[92dvh] sm:max-h-[88vh] overflow-hidden flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="w-10 h-1 bg-slate-200 rounded-full mx-auto mt-3 mb-1 sm:hidden" />
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#E4E4E7] flex-shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            {slipMode && (
              <button onClick={() => setSlipMode(false)} title="Back"
                className="p-1.5 -ml-1.5 text-[#A1A1AA] hover:text-[#27272A] hover:bg-[#F4F4F5] rounded-lg flex-shrink-0">
                <ChevronLeft size={18} />
              </button>
            )}
            <Avatar avatarUrl={driver.avatar_url} name={driver.full_name} size={36} userId={driver.id} />
            <div className="min-w-0">
              <p className="font-bold text-[#18181B] text-sm truncate">{driver.full_name}</p>
              <p className="text-[11px] text-[#71717A]">{getDisplayRole(driver)}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 text-[#A1A1AA] hover:text-[#27272A] hover:bg-[#F4F4F5] rounded-lg flex-shrink-0">
            <X size={16} />
          </button>
        </div>

        {slipMode ? (
          /* ── Salary slip picker ── */
          <div className="p-4 overflow-y-auto">
            <p className="text-[10px] font-bold uppercase tracking-widest text-[#71717A] mb-3">Salary Slips</p>
            {records.length === 0 ? (
              <div className="py-10 text-center">
                <Receipt size={28} className="mx-auto mb-3 text-[#D4D4D8]" />
                <p className="text-sm text-[#71717A]">No payslips yet.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {records.map(r => {
                  const period = r.cycle ? formatPeriod(r.cycle.period_month, r.cycle.period_year) : 'Salary'
                  return (
                    <button key={r.id} onClick={() => openSlip(r)} disabled={busy === r.id}
                      className="w-full flex items-center gap-3 p-3 rounded-xl border border-[#E4E4E7] bg-white hover:border-[#A8896B] hover:bg-[#FBFAF7] transition-all text-left disabled:opacity-50">
                      <div className="w-9 h-9 rounded-lg bg-[#27272A] flex items-center justify-center flex-shrink-0">
                        <Banknote size={16} className="text-[#B8983C]" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-[#18181B] truncate">{period}</p>
                        <p className="text-[11px] text-[#71717A] truncate">Net pay {formatINR(driverSalaryNet(r))}</p>
                      </div>
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${STATUS_CHIP[r.status] ?? 'bg-slate-100 text-slate-500'}`}>
                        {r.status[0].toUpperCase() + r.status.slice(1)}
                      </span>
                      {busy === r.id
                        ? <Loader2 size={16} className="animate-spin text-[#A8896B] flex-shrink-0" />
                        : <Download size={16} className="text-[#A8896B] flex-shrink-0" />}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        ) : (
          /* ── Document buttons ── */
          <div className="p-4 overflow-y-auto">
            <div className="flex items-center justify-between mb-3">
              <p className="text-[10px] font-bold uppercase tracking-widest text-[#71717A]">Salary Documents</p>
              {availableYears.length > 0 && (
                <select value={selectedYear} onChange={e => setSelectedYear(Number(e.target.value))}
                  className="text-[11px] text-[#52525B] bg-[#F4F4F5] border border-[#E4E4E7] rounded-lg px-2 py-1 focus:outline-none focus:border-[#27272A] cursor-pointer">
                  {availableYears.map(y => <option key={y} value={y}>{y}</option>)}
                </select>
              )}
            </div>
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-8 text-[#A1A1AA]">
                <Loader2 size={18} className="animate-spin" />
                <span className="text-sm">Loading…</span>
              </div>
            ) : (
              <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                {DOCS.map(doc => (
                  <button
                    key={doc.key}
                    onClick={doc.onClick}
                    disabled={busy === doc.key || doc.disabled}
                    className={`flex flex-col items-center justify-center gap-1 py-3 rounded-xl border transition-all ${
                      doc.disabled
                        ? 'bg-[#FAFAFA] border-[#E4E4E7] text-[#C4C4C8] cursor-not-allowed'
                        : 'bg-white border-[#E4E4E7] text-[#27272A] hover:border-[#A8896B] hover:bg-[#FBFAF7] hover:-translate-y-0.5 shadow-sm disabled:opacity-50'
                    }`}
                  >
                    <span className={doc.disabled ? 'text-[#C4C4C8]' : 'text-[#A8896B]'}>{doc.icon}</span>
                    <span className="text-[11px] font-semibold leading-tight text-center">{busy === doc.key ? '…' : doc.label}</span>
                    <span className={`text-[9px] font-normal leading-none ${doc.disabled ? 'text-[#D4D4D8]' : 'text-[#A1A1AA]'}`}>{doc.sub}</span>
                  </button>
                ))}
              </div>
            )}
            {!loading && records.length === 0 && (
              <p className="text-[11px] text-[#A1A1AA] mt-2.5">
                Salary documents unlock once the office runs the driver&apos;s first pay cycle.
              </p>
            )}
          </div>
        )}
      </motion.div>

      <AnimatePresence>
        {preview && (
          <StatementPreviewModal spec={preview.spec} title={preview.title} onClose={() => setPreview(null)} />
        )}
      </AnimatePresence>
    </motion.div>
  )
}
