'use client'

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import { AnimatePresence } from 'framer-motion'
import {
  Banknote, Wallet, Landmark, Download, ChevronLeft, ChevronRight, ChevronDown,
  ShieldCheck, FileText, Loader2,
} from 'lucide-react'
import PageBanner from '@/components/PageBanner'
import { formatINR } from '@/components/bus/FeeCollectionSummary'
import { ADMIN_GOLD, BLEED, RECORD_CHIP } from '@/components/salary/adminUi'
import { SALARY_BANNER_DEFAULT } from '@/lib/pageConfig'
import { useAuth } from '@/contexts/AuthContext'
import { PAYROLL_ITEM_LABELS } from '@/lib/payroll'
import {
  SalaryRecord, SalaryStatus, StaffBankAccount, StaffSalaryBase,
  fetchSalaryForStaff, fetchMyBankAccount, fetchMyBaseSalary, formatPeriod, maskAccountNumber,
} from '@/lib/salary'
import type { StatementSpec } from '@/components/salary/statements/generate'

const SalaryStatementsModal = dynamic(() => import('@/components/salary/SalaryStatementsModal'))
const StatementPreviewModal = dynamic(() => import('@/components/salary/statements/StatementPreviewModal'))

// ──────────────────────────────────────────────────────────────
// Employee salary view
//
// Built around the one question someone opens this page to answer — "what am I
// getting this month, and what came off it?" — then the supporting detail in
// decreasing order of how often it is wanted: the year so far, what's on file,
// and the back catalogue of slips.
//
// Sharp-edged panels that run the full width of a phone, matching the admin
// hub. No floating rounded cards: on a 360px screen the gutters they float in
// cost more than they buy.
// ──────────────────────────────────────────────────────────────

const STATUS_LABEL: Record<SalaryStatus, string> = {
  draft: 'In progress',
  approved: 'Approved',
  paid: 'Paid',
}

const ROW = 'flex items-center justify-between gap-3 px-4 py-2.5 border-b border-[#F4F4F5] last:border-b-0'

/** A sharp panel that reaches both screen edges on phones and becomes a card at `sm:`. */
function Panel({ title, action, children, className = '' }: {
  title?: string
  action?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <section className={`${BLEED} bg-white border-y border-[#E4E4E7] sm:border sm:rounded-xl overflow-hidden mb-3 ${className}`}>
      {title && (
        <header className="flex items-center justify-between gap-2 bg-[#27272A] px-4 py-2">
          <h2 className="text-[10px] font-bold uppercase tracking-widest text-[#A1A1AA]">{title}</h2>
          {action}
        </header>
      )}
      {children}
    </section>
  )
}

// ============================================
// Payslip maths
// ============================================

interface Line { label: string; amount: number }

interface Breakdown {
  earnings: Line[]
  deductions: Line[]
  gross: number
  totalDeductions: number
  net: number
}

/**
 * Splits a record into what was earned and what was withheld.
 *
 * Line items carry their sign — positive is an earning, negative a deduction —
 * so the payslip is read straight off them rather than re-derived, and always
 * agrees with the figures the office locked into the cycle.
 */
function breakdownOf(record: SalaryRecord): Breakdown {
  const base = Number(record.base_amount) || 0
  const earnings: Line[] = [{ label: 'Basic salary', amount: base }]
  const deductions: Line[] = []
  for (const item of record.items ?? []) {
    const amount = Number(item.amount) || 0
    if (amount >= 0) earnings.push({ label: item.label, amount })
    else deductions.push({ label: item.label, amount: -amount })
  }
  const gross = earnings.reduce((s, l) => s + l.amount, 0)
  const totalDeductions = deductions.reduce((s, l) => s + l.amount, 0)
  return { earnings, deductions, gross, totalDeductions, net: gross - totalDeductions }
}

/** The Indian financial year (April–March) a period falls in, as its starting year. */
function financialYearOf(year: number, month: number): number {
  return month >= 4 ? year : year - 1
}

function financialYearLabel(start: number): string {
  return `FY ${start}–${String(start + 1).slice(2)}`
}

// ============================================
// View
// ============================================

export default function StaffSalaryView({ onBack }: { onBack: () => void }) {
  const { profile, dataRefreshKey } = useAuth()
  const [loading, setLoading] = useState(true)
  const [records, setRecords] = useState<SalaryRecord[]>([])
  const [bank, setBank] = useState<StaffBankAccount | null>(null)
  const [base, setBase] = useState<StaffSalaryBase | null>(null)
  const [index, setIndex] = useState(0)
  const [showDocs, setShowDocs] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [slipBusy, setSlipBusy] = useState(false)
  const [preview, setPreview] = useState<{ spec: StatementSpec; title: string } | null>(null)

  const load = useCallback(async () => {
    if (!profile) return
    setLoading(true)
    const [recs, acc, baseSalary] = await Promise.all([
      fetchSalaryForStaff(profile.id),
      fetchMyBankAccount(profile.id),
      fetchMyBaseSalary(profile.id),
    ])
    setRecords(recs)
    setBank(acc)
    setBase(baseSalary)
    setIndex(0)
    setLoading(false)
  }, [profile])

  useEffect(() => { load() }, [load, dataRefreshKey])

  // `records` is newest-first, so a higher index is an older month.
  const selected = records[index] ?? null
  const breakdown = useMemo(() => (selected ? breakdownOf(selected) : null), [selected])

  const period = selected?.cycle
    ? formatPeriod(selected.cycle.period_month, selected.cycle.period_year)
    : 'Salary'

  // Year-to-date, over the financial year the *selected* slip sits in — so
  // stepping back to an old payslip shows the year it belonged to, not this one.
  const fy = useMemo(() => {
    const anchor = selected?.cycle
      ? { year: selected.cycle.period_year, month: selected.cycle.period_month }
      : { year: new Date().getFullYear(), month: new Date().getMonth() + 1 }
    const start = financialYearOf(anchor.year, anchor.month)
    const inYear = records.filter(r =>
      r.cycle && financialYearOf(r.cycle.period_year, r.cycle.period_month) === start)
    let gross = 0, deductions = 0, net = 0, paidMonths = 0
    for (const r of inYear) {
      const b = breakdownOf(r)
      gross += b.gross
      deductions += b.totalDeductions
      net += b.net
      if (r.status === 'paid') paidMonths += 1
    }
    return { start, months: inYear.length, gross, deductions, net, paidMonths }
  }, [records, selected])

  const openSlip = async () => {
    if (!selected || !profile || slipBusy) return
    setSlipBusy(true)
    try {
      const { buildPayslip } = await import('@/components/salary/statements/generate')
      const staffLike = { full_name: profile.full_name, email: profile.email, role: profile.role }
      setPreview({ spec: await buildPayslip(selected, staffLike, bank), title: `Salary Slip — ${period}` })
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
        onBack={onBack}
        maxWidth="max-w-2xl"
        backgroundIcon={<Wallet size={150} className="text-white" />}
        actions={
          <button
            onClick={() => setShowDocs(true)}
            className="inline-flex items-center gap-2 rounded-xl bg-white/20 border border-white/30 backdrop-blur-sm px-3 py-2.5 text-xs font-semibold text-white hover:bg-white/30 transition-colors"
          >
            <Download size={14} /> Download Centre
          </button>
        }
      />

      <div className="relative z-0 max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 -mt-8 pb-10">
        {loading ? (
          <SalarySkeleton />
        ) : records.length === 0 ? (
          <EmptyState />
        ) : (
          <>
            <PayslipHero
              record={selected!}
              breakdown={breakdown!}
              period={period}
              index={index}
              count={records.length}
              onStep={d => setIndex(i => Math.min(records.length - 1, Math.max(0, i + d)))}
            />

            {/* Earnings and deductions, exactly as the office locked them in. */}
            <Panel
              title="Payslip breakdown"
              action={
                <button
                  onClick={openSlip}
                  disabled={slipBusy}
                  className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-[#D8BC6A] hover:text-white transition-colors disabled:opacity-50"
                >
                  {slipBusy ? <Loader2 size={12} className="animate-spin" /> : <FileText size={12} />}
                  {slipBusy ? 'Building' : 'Slip'}
                </button>
              }
            >
              <SubHead>Earnings</SubHead>
              {breakdown!.earnings.map((l, i) => (
                <div key={`e-${i}`} className={ROW}>
                  <span className="text-[13px] text-[#52525B] truncate">{l.label}</span>
                  <span className="text-[13px] font-semibold text-[#18181B] tabular-nums flex-shrink-0">
                    {formatINR(l.amount)}
                  </span>
                </div>
              ))}
              <TotalRow label="Gross earnings" amount={breakdown!.gross} />

              {breakdown!.deductions.length > 0 && (
                <>
                  <SubHead>Deductions</SubHead>
                  {breakdown!.deductions.map((l, i) => (
                    <div key={`d-${i}`} className={ROW}>
                      <span className="text-[13px] text-[#52525B] truncate">
                        {l.label}
                        {l.label === PAYROLL_ITEM_LABELS.pf && (
                          <span className="text-[#A1A1AA]"> · provident fund</span>
                        )}
                        {l.label === PAYROLL_ITEM_LABELS.esi && (
                          <span className="text-[#A1A1AA]"> · state insurance</span>
                        )}
                      </span>
                      <span className="text-[13px] font-semibold text-rose-600 tabular-nums flex-shrink-0">
                        −{formatINR(l.amount)}
                      </span>
                    </div>
                  ))}
                  <TotalRow label="Total deductions" amount={breakdown!.totalDeductions} negative />
                </>
              )}

              <div className="flex items-center justify-between gap-3 bg-[#FAFAF8] border-t border-[#E4E4E7] px-4 py-3">
                <span className="text-[11px] font-bold uppercase tracking-widest text-[#71717A]">Net pay</span>
                <span className="text-base font-bold text-[#18181B] tabular-nums">{formatINR(breakdown!.net)}</span>
              </div>

              {selected!.notes && (
                <p className="px-4 py-2.5 text-[11px] text-[#A1A1AA] italic border-t border-[#F4F4F5]">
                  {selected!.notes}
                </p>
              )}
            </Panel>

            {/* Year to date */}
            <Panel title={`${financialYearLabel(fy.start)} · year to date`}>
              <div className="grid grid-cols-2 sm:grid-cols-4">
                <FyStat label="Gross earned" value={formatINR(fy.gross)} />
                <FyStat label="Deductions" value={formatINR(fy.deductions)} border />
                <FyStat label="Net paid" value={formatINR(fy.net)} topBorder />
                <FyStat
                  label="Payslips"
                  value={`${fy.paidMonths}/${fy.months}`}
                  sub={fy.paidMonths === fy.months ? 'all paid' : 'paid'}
                  border
                  topBorder
                />
              </div>
            </Panel>

            {/* What the office has on file. Read-only — it is admin-managed. */}
            <Panel title="Salary & bank details">
              <div className={ROW}>
                <span className="text-[13px] text-[#52525B]">Monthly base salary</span>
                <span className="text-[13px] font-semibold text-[#18181B] tabular-nums">
                  {base ? formatINR(Number(base.base_amount)) : '—'}
                </span>
              </div>
              <div className={ROW}>
                <span className="text-[13px] text-[#52525B]">Provident fund</span>
                <span className="text-[13px] text-[#18181B] tabular-nums text-right">
                  {base?.pf_applicable
                    ? <>Enrolled{base.uan ? <span className="text-[#A1A1AA]"> · UAN {base.uan}</span> : ''}</>
                    : <span className="text-[#A1A1AA]">Not enrolled</span>}
                </span>
              </div>
              <div className={ROW}>
                <span className="text-[13px] text-[#52525B]">State insurance (ESI)</span>
                <span className="text-[13px] text-[#18181B] tabular-nums text-right">
                  {base?.esi_ip_number
                    ? <>Enrolled<span className="text-[#A1A1AA]"> · IP {base.esi_ip_number}</span></>
                    : <span className="text-[#A1A1AA]">Not enrolled</span>}
                </span>
              </div>
              <div className="px-4 py-3 border-t border-[#F4F4F5]">
                <div className="flex items-center gap-1.5 mb-1">
                  <Landmark size={12} className="text-[#B8983C]" />
                  <span className="text-[10px] font-bold uppercase tracking-widest text-[#71717A]">
                    Salary account
                  </span>
                </div>
                {bank ? (
                  <div className="text-[13px] text-[#27272A]">
                    <p className="font-semibold">{bank.account_holder_name}</p>
                    <p className="text-[#71717A] tabular-nums text-xs mt-0.5">
                      {maskAccountNumber(bank.account_number)} · {bank.ifsc}
                      {bank.bank_name ? ` · ${bank.bank_name}` : ''}
                    </p>
                  </div>
                ) : (
                  <p className="text-xs text-[#A1A1AA]">
                    No account on record yet. Contact the office to add your details for salary disbursement.
                  </p>
                )}
              </div>
            </Panel>

            {/* The back catalogue, folded away — most visits never need it. */}
            {records.length > 1 && (
              <Panel>
                <button
                  onClick={() => setShowHistory(v => !v)}
                  className="w-full flex items-center justify-between gap-2 px-4 py-3 hover:bg-[#FAFAF8] transition-colors"
                >
                  <span className="text-[10px] font-bold uppercase tracking-widest text-[#71717A]">
                    All payslips · {records.length}
                  </span>
                  <ChevronDown
                    size={15}
                    className={`text-[#A1A1AA] transition-transform ${showHistory ? 'rotate-180' : ''}`}
                  />
                </button>
                {showHistory && (
                  <div className="border-t border-[#E4E4E7]">
                    {records.map((r, i) => {
                      const b = breakdownOf(r)
                      const active = i === index
                      return (
                        <button
                          key={r.id}
                          onClick={() => { setIndex(i); setShowHistory(false); window.scrollTo({ top: 0, behavior: 'smooth' }) }}
                          className={`w-full flex items-center gap-3 px-4 py-2.5 border-b border-[#F4F4F5] last:border-b-0 text-left transition-colors ${
                            active ? 'bg-[#FAF8F1]' : 'hover:bg-[#FAFAFA]'
                          }`}
                        >
                          <span className="w-1 self-stretch flex-shrink-0 -my-2.5" style={{ background: active ? ADMIN_GOLD : 'transparent' }} />
                          <span className="flex-1 min-w-0 text-[13px] font-semibold text-[#18181B] truncate">
                            {r.cycle ? formatPeriod(r.cycle.period_month, r.cycle.period_year) : 'Salary'}
                          </span>
                          <span className={`text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full flex-shrink-0 ${RECORD_CHIP[r.status]}`}>
                            {STATUS_LABEL[r.status]}
                          </span>
                          <span className="text-[13px] font-semibold text-[#18181B] tabular-nums flex-shrink-0 w-24 text-right">
                            {formatINR(b.net)}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                )}
              </Panel>
            )}
          </>
        )}
      </div>

      <AnimatePresence>
        {showDocs && profile && (
          <SalaryStatementsModal staff={profile} onClose={() => setShowDocs(false)} />
        )}
        {preview && (
          <StatementPreviewModal spec={preview.spec} title={preview.title} onClose={() => setPreview(null)} />
        )}
      </AnimatePresence>
    </>
  )
}

// ============================================
// Pieces
// ============================================

/**
 * The month being viewed, its net pay, and how it was reached — the whole
 * answer to "what am I getting", above the fold on a phone.
 */
function PayslipHero({ record, breakdown, period, index, count, onStep }: {
  record: SalaryRecord
  breakdown: Breakdown
  period: string
  index: number
  count: number
  onStep: (delta: number) => void
}) {
  return (
    <div className={`${BLEED} bg-[#27272A] sm:rounded-xl overflow-hidden shadow-lg mb-3`}>
      {/* Month stepper. Older months are further along the array, so "back" adds. */}
      <div className="flex items-center border-b border-white/10">
        <button
          type="button"
          onClick={() => onStep(1)}
          disabled={index >= count - 1}
          aria-label="Older payslip"
          className="px-3 py-2.5 text-[#A1A1AA] hover:text-white transition-colors disabled:opacity-25 disabled:hover:text-[#A1A1AA]"
        >
          <ChevronLeft size={16} />
        </button>
        <span className="flex-1 min-w-0 text-center text-xs sm:text-sm font-bold tracking-wide text-white truncate">
          {period}
        </span>
        <button
          type="button"
          onClick={() => onStep(-1)}
          disabled={index <= 0}
          aria-label="Newer payslip"
          className="px-3 py-2.5 text-[#A1A1AA] hover:text-white transition-colors disabled:opacity-25 disabled:hover:text-[#A1A1AA]"
        >
          <ChevronRight size={16} />
        </button>
      </div>

      <div className="px-4 pt-4 pb-3.5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-widest text-[#8A8A93]">Net pay</p>
            <p className="text-3xl font-bold text-white tabular-nums leading-tight mt-0.5">
              {formatINR(breakdown.net)}
            </p>
          </div>
          <span
            className={`text-[9px] font-bold uppercase tracking-widest px-2 py-1 rounded-full flex-shrink-0 mt-1 ${
              record.status === 'paid'
                ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                : record.status === 'approved'
                ? 'bg-[#B8983C]/15 text-[#D8BC6A] border border-[#B8983C]/40'
                : 'bg-white/10 text-[#A1A1AA] border border-white/15'
            }`}
          >
            {STATUS_LABEL[record.status]}
          </span>
        </div>

        {record.status === 'paid' && record.payout_reference && (
          <p className="text-[11px] text-emerald-300/80 mt-2 flex items-center gap-1 truncate">
            <ShieldCheck size={12} className="flex-shrink-0" /> Disbursed · ref {record.payout_reference}
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 border-t border-white/10">
        <HeroStat label="Gross earnings" value={formatINR(breakdown.gross)} />
        <HeroStat label="Deductions" value={`−${formatINR(breakdown.totalDeductions)}`} border />
      </div>
    </div>
  )
}

function HeroStat({ label, value, border }: { label: string; value: string; border?: boolean }) {
  return (
    <div className={`px-4 py-2.5 ${border ? 'border-l border-white/10' : ''}`}>
      <p className="text-[9.5px] font-bold uppercase tracking-widest text-[#71717A]">{label}</p>
      <p className="text-sm font-semibold text-white tabular-nums mt-0.5">{value}</p>
    </div>
  )
}

function FyStat({ label, value, sub, border, topBorder }: {
  label: string; value: string; sub?: string; border?: boolean; topBorder?: boolean
}) {
  return (
    <div className={`px-4 py-3 ${border ? 'border-l border-[#F0EFEA]' : ''} ${topBorder ? 'border-t border-[#F0EFEA] sm:border-t-0' : ''} sm:border-l sm:first:border-l-0`}>
      <p className="text-[9.5px] font-bold uppercase tracking-widest text-[#71717A]">{label}</p>
      <p className="text-sm font-bold text-[#18181B] tabular-nums mt-0.5 truncate">{value}</p>
      {sub && <p className="text-[10px] text-[#A1A1AA] mt-0.5">{sub}</p>}
    </div>
  )
}

function SubHead({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-4 pt-2.5 pb-1 text-[9.5px] font-bold uppercase tracking-widest text-[#A1A1AA] bg-[#FAFAF8] border-b border-[#F4F4F5]">
      {children}
    </p>
  )
}

function TotalRow({ label, amount, negative }: { label: string; amount: number; negative?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-2 border-b border-[#E4E4E7] bg-[#FCFCFB]">
      <span className="text-[11px] font-bold uppercase tracking-widest text-[#71717A] truncate">{label}</span>
      <span className={`text-[13px] font-bold tabular-nums flex-shrink-0 ${negative ? 'text-rose-600' : 'text-[#18181B]'}`}>
        {negative ? '−' : ''}{formatINR(amount)}
      </span>
    </div>
  )
}

function EmptyState() {
  return (
    <Panel className="!mb-0">
      <div className="px-6 py-10 text-center">
        <div className="w-14 h-14 mx-auto mb-4 rounded-xl bg-[#27272A] flex items-center justify-center">
          <Banknote size={26} style={{ color: ADMIN_GOLD }} strokeWidth={1.6} />
        </div>
        <h2 className="text-base font-bold text-[#18181B] mb-1">No payslips yet</h2>
        <p className="text-sm text-[#71717A] max-w-sm mx-auto">
          Your monthly salary will appear here once the office runs a pay cycle.
        </p>
      </div>
    </Panel>
  )
}

/** Matches the hero + breakdown shapes so the page does not jump on load. */
function SalarySkeleton() {
  return (
    <div className="animate-pulse">
      <div className={`${BLEED} bg-[#27272A] sm:rounded-xl overflow-hidden shadow-lg mb-3`}>
        <div className="h-10 border-b border-white/10" />
        <div className="px-4 pt-4 pb-3.5 space-y-2">
          <div className="h-2.5 w-20 rounded-full bg-white/10" />
          <div className="h-7 w-40 rounded-lg bg-white/10" />
        </div>
        <div className="h-14 border-t border-white/10" />
      </div>
      <Panel>
        <div className="h-8 bg-[#FAFAF8] border-b border-[#F4F4F5]" />
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className={ROW}>
            <div className="h-2.5 w-28 rounded-full bg-[#E4E4E7]" />
            <div className="h-2.5 w-16 rounded-full bg-[#E4E4E7]" />
          </div>
        ))}
      </Panel>
    </div>
  )
}
