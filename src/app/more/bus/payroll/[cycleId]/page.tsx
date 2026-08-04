'use client'

import React, { useState, useEffect, useCallback, useMemo } from 'react'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import { AnimatePresence } from 'framer-motion'
import { useParams } from 'next/navigation'
import {
  ArrowLeft, CalendarRange, Users, Send, Table2, Download, ChevronRight,
  Receipt, SlidersHorizontal, Lock, LockOpen, CheckCheck, FileText, Search,
} from 'lucide-react'
import ProtectedLayout from '@/components/ProtectedLayout'
import Avatar from '@/components/Avatar'
import ModalShell from '@/components/ui/ModalShell'
import DriverSalaryRecordItemsEditor, { PreviewItem } from '@/components/bus/DriverSalaryRecordItemsEditor'
import CycleSettingsModal from '@/components/salary/CycleSettingsModal'
import DownloadCentreModal from '@/components/salary/DownloadCentreModal'
import { formatINR } from '@/components/bus/FeeCollectionSummary'
import { ADMIN, Sheet, SHEET } from '@/components/bus/adminUI'
import { CYCLE_CHIP } from '@/components/salary/adminUi'
import { getRoleDisplayName, UserProfile } from '@/lib/supabase'
import {
  DriverCycle, DriverSalaryRecord, DriverSalaryBase, PayoutConfig,
  fetchDriverCycle, fetchDriverCycleRecords, setDriverCycleStatus, setDriverCyclePayrollConfig,
  driverSalaryNet, formatPeriod, fetchPayoutConfig, initiateDriverCyclePayouts, fetchDriverBaseSalaries,
  bulkInsertDriverSalaryItems, deleteDriverSalaryItemsByLabel, bulkSetDriverSalaryRecordStatus,
} from '@/lib/driverSalary'
import { fetchDriverBankAccounts } from '@/lib/bus'
import { SalaryRecord, SalaryRecordItem, SalaryCycle, StaffBankAccount, fetchMonthlyBonusPoints } from '@/lib/salary'
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
const DriverStatementsModal = dynamic(() => import('@/components/bus/DriverStatementsModal'))

const ADMIN_GOLD = '#B8983C'

// ── Adapters: reuse the staff Salary statement/CSV builders for drivers ──────
// Driver records/banks mirror the staff shapes; mapping them lets the driver
// payroll cycle share the salary cycle's Download Centre + bank CSV.
function toSalaryRecord(r: DriverSalaryRecord): SalaryRecord {
  return {
    id: r.id, cycle_id: r.cycle_id, staff_id: r.driver_id,
    base_amount: r.base_amount, status: r.status,
    payout_status: r.payout_status, payout_reference: r.payout_reference,
    notes: r.notes, created_at: r.created_at, updated_at: r.updated_at,
    items: r.items, staff: r.driver ?? null,
  }
}

const AUTO_LABELS: string[] = Object.values(PAYROLL_ITEM_LABELS)

/** Sum every stored item carrying this label — tolerates duplicates left by an interrupted close. */
function sumItems(items: SalaryRecordItem[] | undefined, label: string): number {
  return (items ?? []).filter(i => i.label === label).reduce((s, i) => s + Number(i.amount || 0), 0)
}

/**
 * Shared 13-column grid — the header and every data row use this exact
 * template, so headings always sit above their own column.
 *
 * Applied as an inline style rather than a Tailwind `grid-cols-[...]` class:
 * Tailwind only emits CSS for complete class names it can find as literal
 * text in the source, so a template this long (which has to be assembled
 * from several string pieces to stay readable) would never get generated and
 * the grid would silently collapse to a single stacked column.
 */
const GRID = 'grid items-center gap-x-2'
const GRID_COLS = [
  'minmax(150px,1.7fr)',  // driver (chevron + avatar + name + statements icon)
  'minmax(78px,1fr)',     // base
  'minmax(52px,0.7fr)',   // work days
  'minmax(48px,0.62fr)',  // leave
  'minmax(44px,0.6fr)',   // late
  'minmax(76px,1fr)',     // LOP leave
  'minmax(76px,1fr)',     // LOP late
  'minmax(76px,1fr)',     // LOP total
  'minmax(70px,0.9fr)',   // ₹/day
  'minmax(64px,0.85fr)',  // PF
  'minmax(64px,0.85fr)',  // ESI
  'minmax(52px,0.7fr)',   // bonus points
  'minmax(88px,1.15fr)',  // net pay
].join(' ')

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

export default function DriverCycleDetailPage() {
  const params = useParams()
  const cycleId = params.cycleId as string

  const [loading, setLoading] = useState(true)
  const [cycle, setCycle] = useState<DriverCycle | null>(null)
  const [records, setRecords] = useState<DriverSalaryRecord[]>([])
  const [payoutCfg, setPayoutCfg] = useState<PayoutConfig | null>(null)
  const [bankMap, setBankMap] = useState<Record<string, StaffBankAccount>>({})
  const [baseMap, setBaseMap] = useState<Record<string, DriverSalaryBase>>({})
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
  const [docsDriver, setDocsDriver] = useState<UserProfile | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [showSettings, setShowSettings] = useState(false)
  const [confirmAction, setConfirmAction] = useState<'close' | 'reopen' | null>(null)
  const [search, setSearch] = useState('')

  const toggleExpanded = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const load = useCallback(async () => {
    setLoading(true)
    const [c, recs, cfg, banks, bases, globalCal] = await Promise.all([
      fetchDriverCycle(cycleId), fetchDriverCycleRecords(cycleId), fetchPayoutConfig(), fetchDriverBankAccounts(),
      fetchDriverBaseSalaries(), fetchPayrollCalibration(),
    ])
    setCycle(c); setRecords(recs); setPayoutCfg(cfg); setGlobalCalibration(globalCal)

    const bm: Record<string, StaffBankAccount> = {}
    for (const a of banks) bm[a.driver_id] = { ...a, staff_id: a.driver_id } as unknown as StaffBankAccount
    setBankMap(bm)

    const bMap: Record<string, DriverSalaryBase> = {}
    for (const b of bases) bMap[b.driver_id] = b
    setBaseMap(bMap)

    if (c && recs.length > 0) {
      const driverIds = recs.map(r => r.driver_id)
      const [attRecs, hols, attCfg, bonusPts] = await Promise.all([
        fetchMonthlyAttendanceRecords(driverIds, c.period_year, c.period_month),
        fetchHolidays(c.period_year, c.period_month),
        fetchAttendanceConfig(),
        fetchMonthlyBonusPoints(driverIds, c.period_year, c.period_month),
      ])
      setAttendanceRecords(attRecs); setHolidays(hols); setLateCutoff(attCfg.late_cutoff); setBonusPoints(bonusPts)
    } else {
      setAttendanceRecords([]); setHolidays([]); setBonusPoints({})
    }
    setLoading(false)
  }, [cycleId])

  useEffect(() => { load() }, [load])

  const openPdf = async (key: string, title: string, builder: () => Promise<StatementSpec>) => {
    setPdfBusy(key)
    try { setPreview({ spec: await builder(), title }) }
    catch (e) { console.error('pdf failed:', e) }
    setPdfBusy(null)
  }

  const salaryCycle = cycle ? (cycle as unknown as SalaryCycle) : null
  const salaryRecords = records.map(toSalaryRecord)

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
      const base = baseMap[r.driver_id]
      const { lateCount, leaveCount } = computeStaffAttendanceStats(
        r.driver_id, attendanceRecords, holidays, cycle.period_year, cycle.period_month, lateCutoff,
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
        bonusPoints: bonusPoints[r.driver_id] ?? 0, bonusAmount: bonusAmounts[r.driver_id] ?? 0,
      }
    }
    return out
  }, [cycle, records, calibration, attendanceRecords, holidays, bonusPoints, baseMap, lateCutoff])

  const closed = cycle?.status === 'closed'

  /**
   * One place that decides every number shown for a record.
   *
   * While the cycle is OPEN the PF/ESI/LOP/bonus figures are computed live and
   * shown as a read-only preview; any auto-labelled rows still sitting in the
   * database (left behind by an interrupted close) are ignored entirely, so
   * they can never double up against the preview. Once the cycle is CLOSED the
   * stored rows become the single source of truth. Manually added bonuses and
   * deductions always count, in both states.
   */
  const rowFigures = useCallback((r: DriverSalaryRecord) => {
    const c = computedRows[r.id]
    const stored = r.items ?? []
    const manualItems = stored.filter(i => !AUTO_LABELS.includes(i.label))
    const manualTotal = manualItems.reduce((s, i) => s + Number(i.amount || 0), 0)
    const base = Number(r.base_amount || 0)

    if (closed) {
      const pf = Math.abs(sumItems(stored, PAYROLL_ITEM_LABELS.pf))
      const esi = Math.abs(sumItems(stored, PAYROLL_ITEM_LABELS.esi))
      const lopLateRs = Math.abs(sumItems(stored, PAYROLL_ITEM_LABELS.lopLate))
      const lopLeaveRs = Math.abs(sumItems(stored, PAYROLL_ITEM_LABELS.lopLeave))
      const bonus = sumItems(stored, PAYROLL_ITEM_LABELS.bonus)
      return {
        c, pf, esi, lopLateRs, lopLeaveRs, bonus, manualItems,
        previewItems: undefined as PreviewItem[] | undefined,
        net: driverSalaryNet(r),
      }
    }

    const pf = c?.pf ?? 0
    const esi = c?.esi ?? 0
    const lopLateRs = c?.lopLateRs ?? 0
    const lopLeaveRs = c?.lopLeaveRs ?? 0
    const bonus = c?.bonusAmount ?? 0
    return {
      c, pf, esi, lopLateRs, lopLeaveRs, bonus, manualItems,
      previewItems: [
        { label: PAYROLL_ITEM_LABELS.pf, amount: -pf },
        { label: PAYROLL_ITEM_LABELS.esi, amount: -esi },
        { label: PAYROLL_ITEM_LABELS.lopLate, amount: -lopLateRs },
        { label: PAYROLL_ITEM_LABELS.lopLeave, amount: -lopLeaveRs },
        { label: PAYROLL_ITEM_LABELS.bonus, amount: bonus },
      ] as PreviewItem[],
      net: base - pf - esi - lopLateRs - lopLeaveRs + bonus + manualTotal,
    }
  }, [computedRows, closed])

  const totalNet = records.reduce((sum, r) => sum + rowFigures(r).net, 0)
  const paidCount = records.filter(r => r.status === 'paid').length
  const autoProvider = !!payoutCfg?.enabled && payoutCfg.provider !== 'manual'

  const visibleRecords = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return records
    return records.filter(r => (r.driver?.full_name ?? '').toLowerCase().includes(q))
  }, [records, search])

  const closeCycle = async () => {
    if (!cycle || busy) return
    setBusy(true); setDisburseMsg(null)
    const recordIds = records.map(r => r.id)
    // Delete-then-insert makes this idempotent: safe to re-run (e.g. after a
    // previous failed attempt) without ever accumulating duplicate items.
    const del = await deleteDriverSalaryItemsByLabel(recordIds, Object.values(PAYROLL_ITEM_LABELS))
    if (!del.success) { setBusy(false); setDisburseMsg(`Could not close cycle: ${del.error}`); return }

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
    const ins = await bulkInsertDriverSalaryItems(items)
    if (!ins.success) { setBusy(false); setDisburseMsg(`Could not close cycle: ${ins.error}`); return }

    const st = await bulkSetDriverSalaryRecordStatus(recordIds, 'approved')
    if (!st.success) { setBusy(false); setDisburseMsg(`Could not close cycle: ${st.error}`); return }

    const cy = await setDriverCycleStatus(cycleId, 'closed')
    if (!cy.success) { setBusy(false); setDisburseMsg(`Could not close cycle: ${cy.error}`); return }

    setBusy(false)
    setConfirmAction(null)
    load()
  }

  const reopenCycle = async () => {
    if (!cycle || busy) return
    setBusy(true); setDisburseMsg(null)
    const del = await deleteDriverSalaryItemsByLabel(records.map(r => r.id), Object.values(PAYROLL_ITEM_LABELS))
    if (!del.success) { setBusy(false); setDisburseMsg(`Could not reopen cycle: ${del.error}`); return }
    await bulkSetDriverSalaryRecordStatus(records.map(r => r.id), 'draft')
    await setDriverCycleStatus(cycleId, 'open')
    setBusy(false)
    setConfirmAction(null)
    load()
  }

  const markAllPaid = async () => {
    setBusy(true)
    await bulkSetDriverSalaryRecordStatus(records.map(r => r.id), 'paid')
    setBusy(false)
    load()
  }

  const saveCycleConfig = async (config: PayrollCalibration | null) => {
    await setDriverCyclePayrollConfig(cycleId, config)
    setShowSettings(false)
    load()
  }

  const disburse = async () => {
    setBusy(true); setDisburseMsg(null)
    const res = await initiateDriverCyclePayouts(cycleId)
    setBusy(false)
    if (!res.success) { setDisburseMsg(res.error ?? 'Failed to start payouts'); return }
    setDisburseMsg(res.manual
      ? 'Automated payouts are off — download the bank CSV below, upload it at your bank to disburse, then mark all as paid.'
      : `Initiated ${res.initiated ?? 0} payout(s) to the linked bank.`)
    load()
  }

  const downloadBankCsv = () => {
    if (!salaryCycle) return
    setDisburseMsg(null)
    const { fileName, rows, included, skipped } = buildBankDisbursementCsv(salaryCycle, salaryRecords, bankMap)
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
      <div data-page-theme="bus" className="bg-[#FAFAFA]" style={{ minHeight: '100vh' }}>
        <div className="max-w-[1500px] mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <Link href="/more/bus?tab=payroll" className="inline-flex items-center gap-1.5 text-sm text-[#71717A] hover:text-[#27272A] mb-4 transition-colors">
            <ArrowLeft size={16} /> Driver Payroll
          </Link>

          {loading ? (
            <div className="text-center py-12"><div className="spinner mx-auto mb-3" /><p className="text-sm text-[#71717A]">Loading cycle…</p></div>
          ) : !cycle ? (
            <div className={`${ADMIN.card} shadow-sm p-8 text-center text-sm text-[#71717A]`}>Cycle not found.</div>
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
                  <p className="text-xs text-[#71717A]">Driver pay cycle</p>
                </div>
                <button
                  onClick={() => setShowSettings(true)}
                  title="Cycle settings"
                  aria-label="Cycle settings"
                  className={`${ADMIN.ghostBtn} flex-shrink-0 !px-2.5`}
                >
                  <SlidersHorizontal size={15} />
                </button>
                <button
                  onClick={() => setConfirmAction(closed ? 'reopen' : 'close')}
                  disabled={busy || (!closed && records.length === 0)}
                  title={closed ? 'Reopen cycle' : 'Close cycle'}
                  aria-label={closed ? 'Reopen cycle' : 'Close cycle'}
                  className={`${closed ? ADMIN.ghostBtn : ADMIN.darkBtn} flex-shrink-0 !px-2.5`}
                >
                  {closed ? <LockOpen size={15} /> : <Lock size={15} />}
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
                  <Stat icon={<Users size={15} />} label="Drivers" value={String(records.length)} />
                  <Stat label="Paid" value={`${paidCount}/${records.length}`} />
                  <Stat label="Total net" value={formatINR(totalNet)} />
                </div>
                {closed ? (
                  <div className="flex flex-col sm:flex-row gap-2 mt-4 pt-3 border-t border-[#E4E4E7]">
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
                  <p className="text-xs text-[#A1A1AA] mt-4 pt-3 border-t border-[#E4E4E7] text-center">
                    Close the cycle (lock icon above) to lock in PF/ESI/LOP/bonus and enable disbursement.
                  </p>
                )}
                {disburseMsg && <p className="text-xs text-rose-600 mt-2 text-center">{disburseMsg}</p>}
              </div>

              {records.length === 0 ? (
                <div className={`${ADMIN.card} shadow-sm p-8 text-center text-sm text-[#71717A]`}>
                  No eligible drivers found for this cycle.
                </div>
              ) : (
                <>
                  <div className="relative mb-3 max-w-xs">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#A1A1AA]" />
                    <input
                      value={search}
                      onChange={e => setSearch(e.target.value)}
                      placeholder="Search drivers…"
                      className="w-full bg-white border border-[#E4E4E7] rounded-lg pl-8 pr-3 py-2 text-xs text-[#27272A] placeholder:text-[#A1A1AA] focus:outline-none focus:border-[#27272A] transition-colors"
                    />
                  </div>

                  <div className="overflow-x-auto">
                    <div className="min-w-[1080px]">
                      <Sheet>
                        {/* Header — shares the GRID template with every data row, so labels always sit above their column. */}
                        <div className="hidden sm:flex items-stretch bg-[#27272A]">
                          <div className="w-1 flex-shrink-0" />
                          <div className={`${GRID} flex-1 min-w-0 px-3 py-2.5`} style={{ gridTemplateColumns: GRID_COLS }}>
                            <span className={`${SHEET.headCell} pl-[46px]`}>Driver</span>
                            <span className={`${SHEET.headCell} text-right`}>Base</span>
                            <span className={`${SHEET.headCell} text-center`}>Work Days</span>
                            <span className={`${SHEET.headCell} text-center`}>Leave</span>
                            <span className={`${SHEET.headCell} text-center`}>Late</span>
                            <span className={`${SHEET.headCell} text-right`}>LOP Leave</span>
                            <span className={`${SHEET.headCell} text-right`}>LOP Late</span>
                            <span className={`${SHEET.headCell} text-right`}>LOP Total</span>
                            <span className={`${SHEET.headCell} text-right`}>₹/Day</span>
                            <span className={`${SHEET.headCell} text-right`}>PF</span>
                            <span className={`${SHEET.headCell} text-right`}>ESI</span>
                            <span className={`${SHEET.headCell} text-center`}>Bonus Pts</span>
                            <span className={`${SHEET.headCell} text-right`}>Net pay</span>
                          </div>
                        </div>

                        {visibleRecords.length === 0 ? (
                          <div className="px-4 py-8 text-center text-sm text-[#A1A1AA]">No drivers match &quot;{search}&quot;.</div>
                        ) : visibleRecords.map((r, idx) => {
                          const key = `payslip-${r.id}`
                          const open = expanded.has(r.id)
                          const { c, pf, esi, lopLateRs, lopLeaveRs, manualItems, previewItems, net } = rowFigures(r)
                          const lopTotalRs = lopLateRs + lopLeaveRs
                          const bar = r.status === 'paid' ? 'bg-[#27272A]' : r.status === 'approved' ? 'bg-[#B8983C]' : 'bg-[#D4D4D8]'
                          return (
                            <div key={r.id} className={idx < visibleRecords.length - 1 ? 'border-b border-[#F4F4F5]' : ''}>
                              <div
                                role="button"
                                tabIndex={0}
                                onClick={() => toggleExpanded(r.id)}
                                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleExpanded(r.id) } }}
                                className="flex items-stretch hover:bg-[#FAFAFA] transition-colors cursor-pointer"
                              >
                                <div className={`${SHEET.bar} ${bar}`} />
                                <div className={`${GRID} flex-1 min-w-0 px-3 py-2`} style={{ gridTemplateColumns: GRID_COLS }}>
                                  <div className="flex items-center gap-1.5 min-w-0">
                                    <ChevronRight size={14} className={`text-[#A1A1AA] flex-shrink-0 transition-transform ${open ? 'rotate-90' : ''}`} />
                                    <Avatar avatarUrl={r.driver?.avatar_url} name={r.driver?.full_name ?? '?'} size={24} userId={r.driver_id} />
                                    <div className="min-w-0 flex-1">
                                      <p className="text-xs font-semibold text-[#18181B] truncate">{r.driver?.full_name ?? 'Driver'}</p>
                                      <p className="text-[10px] text-[#71717A] truncate">{r.driver ? getRoleDisplayName(r.driver.role) : ''}</p>
                                    </div>
                                    <button
                                      type="button"
                                      onClick={e => { e.stopPropagation(); r.driver && setDocsDriver(r.driver) }}
                                      disabled={!r.driver}
                                      title="Financial statements"
                                      className="flex-shrink-0 flex items-center justify-center text-[#A1A1AA] hover:text-[#27272A] disabled:opacity-30 transition-colors"
                                    >
                                      <FileText size={12} />
                                    </button>
                                  </div>
                                  <span className="text-right text-xs tabular-nums text-[#71717A]">{formatINR(Number(r.base_amount))}</span>
                                  <span className="text-center text-[11px] tabular-nums text-[#71717A]">{c?.workingDays ?? 0}</span>
                                  <span className="text-center text-[11px] tabular-nums text-[#71717A]">{c?.leaveCount ?? 0}</span>
                                  <span className="text-center text-[11px] tabular-nums text-[#71717A]">{c?.lateCount ?? 0}</span>
                                  <span className="text-right text-[11px] tabular-nums text-[#71717A]">{formatINR(lopLeaveRs)}</span>
                                  <span className="text-right text-[11px] tabular-nums text-[#71717A]">{formatINR(lopLateRs)}</span>
                                  <span className={`text-right text-[11px] font-semibold tabular-nums ${lopTotalRs > 0 ? 'text-rose-600' : 'text-[#71717A]'}`}>{formatINR(lopTotalRs)}</span>
                                  <span className="text-right text-[11px] tabular-nums text-[#71717A]">{formatINR(Math.round(c?.salaryPerDay ?? 0))}</span>
                                  <span className="text-right text-[11px] tabular-nums text-[#71717A]">{formatINR(pf)}</span>
                                  <span className="text-right text-[11px] tabular-nums text-[#71717A]">{formatINR(esi)}</span>
                                  <span className={`text-center text-[11px] tabular-nums ${(c?.bonusPoints ?? 0) > 0 ? 'text-emerald-600' : 'text-[#71717A]'}`}>{c?.bonusPoints ?? 0}</span>
                                  <span className="text-right text-sm font-bold text-[#18181B] tabular-nums">{formatINR(net)}</span>
                                </div>
                              </div>
                              {open && (
                                <div className="px-4 sm:px-5 py-4 bg-[#FAFAFA] border-t border-[#F4F4F5]">
                                  <div className="flex items-center justify-end gap-2 mb-3">
                                    <button
                                      disabled={pdfBusy === key}
                                      onClick={() => openPdf(key, `Payslip — ${r.driver?.full_name ?? 'Driver'}`, () => buildPayslip(toSalaryRecord(r), r.driver ? { full_name: r.driver.full_name, email: r.driver.email, role: r.driver.role } : undefined, bankMap[r.driver_id]))}
                                      className="flex items-center gap-1 text-[11px] font-semibold text-[#71717A] hover:text-[#27272A] border border-[#E4E4E7] hover:border-[#D4D4D8] px-2.5 py-1.5 rounded-lg transition-colors disabled:opacity-50 flex-shrink-0"
                                    >
                                      <Receipt size={12} /> {pdfBusy === key ? '…' : 'Payslip'}
                                    </button>
                                  </div>
                                  <DriverSalaryRecordItemsEditor
                                    record={r}
                                    onChanged={load}
                                    previewItems={previewItems}
                                    items={closed ? (r.items ?? []) : manualItems}
                                    net={net}
                                  />
                                  {r.payout_status && (
                                    <span className="inline-block text-[10px] px-2 py-0.5 rounded-full font-semibold uppercase tracking-wide bg-[#FBF6E9] text-[#8A6D1F] border border-[#EFE3C4] mt-2">
                                      payout: {r.payout_status}
                                    </span>
                                  )}
                                  {r.notes && <p className="text-[11px] text-[#A1A1AA] mt-2.5 italic">{r.notes}</p>}
                                </div>
                              )}
                            </div>
                          )
                        })}
                      </Sheet>
                    </div>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>

      <AnimatePresence>
        {showDocs && salaryCycle && (
          <DownloadCentreModal
            periodLabel={formatPeriod(salaryCycle.period_month, salaryCycle.period_year)}
            recordCount={records.length}
            busyKey={pdfBusy}
            onClose={() => setShowDocs(false)}
            onRegister={() => { setShowDocs(false); openPdf('register', 'Driver Salary Register', () => buildSalaryRegister(salaryCycle, salaryRecords)) }}
            onBankTransfer={() => { setShowDocs(false); openPdf('bank', 'Bank Transfer Statement', () => buildBankTransferStatement(salaryCycle, salaryRecords, bankMap)) }}
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
        {docsDriver && (
          <DriverStatementsModal driver={docsDriver} onClose={() => setDocsDriver(null)} />
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
