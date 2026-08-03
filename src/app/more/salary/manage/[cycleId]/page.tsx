'use client'

import React, { useState, useEffect, useCallback, useMemo } from 'react'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import { AnimatePresence } from 'framer-motion'
import { useParams } from 'next/navigation'
import {
  ArrowLeft, CalendarRange, Users, Send, Table2, Download, ChevronRight,
  Receipt, SlidersHorizontal, Lock, LockOpen, CheckCheck,
} from 'lucide-react'
import ProtectedLayout from '@/components/ProtectedLayout'
import Avatar from '@/components/Avatar'
import ModalShell from '@/components/ui/ModalShell'
import SalaryRecordItemsEditor from '@/components/salary/SalaryRecordItemsEditor'
import CycleSettingsModal from '@/components/salary/CycleSettingsModal'
import DownloadCentreModal from '@/components/salary/DownloadCentreModal'
import { ADMIN, ADMIN_GOLD, CYCLE_CHIP, RECORD_CHIP } from '@/components/salary/adminUi'
import { Sheet, SHEET } from '@/components/bus/adminUI'
import { formatINR } from '@/components/bus/FeeCollectionSummary'
import { getRoleDisplayName, UserProfile } from '@/lib/supabase'
import {
  SalaryCycle, SalaryRecord, SalaryRecordItem, StaffBankAccount, StaffSalaryBase, PayoutConfig,
  fetchCycle, fetchCycleRecords, setCycleStatus, setCyclePayrollConfig, salaryNet, formatPeriod,
  fetchPayoutConfig, initiateCyclePayouts, fetchBankAccountsMap, fetchBaseSalaries,
  fetchMonthlyBonusPoints, bulkInsertSalaryItems, deleteSalaryItemsByLabel, bulkSetSalaryRecordStatus,
} from '@/lib/salary'
import {
  fetchMonthlyAttendanceRecords, fetchHolidays, fetchAttendanceConfig, Holiday, StaffAttendanceRecord,
} from '@/lib/attendance'
import {
  PayrollCalibration, DEFAULT_PAYROLL_CALIBRATION, mergeCalibration, fetchPayrollCalibration,
  computeStaffAttendanceStats, computePayrollRow, computeBonusAmounts, daysInMonth, PAYROLL_ITEM_LABELS,
} from '@/lib/payroll'
import {
  StatementSpec, buildSalaryRegister, buildBankTransferStatement, buildPayslip,
} from '@/components/salary/statements/generate'
import { buildBankDisbursementCsv, downloadCsv } from '@/components/salary/statements/csv'

const StatementPreviewModal = dynamic(() => import('@/components/salary/statements/StatementPreviewModal'))
const SalaryStatementsModal = dynamic(() => import('@/components/salary/SalaryStatementsModal'))

function findItemAmount(items: SalaryRecordItem[] | undefined, label: string): number | null {
  const it = (items ?? []).find(i => i.label === label)
  return it ? Number(it.amount) : null
}

interface RowComputed {
  lateCount: number
  leaveCount: number
  workingDays: number
  salaryPerDay: number
  lopFromLate: number
  lopFromLeave: number
  lopLateRs: number
  lopLeaveRs: number
  pf: number
  esi: number
  bonusPoints: number
  bonusAmount: number
}

export default function SalaryCycleDetailPage() {
  const params = useParams()
  const cycleId = params.cycleId as string

  const [loading, setLoading] = useState(true)
  const [cycle, setCycle] = useState<SalaryCycle | null>(null)
  const [records, setRecords] = useState<SalaryRecord[]>([])
  const [payoutCfg, setPayoutCfg] = useState<PayoutConfig | null>(null)
  const [bankMap, setBankMap] = useState<Record<string, StaffBankAccount>>({})
  const [baseMap, setBaseMap] = useState<Record<string, StaffSalaryBase>>({})
  const [attendanceRecords, setAttendanceRecords] = useState<StaffAttendanceRecord[]>([])
  const [holidays, setHolidays] = useState<Holiday[]>([])
  const [lateCutoff, setLateCutoff] = useState<string | null>(null)
  const [bonusPoints, setBonusPoints] = useState<Record<string, number>>({})
  const [globalCalibration, setGlobalCalibration] = useState<PayrollCalibration>(DEFAULT_PAYROLL_CALIBRATION)
  const [busy, setBusy] = useState(false)
  const [disburseMsg, setDisburseMsg] = useState<string | null>(null)
  const [pdfBusy, setPdfBusy] = useState<string | null>(null)
  const [preview, setPreview] = useState<{ spec: StatementSpec; title: string } | null>(null)
  const [showDocs, setShowDocs] = useState(false)
  const [docsStaff, setDocsStaff] = useState<UserProfile | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [showSettings, setShowSettings] = useState(false)
  const [confirmAction, setConfirmAction] = useState<'close' | 'reopen' | null>(null)

  const toggleExpanded = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const load = useCallback(async () => {
    setLoading(true)
    const [c, recs, cfg, bm, bases, globalCal] = await Promise.all([
      fetchCycle(cycleId), fetchCycleRecords(cycleId), fetchPayoutConfig(), fetchBankAccountsMap(),
      fetchBaseSalaries(), fetchPayrollCalibration(),
    ])
    setCycle(c); setRecords(recs); setPayoutCfg(cfg); setBankMap(bm); setGlobalCalibration(globalCal)

    const bMap: Record<string, StaffSalaryBase> = {}
    for (const b of bases) bMap[b.staff_id] = b
    setBaseMap(bMap)

    if (c && recs.length > 0) {
      const staffIds = recs.map(r => r.staff_id)
      const [attRecs, hols, attCfg, bonusPts] = await Promise.all([
        fetchMonthlyAttendanceRecords(staffIds, c.period_year, c.period_month),
        fetchHolidays(c.period_year, c.period_month),
        fetchAttendanceConfig(),
        fetchMonthlyBonusPoints(staffIds, c.period_year, c.period_month),
      ])
      setAttendanceRecords(attRecs); setHolidays(hols); setLateCutoff(attCfg.late_cutoff); setBonusPoints(bonusPts)
    } else {
      setAttendanceRecords([]); setHolidays([]); setBonusPoints({})
    }
    setLoading(false)
  }, [cycleId])

  const openPdf = async (key: string, title: string, builder: () => Promise<StatementSpec>) => {
    setPdfBusy(key)
    try { setPreview({ spec: await builder(), title }) }
    catch (e) { console.error('pdf failed:', e) }
    setPdfBusy(null)
  }

  useEffect(() => { load() }, [load])

  const calibration = useMemo(
    () => mergeCalibration(globalCalibration, cycle?.payroll_config ?? null),
    [globalCalibration, cycle],
  )

  const computedRows = useMemo(() => {
    const out: Record<string, RowComputed> = {}
    if (!cycle) return out
    const workingDays = daysInMonth(cycle.period_year, cycle.period_month)
    const bonusAmounts = computeBonusAmounts(bonusPoints, calibration.bonus)
    for (const r of records) {
      const base = baseMap[r.staff_id]
      const { lateCount, leaveCount } = computeStaffAttendanceStats(
        r.staff_id, attendanceRecords, holidays, cycle.period_year, cycle.period_month, lateCutoff,
      )
      const row = computePayrollRow({
        baseAmount: Number(r.base_amount) || 0,
        pfBasic: base?.pf_basic ?? null,
        pfApplicable: base?.pf_applicable ?? false,
        esiOverride: base?.esi_override ?? null,
        workingDaysInMonth: workingDays,
        lateCount, leaveCount,
        calibration,
      })
      out[r.id] = {
        lateCount, leaveCount, workingDays,
        salaryPerDay: row.salaryPerDay, lopFromLate: row.lopFromLate, lopFromLeave: row.lopFromLeave,
        lopLateRs: Math.round(row.lopFromLate * row.salaryPerDay),
        lopLeaveRs: Math.round(row.lopFromLeave * row.salaryPerDay),
        pf: row.pf, esi: row.esi,
        bonusPoints: bonusPoints[r.staff_id] ?? 0, bonusAmount: bonusAmounts[r.staff_id] ?? 0,
      }
    }
    return out
  }, [cycle, records, calibration, attendanceRecords, holidays, bonusPoints, baseMap, lateCutoff])

  const closed = cycle?.status === 'closed'

  /** PF/ESI/LOP/bonus figures: live-computed while open, read back from the snapshotted items once closed. */
  const rowFigures = useCallback((r: SalaryRecord) => {
    const c = computedRows[r.id]
    const pf = closed ? Math.abs(findItemAmount(r.items, PAYROLL_ITEM_LABELS.pf) ?? 0) : (c?.pf ?? 0)
    const esi = closed ? Math.abs(findItemAmount(r.items, PAYROLL_ITEM_LABELS.esi) ?? 0) : (c?.esi ?? 0)
    const bonus = closed ? (findItemAmount(r.items, PAYROLL_ITEM_LABELS.bonus) ?? 0) : (c?.bonusAmount ?? 0)
    const net = closed
      ? salaryNet(r)
      : Number(r.base_amount || 0) - pf - esi - (c?.lopLateRs ?? 0) - (c?.lopLeaveRs ?? 0) + bonus
    return { c, pf, esi, bonus, net }
  }, [computedRows, closed])

  const totalNet = records.reduce((sum, r) => sum + rowFigures(r).net, 0)
  const paidCount = records.filter(r => r.status === 'paid').length
  const autoProvider = !!payoutCfg?.enabled && payoutCfg.provider !== 'manual'

  const closeCycle = async () => {
    if (!cycle) return
    setBusy(true)
    const items: { record_id: string; label: string; amount: number }[] = []
    for (const r of records) {
      const c = computedRows[r.id]
      if (!c) continue
      if (c.pf > 0) items.push({ record_id: r.id, label: PAYROLL_ITEM_LABELS.pf, amount: -c.pf })
      if (c.esi > 0) items.push({ record_id: r.id, label: PAYROLL_ITEM_LABELS.esi, amount: -c.esi })
      if (c.lopLateRs > 0) items.push({ record_id: r.id, label: PAYROLL_ITEM_LABELS.lopLate, amount: -c.lopLateRs })
      if (c.lopLeaveRs > 0) items.push({ record_id: r.id, label: PAYROLL_ITEM_LABELS.lopLeave, amount: -c.lopLeaveRs })
      if (c.bonusAmount > 0) items.push({ record_id: r.id, label: PAYROLL_ITEM_LABELS.bonus, amount: c.bonusAmount })
    }
    await bulkInsertSalaryItems(items)
    await bulkSetSalaryRecordStatus(records.map(r => r.id), 'approved')
    await setCycleStatus(cycleId, 'closed')
    setBusy(false)
    setConfirmAction(null)
    load()
  }

  const reopenCycle = async () => {
    if (!cycle) return
    setBusy(true)
    await deleteSalaryItemsByLabel(records.map(r => r.id), Object.values(PAYROLL_ITEM_LABELS))
    await bulkSetSalaryRecordStatus(records.map(r => r.id), 'draft')
    await setCycleStatus(cycleId, 'open')
    setBusy(false)
    setConfirmAction(null)
    load()
  }

  const markAllPaid = async () => {
    setBusy(true)
    await bulkSetSalaryRecordStatus(records.map(r => r.id), 'paid')
    setBusy(false)
    load()
  }

  const saveCycleConfig = async (config: PayrollCalibration | null) => {
    await setCyclePayrollConfig(cycleId, config)
    setShowSettings(false)
    load()
  }

  const disburse = async () => {
    setBusy(true); setDisburseMsg(null)
    const res = await initiateCyclePayouts(cycleId)
    setBusy(false)
    if (!res.success) { setDisburseMsg(res.error ?? 'Failed to start payouts'); return }
    setDisburseMsg(res.manual
      ? 'Automated payouts are off — download the bank CSV below, upload it at your bank to disburse, then mark all as paid.'
      : `Initiated ${res.initiated ?? 0} payout(s) to the linked bank.`)
    load()
  }

  const downloadBankCsv = () => {
    if (!cycle) return
    setDisburseMsg(null)
    const { fileName, rows, included, skipped } = buildBankDisbursementCsv(cycle, records, bankMap)
    if (included === 0) {
      setDisburseMsg('No records with bank details on file to export. Add bank accounts first.')
      return
    }
    downloadCsv(fileName, rows)
    setDisburseMsg(
      `Exported ${included} record(s) to ${fileName}.csv.` +
      (skipped.length ? ` Skipped (no bank details): ${skipped.join(', ')}.` : ''),
    )
  }

  return (
    <ProtectedLayout adminOnly>
      <div data-page-theme="salary" className="bg-[#FAFAFA]" style={{ minHeight: '100vh' }}>
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <Link href="/more/salary" className="inline-flex items-center gap-1.5 text-sm text-[#71717A] hover:text-[#27272A] mb-4 transition-colors">
            <ArrowLeft size={16} /> Salary Manager
          </Link>

          {loading ? (
            <div className="text-center py-12"><div className="spinner mx-auto mb-3" /><p className="text-sm text-[#71717A]">Loading…</p></div>
          ) : !cycle ? (
            <div className={`${ADMIN.card} shadow-sm p-8 text-center text-sm text-[#71717A]`}>
              Cycle not found.
            </div>
          ) : (
            <>
              <div className="flex items-center gap-3 mb-4">
                <div className="w-11 h-11 rounded-xl bg-[#27272A] flex items-center justify-center flex-shrink-0">
                  <CalendarRange style={{ color: ADMIN_GOLD }} size={20} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h1 className="font-display text-2xl font-bold text-[#18181B]">{formatPeriod(cycle.period_month, cycle.period_year)}</h1>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold uppercase tracking-wide ${CYCLE_CHIP[cycle.status]}`}>
                      {cycle.status[0].toUpperCase() + cycle.status.slice(1)}
                    </span>
                  </div>
                  <p className="text-xs text-[#71717A]">Salary cycle</p>
                </div>
                <button onClick={() => setShowSettings(true)} className={`${ADMIN.ghostBtn} flex-shrink-0`}>
                  <SlidersHorizontal size={14} /> Cycle Settings
                </button>
                {records.length > 0 && (
                  <button onClick={() => setShowDocs(true)} className={`${ADMIN.darkBtn} flex-shrink-0`}>
                    <Download size={14} /> Download Centre
                  </button>
                )}
              </div>

              {/* Summary */}
              <div className={`${ADMIN.card} shadow-sm p-4 mb-5`}>
                <div className="grid grid-cols-3 gap-3 text-center">
                  <Stat icon={<Users size={15} />} label="Staff" value={String(records.length)} />
                  <Stat label="Paid" value={`${paidCount}/${records.length}`} />
                  <Stat label="Total net" value={formatINR(totalNet)} />
                </div>
                <div className="flex items-center gap-2 mt-4 pt-3 border-t border-[#E4E4E7]">
                  <span className={`${ADMIN.label} mr-auto`}>Cycle</span>
                  {closed ? (
                    <button onClick={() => setConfirmAction('reopen')} disabled={busy}
                      className={`${ADMIN.ghostBtn} text-[11px] !px-2.5 !py-1.5`}>
                      <LockOpen size={12} /> Reopen
                    </button>
                  ) : (
                    <button onClick={() => setConfirmAction('close')} disabled={busy || records.length === 0}
                      className={`${ADMIN.darkBtn} text-[11px] !px-2.5 !py-1.5`}>
                      <Lock size={12} /> Close Cycle
                    </button>
                  )}
                </div>
                {closed ? (
                  <div className="flex flex-col sm:flex-row gap-2 mt-3">
                    <button onClick={disburse} disabled={busy}
                      className={`${ADMIN.darkBtn} flex-1 !py-2.5 !text-sm`}>
                      <Send size={15} /> {busy ? 'Disbursing…' : autoProvider
                        ? `Pay via ${payoutCfg?.provider}`
                        : 'Disburse via linked bank'}
                    </button>
                    <button onClick={downloadBankCsv} disabled={busy}
                      className={`${ADMIN.ghostBtn} flex-1 !py-2.5 !text-sm`}>
                      <Table2 size={15} /> Bank CSV
                    </button>
                    {!autoProvider && (
                      <button onClick={markAllPaid} disabled={busy || paidCount === records.length}
                        className={`${ADMIN.ghostBtn} flex-1 !py-2.5 !text-sm disabled:opacity-40`}>
                        <CheckCheck size={15} /> Mark all paid
                      </button>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-[#A1A1AA] mt-3 text-center">Close the cycle to lock in PF/ESI/LOP/bonus and enable disbursement.</p>
                )}
                {disburseMsg && <p className="text-xs text-[#71717A] mt-2 text-center">{disburseMsg}</p>}
              </div>

              {records.length === 0 ? (
                <div className={`${ADMIN.card} shadow-sm p-8 text-center text-sm text-[#71717A]`}>
                  No eligible staff found for this cycle.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <div className="min-w-[1240px]">
                    <Sheet
                      columns={
                        <>
                          <span className={`${SHEET.headCell} w-52 flex-shrink-0 ml-9`}>Staff</span>
                          <span className={`${SHEET.headCell} w-20 flex-shrink-0 text-right`}>Base</span>
                          <span className={`${SHEET.headCell} w-14 flex-shrink-0 text-center`}>Work Days</span>
                          <span className={`${SHEET.headCell} w-12 flex-shrink-0 text-center`}>Leave</span>
                          <span className={`${SHEET.headCell} w-12 flex-shrink-0 text-center`}>Late</span>
                          <span className={`${SHEET.headCell} w-16 flex-shrink-0 text-center`}>LOP Leave</span>
                          <span className={`${SHEET.headCell} w-16 flex-shrink-0 text-center`}>LOP Late</span>
                          <span className={`${SHEET.headCell} w-14 flex-shrink-0 text-center`}>LOP Total</span>
                          <span className={`${SHEET.headCell} w-16 flex-shrink-0 text-right`}>₹/Day</span>
                          <span className={`${SHEET.headCell} w-16 flex-shrink-0 text-right`}>PF</span>
                          <span className={`${SHEET.headCell} w-16 flex-shrink-0 text-right`}>ESI</span>
                          <span className={`${SHEET.headCell} w-14 flex-shrink-0 text-center`}>Bonus Pts</span>
                          <span className={`${SHEET.headCell} flex-1 text-right`}>Net pay</span>
                        </>
                      }
                    >
                      {records.map((r, idx) => {
                        const staffLike = r.staff ? { full_name: r.staff.full_name, email: r.staff.email, role: r.staff.role } : undefined
                        const key = `payslip-${r.id}`
                        const open = expanded.has(r.id)
                        const { c, pf, esi, bonus, net } = rowFigures(r)
                        const bar = r.status === 'paid' ? 'bg-[#27272A]' : r.status === 'approved' ? 'bg-[#B8983C]' : 'bg-[#D4D4D8]'
                        return (
                          <div key={r.id} className={idx < records.length - 1 ? 'border-b border-[#F4F4F5]' : ''}>
                            <div
                              role="button"
                              tabIndex={0}
                              onClick={() => toggleExpanded(r.id)}
                              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleExpanded(r.id) } }}
                              className="flex items-stretch hover:bg-[#FAFAFA] transition-colors cursor-pointer"
                            >
                              <div className={`${SHEET.bar} ${bar}`} />
                              <div className="flex items-center gap-2 flex-1 min-w-0 px-3 py-2">
                                <ChevronRight size={14} className={`text-[#A1A1AA] flex-shrink-0 transition-transform ${open ? 'rotate-90' : ''}`} />
                                <Avatar avatarUrl={r.staff?.avatar_url} name={r.staff?.full_name ?? '?'} size={24} userId={r.staff_id} />
                                <div className="w-32 flex-shrink-0 min-w-0">
                                  <p className="text-xs font-semibold text-[#18181B] truncate">{r.staff?.full_name ?? 'Staff'}</p>
                                  <p className="text-[10px] text-[#71717A] truncate">{r.staff ? getRoleDisplayName(r.staff.role, r.staff.is_non_teaching) : ''}</p>
                                </div>
                                <span className="w-20 flex-shrink-0 text-right text-xs tabular-nums text-[#71717A]">{formatINR(Number(r.base_amount))}</span>
                                <span className="w-14 flex-shrink-0 text-center text-[11px] tabular-nums text-[#71717A]">{c?.workingDays ?? '—'}</span>
                                <span className="w-12 flex-shrink-0 text-center text-[11px] tabular-nums text-[#71717A]">{c?.leaveCount ?? '—'}</span>
                                <span className="w-12 flex-shrink-0 text-center text-[11px] tabular-nums text-[#71717A]">{c?.lateCount ?? '—'}</span>
                                <span className="w-16 flex-shrink-0 text-center text-[11px] tabular-nums text-[#71717A]">{c ? c.lopFromLeave : '—'}</span>
                                <span className="w-16 flex-shrink-0 text-center text-[11px] tabular-nums text-[#71717A]">{c ? c.lopFromLate : '—'}</span>
                                <span className="w-14 flex-shrink-0 text-center text-[11px] font-semibold tabular-nums text-rose-600">{c ? (c.lopFromLate + c.lopFromLeave) || '—' : '—'}</span>
                                <span className="w-16 flex-shrink-0 text-right text-[11px] tabular-nums text-[#71717A]">{c ? formatINR(Math.round(c.salaryPerDay)) : '—'}</span>
                                <span className="w-16 flex-shrink-0 text-right text-[11px] tabular-nums text-[#71717A]">{pf > 0 ? formatINR(pf) : '—'}</span>
                                <span className="w-16 flex-shrink-0 text-right text-[11px] tabular-nums text-[#71717A]">{esi > 0 ? formatINR(esi) : '—'}</span>
                                <span className="w-14 flex-shrink-0 text-center text-[11px] tabular-nums text-emerald-600">{c?.bonusPoints || '—'}</span>
                                <span className="flex-1 min-w-0 text-right text-sm font-bold text-[#18181B] tabular-nums">{formatINR(net)}</span>
                              </div>
                            </div>
                            {open && (
                              <div className="px-4 sm:px-5 py-4 bg-[#FAFAFA] border-t border-[#F4F4F5]">
                                <div className="flex items-center justify-between gap-2 mb-3">
                                  <button
                                    type="button"
                                    onClick={() => r.staff && setDocsStaff(r.staff)}
                                    disabled={!r.staff}
                                    className="text-[11px] font-semibold text-[#71717A] hover:text-[#27272A] disabled:opacity-40 transition-colors"
                                  >
                                    View financial statements →
                                  </button>
                                  <button
                                    disabled={pdfBusy === key}
                                    onClick={() => openPdf(key, `Payslip — ${r.staff?.full_name ?? 'Staff'}`, () => buildPayslip(r, staffLike, bankMap[r.staff_id]))}
                                    className="flex items-center gap-1 text-[11px] font-semibold text-[#71717A] hover:text-[#27272A] border border-[#E4E4E7] hover:border-[#D4D4D8] px-2.5 py-1.5 rounded-lg transition-colors disabled:opacity-50 flex-shrink-0"
                                  >
                                    <Receipt size={12} /> {pdfBusy === key ? '…' : 'Payslip'}
                                  </button>
                                </div>
                                {bonus > 0 && !closed && (
                                  <p className="text-[11px] text-emerald-600 mb-2">
                                    Task bonus (₹{formatINR(bonus)}) is applied automatically when the cycle is closed.
                                  </p>
                                )}
                                <SalaryRecordItemsEditor record={r} onChanged={load} />
                                <div className="flex items-center gap-2 mt-2">
                                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold uppercase tracking-wide ${RECORD_CHIP[r.status]}`}>
                                    {r.status[0].toUpperCase() + r.status.slice(1)}
                                  </span>
                                  {r.payout_status && (
                                    <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold uppercase tracking-wide bg-[#FBF6E9] text-[#8A6D1F] border border-[#EFE3C4]">
                                      payout: {r.payout_status}
                                    </span>
                                  )}
                                </div>
                                {r.notes && <p className="text-[11px] text-[#A1A1AA] mt-2.5 italic">{r.notes}</p>}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </Sheet>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <AnimatePresence>
        {showDocs && cycle && (
          <DownloadCentreModal
            periodLabel={formatPeriod(cycle.period_month, cycle.period_year)}
            recordCount={records.length}
            busyKey={pdfBusy}
            onClose={() => setShowDocs(false)}
            onRegister={() => { setShowDocs(false); openPdf('register', 'Salary Register', () => buildSalaryRegister(cycle, records)) }}
            onBankTransfer={() => { setShowDocs(false); openPdf('bank', 'Bank Transfer Statement', () => buildBankTransferStatement(cycle, records, bankMap)) }}
          />
        )}
        {showSettings && cycle && (
          <CycleSettingsModal
            initial={calibration}
            hasOverride={!!cycle.payroll_config}
            onClose={() => setShowSettings(false)}
            onSave={saveCycleConfig}
          />
        )}
        {confirmAction && (
          <ModalShell onClose={() => setConfirmAction(null)} size="sm">
            <h3 className="font-bold text-slate-800 mb-1.5">
              {confirmAction === 'close' ? 'Close this cycle?' : 'Reopen this cycle?'}
            </h3>
            <p className="text-sm text-slate-500 mb-4 leading-relaxed">
              {confirmAction === 'close'
                ? 'This locks in PF, ESI, LOP, and task bonus for every record based on current attendance and settings, and enables disbursement. You can still edit items afterward, or reopen to recompute.'
                : 'This removes the auto-applied PF/ESI/LOP/bonus items so they recompute cleanly next time you close. Manually added items are untouched.'}
            </p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setConfirmAction(null)} className="px-3 py-2 text-sm font-semibold text-slate-500 hover:text-slate-700">Cancel</button>
              <button
                onClick={confirmAction === 'close' ? closeCycle : reopenCycle}
                disabled={busy}
                className="btn-primary text-sm disabled:opacity-50"
              >
                {busy ? 'Working…' : confirmAction === 'close' ? 'Close cycle' : 'Reopen cycle'}
              </button>
            </div>
          </ModalShell>
        )}
        {docsStaff && (
          <SalaryStatementsModal staff={docsStaff} onClose={() => setDocsStaff(null)} />
        )}
        {preview && (
          <StatementPreviewModal spec={preview.spec} title={preview.title} onClose={() => setPreview(null)} />
        )}
      </AnimatePresence>
    </ProtectedLayout>
  )
}

function Stat({ icon, label, value }: { icon?: React.ReactNode; label: string; value: string }) {
  return (
    <div>
      <p className="text-base font-bold text-[#18181B] tabular-nums flex items-center justify-center gap-1">
        {icon && <span className="text-[#A1A1AA]">{icon}</span>}{value}
      </p>
      <p className="text-[10px] text-[#71717A] uppercase tracking-widest font-bold mt-0.5">{label}</p>
    </div>
  )
}
