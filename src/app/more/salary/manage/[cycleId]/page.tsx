'use client'

import React, { useState, useEffect, useCallback, useMemo } from 'react'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import { AnimatePresence } from 'framer-motion'
import { useParams } from 'next/navigation'
import {
  ArrowLeft, CalendarRange, Users, Send, Table2, Download, ChevronRight,
  Receipt, SlidersHorizontal, Lock, LockOpen, CheckCheck, FileText, Search, BadgeCheck, CalendarDays,
} from 'lucide-react'
import ProtectedLayout from '@/components/ProtectedLayout'
import Avatar from '@/components/Avatar'
import ModalShell from '@/components/ui/ModalShell'
import SalaryRecordItemsEditor, { PreviewItem } from '@/components/salary/SalaryRecordItemsEditor'
import CycleSettingsModal from '@/components/salary/CycleSettingsModal'
import DownloadCentreModal from '@/components/salary/DownloadCentreModal'
import EditableCell from '@/components/salary/EditableCell'
import AttendanceCalendarModal from '@/components/salary/AttendanceCalendarModal'
import { ADMIN, ADMIN_GOLD, CYCLE_CHIP, CYCLE_STATUS_LABEL, PAID_CHIP } from '@/components/salary/adminUi'
import { Sheet, SHEET } from '@/components/bus/adminUI'
import { formatINR } from '@/components/bus/FeeCollectionSummary'
import { getRoleDisplayName, UserProfile } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import {
  SalaryCycle, SalaryRecord, SalaryRecordItem, StaffBankAccount, StaffSalaryBase, PayoutConfig,
  fetchCycle, fetchCycleRecords, setCycleStatus, setCyclePayrollConfig, salaryNet, formatPeriod,
  fetchPayoutConfig, initiateCyclePayouts, fetchBankAccountsMap, fetchBaseSalaries,
  fetchMonthlyBonusPoints, bulkInsertSalaryItems, deleteSalaryItemsByLabel, bulkSetSalaryRecordStatus,
  updateSalaryRecordOverrides, SalaryRecordOverrides,
} from '@/lib/salary'
import { fetchDriverBaseSalaries } from '@/lib/driverSalary'
import { fetchDriverBankAccounts } from '@/lib/bus'
import {
  fetchMonthlyAttendanceRecords, fetchHolidays, Holiday, StaffAttendanceRecord,
} from '@/lib/attendance'
import {
  PayrollCalibration, DEFAULT_PAYROLL_CALIBRATION, mergeCalibration, fetchPayrollCalibration,
  computeStaffAttendanceStats, computePayrollRow, computeBonusAmounts, daysInMonth,
  PAYROLL_ITEM_LABELS, isAutoPayrollLabel,
} from '@/lib/payroll'
import {
  StatementSpec, buildSalaryRegister, buildBankTransferStatement, buildPayslip,
} from '@/components/salary/statements/generate'
import { buildBankDisbursementCsv, downloadCsv } from '@/components/salary/statements/csv'
import type { StatutorySourceRow } from '@/lib/statutory'

const StatementPreviewModal = dynamic(() => import('@/components/salary/statements/StatementPreviewModal'))
const SalaryStatementsModal = dynamic(() => import('@/components/salary/SalaryStatementsModal'))
const EpfDocumentsModal = dynamic(() => import('@/components/salary/EpfDocumentsModal'))

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
  'minmax(178px,1.9fr)',  // staff (chevron + avatar + name + statements & calendar icons)
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

export default function SalaryCycleDetailPage() {
  const params = useParams()
  const cycleId = params.cycleId as string
  const { profile } = useAuth()
  const viewerId = profile?.id ?? ''

  const [loading, setLoading] = useState(true)
  const [cycle, setCycle] = useState<SalaryCycle | null>(null)
  const [records, setRecords] = useState<SalaryRecord[]>([])
  const [payoutCfg, setPayoutCfg] = useState<PayoutConfig | null>(null)
  const [bankMap, setBankMap] = useState<Record<string, StaffBankAccount>>({})
  const [baseMap, setBaseMap] = useState<Record<string, StaffSalaryBase>>({})
  const [attendanceRecords, setAttendanceRecords] = useState<StaffAttendanceRecord[]>([])
  const [holidays, setHolidays] = useState<Holiday[]>([])
  const [bonusPoints, setBonusPoints] = useState<Record<string, number>>({})
  const [globalCalibration, setGlobalCalibration] = useState<PayrollCalibration>(DEFAULT_PAYROLL_CALIBRATION)
  const [busy, setBusy] = useState(false)
  const [disburseMsg, setDisburseMsg] = useState<string | null>(null)
  const [pdfBusy, setPdfBusy] = useState<string | null>(null)
  const [preview, setPreview] = useState<{ spec: StatementSpec; title: string } | null>(null)
  const [showDocs, setShowDocs] = useState(false)
  const [showEpfDocs, setShowEpfDocs] = useState(false)
  const [docsStaff, setDocsStaff] = useState<UserProfile | null>(null)
  const [calendarPerson, setCalendarPerson] = useState<UserProfile | null>(null)
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
    const [c, recs, cfg, bm, bases, driverBases, driverBanks, globalCal] = await Promise.all([
      fetchCycle(cycleId), fetchCycleRecords(cycleId), fetchPayoutConfig(), fetchBankAccountsMap(),
      fetchBaseSalaries(), fetchDriverBaseSalaries(), fetchDriverBankAccounts(), fetchPayrollCalibration(),
    ])
    setCycle(c); setRecords(recs); setPayoutCfg(cfg); setGlobalCalibration(globalCal)

    // A cycle lists staff and drivers together, but their base-salary and bank
    // details live in separate tables. Key both by profile id so every row can
    // look its own up without caring which kind of person it is.
    for (const a of driverBanks) {
      bm[a.driver_id] = { ...a, staff_id: a.driver_id } as unknown as StaffBankAccount
    }
    setBankMap(bm)

    const bMap: Record<string, StaffSalaryBase> = {}
    for (const b of bases) bMap[b.staff_id] = b
    for (const b of driverBases) {
      bMap[b.driver_id] = { ...b, staff_id: b.driver_id } as unknown as StaffSalaryBase
    }
    setBaseMap(bMap)

    if (c && recs.length > 0) {
      const staffIds = recs.map(r => r.staff_id)
      const [attRecs, hols, bonusPts] = await Promise.all([
        fetchMonthlyAttendanceRecords(staffIds, c.period_year, c.period_month),
        fetchHolidays(c.period_year, c.period_month),
        fetchMonthlyBonusPoints(staffIds, c.period_year, c.period_month),
      ])
      setAttendanceRecords(attRecs); setHolidays(hols); setBonusPoints(bonusPts)
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
    const calendarDays = daysInMonth(cycle.period_year, cycle.period_month)
    const bonusAmounts = computeBonusAmounts(bonusPoints, calibration.bonus)
    for (const r of records) {
      const base = baseMap[r.staff_id]
      const derived = computeStaffAttendanceStats(
        r.staff_id, attendanceRecords, holidays, cycle.period_year, cycle.period_month,
      )
      // A hand-typed override wins over the derived figure; null falls back to it.
      const workingDays = r.working_days_override ?? calendarDays
      const leaveCount = r.leave_override ?? derived.leaveCount
      const lateCount = r.late_override ?? derived.lateCount

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
        pf: r.pf_amount_override ?? row.pf,
        esi: r.esi_amount_override ?? row.esi,
        bonusPoints: bonusPoints[r.staff_id] ?? 0, bonusAmount: bonusAmounts[r.staff_id] ?? 0,
      }
    }
    return out
  }, [cycle, records, calibration, attendanceRecords, holidays, bonusPoints, baseMap])

  const closed = cycle?.status === 'closed'

  /**
   * Every label that counts as machine-generated across this cycle: the five
   * current ones, plus the exact legacy labels actually present on these
   * records (`Task bonus (June 2026) · 4 pts` and friends carry the period in
   * the text, so they can only be matched by reading them off the rows).
   * Deleting this whole set is what stops old and new automatic items from
   * sitting side by side and being counted twice.
   */
  const autoLabelsToPurge = useCallback((): string[] => {
    const set = new Set<string>(Object.values(PAYROLL_ITEM_LABELS))
    for (const r of records) {
      for (const i of r.items ?? []) if (isAutoPayrollLabel(i.label)) set.add(i.label)
    }
    return Array.from(set)
  }, [records])

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
  const rowFigures = useCallback((r: SalaryRecord) => {
    const c = computedRows[r.id]
    const stored = r.items ?? []
    const manualItems = stored.filter(i => !isAutoPayrollLabel(i.label))
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
        net: salaryNet(r),
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

  /**
   * Every record flattened into what the EPF and ESI monthly returns need.
   *
   * It reads the same figures the sheet shows, so a return can never claim
   * something this cycle does not say. Once the cycle is locked the lost days
   * are derived back from the loss-of-pay actually withheld rather than
   * recomputed from attendance — the money is what was paid on, and attendance
   * marked after the lock should not quietly move the NCP days on a return.
   */
  const statutoryRows = useMemo<StatutorySourceRow[]>(() => records.map(r => {
    const { c, pf, esi, lopLateRs, lopLeaveRs } = rowFigures(r)
    const cfg = baseMap[r.staff_id]
    const baseAmount = Number(r.base_amount) || 0
    const perDay = c?.salaryPerDay ?? 0
    const lopDays = closed && perDay > 0
      ? (lopLateRs + lopLeaveRs) / perDay
      : (c?.lopFromLate ?? 0) + (c?.lopFromLeave ?? 0)
    return {
      staffId: r.staff_id,
      name: r.staff?.full_name ?? '',
      baseAmount,
      workingDays: c?.workingDays ?? 0,
      lopDays,
      pfBasic: cfg?.pf_basic ?? null,
      pfApplicable: cfg?.pf_applicable ?? false,
      epsApplicable: cfg?.eps_applicable ?? true,
      // The same rule computePayrollRow applies, so the two never disagree
      // about who ESI is due for.
      esiApplicable: cfg?.esi_override ?? (baseAmount > 0 && baseAmount <= calibration.esi.wage_ceiling),
      uan: cfg?.uan ?? null,
      ipNumber: cfg?.esi_ip_number ?? null,
      deductedPf: pf,
      deductedEsi: esi,
    }
  }), [records, rowFigures, baseMap, calibration, closed])

  const totalNet = records.reduce((sum, r) => sum + rowFigures(r).net, 0)
  const paidCount = records.filter(r => r.status === 'paid').length
  const allPaid = records.length > 0 && paidCount === records.length
  const autoProvider = !!payoutCfg?.enabled && payoutCfg.provider !== 'manual'

  const visibleRecords = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return records
    return records.filter(r => (r.staff?.full_name ?? '').toLowerCase().includes(q))
  }, [records, search])

  /** Persist one hand-typed cell, then reload so every dependent figure recomputes. */
  const saveOverride = async (recordId: string, patch: SalaryRecordOverrides) => {
    const res = await updateSalaryRecordOverrides(recordId, patch)
    if (!res.success) { setDisburseMsg(`Could not save: ${res.error}`); return }
    setDisburseMsg(null)
    await load()
  }

  const closeCycle = async () => {
    if (!cycle || busy) return
    setBusy(true); setDisburseMsg(null)
    const recordIds = records.map(r => r.id)
    // Delete-then-insert makes this idempotent: safe to re-run (e.g. after a
    // previous failed attempt) without ever accumulating duplicate items.
    const del = await deleteSalaryItemsByLabel(recordIds, autoLabelsToPurge())
    if (!del.success) { setBusy(false); setDisburseMsg(`Could not lock cycle: ${del.error}`); return }

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
    const ins = await bulkInsertSalaryItems(items)
    if (!ins.success) { setBusy(false); setDisburseMsg(`Could not lock cycle: ${ins.error}`); return }

    const st = await bulkSetSalaryRecordStatus(recordIds, 'approved')
    if (!st.success) { setBusy(false); setDisburseMsg(`Could not lock cycle: ${st.error}`); return }

    const cy = await setCycleStatus(cycleId, 'closed')
    if (!cy.success) { setBusy(false); setDisburseMsg(`Could not lock cycle: ${cy.error}`); return }

    setBusy(false)
    setConfirmAction(null)
    load()
  }

  const reopenCycle = async () => {
    if (!cycle || busy) return
    setBusy(true); setDisburseMsg(null)
    const del = await deleteSalaryItemsByLabel(records.map(r => r.id), autoLabelsToPurge())
    if (!del.success) { setBusy(false); setDisburseMsg(`Could not unlock cycle: ${del.error}`); return }
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

    if (res.manual) {
      setDisburseMsg('Bank disbursement is off — download the bank CSV below, upload it at your bank to disburse, then mark all as paid.')
    } else if (res.file) {
      // bank_file mode: the money has not moved yet, so hand the admin the file
      // straight away rather than leaving them to hunt for it.
      const blob = new Blob([res.file.content], { type: res.file.mime })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = res.file.filename
      a.click()
      URL.revokeObjectURL(url)
      setDisburseMsg(`Prepared ${res.initiated ?? 0} transfer(s) as ${res.file.filename}. Upload it at your bank to release the money, then mark all as paid.`)
    } else {
      setDisburseMsg(`Initiated ${res.initiated ?? 0} transfer(s) with your bank.`)
    }
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
        <div className="max-w-[1500px] mx-auto px-4 sm:px-6 lg:px-8 py-6">
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
                      {CYCLE_STATUS_LABEL[cycle.status]}
                    </span>
                    {allPaid && (
                      <span className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full font-semibold uppercase tracking-wide ${PAID_CHIP}`}>
                        <BadgeCheck size={11} /> Paid
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-[#71717A]">Salary cycle</p>
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
                  title={closed ? 'Unlock cycle' : 'Lock cycle'}
                  aria-label={closed ? 'Unlock cycle' : 'Lock cycle'}
                  className={`${closed ? ADMIN.ghostBtn : ADMIN.darkBtn} flex-shrink-0 !px-2.5`}
                >
                  {closed ? <Lock size={15} /> : <LockOpen size={15} />}
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
                    Lock the cycle (padlock above) to fix PF/ESI/LOP/bonus and enable disbursement.
                  </p>
                )}
                {disburseMsg && <p className="text-xs text-rose-600 mt-2 text-center">{disburseMsg}</p>}
              </div>

              {records.length === 0 ? (
                <div className={`${ADMIN.card} shadow-sm p-8 text-center text-sm text-[#71717A]`}>
                  No eligible staff found for this cycle.
                </div>
              ) : (
                <>
                  <div className="relative mb-3 max-w-xs">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#A1A1AA]" />
                    <input
                      value={search}
                      onChange={e => setSearch(e.target.value)}
                      placeholder="Search staff…"
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
                            <span className={`${SHEET.headCell} pl-[46px]`}>Staff</span>
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
                          <div className="px-4 py-8 text-center text-sm text-[#A1A1AA]">No staff match &quot;{search}&quot;.</div>
                        ) : visibleRecords.map((r, idx) => {
                          const staffLike = r.staff ? { full_name: r.staff.full_name, email: r.staff.email, role: r.staff.role } : undefined
                          const key = `payslip-${r.id}`
                          const open = expanded.has(r.id)
                          const { c, pf, esi, lopLateRs, lopLeaveRs, manualItems, previewItems, net } = rowFigures(r)
                          const lopTotalRs = lopLateRs + lopLeaveRs
                          // PF only computes when someone is enrolled *and* has a PF Basic wage,
                          // and a stored override beats both. Say which it is, so a zero in this
                          // column is never a mystery.
                          const pfCfg = baseMap[r.staff_id]
                          const pfWhy = r.pf_amount_override != null
                            ? `Manually set to ${formatINR(pf)} — clear the cell to use the computed figure`
                            : !pfCfg?.pf_applicable
                              ? 'PF is switched off for this person — turn it on in Base Salaries'
                              : !(Number(pfCfg?.pf_basic) > 0)
                                ? 'No PF Basic wage set for this person — add one in Base Salaries'
                                : 'Computed from PF Basic x the PF rate'
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
                                    <Avatar avatarUrl={r.staff?.avatar_url} name={r.staff?.full_name ?? '?'} size={24} userId={r.staff_id} />
                                    <div className="min-w-0 flex-1">
                                      <p className="text-xs font-semibold text-[#18181B] truncate">{r.staff?.full_name ?? 'Staff'}</p>
                                      <p className="text-[10px] text-[#71717A] truncate">{r.staff ? getRoleDisplayName(r.staff.role, r.staff.is_non_teaching) : ''}</p>
                                    </div>
                                    <button
                                      type="button"
                                      onClick={e => { e.stopPropagation(); r.staff && setDocsStaff(r.staff) }}
                                      disabled={!r.staff}
                                      title="Financial statements"
                                      className="flex-shrink-0 flex items-center justify-center text-[#A1A1AA] hover:text-[#27272A] disabled:opacity-30 transition-colors"
                                    >
                                      <FileText size={12} />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={e => { e.stopPropagation(); r.staff && setCalendarPerson(r.staff) }}
                                      disabled={!r.staff}
                                      title="Attendance calendar"
                                      className="flex-shrink-0 flex items-center justify-center text-[#A1A1AA] hover:text-[#27272A] disabled:opacity-30 transition-colors"
                                    >
                                      <CalendarDays size={12} />
                                    </button>
                                  </div>
                                  <EditableCell
                                    value={Number(r.base_amount) || 0} derived editable={!closed}
                                    format={formatINR} title="Base salary for this cycle"
                                    onSave={v => saveOverride(r.id, { base_amount: v ?? 0 })}
                                  />
                                  <EditableCell
                                    value={c?.workingDays ?? 0} derived={r.working_days_override == null} editable={!closed}
                                    align="center" format={n => String(n)} title="Working days — clear to use the calendar month"
                                    onSave={v => saveOverride(r.id, { working_days_override: v })}
                                  />
                                  <EditableCell
                                    value={c?.leaveCount ?? 0} derived={r.leave_override == null} editable={!closed}
                                    align="center" format={n => String(n)} title="Leave days — clear to use attendance"
                                    onSave={v => saveOverride(r.id, { leave_override: v })}
                                  />
                                  <EditableCell
                                    value={c?.lateCount ?? 0} derived={r.late_override == null} editable={!closed}
                                    align="center" format={n => String(n)} title="Late arrivals — clear to use attendance"
                                    onSave={v => saveOverride(r.id, { late_override: v })}
                                  />
                                  <span className="text-right text-[11px] tabular-nums text-[#71717A]" title={`${c?.lopFromLeave ?? 0} day(s)`}>{formatINR(lopLeaveRs)}</span>
                                  <span className="text-right text-[11px] tabular-nums text-[#71717A]" title={`${c?.lopFromLate ?? 0} day(s)`}>{formatINR(lopLateRs)}</span>
                                  <span className={`text-right text-[11px] font-semibold tabular-nums ${lopTotalRs > 0 ? 'text-rose-600' : 'text-[#71717A]'}`}>{formatINR(lopTotalRs)}</span>
                                  <span className="text-right text-[11px] tabular-nums text-[#71717A]">{formatINR(Math.round(c?.salaryPerDay ?? 0))}</span>
                                  <EditableCell
                                    value={pf} derived={r.pf_amount_override == null} editable={!closed}
                                    format={formatINR} title={pfWhy}
                                    onSave={v => saveOverride(r.id, { pf_amount_override: v })}
                                  />
                                  <EditableCell
                                    value={esi} derived={r.esi_amount_override == null} editable={!closed}
                                    format={formatINR} title="ESI — clear to use the computed figure"
                                    onSave={v => saveOverride(r.id, { esi_amount_override: v })}
                                  />
                                  <span className={`text-center text-[11px] tabular-nums ${(c?.bonusPoints ?? 0) > 0 ? 'text-emerald-600' : 'text-[#71717A]'}`}>{c?.bonusPoints ?? 0}</span>
                                  <span className="text-right text-sm font-bold text-[#18181B] tabular-nums">{formatINR(net)}</span>
                                </div>
                              </div>
                              {open && (
                                <div className="px-4 sm:px-5 py-4 bg-[#FAFAFA] border-t border-[#F4F4F5]">
                                  <div className="flex items-center justify-end gap-2 mb-3">
                                    <button
                                      disabled={pdfBusy === key}
                                      onClick={() => openPdf(key, `Payslip — ${r.staff?.full_name ?? 'Staff'}`, () => buildPayslip(r, staffLike, bankMap[r.staff_id]))}
                                      className="flex items-center gap-1 text-[11px] font-semibold text-[#71717A] hover:text-[#27272A] border border-[#E4E4E7] hover:border-[#D4D4D8] px-2.5 py-1.5 rounded-lg transition-colors disabled:opacity-50 flex-shrink-0"
                                    >
                                      <Receipt size={12} /> {pdfBusy === key ? '…' : 'Payslip'}
                                    </button>
                                  </div>
                                  <SalaryRecordItemsEditor
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
        {showDocs && cycle && (
          <DownloadCentreModal
            periodLabel={formatPeriod(cycle.period_month, cycle.period_year)}
            recordCount={records.length}
            busyKey={pdfBusy}
            onClose={() => setShowDocs(false)}
            onRegister={() => { setShowDocs(false); openPdf('register', 'Salary Register', () => buildSalaryRegister(cycle, records)) }}
            onBankTransfer={() => { setShowDocs(false); openPdf('bank', 'Bank Transfer Statement', () => buildBankTransferStatement(cycle, records, bankMap)) }}
            onStatutory={() => { setShowDocs(false); setShowEpfDocs(true) }}
          />
        )}
        {showEpfDocs && cycle && (
          <EpfDocumentsModal
            cycle={cycle}
            sourceRows={statutoryRows}
            daysInMonth={daysInMonth(cycle.period_year, cycle.period_month)}
            onClose={() => setShowEpfDocs(false)}
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
              {confirmAction === 'close' ? 'Lock this cycle?' : 'Unlock this cycle?'}
            </h3>
            <p className="text-sm text-slate-500 mb-4 leading-relaxed">
              {confirmAction === 'close'
                ? 'This locks in PF, ESI, LOP, and task bonus for every record based on current attendance and settings, and enables disbursement. Columns stop being editable, but you can unlock again at any time to make changes.'
                : 'This makes the cycle editable again and removes the auto-applied PF/ESI/LOP/bonus items so they recompute cleanly next time you lock. Manually added items are untouched.'}
            </p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setConfirmAction(null)} className="px-3 py-2 text-sm font-semibold text-slate-500 hover:text-slate-700">Cancel</button>
              <button
                onClick={confirmAction === 'close' ? closeCycle : reopenCycle}
                disabled={busy}
                className="btn-primary text-sm disabled:opacity-50"
              >
                {busy ? 'Working…' : confirmAction === 'close' ? 'Lock cycle' : 'Unlock cycle'}
              </button>
            </div>
          </ModalShell>
        )}
        {docsStaff && (
          <SalaryStatementsModal staff={docsStaff} onClose={() => setDocsStaff(null)} />
        )}
        {calendarPerson && (
          <AttendanceCalendarModal
            person={calendarPerson}
            viewerId={viewerId}
            onClose={() => setCalendarPerson(null)}
            onClosed={load}
          />
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
