'use client'

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import { AnimatePresence } from 'framer-motion'
import { Banknote, Wallet, Download, FileText, Loader2, ShieldCheck } from 'lucide-react'
import PageBanner from '@/components/PageBanner'
import { formatINR } from '@/components/bus/FeeCollectionSummary'
import { compactINR } from '@/components/salary/SalarySummary'
import {
  Btn, Chip, Deck, LABEL, MonthStepper, Panel, PanelHead, SHELL, StatTile,
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

const ROW = 'flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 px-3.5 py-2 border-b border-[#F0ECE3] last:border-b-0'

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
        title="My salary"
        subtitle="Payslips, deductions and the year so far"
        maxWidth="max-w-7xl 2xl:max-w-[1600px]"
        backgroundIcon={<Wallet size={150} className="text-white" />}
        actions={
          <button
            onClick={() => setShowDocs(true)}
            className="inline-flex items-center justify-center gap-1.5 h-[30px] px-3 rounded-full bg-white text-slate-900 text-[12px] font-semibold ring-1 ring-black/5 shadow-[0_6px_16px_-8px_rgba(15,23,42,.55)] hover:bg-slate-50 active:scale-[0.97] transition"
          >
            <Download size={13} className="text-[#8B6F47]" /> Documents
          </button>
        }
      />

      <div className={`${SHELL} relative z-10 px-4 sm:px-6 lg:px-8 pt-4 pb-14`}>
        {loading ? (
          <SalarySkeleton />
        ) : error ? (
          <Panel bleed className="px-4 py-8 text-center">
            <p className="text-[14px] font-semibold text-[#A93232] mb-1">Your payslips did not load.</p>
            <p className="text-[12.5px] text-slate-500 max-w-md mx-auto break-words">{error}</p>
            <Btn tone="ghost" onClick={load} className="mt-3">Try again</Btn>
          </Panel>
        ) : slips.length === 0 ? (
          <Panel bleed className="px-6 py-10 text-center">
            <div className="icon-chip w-12 h-12 mx-auto mb-3" style={{ background: 'linear-gradient(135deg, #3D3B40, #8B6F47)' }}>
              <Banknote size={22} className="relative z-10 text-white" strokeWidth={1.8} />
            </div>
            <h2 className="text-[15px] font-semibold text-slate-900 mb-1">No payslips yet</h2>
            <p className="text-[13px] text-slate-500 max-w-sm mx-auto leading-relaxed">
              Your salary shows here once the office runs a pay cycle.
            </p>
          </Panel>
        ) : (
          <div className="space-y-4">
            {/* The one control that says which month everything below belongs to. */}
            <Deck>
              <MonthStepper
                className="px-1 pb-2.5"
                label={period}
                sub={slip ? (slip.locked ? 'Final' : 'Provisional') : undefined}
                onPrev={() => setIndex(i => Math.min(slips.length - 1, i + 1))}
                onNext={() => setIndex(i => Math.max(0, i - 1))}
                canPrev={index < slips.length - 1}
                canNext={index > 0}
                right={slip && <Chip tone={STATUS_TONE[slip.status]}>{STATUS_LABEL[slip.status]}</Chip>}
              />

              {slip && (
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
                  <StatTile
                    label="Net pay" shade={0}
                    value={formatINR(slip.net)}
                    sub={older ? `Compared with ${formatPeriod(older.month, older.year)}` : 'Take-home'}
                    percent={older ? percentChange(slip.net, older.net) : null}
                    goodWhenUp
                  />
                  <StatTile
                    label="Gross earnings" shade={1}
                    value={formatINR(slip.gross)}
                    sub={slip.bonus ? `Includes ${compactINR(slip.bonus)} task bonus` : 'Base and additions'}
                  />
                  <StatTile
                    label="Deductions" shade={2}
                    value={formatINR(slip.totalDeductions)}
                    sub={slip.deductions.length
                      ? slip.deductions.map(d => d.label.replace('Loss of pay', 'LOP')).join(' · ')
                      : 'Nothing held back'}
                  />
                  <StatTile
                    label={financialYearLabel(fy.start)} shade={3}
                    value={compactINR(fy.net)}
                    sub={`Net over ${fy.months} payslip${fy.months === 1 ? '' : 's'}`}
                  />
                </div>
              )}
            </Deck>

            {/* Both columns are the same height at desktop: the grid stretches
                them to the taller one, and inside each the list that can afford
                to scroll (the payslip history) absorbs the slack. */}
            <div className="grid lg:grid-cols-[minmax(0,1.62fr)_minmax(0,1fr)] gap-4 items-stretch">
              {/* Breakdown — names its own month, so it is readable on its own. */}
              {slip && (
                <Panel bleed className="lg:flex lg:flex-col lg:min-h-0">
                  <PanelHead
                    title={`Payslip for ${period}`}
                    right={
                      <Btn tone="ghost" onClick={openSlip} disabled={slipBusy}>
                        {slipBusy ? <Loader2 size={13} className="animate-spin" /> : <FileText size={13} />}
                        {slipBusy ? 'Building' : 'PDF'}
                      </Btn>
                    }
                  />

                  <SubHead>Earnings</SubHead>
                  {slip.earnings.map((l, i) => (
                    <Line key={`e-${i}`} label={l.label} amount={formatINR(l.amount)} />
                  ))}
                  <Total label="Gross earnings" amount={formatINR(slip.gross)} />

                  <SubHead>Deductions</SubHead>
                  {slip.deductions.length === 0 ? (
                    <p className="px-3.5 py-2 text-[12.5px] text-slate-500">Nothing held back this month.</p>
                  ) : slip.deductions.map((l, i) => (
                    <Line
                      key={`d-${i}`}
                      label={l.label}
                      note={DEDUCTION_NOTE[l.label]}
                      amount={`−${formatINR(l.amount)}`}
                    />
                  ))}
                  <Total label="Total deductions" amount={`−${formatINR(slip.totalDeductions)}`} accent />

                  <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3.5 py-3 border-t border-[#EEEAE1] bg-[#F7F5F0]">
                    <span className="text-[13px] font-semibold text-slate-700">Net pay for {period}</span>
                    <span className="text-[17px] font-bold text-slate-900 tabular-nums">{formatINR(slip.net)}</span>
                  </div>

                  {!slip.locked && (
                    <p className="px-3.5 py-2.5 text-[12px] leading-snug text-[#6E5513] bg-[#FBF4E2] border-t border-[#EADBB0]">
                      Provisional. {period} is still open, so figures that depend on attendance can change until the office locks it.
                    </p>
                  )}
                  {slip.status === 'paid' && slip.payoutReference && (
                    <p className="px-3.5 py-2.5 text-[12px] text-[#1F6B42] flex items-start gap-1.5 border-t border-[#EEEAE1] break-all">
                      <ShieldCheck size={13} className="flex-shrink-0 mt-px" /> Paid · ref {slip.payoutReference}
                    </p>
                  )}
                  {slip.notes && (
                    <p className="px-3.5 py-2.5 text-[12px] text-slate-500 italic border-t border-[#EEEAE1] break-words">{slip.notes}</p>
                  )}

                  {/* Takes whatever height the taller column has left over, so the
                      two end level without a hole opening up mid-payslip. */}
                  <div className="hidden lg:block lg:flex-1" />
                </Panel>
              )}

              <div className="flex flex-col gap-4 lg:min-h-0">
                {/* Every payslip, so a month is one tap away and the year reads at a glance. */}
                <Panel bleed className="lg:flex-1 lg:flex lg:flex-col lg:min-h-0">
                  <PanelHead title={`${financialYearLabel(fy.start)} · ${fy.paid} of ${fy.months} paid`} />
                  <div className="grid grid-cols-3 border-b border-[#EEEAE1] divide-x divide-[#EEEAE1]">
                    <MiniStat label="Gross" value={compactINR(fy.gross)} />
                    <MiniStat label="Deducted" value={compactINR(fy.deductions)} />
                    <MiniStat label="Net" value={compactINR(fy.net)} />
                  </div>
                  <div className="lg:flex-1 lg:min-h-0 lg:overflow-y-auto">
                  {slips.map((s, i) => (
                    <button
                      key={s.recordId}
                      onClick={() => setIndex(i)}
                      aria-pressed={i === index}
                      className={`relative w-full flex flex-wrap items-center gap-x-2 gap-y-1 px-3.5 py-2.5 border-b border-[#F0ECE3] last:border-b-0 text-left transition-colors ${
                        i === index ? 'bg-[#F7F2E4]' : 'hover:bg-[#FAF7F0]'
                      }`}
                    >
                      <span className="absolute left-0 top-0 bottom-0 w-[3px]" style={{ background: i === index ? '#B8983C' : 'transparent' }} />
                      <span className="flex-1 min-w-[7rem] text-[13px] font-semibold text-slate-900 break-words">
                        {s.month ? formatPeriod(s.month, s.year) : 'Salary'}
                      </span>
                      <Chip tone={STATUS_TONE[s.status]}>{STATUS_LABEL[s.status]}</Chip>
                      <span className="text-[13px] font-semibold text-slate-900 tabular-nums min-w-[76px] text-right">
                        {formatINR(s.net)}
                      </span>
                    </button>
                  ))}
                  </div>
                </Panel>

                {/* What the office holds. Read-only — it is admin-managed. */}
                <Panel bleed className="lg:flex-shrink-0">
                  <PanelHead title="On file with the office" />
                  <div className={ROW}>
                    <span className="text-[12.5px] text-slate-600">Monthly base salary</span>
                    <span className="text-[12.5px] font-semibold text-slate-900 tabular-nums">
                      {base ? formatINR(Number(base.base_amount)) : '—'}
                    </span>
                  </div>
                  <div className={ROW}>
                    <span className="text-[12.5px] text-slate-600">Provident fund</span>
                    <span className="text-[12.5px] text-slate-900 tabular-nums text-right break-all">
                      {base?.pf_applicable
                        ? <>Enrolled{base.uan ? <span className="text-slate-500"> · UAN {base.uan}</span> : ''}</>
                        : <span className="text-slate-500">Not enrolled</span>}
                    </span>
                  </div>
                  <div className={ROW}>
                    <span className="text-[12.5px] text-slate-600">State insurance</span>
                    <span className="text-[12.5px] text-slate-900 tabular-nums text-right break-all">
                      {base?.esi_ip_number
                        ? <>Enrolled<span className="text-slate-500"> · IP {base.esi_ip_number}</span></>
                        : <span className="text-slate-500">Not enrolled</span>}
                    </span>
                  </div>
                  <div className="px-3.5 py-2.5 border-t border-[#F0ECE3]">
                    <span className={`${LABEL} block mb-1`}>Salary account</span>
                    {bank ? (
                      <div className="text-[12.5px] text-slate-900 leading-snug">
                        <p className="font-semibold break-words">{bank.account_holder_name}</p>
                        <p className="text-slate-500 tabular-nums text-[12px] mt-0.5 break-words">
                          {maskAccountNumber(bank.account_number)} · {bank.ifsc}
                          {bank.bank_name ? ` · ${bank.bank_name}` : ''}
                        </p>
                      </div>
                    ) : (
                      <p className="text-[12.5px] text-slate-500 leading-snug">
                        No account on file. Ask the office to add yours so your salary can be paid into it.
                      </p>
                    )}
                  </div>
                </Panel>
              </div>
            </div>
          </div>
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
      <span className="min-w-0 text-[12.5px] text-slate-700 break-words">
        {label}
        {note && <span className="text-slate-400"> · {note}</span>}
      </span>
      <span className="text-[12.5px] font-semibold text-slate-900 tabular-nums flex-shrink-0">{amount}</span>
    </div>
  )
}

function Total({ label, amount, accent }: { label: string; amount: string; accent?: boolean }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 px-3.5 py-2 border-y border-[#EEEAE1] bg-[#FBFAF6]">
      <span className="text-[12.5px] font-semibold text-slate-700">{label}</span>
      <span className={`text-[13px] font-bold tabular-nums flex-shrink-0 ${accent ? 'text-[#A93232]' : 'text-slate-900'}`}>
        {amount}
      </span>
    </div>
  )
}

function SubHead({ children }: { children: React.ReactNode }) {
  return (
    <p className={`${LABEL} px-3.5 pt-3 pb-1`}>{children}</p>
  )
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-3 py-2 min-w-0">
      <span className={`${LABEL} block`}>{label}</span>
      <span className="block text-[13.5px] font-bold text-slate-900 tabular-nums break-all mt-0.5">{value}</span>
    </div>
  )
}

/** Matches the real layout's shape so the page does not jump on load. */
function SalarySkeleton() {
  return (
    <div className="animate-pulse space-y-4">
      <div className="fx-deck fx-bleed p-3">
        <div className="h-10 w-48 rounded-full bg-white/70 mb-3" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
          {Array.from({ length: 4 }, (_, i) => <div key={i} className="h-[92px] fx-tile" />)}
        </div>
      </div>
      <div className="grid lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 h-[280px] fx-card" />
        <div className="h-[180px] fx-card" />
      </div>
    </div>
  )
}
