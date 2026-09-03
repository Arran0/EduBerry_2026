'use client'

import React, { useState, useEffect, useCallback, useMemo } from 'react'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import { AnimatePresence } from 'framer-motion'
import { useParams } from 'next/navigation'
import {
  ArrowLeft, CalendarRange, Send, Download, ChevronRight,
  Receipt, SlidersHorizontal, Lock, LockOpen, CheckCheck, FileText, BadgeCheck, CalendarDays, Landmark,
  ShieldAlert,
} from 'lucide-react'
import ProtectedLayout from '@/components/ProtectedLayout'
import Avatar from '@/components/Avatar'
import ModalShell from '@/components/ui/ModalShell'
import SalaryRecordItemsEditor, { PreviewItem } from '@/components/salary/SalaryRecordItemsEditor'
import CycleSettingsModal from '@/components/salary/CycleSettingsModal'
import DownloadCentreModal from '@/components/salary/DownloadCentreModal'
import EditableCell from '@/components/salary/EditableCell'
import { useVerifiedEdits } from '@/components/salary/useVerifiedEdits'
import { describeRecordEdits, editFingerprint } from '@/lib/salaryEdits'
import AttendanceCalendarModal from '@/components/salary/AttendanceCalendarModal'
import CycleStatsStrip, { CycleTotals } from '@/components/salary/CycleStatsStrip'
import CycleToolbar, { CycleFilters, DEFAULT_CYCLE_FILTERS } from '@/components/salary/CycleToolbar'
import { ADMIN_GOLD, CYCLE_CHIP, CYCLE_STATUS_LABEL, PAID_CHIP, SHARP } from '@/components/salary/adminUi'
import { SHEET } from '@/components/bus/adminUI'
import { formatINR } from '@/components/bus/FeeCollectionSummary'
import { getDisplayRole, UserProfile } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { useSchoolClock } from '@/hooks/useSchoolClock'
import { fetchTeamMemberships, TeamMembership } from '@/lib/teams'
import {
  SalaryCycle, SalaryRecord, SalaryRecordItem, StaffBankAccount, StaffSalaryBase, PayoutConfig,
  fetchCycle, fetchCycleRecords, setCycleStatus, setCyclePayrollConfig, salaryNet, formatPeriod,
  fetchPayoutConfig, initiateCyclePayouts, fetchBankAccountsMap, fetchBaseSalaries,
  fetchMonthlyBonusPoints, bulkInsertSalaryItems, deleteSalaryItemsByLabel, bulkSetSalaryRecordStatus,
  updateSalaryRecordOverrides, SalaryRecordOverrides, fetchSalaryRecord, fetchHiddenSalaryMemberIds,
  recordPersonId, recordPersonName, recordPersonLeft,
  generateSalaryCycle, ensureDriverRecordsInCycle, ensureSupportStaffRecordsInCycle,
} from '@/lib/salary'
import { fetchDriverBaseSalaries } from '@/lib/driverSalary'
import { fetchDriverBankAccounts } from '@/lib/bus'
import {
  fetchSupportStaffSalaryBases, fetchSupportStaffBankAccounts, fetchSupportAttendanceRange,
  supportRecordToStaffShape,
} from '@/lib/supportStaff'
import {
  fetchMonthlyAttendanceRecords, fetchHolidays, fetchNonWorkingDays, fetchAttendanceTimingDeltas,
  recomputePendingAttendance,
  Holiday, NonWorkingDay, AttendanceTimingDelta, StaffAttendanceRecord,
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

/**
 * How many rows mount at a time.
 *
 * A cycle is one row per person and a school runs to a hundred, each carrying
 * an avatar and six editable cells. Mounting them all costs a visible pause on
 * open and again on every keystroke in the search box, for rows nobody has
 * scrolled to yet. The month's data is still fetched in full — the totals and
 * the bank export have to cover the whole cycle — but the DOM is built a
 * screenful at a time.
 */
const ROWS_PER_CHUNK = 30

/** Sum every stored item carrying this label — tolerates duplicates left by an interrupted close. */
function sumItems(items: SalaryRecordItem[] | undefined, label: string): number {
  return (items ?? []).filter(i => i.label === label).reduce((s, i) => s + Number(i.amount || 0), 0)
}

/**
 * Shared 14-column grid — the header and every data row use this exact
 * template, so headings always sit above their own column.
 *
 * Applied as an inline style rather than a Tailwind `grid-cols-[...]` class:
 * Tailwind only emits CSS for complete class names it can find as literal
 * text in the source, so a template this long (which has to be assembled
 * from several string pieces to stay readable) would never get generated and
 * the grid would silently collapse to a single stacked column.
 */
const GRID = 'grid items-center gap-x-1.5'
const GRID_COLS = [
  // The sign-off sits first so it stays on screen at the width a phone scrolls
  // the sheet to — a check you have to scroll sideways to find is one that
  // gets skipped.
  '22px',                 // hand-edit sign-off
  // The staff column takes a deliberately outsized share of the spare width:
  // the numeric columns are fixed-width figures that gain nothing from more
  // room, while a full name plus its role, an avatar and three icons is the
  // one cell that actually needs it. At the sheet's floor every column is at
  // its minimum and the name truncates; past that, the growth goes here.
  'minmax(168px,2.8fr)',  // staff (chevron + avatar + name + statements & calendar icons)
  'minmax(74px,1fr)',     // base
  'minmax(46px,0.66fr)',  // work days
  'minmax(44px,0.6fr)',   // leave
  'minmax(40px,0.56fr)',  // late
  'minmax(44px,0.58fr)',  // half day
  // The per-reason loss-of-pay splits are gone: three columns said one thing,
  // and the reason is already in the Leave/Late/Half counts beside them and in
  // the expanded row's item list.
  'minmax(70px,0.85fr)',  // LOP total
  'minmax(62px,0.75fr)',  // ₹/day
  'minmax(60px,0.8fr)',   // PF
  'minmax(60px,0.8fr)',   // ESI
  'minmax(70px,0.9fr)',   // other (hand-added bonuses & deductions, netted)
  'minmax(46px,0.62fr)',  // bonus points
  'minmax(84px,1.1fr)',   // net pay
].join(' ')

interface RowComputed {
  lateCount: number
  leaveCount: number
  halfDayCount: number
  workingDays: number
  salaryPerDay: number
  lopFromLate: number
  lopFromLeave: number
  lopFromHalfDay: number
  lopLateRs: number
  lopLeaveRs: number
  lopHalfDayRs: number
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
  // The same clock the attendance calendar reads. A month still in progress is
  // only adjudicated up to "today", so the Leave column and the calendar's
  // Absent chip have to agree on which day that is — the device's UTC date
  // spends part of every day behind the school's.
  const { today: schoolToday } = useSchoolClock()

  const [loading, setLoading] = useState(true)
  const [cycle, setCycle] = useState<SalaryCycle | null>(null)
  const [records, setRecords] = useState<SalaryRecord[]>([])
  const [payoutCfg, setPayoutCfg] = useState<PayoutConfig | null>(null)
  const [bankMap, setBankMap] = useState<Record<string, StaffBankAccount>>({})
  const [baseMap, setBaseMap] = useState<Record<string, StaffSalaryBase>>({})
  const [attendanceRecords, setAttendanceRecords] = useState<StaffAttendanceRecord[]>([])
  const [holidays, setHolidays] = useState<Holiday[]>([])
  const [nonWorkingDays, setNonWorkingDays] = useState<NonWorkingDay[]>([])
  const [timingDeltas, setTimingDeltas] = useState<Map<string, AttendanceTimingDelta>>(new Map())
  const [bonusPoints, setBonusPoints] = useState<Record<string, number>>({})
  const [globalCalibration, setGlobalCalibration] = useState<PayrollCalibration>(DEFAULT_PAYROLL_CALIBRATION)
  const [teams, setTeams] = useState<TeamMembership[]>([])
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
  const [filters, setFilters] = useState<CycleFilters>(DEFAULT_CYCLE_FILTERS)
  /** Records left out of the sheet because the person has resigned or is hidden. */
  const [excludedCount, setExcludedCount] = useState(0)
  /** How many rows are actually mounted — the rest arrive as you scroll. */
  const [renderLimit, setRenderLimit] = useState(ROWS_PER_CHUNK)
  const verified = useVerifiedEdits(cycleId)

  const toggleExpanded = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const load = useCallback(async () => {
    setLoading(true)
    // Late and Half Day are LOP occurrences, so an attendance rule edited after
    // the day it covers moves real money on this sheet. Settle any such change
    // before the month's attendance is read, rather than computing a payslip
    // from statuses the attendance app has already stopped agreeing with. Costs
    // one read of an empty queue when nothing has changed.
    await recomputePendingAttendance()
    const [c, allRecs, cfg, bm, bases, driverBases, driverBanks, supportBases, supportBanks, globalCal, hiddenIds] = await Promise.all([
      fetchCycle(cycleId), fetchCycleRecords(cycleId), fetchPayoutConfig(), fetchBankAccountsMap(),
      fetchBaseSalaries(), fetchDriverBaseSalaries(), fetchDriverBankAccounts(),
      fetchSupportStaffSalaryBases(), fetchSupportStaffBankAccounts(),
      fetchPayrollCalibration(), fetchHiddenSalaryMemberIds(),
    ])

    // A cycle is generated once, for the roster at the moment it's run — a new
    // hire, a driver just enrolled, or a support-staff member just activated
    // afterwards never gets a row of their own. Left alone, an open cycle
    // silently drifts further behind the current roster the longer it stays
    // open, showing a headcount that no longer matches Base Salaries or Bank
    // Accounts. Re-running the generator is idempotent (it only ever inserts
    // rows that don't already exist), so it is safe to run again on every load
    // of an open cycle; a closed cycle is history and is never touched.
    let cycleRecs = allRecs
    if (c && c.status !== 'closed') {
      const [staffSync, driverSync, supportSync] = await Promise.all([
        generateSalaryCycle(c.period_month, c.period_year),
        ensureDriverRecordsInCycle(c.id),
        ensureSupportStaffRecordsInCycle(c.id),
      ])
      if (!staffSync.success) console.error('Roster sync (staff) failed:', staffSync.error)
      if (!driverSync.success) console.error('Roster sync (drivers) failed:', driverSync.error)
      if (!supportSync.success) console.error('Roster sync (support staff) failed:', supportSync.error)
      const added = (staffSync.created ?? 0) + (driverSync.added ?? 0) + (supportSync.added ?? 0)
      if (added > 0) cycleRecs = await fetchCycleRecords(cycleId)
    }

    // A cycle is generated for everyone on the roster at the time it was run,
    // so months later it still carries rows for people who have since resigned
    // (staff/driver) or left (support staff) — and for anyone an admin has
    // hidden from the salary app. Neither should be paid, and neither should be
    // counted in the month's totals, so they come out here rather than being
    // left for the eye to skip. The rows stay in the database; they are simply
    // not this sheet's business.
    const hidden = new Set(hiddenIds)
    const recs = cycleRecs.filter(r => !recordPersonLeft(r) && !hidden.has(recordPersonId(r)))
    setExcludedCount(cycleRecs.length - recs.length)
    setCycle(c); setRecords(recs); setPayoutCfg(cfg); setGlobalCalibration(globalCal)

    // A cycle lists staff, drivers and support staff together, but their
    // base-salary and bank details live in separate tables (support staff have
    // no profiles row to key a shared table off — see
    // supabase-migrations/add_support_staff_salary.sql). Key all three by
    // whichever id applies (recordPersonId) so every row can look its own up
    // without caring which kind of person it is.
    for (const a of driverBanks) {
      bm[a.driver_id] = { ...a, staff_id: a.driver_id } as unknown as StaffBankAccount
    }
    for (const a of supportBanks) {
      bm[a.support_staff_id] = { ...a, staff_id: a.support_staff_id } as unknown as StaffBankAccount
    }
    setBankMap(bm)

    const bMap: Record<string, StaffSalaryBase> = {}
    for (const b of bases) bMap[b.staff_id] = b
    for (const b of driverBases) {
      bMap[b.driver_id] = { ...b, staff_id: b.driver_id } as unknown as StaffSalaryBase
    }
    for (const b of supportBases) {
      bMap[b.support_staff_id] = { ...b, staff_id: b.support_staff_id } as unknown as StaffSalaryBase
    }
    setBaseMap(bMap)

    if (c && recs.length > 0) {
      // Profile-backed people (staff/drivers) vs. support staff read attendance
      // from two different tables — split the roster so each fetch only asks
      // its own table, then merge into one StaffAttendanceRecord-shaped array
      // (see supportRecordToStaffShape) so every downstream figure — working
      // days, leave, late, half day, LOP, PF, ESI — is computed by the exact
      // same math for everyone on the sheet, regardless of which table they
      // actually live in. Task-manager bonus points are profile-only: support
      // staff have no account to earn them with, so that fetch stays scoped to
      // staffIds.
      const staffIds = recs.filter(r => r.staff_id).map(r => r.staff_id as string)
      const supportStaffIds = new Set(recs.filter(r => r.support_staff_id).map(r => r.support_staff_id as string))
      const [staffAttRecs, hols, nonWorking, bonusPts, supportAttRecs] = await Promise.all([
        fetchMonthlyAttendanceRecords(staffIds, c.period_year, c.period_month),
        fetchHolidays(c.period_year, c.period_month),
        fetchNonWorkingDays(c.period_year, c.period_month),
        fetchMonthlyBonusPoints(staffIds, c.period_year, c.period_month),
        supportStaffIds.size > 0
          ? fetchSupportAttendanceRange(
              `${c.period_year}-${String(c.period_month).padStart(2, '0')}-01`,
              `${c.period_year}-${String(c.period_month).padStart(2, '0')}-${String(daysInMonth(c.period_year, c.period_month)).padStart(2, '0')}`,
            )
          : Promise.resolve([]),
      ])
      const attRecs = [
        ...staffAttRecs,
        ...supportAttRecs
          .filter(r => supportStaffIds.has(r.support_staff_id))
          .map(supportRecordToStaffShape),
      ]
      // Grace-minute lateness/earliness needs the fetched records first — the
      // day-timing cutoffs are resolved per date, not per staff, from them.
      // Support staff never punch, so they carry no timing deltas — grace
      // periods simply never apply to their Late/Half Day counts.
      const deltas = await fetchAttendanceTimingDeltas(staffAttRecs)
      setAttendanceRecords(attRecs); setHolidays(hols); setNonWorkingDays(nonWorking)
      setTimingDeltas(deltas); setBonusPoints(bonusPts)
    } else {
      setAttendanceRecords([]); setHolidays([]); setNonWorkingDays([])
      setTimingDeltas(new Map()); setBonusPoints({})
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

  // Team rosters drive the team filter only — they never change with the
  // cycle, so they load once rather than on every reload of the sheet.
  useEffect(() => { fetchTeamMemberships().then(setTeams) }, [])

  const calibration = useMemo(
    () => mergeCalibration(globalCalibration, cycle?.payroll_config ?? null),
    [globalCalibration, cycle],
  )

  const computedRows = useMemo(() => {
    const out: Record<string, RowComputed> = {}
    if (!cycle) return out
    // Non-working days shrink the payable days for everyone (whole-school
    // rows only, same as holidays' is_default-only scope for payroll);
    // holidays no longer do — see computeMonthlyStats for the same rule on
    // the personal calendar.
    const calendarDays = daysInMonth(cycle.period_year, cycle.period_month) - nonWorkingDays.length
    const bonusAmounts = computeBonusAmounts(bonusPoints, calibration.bonus)
    const grace = {
      lateGraceMinutes: calibration.lop.lateGraceMinutes,
      halfDayGraceMinutes: calibration.lop.halfDayGraceMinutes,
      timingDeltas,
    }
    for (const r of records) {
      const personId = recordPersonId(r)
      const base = baseMap[personId]
      const derived = computeStaffAttendanceStats(
        personId, attendanceRecords, holidays, nonWorkingDays, cycle.period_year, cycle.period_month,
        schoolToday ?? undefined, grace,
      )
      // A hand-typed override wins over the derived figure; null falls back to it.
      const workingDays = r.working_days_override ?? calendarDays
      const leaveCount = r.leave_override ?? derived.leaveCount
      const lateCount = r.late_override ?? derived.lateCount
      const halfDayCount = r.half_day_override ?? derived.halfDayCount

      const row = computePayrollRow({
        baseAmount: Number(r.base_amount) || 0,
        pfBasic: base?.pf_basic ?? null,
        pfApplicable: base?.pf_applicable ?? false,
        esiOverride: base?.esi_override ?? null,
        workingDaysInMonth: workingDays,
        lateCount, leaveCount, halfDayCount,
        calibration,
      })
      out[r.id] = {
        lateCount, leaveCount, halfDayCount, workingDays,
        salaryPerDay: row.salaryPerDay, lopFromLate: row.lopFromLate, lopFromLeave: row.lopFromLeave,
        lopFromHalfDay: row.lopFromHalfDay,
        lopLateRs: Math.round(row.lopFromLate * row.salaryPerDay),
        lopLeaveRs: Math.round(row.lopFromLeave * row.salaryPerDay),
        lopHalfDayRs: Math.round(row.lopFromHalfDay * row.salaryPerDay),
        pf: r.pf_amount_override ?? row.pf,
        esi: r.esi_amount_override ?? row.esi,
        bonusPoints: bonusPoints[personId] ?? 0, bonusAmount: bonusAmounts[personId] ?? 0,
      }
    }
    return out
  }, [cycle, records, calibration, attendanceRecords, holidays, nonWorkingDays, timingDeltas, bonusPoints, baseMap, schoolToday])

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
      const lopHalfDayRs = Math.abs(sumItems(stored, PAYROLL_ITEM_LABELS.lopHalfDay))
      const bonus = sumItems(stored, PAYROLL_ITEM_LABELS.bonus)
      return {
        c, pf, esi, lopLateRs, lopLeaveRs, lopHalfDayRs, bonus, manualItems, manualTotal,
        previewItems: undefined as PreviewItem[] | undefined,
        net: salaryNet(r),
      }
    }

    const pf = c?.pf ?? 0
    const esi = c?.esi ?? 0
    const lopLateRs = c?.lopLateRs ?? 0
    const lopLeaveRs = c?.lopLeaveRs ?? 0
    const lopHalfDayRs = c?.lopHalfDayRs ?? 0
    const bonus = c?.bonusAmount ?? 0
    return {
      c, pf, esi, lopLateRs, lopLeaveRs, lopHalfDayRs, bonus, manualItems, manualTotal,
      previewItems: [
        { label: PAYROLL_ITEM_LABELS.pf, amount: -pf },
        { label: PAYROLL_ITEM_LABELS.esi, amount: -esi },
        { label: PAYROLL_ITEM_LABELS.lopLate, amount: -lopLateRs },
        { label: PAYROLL_ITEM_LABELS.lopLeave, amount: -lopLeaveRs },
        { label: PAYROLL_ITEM_LABELS.lopHalfDay, amount: -lopHalfDayRs },
        { label: PAYROLL_ITEM_LABELS.bonus, amount: bonus },
      ] as PreviewItem[],
      net: base - pf - esi - lopLateRs - lopLeaveRs - lopHalfDayRs + bonus + manualTotal,
    }
  }, [computedRows, closed])

  /** What a row has had typed into it by hand — see src/lib/salaryEdits.ts. */
  const editsOf = useCallback(
    (r: SalaryRecord) => describeRecordEdits(r, baseMap[recordPersonId(r)]?.base_amount),
    [baseMap],
  )

  /** Edited rows still waiting to be signed off. Locking is blocked until this is empty. */
  const unverified = useMemo(
    () => records.filter(r => {
      const e = editsOf(r)
      return e.length > 0 && !verified.isVerified(r.id, editFingerprint(e))
    }),
    [records, editsOf, verified],
  )

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
    const { c, pf, esi, lopLateRs, lopLeaveRs, lopHalfDayRs } = rowFigures(r)
    const cfg = baseMap[recordPersonId(r)]
    const baseAmount = Number(r.base_amount) || 0
    const perDay = c?.salaryPerDay ?? 0
    const lopDays = closed && perDay > 0
      ? (lopLateRs + lopLeaveRs + lopHalfDayRs) / perDay
      : (c?.lopFromLate ?? 0) + (c?.lopFromLeave ?? 0) + (c?.lopFromHalfDay ?? 0)
    return {
      staffId: recordPersonId(r),
      name: recordPersonName(r),
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

  const paidCount = records.filter(r => r.status === 'paid').length
  const allPaid = records.length > 0 && paidCount === records.length
  const autoProvider = !!payoutCfg?.enabled && payoutCfg.provider !== 'manual'

  /** Union of the rosters of every selected team; null when no team is selected. */
  const teamMemberIds = useMemo(() => {
    if (filters.teamIds.length === 0) return null
    const ids = new Set<string>()
    for (const t of teams) {
      if (filters.teamIds.includes(t.id)) for (const m of t.memberIds) ids.add(m)
    }
    return ids
  }, [filters.teamIds, teams])

  /**
   * The rows the sheet is showing — and, deliberately, the exact set the bank
   * CSV export and the stats strip work from, so what is on screen, what is
   * totalled, and what would be exported can never be three different things.
   */
  const visibleRecords = useMemo(() => {
    const q = filters.search.trim().toLowerCase()
    const out = records.filter(r => {
      if (q) {
        const hay = `${recordPersonName(r)} ${r.staff?.email ?? ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      // Support staff are on no team, so a team filter naturally excludes
      // them — r.staff_id is null for those rows and never in the set.
      if (teamMemberIds && !(r.staff_id && teamMemberIds.has(r.staff_id))) return false
      if (filters.pay === 'paid' && r.status !== 'paid') return false
      if (filters.pay === 'unpaid' && r.status === 'paid') return false
      if (filters.noBank && bankMap[recordPersonId(r)]) return false
      if (filters.withLop) {
        const f = rowFigures(r)
        if (f.lopLateRs + f.lopLeaveRs + f.lopHalfDayRs <= 0) return false
      }
      return true
    })

    // Sort keys are computed once per row, not inside the comparator, which
    // would re-derive each record's figures O(n log n) times.
    const dir = filters.desc ? -1 : 1
    const keyed = out.map(r => {
      const f = rowFigures(r)
      const num =
        filters.sort === 'net' ? f.net
        : filters.sort === 'base' ? Number(r.base_amount) || 0
        : filters.sort === 'lop' ? f.lopLateRs + f.lopLeaveRs + f.lopHalfDayRs
        : filters.sort === 'statutory' ? f.pf + f.esi
        : filters.sort === 'leave' ? f.c?.leaveCount ?? 0
        : null
      return { r, num, name: recordPersonName(r).toLowerCase(), edited: editsOf(r).length > 0 }
    })
    keyed.sort((a, b) => (
      // Hand-edited rows come first whatever the sort — they are the ones
      // somebody has to look at before this cycle can be locked, and hunting
      // for them down a hundred-row sheet is how they get missed.
      Number(b.edited) - Number(a.edited) ||
      (a.num === null || b.num === null
        ? a.name.localeCompare(b.name) * dir
        // Equal figures fall back to the name, so the order is stable and
        // readable rather than whatever the filter happened to leave behind.
        : ((a.num - b.num) || a.name.localeCompare(b.name) * (filters.desc ? -1 : 1)) * dir)
    ))
    return keyed.map(k => k.r)
  }, [records, filters, teamMemberIds, bankMap, rowFigures, editsOf])

  const narrowed = visibleRecords.length !== records.length

  // Narrowing the list starts the count again — otherwise a search that matches
  // three people would still be paying to keep ninety rows mounted.
  useEffect(() => { setRenderLimit(ROWS_PER_CHUNK) }, [filters])

  const mountedRecords = visibleRecords.slice(0, renderLimit)
  const moreToMount = visibleRecords.length - mountedRecords.length

  // Mount the next chunk as its placeholder comes into view. The margin means
  // the rows are already there by the time the scroll reaches them, so this
  // reads as a long sheet rather than as paging.
  //
  // The sentinel is tracked as state rather than through a ref, because the
  // node appears a render *later* than the count that describes it: the
  // records land while the sheet is still behind its loading spinner, so a
  // ref-based effect would run once against a null ref and then never again,
  // its dependency having already settled. Keying off the element itself means
  // the observer is attached the moment there is something to observe.
  const [sentinel, setSentinel] = useState<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!sentinel || moreToMount <= 0) return
    const io = new IntersectionObserver(
      entries => { if (entries.some(e => e.isIntersecting)) setRenderLimit(n => n + ROWS_PER_CHUNK) },
      { rootMargin: '600px' },
    )
    io.observe(sentinel)
    return () => io.disconnect()
  }, [sentinel, moreToMount])

  /**
   * Totals for whatever set is passed in.
   *
   * `additions` is derived rather than summed: net + statutory + LOP is by
   * construction base + bonus + manual adjustments, so taking base back off
   * it captures hand-added items as well as the task bonus without a second
   * pass over every record's items.
   */
  const totalsOf = useCallback((recs: SalaryRecord[]): CycleTotals => {
    let base = 0, statutory = 0, lop = 0, net = 0
    for (const r of recs) {
      const f = rowFigures(r)
      base += Number(r.base_amount) || 0
      statutory += f.pf + f.esi
      lop += f.lopLateRs + f.lopLeaveRs + f.lopHalfDayRs
      net += f.net
    }
    return { count: recs.length, base, additions: net + statutory + lop - base, statutory, lop, net }
  }, [rowFigures])

  const totals = useMemo(() => totalsOf(visibleRecords), [totalsOf, visibleRecords])

  /**
   * Re-read one record and slot it back into the sheet.
   *
   * Every figure on the row — LOP, PF, ESI, net, the totals strip — is a
   * `useMemo` over `records`, so replacing the one record recomputes exactly
   * what changed. The whole-cycle `load()` this replaced re-fetched every
   * record, every bank account, both base-salary tables and a month of
   * attendance to refresh a single cell.
   */
  const refreshRecord = useCallback(async (recordId: string) => {
    const fresh = await fetchSalaryRecord(recordId)
    if (!fresh) return
    setRecords(prev => prev.map(r => (r.id === recordId ? fresh : r)))
  }, [])

  /** Persist one hand-typed cell, then refresh just that row. */
  const saveOverride = async (recordId: string, patch: SalaryRecordOverrides) => {
    const res = await updateSalaryRecordOverrides(recordId, patch)
    if (!res.success) { setDisburseMsg(`Could not save: ${res.error}`); return }
    setDisburseMsg(null)
    await refreshRecord(recordId)
  }

  const closeCycle = async () => {
    if (!cycle || busy) return
    if (unverified.length > 0) {
      setConfirmAction(null)
      setDisburseMsg(
        `${unverified.length} hand-edited row(s) still need checking before this cycle can be locked. ` +
        'They are at the top of the sheet — tick each one to confirm its figures.',
      )
      return
    }
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
      if (c.lopHalfDayRs > 0) items.push({ record_id: r.id, label: PAYROLL_ITEM_LABELS.lopHalfDay, amount: -c.lopHalfDayRs })
      if (c.bonusAmount > 0) items.push({ record_id: r.id, label: PAYROLL_ITEM_LABELS.bonus, amount: c.bonusAmount })
    }
    const ins = await bulkInsertSalaryItems(items)
    if (!ins.success) { setBusy(false); setDisburseMsg(`Could not lock cycle: ${ins.error}`); return }

    const st = await bulkSetSalaryRecordStatus(recordIds, 'approved')
    if (!st.success) { setBusy(false); setDisburseMsg(`Could not lock cycle: ${st.error}`); return }

    const cy = await setCycleStatus(cycleId, 'closed')
    if (!cy.success) { setBusy(false); setDisburseMsg(`Could not lock cycle: ${cy.error}`); return }

    // The sign-offs were a check on the way to this point; past it the figures
    // are fixed and the notes have nothing left to say.
    verified.clear()
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
      setDisburseMsg('Bank disbursement is off — download the bank CSV above, upload it at your bank to disburse, then mark all as paid.')
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

  /**
   * Export a bank upload file for the rows currently on screen.
   *
   * Exporting the filtered set rather than the whole cycle is the point: a
   * school routinely releases one team, or the people whose accounts are
   * actually on file, ahead of the rest.
   */
  const downloadBankCsv = () => {
    if (!cycle) return
    setDisburseMsg(null)
    const { fileName, rows, included, missingBank, notApproved } =
      buildBankDisbursementCsv(cycle, visibleRecords, bankMap)

    if (included === 0) {
      setDisburseMsg(
        notApproved === 0
          ? 'No records with bank details on file to export. Add bank accounts first.'
          : !closed
            ? 'Nothing to export yet — lock the cycle first so its records are approved for payment.'
            : `Nothing to export: all ${notApproved} ${narrowed ? 'filtered ' : ''}record(s) are already marked paid.`,
      )
      return
    }
    downloadCsv(fileName, rows)
    setDisburseMsg(
      `Exported ${included}${narrowed ? ` of the ${visibleRecords.length} filtered` : ''} record(s) to ${fileName}.csv.` +
      (missingBank.length ? ` Skipped (no bank details): ${missingBank.join(', ')}.` : '') +
      (notApproved > 0 ? ` Skipped ${notApproved} already-paid or unapproved record(s).` : ''),
    )
  }

  return (
    <ProtectedLayout adminOnly>
      <div data-page-theme="salary" className="bg-[#FAFAFA]" style={{ minHeight: '100vh' }}>
        {/* Phones give the sheet the entire viewport width — a payroll grid is
            the one screen where a 16px gutter on each side is a column lost. */}
        <div className="max-w-[1600px] mx-auto px-0 sm:px-6 lg:px-8 py-3 sm:py-6">
          <div className="px-2 sm:px-0">
            <Link href="/more/salary" className="inline-flex items-center gap-1.5 text-xs text-[#71717A] hover:text-[#27272A] mb-2.5 transition-colors">
              <ArrowLeft size={14} /> Salary Manager
            </Link>
          </div>

          {loading ? (
            <div className="text-center py-12"><div className="spinner mx-auto mb-3" /><p className="text-sm text-[#71717A]">Loading…</p></div>
          ) : !cycle ? (
            <div className="bg-white border border-[#E4E4E7] p-8 text-center text-sm text-[#71717A]">
              Cycle not found.
            </div>
          ) : (
            <>
              {/* Wraps rather than squeezes: on a narrow phone the three controls
                  drop to their own line instead of crushing the period heading. */}
              <div className="flex flex-wrap items-center gap-2 mb-2.5 px-2 sm:px-0">
                <div className="w-9 h-9 bg-[#27272A] flex items-center justify-center flex-shrink-0">
                  <CalendarRange style={{ color: ADMIN_GOLD }} size={17} />
                </div>
                <div className="flex-1 min-w-[150px]">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <h1 className="font-display text-lg sm:text-xl font-bold text-[#18181B] leading-none">{formatPeriod(cycle.period_month, cycle.period_year)}</h1>
                    <span className={`text-[9px] px-1.5 py-0.5 font-bold uppercase tracking-[0.1em] ${CYCLE_CHIP[cycle.status]}`}>
                      {CYCLE_STATUS_LABEL[cycle.status]}
                    </span>
                    {allPaid && (
                      <span className={`inline-flex items-center gap-1 text-[9px] px-1.5 py-0.5 font-bold uppercase tracking-[0.1em] ${PAID_CHIP}`}>
                        <BadgeCheck size={10} /> Paid
                      </span>
                    )}
                    {cycle.payroll_config && (
                      <span className="text-[9px] px-1.5 py-0.5 font-bold uppercase tracking-[0.1em] bg-[#FBF6E9] text-[#8A6D1F] border border-[#EFE3C4]">
                        Custom rules
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-1.5 ml-auto flex-shrink-0">
                  <LockSwitch
                    closed={closed}
                    disabled={busy || (!closed && records.length === 0)}
                    onSelect={next => setConfirmAction(next)}
                  />
                  <button
                    onClick={() => setShowSettings(true)}
                    title="Cycle settings"
                    aria-label="Cycle settings"
                    className={`${SHARP.ghostBtn} !py-[7px]`}
                  >
                    <SlidersHorizontal size={13} />
                  </button>
                  {records.length > 0 && (
                    <button onClick={() => setShowDocs(true)} title="Download Centre"
                      className={`${SHARP.darkBtn} !py-[7px]`}>
                      <Download size={13} /> <span className="hidden sm:inline">Download Centre</span>
                    </button>
                  )}
                </div>
              </div>

              {records.length === 0 ? (
                <div className="bg-white border border-[#E4E4E7] p-8 text-center text-sm text-[#71717A]">
                  {excludedCount > 0
                    ? `Every record in this cycle belongs to someone who has since left or is hidden from the salary app (${excludedCount}).`
                    : 'No eligible staff found for this cycle.'}
                </div>
              ) : (
                <>
                  <CycleStatsStrip totals={totals} filtered={narrowed} />


                  <div className="px-2 sm:px-0">
                    <CycleToolbar
                      filters={filters}
                      onChange={setFilters}
                      teams={teams}
                      shown={visibleRecords.length}
                      total={records.length}
                      onExportCsv={downloadBankCsv}
                      exportDisabled={visibleRecords.length === 0}
                    />
                  </div>

                  {(closed || disburseMsg) && (
                    <div className="bg-white border border-[#E4E4E7] mb-2 px-2.5 py-2">
                      {closed ? (
                        <div className="flex flex-wrap items-center gap-1.5">
                          <button onClick={disburse} disabled={busy} className={SHARP.darkBtn}>
                            <Send size={12} /> {busy ? 'Disbursing…' : autoProvider
                              ? `Pay via ${payoutCfg?.provider}`
                              : 'Disburse via linked bank'}
                          </button>
                          {!autoProvider && (
                            <button onClick={markAllPaid} disabled={busy || allPaid} className={SHARP.ghostBtn}>
                              <CheckCheck size={12} /> Mark all paid
                            </button>
                          )}
                        </div>
                      ) : null}
                      {disburseMsg && (
                        <p className={`text-[11px] text-[#71717A] leading-snug ${closed ? 'mt-1.5 pt-1.5 border-t border-[#F4F4F5]' : ''}`}>
                          {disburseMsg}
                        </p>
                      )}
                    </div>
                  )}

                  {!closed && unverified.length > 0 && (
                    <div className="flex items-start gap-1.5 bg-[#FBF6E9] border border-[#EFE3C4] text-[#8A6D1F] px-2.5 py-2 mb-2 mx-2 sm:mx-0">
                      <ShieldAlert size={13} className="flex-shrink-0 mt-px" />
                      <p className="text-[11px] leading-snug">
                        <span className="font-semibold">{unverified.length} row(s) have hand-typed figures.</span>{' '}
                        They are pinned to the top of the sheet — tick each one to confirm it before locking the
                        cycle. Editing a row again clears its tick.
                      </p>
                    </div>
                  )}

                  {!closed && (
                    <p className="text-[10px] text-[#A1A1AA] mb-2 px-2 sm:px-0">
                      Figures are a live preview. Lock the cycle to fix PF/ESI/LOP/bonus and enable disbursement.
                      {excludedCount > 0 && ` ${excludedCount} record(s) hidden — left or hidden from the salary app.`}
                    </p>
                  )}

                  <div className="overflow-x-auto">
                    <div className="min-w-[1000px] bg-white border-y sm:border border-[#E4E4E7]">
                      {/* Header — shares the GRID template with every data row, so labels always sit above their column.
                          Always visible (not just sm+): it sits inside the same overflow-x-auto/min-w wrapper
                          as the rows, so it scrolls in sync with them on phones instead of leaving the columns unlabeled. */}
                      <div className="flex items-stretch bg-[#27272A]">
                        <div className="w-1 flex-shrink-0" />
                        <div className={`${GRID} flex-1 min-w-0 px-2.5 py-2`} style={{ gridTemplateColumns: GRID_COLS }}>
                          <span className={`${SHEET.headCell} text-center`} title="Sign-off on hand-edited rows">✓</span>
                          <span className={`${SHEET.headCell} pl-[42px]`}>Staff</span>
                          <span className={`${SHEET.headCell} text-right`}>Base</span>
                          <span className={`${SHEET.headCell} text-center`}>Days</span>
                          <span className={`${SHEET.headCell} text-center`}>Leave</span>
                          <span className={`${SHEET.headCell} text-center`}>Late</span>
                          <span className={`${SHEET.headCell} text-center`}>Half</span>
                          <span className={`${SHEET.headCell} text-right`}>LOP</span>
                          <span className={`${SHEET.headCell} text-right`}>₹/Day</span>
                          <span className={`${SHEET.headCell} text-right`}>PF</span>
                          <span className={`${SHEET.headCell} text-right`}>ESI</span>
                          <span className={`${SHEET.headCell} text-right`}>Other</span>
                          <span className={`${SHEET.headCell} text-center`}>Pts</span>
                          <span className={`${SHEET.headCell} text-right`}>Net pay</span>
                        </div>
                      </div>

                      {visibleRecords.length === 0 ? (
                        <div className="px-4 py-8 text-center text-sm text-[#A1A1AA]">
                          No staff match the current search and filters.
                        </div>
                      ) : mountedRecords.map((r, idx) => {
                        const staffLike = r.staff
                          ? { full_name: r.staff.full_name, email: r.staff.email, role: r.staff.role }
                          : r.support_staff
                            ? { full_name: r.support_staff.full_name, email: null, role: r.support_staff.designation || 'Support Staff' }
                            : undefined
                        const key = `payslip-${r.id}`
                        const open = expanded.has(r.id)
                        const { c, pf, esi, lopLateRs, lopLeaveRs, lopHalfDayRs, manualItems, manualTotal, previewItems, net } = rowFigures(r)
                        const lopTotalRs = lopLateRs + lopLeaveRs + lopHalfDayRs
                        const edits = editsOf(r)
                        const fingerprint = editFingerprint(edits)
                        const signedOff = edits.length > 0 && verified.isVerified(r.id, fingerprint)
                        // PF only computes when someone is enrolled *and* has a PF Basic wage,
                        // and a stored override beats both. Say which it is, so a zero in this
                        // column is never a mystery.
                        const pfCfg = baseMap[recordPersonId(r)]
                        const pfWhy = r.pf_amount_override != null
                          ? `Manually set to ${formatINR(pf)} — clear the cell to use the computed figure`
                          : !pfCfg?.pf_applicable
                            ? 'PF is switched off for this person — turn it on in Base Salaries'
                            : !(Number(pfCfg?.pf_basic) > 0)
                              ? 'No PF Basic wage set for this person — add one in Base Salaries'
                              : 'Computed from PF Basic x the PF rate'
                        const bar = r.status === 'paid' ? 'bg-[#27272A]' : r.status === 'approved' ? 'bg-[#B8983C]' : 'bg-[#D4D4D8]'
                        const hasBank = !!bankMap[recordPersonId(r)]
                        return (
                          <div key={r.id} className={idx < mountedRecords.length - 1 ? 'border-b border-[#F4F4F5]' : ''}>
                            <div
                              role="button"
                              tabIndex={0}
                              onClick={() => toggleExpanded(r.id)}
                              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleExpanded(r.id) } }}
                              className="flex items-stretch hover:bg-[#FAFAFA] transition-colors cursor-pointer"
                            >
                              <div className={`${SHEET.bar} ${bar}`} />
                              <div className={`${GRID} flex-1 min-w-0 px-2.5 py-1.5`} style={{ gridTemplateColumns: GRID_COLS }}>
                                {/* Empty for a row nothing was typed into: only a
                                    hand-edited figure needs a person to vouch for it. */}
                                {edits.length === 0 ? <span /> : (
                                  <input
                                    type="checkbox"
                                    checked={signedOff}
                                    disabled={closed}
                                    onClick={e => e.stopPropagation()}
                                    onChange={e => verified.setVerified(r.id, fingerprint, e.target.checked)}
                                    title={`Hand-edited: ${edits.join(', ')}. Tick once you have checked these figures — editing the row again clears the tick.`}
                                    aria-label={`Confirm hand-edited figures for ${recordPersonName(r) || 'this row'}`}
                                    className="w-3 h-3 accent-[#27272A] cursor-pointer disabled:cursor-default"
                                  />
                                )}
                                <div className="flex items-center gap-1 min-w-0">
                                  <ChevronRight size={13} className={`text-[#A1A1AA] flex-shrink-0 transition-transform ${open ? 'rotate-90' : ''}`} />
                                  <Avatar avatarUrl={r.staff?.avatar_url} name={recordPersonName(r) || '?'} size={22} userId={r.staff_id ?? undefined} />
                                  <div className="min-w-0 flex-1 leading-tight">
                                    <p className="text-[11px] font-semibold text-[#18181B] truncate">{recordPersonName(r) || 'Staff'}</p>
                                    <p className="text-[9px] text-[#71717A] truncate">
                                      {r.staff ? getDisplayRole(r.staff) : r.support_staff ? (r.support_staff.designation || 'Support Staff') : ''}
                                    </p>
                                  </div>
                                  {!hasBank && (
                                    <span title="No bank account on file — this row can't be exported for disbursement"
                                      className="flex-shrink-0 text-[#BE123C]">
                                      <Landmark size={11} />
                                    </span>
                                  )}
                                  <button
                                    type="button"
                                    onClick={e => { e.stopPropagation(); r.staff && setDocsStaff(r.staff) }}
                                    disabled={!r.staff}
                                    title="Financial statements"
                                    className="flex-shrink-0 flex items-center justify-center text-[#A1A1AA] hover:text-[#27272A] disabled:opacity-30 transition-colors"
                                  >
                                    <FileText size={11} />
                                  </button>
                                  {/* One calendar at a time: the popup can correct attendance, and
                                      opening a second over it means two of them reload the cycle on
                                      close, the last one winning with figures read before the other's
                                      edit. */}
                                  <button
                                    type="button"
                                    onClick={e => { e.stopPropagation(); if (!calendarPerson && r.staff) setCalendarPerson(r.staff) }}
                                    disabled={!r.staff || !!calendarPerson}
                                    title={calendarPerson ? 'Close the open calendar first' : 'Attendance calendar'}
                                    className="flex-shrink-0 flex items-center justify-center text-[#A1A1AA] hover:text-[#27272A] disabled:opacity-30 transition-colors"
                                  >
                                    <CalendarDays size={11} />
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
                                  align="center" format={n => String(n)}
                                  title="Leave days — the Absent count on this staff member's attendance calendar for this month. Clear to go back to it."
                                  onSave={v => saveOverride(r.id, { leave_override: v })}
                                />
                                <EditableCell
                                  value={c?.lateCount ?? 0} derived={r.late_override == null} editable={!closed}
                                  align="center" format={n => String(n)} title="Late arrivals — clear to use attendance"
                                  onSave={v => saveOverride(r.id, { late_override: v })}
                                />
                                <EditableCell
                                  value={c?.halfDayCount ?? 0} derived={r.half_day_override == null} editable={!closed}
                                  align="center" format={n => String(n)} title="Half days — clear to use attendance"
                                  onSave={v => saveOverride(r.id, { half_day_override: v })}
                                />
                                <span
                                  className={`text-right text-[11px] font-semibold tabular-nums ${lopTotalRs > 0 ? 'text-[#BE123C]' : 'text-[#71717A]'}`}
                                  title={`${(c?.lopFromLeave ?? 0)} day(s) leave · ${(c?.lopFromLate ?? 0) + (c?.lopFromHalfDay ?? 0)} day(s) late/half day`}
                                >
                                  {formatINR(lopTotalRs)}
                                </span>
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
                                {/* Hand-added bonuses and deductions, netted against each
                                    other — the one column on the sheet that is nobody's
                                    formula. Open the row to see what makes it up. */}
                                <span
                                  className={`text-right text-[11px] tabular-nums ${
                                    manualTotal > 0 ? 'text-[#15803D] font-semibold'
                                      : manualTotal < 0 ? 'text-[#BE123C] font-semibold'
                                      : 'text-[#A1A1AA]'
                                  }`}
                                  title={manualItems.length === 0
                                    ? 'No manual bonuses or deductions on this row'
                                    : manualItems.map(i => `${i.label}: ${formatINR(Number(i.amount))}`).join('\n')}
                                >
                                  {manualTotal === 0 ? '—' : `${manualTotal > 0 ? '+' : '−'}${formatINR(Math.abs(manualTotal))}`}
                                </span>
                                <span className={`text-center text-[11px] tabular-nums ${(c?.bonusPoints ?? 0) > 0 ? 'text-[#15803D]' : 'text-[#71717A]'}`}>{c?.bonusPoints ?? 0}</span>
                                <span className="text-right text-[13px] font-bold text-[#18181B] tabular-nums">{formatINR(net)}</span>
                              </div>
                            </div>
                            {open && (
                              <div className="px-3 sm:px-4 py-3 bg-[#FAFAFA] border-t border-[#F4F4F5]">
                                <div className="flex items-center justify-end gap-2 mb-2.5">
                                  <button
                                    disabled={pdfBusy === key}
                                    onClick={() => openPdf(key, `Payslip — ${recordPersonName(r) || 'Staff'}`, () => buildPayslip(r, staffLike, bankMap[recordPersonId(r)]))}
                                    className={SHARP.ghostBtn}
                                  >
                                    <Receipt size={12} /> {pdfBusy === key ? '…' : 'Payslip'}
                                  </button>
                                </div>
                                <SalaryRecordItemsEditor
                                  record={r}
                                  onChanged={() => refreshRecord(r.id)}
                                  previewItems={previewItems}
                                  items={closed ? (r.items ?? []) : manualItems}
                                  net={net}
                                />
                                {r.payout_status && (
                                  <span className="inline-block text-[10px] px-2 py-0.5 font-semibold uppercase tracking-wide bg-[#FBF6E9] text-[#8A6D1F] border border-[#EFE3C4] mt-2">
                                    payout: {r.payout_status}
                                  </span>
                                )}
                                {r.notes && <p className="text-[11px] text-[#A1A1AA] mt-2.5 italic">{r.notes}</p>}
                              </div>
                            )}
                          </div>
                        )
                      })}

                      {moreToMount > 0 && (
                        <div ref={setSentinel} className="flex items-center justify-center gap-2 px-4 py-3 text-[11px] text-[#A1A1AA]">
                          <span className="spinner-sm" aria-hidden />
                          Loading {moreToMount} more row{moreToMount === 1 ? '' : 's'}…
                        </div>
                      )}
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
            sharp
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
            periodLabel={formatPeriod(cycle.period_month, cycle.period_year)}
            onClose={() => setShowSettings(false)}
            onSave={saveCycleConfig}
          />
        )}
        {confirmAction && (
          <ModalShell onClose={() => setConfirmAction(null)} size="sm" sharp>
            <h3 className="font-bold text-[#18181B] mb-1.5">
              {confirmAction === 'close' ? 'Lock this cycle?' : 'Unlock this cycle?'}
            </h3>
            <p className="text-sm text-[#71717A] mb-4 leading-relaxed">
              {confirmAction === 'close'
                ? 'This locks in PF, ESI, LOP, and task bonus for every record based on current attendance and settings, and enables disbursement. Columns stop being editable, but you can unlock again at any time to make changes.'
                : 'This makes the cycle editable again and removes the auto-applied PF/ESI/LOP/bonus items so they recompute cleanly next time you lock. Manually added items are untouched.'}
            </p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setConfirmAction(null)} className="px-3 py-2 text-sm font-semibold text-[#71717A] hover:text-[#27272A]">Cancel</button>
              <button
                onClick={confirmAction === 'close' ? closeCycle : reopenCycle}
                disabled={busy}
                className="bg-[#27272A] hover:bg-[#18181B] text-white text-sm font-semibold px-4 py-2 transition-colors disabled:opacity-40"
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
            year={cycle?.period_year}
            month={cycle?.period_month}
            periodLabel={cycle ? formatPeriod(cycle.period_month, cycle.period_year) : undefined}
            sharp
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

/**
 * The lock control, as a two-state switch rather than a single icon button.
 *
 * A lone padlock has to be read twice — is that icon the current state, or
 * what pressing it does? Showing both positions with the live one filled
 * answers that at a glance and makes the inactive half the thing you press,
 * which is also the only half that can fire a confirmation.
 */
function LockSwitch({ closed, disabled, onSelect }: {
  closed: boolean
  disabled: boolean
  onSelect: (action: 'close' | 'reopen') => void
}) {
  const seg = 'inline-flex items-center gap-1 px-2 py-[7px] text-[11px] font-semibold transition-colors disabled:cursor-default'
  return (
    <div className="inline-flex border border-[#27272A] flex-shrink-0" role="group" aria-label="Cycle lock state">
      <button
        onClick={() => onSelect('reopen')}
        disabled={disabled || !closed}
        aria-pressed={!closed}
        title={closed ? 'Unlock this cycle to edit it again' : 'This cycle is unlocked and editable'}
        className={`${seg} ${closed ? 'bg-white text-[#71717A] hover:text-[#27272A] disabled:opacity-40' : 'bg-[#27272A] text-white'}`}
      >
        <LockOpen size={12} /> Open
      </button>
      <button
        onClick={() => onSelect('close')}
        disabled={disabled || closed}
        aria-pressed={closed}
        title={closed ? 'This cycle is locked' : 'Lock this cycle to fix its figures and enable disbursement'}
        className={`${seg} ${closed ? 'bg-[#27272A] text-white' : 'bg-white text-[#71717A] hover:text-[#27272A] disabled:opacity-40'}`}
      >
        <Lock size={12} /> Locked
      </button>
    </div>
  )
}
