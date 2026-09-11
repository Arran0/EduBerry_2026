'use client'

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import { AnimatePresence } from 'framer-motion'
import { Banknote, Wallet, Download, FileText, Loader2, ShieldCheck } from 'lucide-react'
import PageBanner from '@/components/PageBanner'
import { formatINR } from '@/components/bus/FeeCollectionSummary'
import { compactINR } from '@/components/salary/SalarySummary'
import {
  Chip, LABEL, MonthStepper, Panel, PanelHead, SHADE, StatTile,
} from '@/components/salary/ui'
import { SALARY_BANNER_DEFAULT } from '@/lib/pageConfig'
import { useAuth } from '@/contexts/AuthContext'
import { useSchoolClock } from '@/hooks/useSchoolClock'
import { PAYROLL_ITEM_LABELS } from '@/lib/payroll'
import {
  SalaryRecord, SalaryStatus, StaffBankAccount, StaffSalaryBase,
  fetchSalaryForStaff, fetchMyBankAccount, fetchMyBaseSalary, formatPeriod, maskAccountNumber,
} from '@/lib/salary'
import { StaffPayslip, buildStaffPayslips, percentChange } from '@/lib/salaryStats'
import type { StatementSpec } from '@/components/salary/statements/generate'

const SalaryStatementsModal = dynamic(() => import('@/components/salary/SalaryStatementsModal'))
const StatementPreviewModal = dynamic(() => import('@/components/salary/statements/StatementPreviewModal'))

// ──────────────────────────────────────────────────────────────
// Employee salary view
//
// One month is on screen at a time and every figure on it belongs to that
// month — the stepper names it, the breakdown panel repeats it in its own
// header, and the year-to-date panel names the financial year instead so the
// two can never be mistaken for each other.
//
// Same sharp off-white language and the same width as the admin hub: on a
// desktop the old two-column-wide layout left half the screen empty, so the
// breakdown now sits beside the payslip history rather than above it.
// ──────────────────────────────────────────────────────────────

const STATUS_LABEL: Record<SalaryStatus, string> = {
  draft: 'In progress',
  approved: 'Approved',
  paid: 'Paid',
}

const STATUS_TONE: Record<SalaryStatus, 'neutral' | 'gold' | 'good'> = {
  draft: 'neutral',
  approved: 'gold',
  paid: 'good',
}

const ROW = 'flex items-center justify-between gap-3 px-3 py-[6px] border-b border-[#F0ECE2] last:border-b-0'

/** The Indian financial year (April–March) a period falls in, as its starting year. */
function financialYearOf(year: number, month: number): number {
  return month >= 4 ? year : year - 1
}

function financialYearLabel(start: number): string {
  return `FY ${start}–${String(start + 1).slice(2)}`
}

export default function StaffSalaryView() {
  const { profile, dataRefreshKey } = useAuth()
  const { today } = useSchoolClock()
  const [loading, setLoading] = useState(true)
  const [slips, setSlips] = useState<StaffPayslip[]>([])
  const [bank, setBank] = useState<StaffBankAccount | null>(null)
  const [base, setBase] = useState<StaffSalaryBase | null>(null)
  const [index, setIndex] = useState(0)
  const [showDocs, setShowDocs] = useState(false)
  const [slipBusy, setSlipBusy] = useState(false)
  const [preview, setPreview] = useState<{ spec: StatementSpec; title: string } | null>(null)
  const [records, setRecords] = useState<SalaryRecord[]>([])
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!profile) return
    setLoading(true)
    setError(null)
    try {
      const [recs, acc, baseSalary] = await Promise.all([
        fetchSalaryForStaff(profile.id),
        fetchMyBankAccount(profile.id),
        fetchMyBaseSalary(profile.id),
      ])
      // The payslips are only worth showing once they carry the same PF, ESI
      // and loss of pay the office sees, so they are built before anything
      // renders.
      const built = await buildStaffPayslips(profile.id, recs, baseSalary, today)
      setRecords(recs)
      setBank(acc)
      setBase(baseSalary)
      setSlips(built)
      setIndex(0)
    } catch (e) {
      // Better an explanation than an empty page that reads as "you have no
      // payslips".
      console.error('staff salary load failed:', e)
      setError(e instanceof Error ? e.message : 'Could not load your payslips.')
    }
    setLoading(false)
  }, [profile, today])

  useEffect(() => { load() }, [load, dataRefreshKey])

  // `slips` is newest-first, so a higher index is an older month.
  const slip = slips[index] ?? null
  const older = slips[index + 1] ?? null

  const period = slip && slip.month
    ? formatPeriod(slip.month, slip.year)
    : 'Salary'

  // Year to date, over the financial year the *selected* slip sits in — so
  // stepping back to an old payslip shows the year it belonged to, not this one.
  const fy = useMemo(() => {
    const anchor = slip?.month
      ? { year: slip.year, month: slip.month }
      : { year: new Date().getFullYear(), month: new Date().getMonth() + 1 }
    const start = financialYearOf(anchor.year, anchor.month)
    const inYear = slips.filter(s => s.month && financialYearOf(s.year, s.month) === start)
    return {
      start,
      months: inYear.length,
      gross: inYear.reduce((t, s) => t + s.gross, 0),
      deductions: inYear.reduce((t, s) => t + s.totalDeductions, 0),
      net: inYear.reduce((t, s) => t + s.net, 0),
      paid: inYear.filter(s => s.status === 'paid').length,
    }
  }, [slips, slip])

  const openSlip = async () => {
    const record = records.find(r => r.id === slip?.recordId)
    if (!record || !profile || slipBusy) return
    setSlipBusy(true)
    try {
      const { buildPayslip } = await import('@/components/salary/statements/generate')
      const staffLike = { full_name: profile.full_name, email: profile.email, role: profile.role }
      setPreview({ spec: await buildPayslip(record, staffLike, bank), title: `Salary Slip — ${period}` })
    } catch (e) {
      console.error('payslip generation failed:', e)
    }
    setSlipBusy(false)
  }

  return (
    <>
      <PageBanner
        settingKey="salary_banner"
        defaultBanner={SALARY_BANNER_DEFAULT}
        icon={<Banknote size={26} className="text-white" />}
        title="My Salary"
        subtitle="Payslips, deductions & year to date"
        maxWidth="max-w-7xl"
        backgroundIcon={<Wallet size={150} className="text-white" />}
        actions={
          <button
            onClick={() => setShowDocs(true)}
            className="inline-flex items-center gap-2 bg-white/20 border border-white/30 backdrop-blur-sm px-3 py-2 text-[11px] font-bold uppercase tracking-[0.08em] text-white hover:bg-white/30 transition-colors"
          >
            <Download size={13} /> Documents
          </button>
        }
      />

      {/* The stepper starts below the banner rather than tucked up into it: a
          control straddling the banner's bottom edge reads as having slipped
          out of place, and half of it loses contrast against the image. */}
      <div className="relative z-10 max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 pt-4 pb-10">
        {loading ? (
          <SalarySkeleton />
        ) : error ? (
          <Panel bleed className="px-4 py-6 text-center">
            <p className="text-[13px] font-semibold text-[#A93232] mb-1">Your payslips did not load.</p>
            <p className="text-[12px] text-[#8C8878] max-w-md mx-auto">{error}</p>
            <button onClick={load} className="mt-3 inline-flex items-center gap-1.5 border border-[#E3DFD3] px-2.5 py-[7px] text-[10.5px] font-bold uppercase tracking-[0.08em] text-[#52525B] hover:text-[#18181B]">
              Try again
            </button>
          </Panel>
        ) : slips.length === 0 ? (
          <Panel bleed className="px-6 py-10 text-center">
            <div className="w-12 h-12 mx-auto mb-3 bg-[#27272A] flex items-center justify-center">
              <Banknote size={22} className="text-[#B8983C]" strokeWidth={1.6} />
            </div>
            <h2 className="text-[13px] font-bold uppercase tracking-[0.08em] text-[#18181B] mb-1">No payslips yet</h2>
            <p className="text-[12.5px] text-[#8C8878] max-w-sm mx-auto">
              Your monthly salary appears here once the office runs a pay cycle.
            </p>
          </Panel>
        ) : (
          <>
            {/* The one control that says which month everything below belongs to. */}
            <MonthStepper
              className="mb-1.5"
              label={period}
              sub={slip && <span className="hidden sm:inline">{slip.locked ? 'final' : 'provisional'}</span>}
              onPrev={() => setIndex(i => Math.min(slips.length - 1, i + 1))}
              onNext={() => setIndex(i => Math.max(0, i - 1))}
              canPrev={index < slips.length - 1}
              canNext={index > 0}
              right={slip && <Chip tone={STATUS_TONE[slip.status]}>{STATUS_LABEL[slip.status]}</Chip>}
            />

            {slip && (
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-1.5 mb-1.5">
                <StatTile
                  label="Net pay" shade={0}
                  value={formatINR(slip.net)}
                  sub={older ? `vs ${formatPeriod(older.month, older.year)}` : 'take-home'}
                  percent={older ? percentChange(slip.net, older.net) : null}
                  goodWhenUp
                />
                <StatTile
                  label="Gross earnings" shade={1}
                  value={formatINR(slip.gross)}
                  sub={slip.bonus ? `incl. ${compactINR(slip.bonus)} task bonus` : 'base & additions'}
                />
                <StatTile
                  label="Deductions" shade={2}
                  value={formatINR(slip.totalDeductions)}
                  sub={slip.deductions.length
                    ? slip.deductions.map(d => d.label.replace('Loss of pay', 'LOP')).join(' · ')
                    : 'nothing withheld'}
                />
                <StatTile
                  label={financialYearLabel(fy.start)} shade={3}
                  value={compactINR(fy.net)}
                  sub={`net over ${fy.months} payslip${fy.months === 1 ? '' : 's'}`}
                />
              </div>
            )}

            {/* Both columns are the same height at desktop: the grid stretches
                them to the taller one, and inside each the list that can afford
                to scroll (the deduction lines, the payslip history) absorbs the
                slack, so neither column ends in dead space. */}
            <div className="grid lg:grid-cols-[minmax(0,1.62fr)_minmax(0,1fr)] gap-1.5 items-stretch">
              {/* Breakdown — names its own month, so it is readable on its own. */}
              {slip && (
                <Panel bleed className="lg:flex lg:flex-col lg:min-h-0">
                  <PanelHead
                    title={`Payslip · ${period}`}
                    right={
                      <button
                        onClick={openSlip}
                        disabled={slipBusy}
                        className="inline-flex items-center gap-1 text-[9.5px] font-bold uppercase tracking-[0.1em] text-[#D8BC6A] hover:text-white transition-colors disabled:opacity-40"
                      >
                        {slipBusy ? <Loader2 size={11} className="animate-spin" /> : <FileText size={11} />}
                        {slipBusy ? 'Building' : 'PDF'}
                      </button>
                    }
                  />

                  <SubHead>Earnings</SubHead>
                  {slip.earnings.map((l, i) => (
                    <Line key={`e-${i}`} label={l.label} amount={formatINR(l.amount)} />
                  ))}
                  <Total label="Gross earnings" amount={formatINR(slip.gross)} />

                  <SubHead>Deductions</SubHead>
                  {slip.deductions.length === 0 ? (
                    <p className="px-3 py-[6px] text-[12px] text-[#A8A395]">Nothing withheld this month.</p>
                  ) : slip.deductions.map((l, i) => (
                    <Line
                      key={`d-${i}`}
                      label={l.label}
                      note={DEDUCTION_NOTE[l.label]}
                      amount={`−${formatINR(l.amount)}`}
                    />
                  ))}
                  <Total label="Total deductions" amount={`−${formatINR(slip.totalDeductions)}`} accent />

                  <div className="flex items-center justify-between gap-3 px-3 py-2.5 border-t border-[#E3DFD3]" style={{ background: SHADE[1] }}>
                    <span className={LABEL}>Net pay · {period}</span>
                    <span className="text-[15px] font-bold text-[#18181B] tabular-nums">{formatINR(slip.net)}</span>
                  </div>

                  {!slip.locked && (
                    <p className="px-3 py-2 text-[11px] text-[#7A6220] bg-[#FAF3DF] border-t border-[#E7D9AE]">
                      Provisional — {period} is still open, so attendance-based figures can change until the office locks it.
                    </p>
                  )}
                  {slip.status === 'paid' && slip.payoutReference && (
                    <p className="px-3 py-2 text-[11px] text-[#1F6B42] flex items-center gap-1 border-t border-[#F0ECE2]">
                      <ShieldCheck size={12} className="flex-shrink-0" /> Disbursed · ref {slip.payoutReference}
                    </p>
                  )}
                  {slip.notes && (
                    <p className="px-3 py-2 text-[11px] text-[#8C8878] italic border-t border-[#F0ECE2]">{slip.notes}</p>
                  )}

                  {/* Takes whatever height the taller column has left over, so the
                      two end level without a hole opening up mid-payslip. */}
                  <div className="hidden lg:block lg:flex-1" />
                </Panel>
              )}

              <div className="flex flex-col gap-1.5 lg:min-h-0">
                {/* Every payslip, so a month is one tap away and the year reads at a glance. */}
                <Panel bleed className="lg:flex-1 lg:flex lg:flex-col lg:min-h-0">
                  <PanelHead title={`${financialYearLabel(fy.start)} · ${fy.paid}/${fy.months} paid`} />
                  <div className="grid grid-cols-3 border-b border-[#E3DFD3]">
                    <MiniStat label="Gross" value={compactINR(fy.gross)} />
                    <MiniStat label="Deducted" value={compactINR(fy.deductions)} border />
                    <MiniStat label="Net" value={compactINR(fy.net)} border />
                  </div>
                  <div className="lg:flex-1 lg:min-h-0 lg:overflow-y-auto">
                  {slips.map((s, i) => (
                    <button
                      key={s.recordId}
                      onClick={() => setIndex(i)}
                      className={`w-full flex items-center gap-2 px-3 py-[6px] border-b border-[#F0ECE2] last:border-b-0 text-left transition-colors ${
                        i === index ? 'bg-[#F4F1E7]' : 'hover:bg-[#FAF8F2]'
                      }`}
                    >
                      <span
                        className="w-[3px] self-stretch flex-shrink-0 -my-[6px]"
                        style={{ background: i === index ? '#B8983C' : 'transparent' }}
                      />
                      <span className="flex-1 min-w-0 text-[11.5px] font-semibold text-[#18181B] truncate">
                        {s.month ? formatPeriod(s.month, s.year) : 'Salary'}
                      </span>
                      <Chip tone={STATUS_TONE[s.status]}>{STATUS_LABEL[s.status]}</Chip>
                      <span className="text-[11.5px] font-semibold text-[#18181B] tabular-nums w-[68px] text-right">
                        {formatINR(s.net)}
                      </span>
                    </button>
                  ))}
                  </div>
                </Panel>

                {/* What the office holds. Read-only — it is admin-managed. */}
                <Panel bleed className="lg:flex-shrink-0">
                  <PanelHead title="On file" />
                  <div className={ROW}>
                    <span className="text-[12px] text-[#6B675A]">Monthly base salary</span>
                    <span className="text-[12px] font-semibold text-[#18181B] tabular-nums">
                      {base ? formatINR(Number(base.base_amount)) : '—'}
                    </span>
                  </div>
                  <div className={ROW}>
                    <span className="text-[12px] text-[#6B675A]">Provident fund</span>
                    <span className="text-[12px] text-[#18181B] tabular-nums text-right">
                      {base?.pf_applicable
                        ? <>Enrolled{base.uan ? <span className="text-[#A8A395]"> · UAN {base.uan}</span> : ''}</>
                        : <span className="text-[#A8A395]">Not enrolled</span>}
                    </span>
                  </div>
                  <div className={ROW}>
                    <span className="text-[12px] text-[#6B675A]">State insurance</span>
                    <span className="text-[12px] text-[#18181B] tabular-nums text-right">
                      {base?.esi_ip_number
                        ? <>Enrolled<span className="text-[#A8A395]"> · IP {base.esi_ip_number}</span></>
                        : <span className="text-[#A8A395]">Not enrolled</span>}
                    </span>
                  </div>
                  <div className="px-3 py-2 border-t border-[#F0ECE2]">
                    <span className={`${LABEL} block mb-1`}>Salary account</span>
                    {bank ? (
                      <div className="text-[12px] text-[#27272A] leading-tight">
                        <p className="font-semibold">{bank.account_holder_name}</p>
                        <p className="text-[#8C8878] tabular-nums text-[11px] mt-0.5">
                          {maskAccountNumber(bank.account_number)} · {bank.ifsc}
                          {bank.bank_name ? ` · ${bank.bank_name}` : ''}
                        </p>
                      </div>
                    ) : (
                      <p className="text-[11.5px] text-[#A8A395]">
                        No account on record. Contact the office to add your details for salary disbursement.
                      </p>
                    )}
                  </div>
                </Panel>
              </div>
            </div>
          </>
        )}
      </div>

      <AnimatePresence>
        {showDocs && profile && (
          <SalaryStatementsModal key="salary-statements" staff={profile} onClose={() => setShowDocs(false)} />
        )}
        {preview && (
          <StatementPreviewModal key="statement-preview" spec={preview.spec} title={preview.title} onClose={() => setPreview(null)} />
        )}
      </AnimatePresence>
    </>
  )
}

/** Plain-English gloss for the statutory line items, which are initialisms. */
const DEDUCTION_NOTE: Record<string, string> = {
  [PAYROLL_ITEM_LABELS.pf]: 'provident fund',
  [PAYROLL_ITEM_LABELS.esi]: 'state insurance',
  'Loss of pay': 'unpaid days',
}

function Line({ label, note, amount }: { label: string; note?: string; amount: string }) {
  return (
    <div className={ROW}>
      <span className="text-[12px] text-[#52525B] truncate">
        {label}
        {note && <span className="text-[#A8A395]"> · {note}</span>}
      </span>
      <span className="text-[12px] font-semibold text-[#18181B] tabular-nums flex-shrink-0">{amount}</span>
    </div>
  )
}

function Total({ label, amount, accent }: { label: string; amount: string; accent?: boolean }) {
  return (
    <div
      className="flex items-center justify-between gap-3 px-3 py-[6px] border-y border-[#E3DFD3]"
      style={{ background: SHADE[2] }}
    >
      <span className={`${LABEL} truncate`}>{label}</span>
      <span className={`text-[12px] font-bold tabular-nums flex-shrink-0 ${accent ? 'text-[#A93232]' : 'text-[#18181B]'}`}>
        {amount}
      </span>
    </div>
  )
}

function SubHead({ children }: { children: React.ReactNode }) {
  return (
    <p className={`${LABEL} px-3 py-1 border-b border-[#F0ECE2]`} style={{ background: SHADE[3] }}>
      {children}
    </p>
  )
}

function MiniStat({ label, value, border }: { label: string; value: string; border?: boolean }) {
  return (
    <div className={`px-2.5 py-1.5 min-w-0 ${border ? 'border-l border-[#F0ECE2]' : ''}`}>
      <span className={`${LABEL} block truncate`}>{label}</span>
      <span className="block text-[12.5px] font-bold text-[#18181B] tabular-nums truncate mt-0.5">{value}</span>
    </div>
  )
}

/** Matches the real layout's shape so the page does not jump on load. */
function SalarySkeleton() {
  return (
    <div className="animate-pulse">
      <div className="h-[34px] bg-white border border-[#E3DFD3] mb-1.5" />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-1.5 mb-1.5">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="h-[68px] border border-[#E3DFD3]" style={{ background: SHADE[i as 0 | 1 | 2 | 3] }} />
        ))}
      </div>
      <div className="grid lg:grid-cols-3 gap-1.5">
        <div className="lg:col-span-2 h-[280px] bg-white border border-[#E3DFD3]" />
        <div className="h-[180px] bg-white border border-[#E3DFD3]" />
      </div>
    </div>
  )
}
