'use client'

import React, { useState, useEffect, useCallback, useMemo } from 'react'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import { AnimatePresence } from 'framer-motion'
import { useParams } from 'next/navigation'
import {
  ArrowLeft, CalendarRange, Send, Download, ChevronRight, Loader2,
  Receipt, SlidersHorizontal, Lock, LockOpen, CheckCheck, FileText, BadgeCheck, CalendarDays, Landmark,
  ShieldAlert,
} from 'lucide-react'
import ProtectedLayout from '@/components/ProtectedLayout'
import Avatar from '@/components/Avatar'
import ModalErrorBoundary from '@/components/ui/ModalErrorBoundary'
import SalaryRecordItemsEditor, { PreviewItem } from '@/components/salary/SalaryRecordItemsEditor'
import CycleSettingsModal from '@/components/salary/CycleSettingsModal'
import DownloadCentreModal from '@/components/salary/DownloadCentreModal'
import EditableCell from '@/components/salary/EditableCell'
import { useVerifiedEdits } from '@/components/salary/useVerifiedEdits'
import { describeRecordEdits, editFingerprint } from '@/lib/salaryEdits'
import AttendanceCalendarModal from '@/components/salary/AttendanceCalendarModal'
import CycleStatsStrip, { CycleTotals } from '@/components/salary/CycleStatsStrip'
import CycleToolbar, { CycleFilters, DEFAULT_CYCLE_FILTERS } from '@/components/salary/CycleToolbar'
import { CYCLE_STATUS_LABEL } from '@/components/salary/adminUi'
import {
  Btn, Chip, ConfirmModal, Deck, Fact, IconChip, LABEL, Loading, Note, Notice, Num, Panel, SHELL, SX,
} from '@/components/salary/ui'
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
  deleteSalaryRecordsByIds,
  updateSalaryRecordOverrides, SalaryRecordOverrides, fetchSalaryRecord, fetchHiddenSalaryMemberIds,
  recordPersonId, recordPersonName, recordPersonLeft, recordPersonKind,
  generateSalaryCycle, ensureDriverRecordsInCycle, ensureSupportStaffRecordsInCycle,
  freezeCycleRecordSnapshots, CycleRecordSnapshot,
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
import { SalarySheetCategory, SalarySheetRow } from '@/components/salary/statements/salarySheetXlsx'
import type { StatutorySourceRow } from '@/lib/statutory'

const StatementPreviewModal = dynamic(() => import('@/components/salary/statements/StatementPreviewModal'))
const SalaryStatementsModal = dynamic(() => import('@/components/salary/SalaryStatementsModal'))
const EpfDocumentsModal = dynamic(() => import('@/components/salary/EpfDocumentsModal'))
const SalarySheetPreviewModal = dynamic(() => import('@/components/salary/statements/SalarySheetPreviewModal'))

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

function capitalize(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s
}

/** Which Salary Sheet tab a record belongs on — the same Teaching / Non-Teaching /
 *  Support / Drivers split the office's own paper sheet uses, derived from the
 *  roster kind and (for staff) the same is_non_teaching flag the role badge
 *  already reads. Support staff (house-keeping etc., no profiles row) are kept
 *  apart from non-teaching office staff rather than folded into that tab. */
function salarySheetCategory(r: SalaryRecord): SalarySheetCategory {
  const kind = recordPersonKind(r)
  if (kind === 'driver') return 'driver'
  if (kind === 'support') return 'support'
  return r.staff?.is_non_teaching ? 'non_teaching' : 'teaching'
}

function salarySheetDesignation(r: SalaryRecord): string {
  if (r.staff) return getDisplayRole(r.staff)
  if (r.support_staff) return r.support_staff.designation || 'Support Staff'
  return r.person_role_snapshot ? capitalize(r.person_role_snapshot) : '—'
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
const GRID = 'grid items-center gap-x-2'

/** The laptop sheet below xl: who, then the five figures that decide a payslip. */
const COMPACT_COLS = 'minmax(0,2.2fr) minmax(0,1fr) minmax(0,1fr) minmax(0,1fr) minmax(0,1.1fr) 20px'
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
  '38px',                 // paid by cash
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
  const [showSalarySheet, setShowSalarySheet] = useState(false)
  const [docsStaff, setDocsStaff] = useState<UserProfile | null>(null)
  const [calendarPerson, setCalendarPerson] = useState<UserProfile | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [showSettings, setShowSettings] = useState(false)
  const [confirmAction, setConfirmAction] = useState<'close' | 'reopen' | null>(null)
  const [filters, setFilters] = useState<CycleFilters>(DEFAULT_CYCLE_FILTERS)
  /** Records left out of the sheet because the person has resigned or is hidden. */
  const [excludedCount, setExcludedCount] = useState(0)
  /** Their record ids — dropped for good when this (still open) cycle locks. See closeCycle. */
  const [excludedRecordIds, setExcludedRecordIds] = useState<string[]>([])
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
    // before the month's ATTENDANCE is read, rather than computing a payslip
    // from statuses the attendance app has already stopped agreeing with. Costs
    // one read of an empty queue when nothing has changed.
    //
    // Only the attendance fetch below depends on it, so it runs alongside the
    // cycle/records/config round trips rather than in front of them — waiting
    // for it there delayed everything on the page, including the rows and
    // totals that have nothing to do with attendance.
    // Kept settled even on the branch below that never awaits it (a cycle with
    // no rows reads no attendance), so a failure can't surface as an unhandled
    // rejection — the recompute is best-effort either way.
    const recompute = recomputePendingAttendance()
      .catch(e => { console.error('recomputePendingAttendance failed:', e); return null })
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
    // hidden from the salary app. While the cycle is still OPEN, neither
    // should be paid nor counted in the month's totals, so they come out here
    // rather than being left for the eye to skip — the rows stay in the
    // database; they are simply not this sheet's business yet.
    //
    // A CLOSED cycle is history: it must show every record exactly as it was
    // at the moment it was locked, whether the person behind it has since
    // resigned, been banned, changed role, or been deleted outright. So this
    // exclusion — and the roster sync above — only ever apply to an open
    // cycle; a closed one is never filtered.
    const hidden = new Set(hiddenIds)
    const isExcluded = (r: SalaryRecord) => recordPersonLeft(r) || hidden.has(recordPersonId(r))
    const recs = c && c.status === 'closed' ? cycleRecs : cycleRecs.filter(r => !isExcluded(r))
    setExcludedCount(c && c.status === 'closed' ? 0 : cycleRecs.length - recs.length)
    setExcludedRecordIds(c && c.status === 'closed' ? [] : cycleRecs.filter(isExcluded).map(r => r.id))
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
      // Here is where the recompute started above actually has to have landed.
      await recompute
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
    const closed = cycle.status === 'closed'
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
      // A closed cycle whose lock already froze every one of these counts
      // (see closeCycle's freezeCycleRecordSnapshots call) has no business
      // re-deriving them from *today's* attendance, holidays or grace
      // settings — that would let a change made after the lock quietly move
      // a figure that was supposed to be fixed. Only fall back to a live
      // derive when a count was never frozen: an open cycle (still a live
      // preview by design), or a cycle closed before this snapshotting
      // existed.
      const frozen = closed
        && r.working_days_snapshot != null && r.leave_snapshot != null
        && r.late_snapshot != null && r.half_day_snapshot != null
      const derived = frozen
        ? { leaveCount: 0, lateCount: 0, halfDayCount: 0 }
        : computeStaffAttendanceStats(
            personId, attendanceRecords, holidays, nonWorkingDays, cycle.period_year, cycle.period_month,
            schoolToday ?? undefined, grace,
          )
      // A hand-typed override wins outright (it's an explicit correction,
      // made and re-affirmed by an admin); next the value frozen at lock
      // time; only then the live derive.
      const workingDays = r.working_days_override ?? r.working_days_snapshot ?? calendarDays
      const leaveCount = r.leave_override ?? r.leave_snapshot ?? derived.leaveCount
      const lateCount = r.late_override ?? r.late_snapshot ?? derived.lateCount
      const halfDayCount = r.half_day_override ?? r.half_day_snapshot ?? derived.halfDayCount

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
        bonusPoints: (closed && r.bonus_points_snapshot != null) ? r.bonus_points_snapshot : (bonusPoints[personId] ?? 0),
        bonusAmount: bonusAmounts[personId] ?? 0,
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

  /** Sign off every currently-unverified row at once, against the values it holds right now. */
  const verifyAll = () => {
    for (const r of unverified) verified.setVerified(r.id, editFingerprint(editsOf(r)), true)
  }

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
      if (filters.kind !== 'all' && recordPersonKind(r) !== filters.kind) return false
      // Support staff are on no team, so a team filter naturally excludes
      // them — r.staff_id is null for those rows and never in the set.
      if (teamMemberIds && !(r.staff_id && teamMemberIds.has(r.staff_id))) return false
      if (filters.pay === 'paid' && r.status !== 'paid') return false
      if (filters.pay === 'unpaid' && r.status === 'paid') return false
      // A cash-marked row is never blocked on a bank account — it doesn't need one.
      if (filters.noBank && (bankMap[recordPersonId(r)] || r.pay_by_cash)) return false
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
        `${unverified.length} row(s) with typed-in figures need ticking before this cycle can lock. ` +
        'They are at the top of the sheet.',
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
    const snapshots: CycleRecordSnapshot[] = []
    for (const r of records) {
      const c = computedRows[r.id]
      if (!c) continue
      if (c.pf > 0) items.push({ record_id: r.id, label: PAYROLL_ITEM_LABELS.pf, amount: -c.pf })
      if (c.esi > 0) items.push({ record_id: r.id, label: PAYROLL_ITEM_LABELS.esi, amount: -c.esi })
      if (c.lopLateRs > 0) items.push({ record_id: r.id, label: PAYROLL_ITEM_LABELS.lopLate, amount: -c.lopLateRs })
      if (c.lopLeaveRs > 0) items.push({ record_id: r.id, label: PAYROLL_ITEM_LABELS.lopLeave, amount: -c.lopLeaveRs })
      if (c.lopHalfDayRs > 0) items.push({ record_id: r.id, label: PAYROLL_ITEM_LABELS.lopHalfDay, amount: -c.lopHalfDayRs })
      if (c.bonusAmount > 0) items.push({ record_id: r.id, label: PAYROLL_ITEM_LABELS.bonus, amount: c.bonusAmount })

      // Freeze who this record is for and its attendance-derived counts, so
      // once locked nothing about this row recomputes again — see
      // computedRows and load()'s roster filter for the read side of this.
      // A field the admin had already hand-overridden keeps whatever the
      // record already carries rather than taking a freshly derived value:
      // the override is what fixes that figure, and the snapshot must not
      // move it. (computedRows reads the override ahead of the snapshot
      // either way, so the stored value only matters if the override is
      // ever cleared.)
      snapshots.push({
        id: r.id,
        cycle_id: r.cycle_id,
        staff_id: r.staff_id,
        support_staff_id: r.support_staff_id,
        person_name_snapshot: recordPersonName(r) || null,
        person_role_snapshot: r.support_staff_id ? 'support' : (r.staff?.role ?? r.person_role_snapshot ?? null),
        working_days_snapshot: r.working_days_override == null ? c.workingDays : r.working_days_snapshot,
        leave_snapshot: r.leave_override == null ? c.leaveCount : r.leave_snapshot,
        late_snapshot: r.late_override == null ? c.lateCount : r.late_snapshot,
        half_day_snapshot: r.half_day_override == null ? c.halfDayCount : r.half_day_snapshot,
        bonus_points_snapshot: c.bonusPoints,
      })
    }
    const ins = await bulkInsertSalaryItems(items)
    if (!ins.success) { setBusy(false); setDisburseMsg(`Could not lock cycle: ${ins.error}`); return }

    const snap = await freezeCycleRecordSnapshots(snapshots)
    if (!snap.success) { setBusy(false); setDisburseMsg(`Could not lock cycle: ${snap.error}`); return }

    const st = await bulkSetSalaryRecordStatus(recordIds, 'approved')
    if (!st.success) { setBusy(false); setDisburseMsg(`Could not lock cycle: ${st.error}`); return }

    // Drop draft records for anyone who resigned or was hidden while this
    // cycle was open — a closed cycle shows every record it has with no such
    // filter, so left alone these would silently reappear the moment it
    // locks. See deleteSalaryRecordsByIds.
    if (excludedRecordIds.length > 0) {
      const purge = await deleteSalaryRecordsByIds(excludedRecordIds)
      if (!purge.success) { setBusy(false); setDisburseMsg(`Could not lock cycle: ${purge.error}`); return }
    }

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
      setDisburseMsg('Bank payouts are off. Download the bank file above, upload it at your bank, then mark everyone paid.')
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
      setDisburseMsg(`${res.initiated ?? 0} transfer(s) saved as ${res.file.filename}. Upload it at your bank to release the money, then mark everyone paid.`)
    } else {
      setDisburseMsg(`${res.initiated ?? 0} transfer(s) sent to your bank.`)
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
    const { fileName, rows, included, missingBank, notApproved, cash } =
      buildBankDisbursementCsv(cycle, visibleRecords, bankMap)

    if (included === 0) {
      setDisburseMsg(
        notApproved === 0
          ? cash > 0 && missingBank.length === 0
            ? `Nothing to download: all ${cash} ${narrowed ? 'filtered ' : ''}record(s) are paid in cash.`
            : 'Nobody here has bank details on file. Add bank accounts first.'
          : !closed
            ? 'Nothing to download yet. Lock the cycle first so its records are approved for payment.'
            : `Nothing to download: all ${notApproved} ${narrowed ? 'filtered ' : ''}record(s) are already marked paid.`,
      )
      return
    }
    downloadCsv(fileName, rows)
    setDisburseMsg(
      `Saved ${included}${narrowed ? ` of the ${visibleRecords.length} filtered` : ''} record(s) to ${fileName}.csv.` +
      (missingBank.length ? ` Left out, no bank details: ${missingBank.join(', ')}.` : '') +
      (notApproved > 0 ? ` Left out ${notApproved} already paid or not yet approved.` : '') +
      (cash > 0 ? ` Left out ${cash} paid in cash.` : ''),
    )
  }

  /**
   * Every record's Salary Sheet row, built once from the whole cycle — the
   * Salary Sheet preview does its own category/department/search filtering
   * (see SalarySheetPreviewModal), independent of whatever the cycle sheet's
   * own toolbar currently shows.
   */
  const salarySheetAllRows = useMemo<SalarySheetRow[]>(() => records.map(r => {
    const c = computedRows[r.id]
    const { pf, esi, bonus, manualItems, net, lopLateRs, lopLeaveRs, lopHalfDayRs } = rowFigures(r)
    const positiveManual = manualItems.filter(i => Number(i.amount) > 0).reduce((s, i) => s + Number(i.amount), 0)
    const negativeManual = Math.abs(manualItems.filter(i => Number(i.amount) < 0).reduce((s, i) => s + Number(i.amount), 0))
    // Leave/late/half-day counts (c?.*) already fold in the late-arrival and
    // half-day grace periods — see computeStaffAttendanceStats — for an open
    // cycle's live figures, and are the values frozen at lock time for a
    // closed one. The grace periods are payroll-only: they never change what
    // a staff member's own attendance calendar shows for the same day.
    const workingDays = c?.workingDays ?? 0
    const leaveCount = c?.leaveCount ?? 0
    const lateCount = c?.lateCount ?? 0
    const halfDayCount = c?.halfDayCount ?? 0
    return {
      category: salarySheetCategory(r),
      personId: recordPersonId(r),
      name: recordPersonName(r) || '—',
      designation: salarySheetDesignation(r),
      payByCash: r.pay_by_cash,
      baseAmount: Number(r.base_amount) || 0,
      workingDays,
      daysWorked: workingDays - (leaveCount + lateCount + halfDayCount),
      leaveCount, lateCount, halfDayCount,
      lopAmount: lopLateRs + lopLeaveRs + lopHalfDayRs,
      salaryPerDay: c?.salaryPerDay ?? 0,
      pf, esi,
      advance: negativeManual,
      extraOther: bonus + positiveManual,
      net,
    }
  }), [records, computedRows, rowFigures])

  const period = cycle ? formatPeriod(cycle.period_month, cycle.period_year) : ''

  return (
    <ProtectedLayout adminOnly>
      <div data-page-theme="salary" className="overflow-x-clip" style={{ minHeight: '100vh' }}>
        <div className={`${SHELL} px-4 sm:px-6 lg:px-8 pt-3 sm:pt-6 pb-14`}>
          <Link href="/more/salary"
            className="lg-pill inline-flex items-center gap-1.5 h-8 pl-2.5 pr-3.5 mb-3 text-[12.5px] font-semibold text-slate-700 hover:text-slate-900 transition-colors">
            <ArrowLeft size={14} /> Salary
          </Link>

          {loading ? (
            <Loading />
          ) : !cycle ? (
            <Panel><Note>This cycle does not exist any more.</Note></Panel>
          ) : (
            <>
              {/* Title and the cycle's three controls. The controls drop to their
                  own line on a narrow phone instead of crushing the month. */}
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2.5 mb-4">
                <div className="flex items-center gap-3 min-w-0 flex-1 basis-[220px]">
                  <IconChip icon={CalendarRange} />
                  <div className="min-w-0">
                    <h1 className="font-display text-[1.3rem] sm:text-[1.6rem] font-bold leading-[1.15] text-slate-900 headline break-words">
                      {period}
                    </h1>
                    <div className="flex flex-wrap items-center gap-1.5 mt-1">
                      <Chip tone={closed ? 'dark' : 'neutral'}>{CYCLE_STATUS_LABEL[cycle.status]}</Chip>
                      {allPaid && <Chip tone="good"><BadgeCheck size={11} /> All paid</Chip>}
                      {cycle.payroll_config && <Chip tone="gold">Own rules</Chip>}
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  <LockSwitch
                    closed={closed}
                    disabled={busy || (!closed && records.length === 0)}
                    onSelect={next => setConfirmAction(next)}
                  />
                  <Btn tone="ghost" onClick={() => setShowSettings(true)} title="This cycle's PF, ESI, loss of pay and bonus rules">
                    <SlidersHorizontal size={14} /> Rules
                  </Btn>
                  {records.length > 0 && (
                    <Btn
                      tone="dark"
                      onClick={() => closed && setShowDocs(true)}
                      disabled={!closed}
                      title={closed ? 'Registers, bank files and returns' : 'Lock the cycle first. Until then its figures can still change.'}
                    >
                      <Download size={14} /> Downloads
                    </Btn>
                  )}
                </div>
              </div>

              {records.length === 0 ? (
                <Panel>
                  <Note>
                    {excludedCount > 0
                      ? `Everyone in this cycle has since left or is hidden from the salary app (${excludedCount}).`
                      : 'Nobody eligible was found for this cycle.'}
                  </Note>
                </Panel>
              ) : (
                <Deck>
                  <CycleStatsStrip totals={totals} filtered={narrowed} />

                  <CycleToolbar
                    filters={filters}
                    onChange={setFilters}
                    teams={teams}
                    shown={visibleRecords.length}
                    total={records.length}
                    onExportCsv={downloadBankCsv}
                    exportDisabled={visibleRecords.length === 0}
                  />

                  {(closed || disburseMsg) && (
                    <Panel className="mb-2.5 px-3.5 py-2.5">
                      {closed && (
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Btn tone="gold" onClick={disburse} disabled={busy}>
                            <Send size={13} /> {busy ? 'Sending…' : autoProvider
                              ? `Pay via ${payoutCfg?.provider}`
                              : 'Pay through the bank'}
                          </Btn>
                          {!autoProvider && (
                            <Btn tone="ghost" onClick={markAllPaid} disabled={busy || allPaid}>
                              <CheckCheck size={13} /> Mark all paid
                            </Btn>
                          )}
                        </div>
                      )}
                      {disburseMsg && (
                        <p className={`text-[12.5px] text-slate-600 leading-relaxed break-words ${closed ? 'mt-2 pt-2 border-t border-[#EEEAE1]' : ''}`}>
                          {disburseMsg}
                        </p>
                      )}
                    </Panel>
                  )}

                  {!closed && unverified.length > 0 && (
                    <Notice tone="warn" className="mb-2.5">
                      <span className="flex flex-wrap items-start gap-x-3 gap-y-1">
                        <span className="flex items-start gap-1.5 flex-1 basis-[240px]">
                          <ShieldAlert size={14} className="flex-shrink-0 mt-0.5" />
                          <span>
                            <span className="font-semibold">{unverified.length} {unverified.length === 1 ? 'row has' : 'rows have'} typed-in figures.</span>{' '}
                            They are at the top. Tick each one once checked; the cycle cannot lock until they are. Editing a row again clears its tick.
                          </span>
                        </span>
                        <button onClick={verifyAll} className="font-semibold underline underline-offset-2">Tick all</button>
                      </span>
                    </Notice>
                  )}

                  {!closed && (
                    <p className="px-1 mb-2.5 text-[12px] text-slate-500 leading-snug">
                      These figures follow attendance until you lock the cycle. Locking fixes PF, ESI, loss of pay and bonus, and lets you pay.
                      {excludedCount > 0 && ` ${excludedCount} ${excludedCount === 1 ? 'person who has left or is hidden is' : 'people who have left or are hidden are'} not shown.`}
                    </p>
                  )}

                  <div className="fx-card fx-bleed min-w-0">
                    {/* Laptop header: the five figures that decide a payslip. */}
                    <div className="hidden sm:grid xl:hidden items-center gap-x-3 px-3.5 py-2 bg-[#F7F5F0] border-b border-[#EEEAE1]"
                      style={{ gridTemplateColumns: COMPACT_COLS }}>
                      <span className={LABEL}>Person</span>
                      <span className={`${LABEL} text-right`}>Base</span>
                      <span className={`${LABEL} text-right`}>Loss of pay</span>
                      <span className={`${LABEL} text-right`}>PF + ESI</span>
                      <span className={`${LABEL} text-right`}>Net pay</span>
                      <span />
                    </div>

                    {/* Wide-screen header — shares GRID_COLS with every full row. */}
                    <div className="hidden xl:flex items-stretch bg-[#F7F5F0] border-b border-[#EEEAE1]">
                      <div className="w-[3px] flex-shrink-0" />
                      <div className={`${GRID} flex-1 min-w-0 px-3 py-2`} style={{ gridTemplateColumns: GRID_COLS }}>
                        <span className={`${LABEL} text-center`} title="Sign-off on rows with typed-in figures">✓</span>
                        <span className={`${LABEL} pl-[42px]`}>Person</span>
                        <span className={`${LABEL} text-center`} title="Paid in cash: left out of the bank file and automatic payouts">Cash</span>
                        <span className={`${LABEL} text-right`}>Base</span>
                        <span className={`${LABEL} text-center`}>Days</span>
                        <span className={`${LABEL} text-center`}>Leave</span>
                        <span className={`${LABEL} text-center`}>Late</span>
                        <span className={`${LABEL} text-center`}>Half</span>
                        <span className={`${LABEL} text-right`}>LOP</span>
                        <span className={`${LABEL} text-right`}>Per day</span>
                        <span className={`${LABEL} text-right`}>PF</span>
                        <span className={`${LABEL} text-right`}>ESI</span>
                        <span className={`${LABEL} text-right`}>Other</span>
                        <span className={`${LABEL} text-center`}>Points</span>
                        <span className={`${LABEL} text-right`}>Net pay</span>
                      </div>
                    </div>

                    {visibleRecords.length === 0 ? (
                      <Note>Nobody matches the search and filters.</Note>
                    ) : mountedRecords.map(r => {
                      const staffLike = r.staff
                        ? { full_name: r.staff.full_name, email: r.staff.email, role: r.staff.role }
                        : r.support_staff
                          ? { full_name: r.support_staff.full_name, email: null, role: r.support_staff.designation || 'Support Staff' }
                          // Account deleted since this cycle was locked — the name/role
                          // frozen at lock time is all a payslip can still say about them.
                          : r.person_name_snapshot
                            ? { full_name: r.person_name_snapshot, email: null, role: r.person_role_snapshot || '' }
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
                        ? `Typed in as ${formatINR(pf)}. Clear the box to use the worked-out figure.`
                        : !pfCfg?.pf_applicable
                          ? 'PF is off for this person. Turn it on in Base salaries.'
                          : !(Number(pfCfg?.pf_basic) > 0)
                            ? 'No PF Basic wage for this person. Add one in Base salaries.'
                            : 'PF Basic wage × the PF rate'
                      const bar = r.status === 'paid' ? '#27272A' : r.status === 'approved' ? '#B8983C' : '#DDD8CC'
                      const hasBank = !!bankMap[recordPersonId(r)]
                      const name = recordPersonName(r) || 'Staff'
                      const role = r.staff
                        ? getDisplayRole(r.staff)
                        : r.support_staff
                          ? (r.support_staff.designation || 'Support staff')
                          // Profile/support-staff row is gone (account deleted) — the role
                          // frozen at lock time is all that's left to describe them.
                          : r.person_role_snapshot
                            ? `${capitalize(r.person_role_snapshot)} · deleted`
                            : 'Deleted'

                      const signOff = edits.length === 0 ? null : (
                        <input
                          type="checkbox"
                          checked={signedOff}
                          disabled={closed}
                          onClick={e => e.stopPropagation()}
                          onChange={e => verified.setVerified(r.id, fingerprint, e.target.checked)}
                          title={`Typed in: ${edits.join(', ')}. Tick once checked. Editing the row again clears the tick.`}
                          aria-label={`Confirm typed-in figures for ${name}`}
                          className={SX.check}
                        />
                      )
                      const cash = (
                        <input
                          type="checkbox"
                          checked={r.pay_by_cash}
                          disabled={closed}
                          onClick={e => e.stopPropagation()}
                          onChange={e => saveOverride(r.id, { pay_by_cash: e.target.checked })}
                          title={r.pay_by_cash
                            ? 'Paid in cash this cycle: left out of the bank file and automatic payouts'
                            : 'Pay in cash: leaves this person out of the bank file and automatic payouts'}
                          aria-label={`Paid in cash for ${name}`}
                          className={SX.check}
                        />
                      )
                      const noBank = !hasBank && !r.pay_by_cash && (
                        <span title="No bank account on file, so this row cannot go in the bank file" className="flex-shrink-0 text-[#BE123C]">
                          <Landmark size={13} />
                        </span>
                      )
                      const toolButtons = (
                        <>
                          <button
                            type="button"
                            onClick={e => { e.stopPropagation(); r.staff && setDocsStaff(r.staff) }}
                            disabled={!r.staff}
                            title="Salary documents"
                            aria-label={`Salary documents for ${name}`}
                            className={SX.icon}
                          >
                            <FileText size={14} />
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
                            aria-label={`Attendance calendar for ${name}`}
                            className={SX.icon}
                          >
                            <CalendarDays size={14} />
                          </button>
                        </>
                      )

                      const cells = {
                        base: <EditableCell value={Number(r.base_amount) || 0} derived editable={!closed}
                          format={formatINR} title="Base salary for this cycle"
                          onSave={v => saveOverride(r.id, { base_amount: v ?? 0 })} />,
                        days: <EditableCell value={c?.workingDays ?? 0} derived={r.working_days_override == null} editable={!closed}
                          align="center" format={n => String(n)} title="Working days. Clear to use the calendar month."
                          onSave={v => saveOverride(r.id, { working_days_override: v })} />,
                        leave: <EditableCell value={c?.leaveCount ?? 0} derived={r.leave_override == null} editable={!closed}
                          align="center" format={n => String(n)}
                          title="Leave days: the Absent count on this person's attendance calendar for the month. Clear to go back to it."
                          onSave={v => saveOverride(r.id, { leave_override: v })} />,
                        late: <EditableCell value={c?.lateCount ?? 0} derived={r.late_override == null} editable={!closed}
                          align="center" format={n => String(n)} title="Late arrivals. Clear to use attendance."
                          onSave={v => saveOverride(r.id, { late_override: v })} />,
                        half: <EditableCell value={c?.halfDayCount ?? 0} derived={r.half_day_override == null} editable={!closed}
                          align="center" format={n => String(n)} title="Half days. Clear to use attendance."
                          onSave={v => saveOverride(r.id, { half_day_override: v })} />,
                        pf: <EditableCell value={pf} derived={r.pf_amount_override == null} editable={!closed}
                          format={formatINR} title={pfWhy}
                          onSave={v => saveOverride(r.id, { pf_amount_override: v })} />,
                        esi: <EditableCell value={esi} derived={r.esi_amount_override == null} editable={!closed}
                          format={formatINR} title="ESI. Clear to use the worked-out figure."
                          onSave={v => saveOverride(r.id, { esi_amount_override: v })} />,
                      }
                      const lopText = (
                        <span
                          className={`text-right text-[12px] font-semibold tabular-nums ${lopTotalRs > 0 ? 'text-[#BE123C]' : 'text-slate-400'}`}
                          title={`${(c?.lopFromLeave ?? 0)} day(s) leave · ${(c?.lopFromLate ?? 0) + (c?.lopFromHalfDay ?? 0)} day(s) late or half day`}
                        >
                          {formatINR(lopTotalRs)}
                        </span>
                      )
                      const otherText = (
                        <span
                          className={`text-right text-[12px] tabular-nums ${
                            manualTotal > 0 ? 'text-[#15803D] font-semibold'
                              : manualTotal < 0 ? 'text-[#BE123C] font-semibold'
                              : 'text-slate-400'
                          }`}
                          title={manualItems.length === 0
                            ? 'No bonuses or deductions added by hand'
                            : manualItems.map(i => `${i.label}: ${formatINR(Number(i.amount))}`).join('\n')}
                        >
                          {manualTotal === 0 ? '—' : `${manualTotal > 0 ? '+' : '−'}${formatINR(Math.abs(manualTotal))}`}
                        </span>
                      )
                      const points = (
                        <span className={`text-center text-[12px] tabular-nums ${(c?.bonusPoints ?? 0) > 0 ? 'text-[#15803D]' : 'text-slate-400'}`}>{c?.bonusPoints ?? 0}</span>
                      )
                      const toggle = () => toggleExpanded(r.id)
                      const onKey = (e: React.KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle() } }

                      return (
                        <div key={r.id} className="relative border-b border-[#F0ECE3] last:border-b-0">
                          <span className="absolute left-0 top-0 bottom-0 w-[3px] z-[1]" style={{ background: bar }} />

                          {/* Phone: who, and what they take home. */}
                          <div
                            role="button" tabIndex={0} aria-expanded={open}
                            onClick={toggle} onKeyDown={onKey}
                            className="sm:hidden flex items-center justify-between gap-3 px-3.5 py-2.5 cursor-pointer hover:bg-[#FAF7F0] transition-colors"
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <Avatar avatarUrl={r.staff?.avatar_url} name={name} size={30} userId={r.staff_id ?? undefined} />
                              <div className="min-w-0">
                                <p className="text-[13px] font-semibold text-slate-900 leading-snug break-words flex items-center gap-1.5">
                                  {name}{noBank}
                                </p>
                                <p className="text-[11.5px] text-slate-500 leading-snug break-words">
                                  {role}{lopTotalRs > 0 && <span className="text-[#BE123C]"> · LOP {formatINR(lopTotalRs)}</span>}
                                </p>
                              </div>
                            </div>
                            <div className="flex items-center gap-1 flex-shrink-0">
                              <span className="text-[14px] font-bold text-slate-900 tabular-nums">{formatINR(net)}</span>
                              <ChevronRight size={16} className={`text-slate-400 transition-transform ${open ? 'rotate-90' : ''}`} />
                            </div>
                          </div>

                          {/* Laptop: the five figures that decide a payslip. */}
                          <div
                            role="button" tabIndex={0} aria-expanded={open}
                            onClick={toggle} onKeyDown={onKey}
                            className="hidden sm:grid xl:hidden items-center gap-x-3 px-3.5 py-2 cursor-pointer hover:bg-[#FAF7F0] transition-colors"
                            style={{ gridTemplateColumns: COMPACT_COLS }}
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <Avatar avatarUrl={r.staff?.avatar_url} name={name} size={26} userId={r.staff_id ?? undefined} />
                              <div className="min-w-0">
                                <p className="text-[13px] font-semibold text-slate-900 leading-snug break-words flex items-center gap-1.5">{name}{noBank}</p>
                                <p className="text-[11.5px] text-slate-500 leading-snug break-words">{role}</p>
                              </div>
                            </div>
                            <Num className="text-slate-700">{formatINR(Number(r.base_amount) || 0)}</Num>
                            {lopText}
                            <Num className="text-slate-700">{formatINR(pf + esi)}</Num>
                            <span className="text-right text-[13.5px] font-bold text-slate-900 tabular-nums">{formatINR(net)}</span>
                            <ChevronRight size={16} className={`justify-self-end text-slate-400 transition-transform ${open ? 'rotate-90' : ''}`} />
                          </div>

                          {/* Wide screens: the whole row. */}
                          <div
                            role="button" tabIndex={0} aria-expanded={open}
                            onClick={toggle} onKeyDown={onKey}
                            className="hidden xl:flex items-stretch hover:bg-[#FAF7F0] transition-colors cursor-pointer"
                          >
                            <div className="w-[3px] flex-shrink-0" />
                            <div className={`${GRID} flex-1 min-w-0 px-3 py-1.5`} style={{ gridTemplateColumns: GRID_COLS }}>
                              {/* Empty for a row nothing was typed into: only a
                                  typed-in figure needs a person to vouch for it. */}
                              {signOff ?? <span />}
                              <div className="flex items-center gap-1.5 min-w-0">
                                <ChevronRight size={14} className={`text-slate-400 flex-shrink-0 transition-transform ${open ? 'rotate-90' : ''}`} />
                                <Avatar avatarUrl={r.staff?.avatar_url} name={name} size={24} userId={r.staff_id ?? undefined} />
                                <div className="min-w-0 flex-1 leading-tight">
                                  <p className="text-[12.5px] font-semibold text-slate-900 break-words">{name}</p>
                                  <p className="text-[11px] text-slate-500 break-words">{role}</p>
                                </div>
                                {noBank}
                              </div>
                              <span className="justify-self-center">{cash}</span>
                              {cells.base}
                              {cells.days}
                              {cells.leave}
                              {cells.late}
                              {cells.half}
                              {lopText}
                              <span className="text-right text-[12px] tabular-nums text-slate-500">{formatINR(Math.round(c?.salaryPerDay ?? 0))}</span>
                              {cells.pf}
                              {cells.esi}
                              {otherText}
                              {points}
                              <span className="text-right text-[13.5px] font-bold text-slate-900 tabular-nums">{formatINR(net)}</span>
                            </div>
                          </div>

                          {open && (
                            <div className="px-3.5 py-3 bg-[#FAF8F3] border-t border-[#EEEAE1]">
                              {/* Below xl the row shows five figures; the rest of
                                  the sheet's columns, editable, live here. */}
                              <div className="xl:hidden mb-3">
                                <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-x-3 gap-y-2.5">
                                  <Fact label="Base"><CellBox>{cells.base}</CellBox></Fact>
                                  <Fact label="Working days"><CellBox>{cells.days}</CellBox></Fact>
                                  <Fact label="Leave"><CellBox>{cells.leave}</CellBox></Fact>
                                  <Fact label="Late"><CellBox>{cells.late}</CellBox></Fact>
                                  <Fact label="Half days"><CellBox>{cells.half}</CellBox></Fact>
                                  <Fact label="PF"><CellBox>{cells.pf}</CellBox></Fact>
                                  <Fact label="ESI"><CellBox>{cells.esi}</CellBox></Fact>
                                  <Fact label="Loss of pay"><CellBox>{lopText}</CellBox></Fact>
                                  <Fact label="Per day"><CellBox><span className="text-right text-[12px] tabular-nums text-slate-500">{formatINR(Math.round(c?.salaryPerDay ?? 0))}</span></CellBox></Fact>
                                  <Fact label="Other"><CellBox>{otherText}</CellBox></Fact>
                                  <Fact label="Bonus points"><CellBox>{points}</CellBox></Fact>
                                  <Fact label="Net pay"><CellBox><span className="text-right text-[13px] font-bold text-slate-900 tabular-nums">{formatINR(net)}</span></CellBox></Fact>
                                </div>
                                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mt-3">
                                  <label className="inline-flex items-center gap-2 text-[12.5px] text-slate-700 cursor-pointer">
                                    {cash} Paid in cash
                                  </label>
                                  {signOff && (
                                    <label className="inline-flex items-center gap-2 text-[12.5px] text-slate-700 cursor-pointer">
                                      {signOff} Typed-in figures checked
                                    </label>
                                  )}
                                </div>
                              </div>

                              <div className="flex flex-wrap items-center gap-2 mb-2.5">
                                <p className={`${SX.heading} flex-1 basis-[160px]`}>Bonuses and deductions</p>
                                <span className="flex items-center gap-0.5">{toolButtons}</span>
                                <Btn
                                  tone="ghost"
                                  disabled={pdfBusy === key}
                                  onClick={() => openPdf(key, `Payslip · ${name}`, () => buildPayslip(r, staffLike, bankMap[recordPersonId(r)]))}
                                >
                                  {pdfBusy === key ? <Loader2 size={13} className="animate-spin" /> : <Receipt size={13} />} Payslip
                                </Btn>
                              </div>
                              <SalaryRecordItemsEditor
                                record={r}
                                onChanged={() => refreshRecord(r.id)}
                                previewItems={previewItems}
                                items={closed ? (r.items ?? []) : manualItems}
                                net={net}
                              />
                              {r.payout_status && (
                                <div className="mt-2.5"><Chip tone="gold">Payout: {r.payout_status}</Chip></div>
                              )}
                              {r.notes && <p className="text-[12px] text-slate-500 mt-2.5 italic break-words">{r.notes}</p>}
                            </div>
                          )}
                        </div>
                      )
                    })}

                    {moreToMount > 0 && (
                      <div ref={setSentinel} className="flex items-center justify-center gap-2 px-4 py-3 text-[12px] text-slate-500">
                        <span className="spinner-sm" aria-hidden />
                        Loading {moreToMount} more…
                      </div>
                    )}
                  </div>
                </Deck>
              )}
            </>
          )}
        </div>
      </div>

      {/*
        Every direct child here carries its own `key`, and must keep it.

        AnimatePresence identifies its children *only* by key
        (`getChildKey = child => child.key || ''`) and its own documentation
        requires each one to be unique. Keyless siblings therefore all collapse
        onto a single anonymous slot, and this page puts two popups on screen
        at once — the EPF/ESI panel opens the remittance preview alongside
        itself — so React was being handed two children under one key. React's
        behaviour for a duplicate key is undefined by design: it cannot tell
        the two subtrees apart, so which one is kept, torn down, or reconciled
        into the other is not something this page can rely on.

        That matters more here than a misdrawn popup would, because of what
        these children are. ModalShell portals a `fixed inset-0` root onto
        <body>; a child whose exit never completes leaves that root mounted,
        faded to nothing but still covering the viewport and still taking every
        click. Nothing is thrown, so no error boundary fires and the console
        stays clean — the page just looks entirely normal and answers nothing,
        which is exactly how the Download Centre freeze was reported.

        (See also the route-level error.tsx and the inert-while-leaving guard
        in ModalShell, which make that symptom unreachable from either cause.)
      */}
      <AnimatePresence>
        {showDocs && cycle && (
          <ModalErrorBoundary key="download-centre" onClose={() => setShowDocs(false)}>
            <DownloadCentreModal
              periodLabel={formatPeriod(cycle.period_month, cycle.period_year)}
              recordCount={records.length}
              busyKey={pdfBusy}
              sharp
              onClose={() => setShowDocs(false)}
              onRegister={() => { setShowDocs(false); openPdf('register', 'Salary Register', () => buildSalaryRegister(cycle, records)) }}
              onBankTransfer={() => { setShowDocs(false); openPdf('bank', 'Bank Transfer Statement', () => buildBankTransferStatement(cycle, records, bankMap)) }}
              onSalarySheet={() => { setShowDocs(false); setShowSalarySheet(true) }}
              onStatutory={() => { setShowDocs(false); setShowEpfDocs(true) }}
            />
          </ModalErrorBoundary>
        )}
        {showEpfDocs && cycle && (
          <ModalErrorBoundary key="epf-docs" onClose={() => setShowEpfDocs(false)}>
            <EpfDocumentsModal
              cycle={cycle}
              sourceRows={statutoryRows}
              daysInMonth={daysInMonth(cycle.period_year, cycle.period_month)}
              onClose={() => setShowEpfDocs(false)}
              onPreview={(spec, title) => setPreview({ spec, title })}
            />
          </ModalErrorBoundary>
        )}
        {showSalarySheet && cycle && (
          <ModalErrorBoundary key="salary-sheet" onClose={() => setShowSalarySheet(false)}>
            <SalarySheetPreviewModal
              cycle={cycle}
              rows={salarySheetAllRows}
              teams={teams}
              onClose={() => setShowSalarySheet(false)}
            />
          </ModalErrorBoundary>
        )}
        {showSettings && cycle && (
          <ModalErrorBoundary key="cycle-settings" onClose={() => setShowSettings(false)}>
            <CycleSettingsModal
              initial={calibration}
              hasOverride={!!cycle.payroll_config}
              periodLabel={formatPeriod(cycle.period_month, cycle.period_year)}
              onClose={() => setShowSettings(false)}
              onSave={saveCycleConfig}
            />
          </ModalErrorBoundary>
        )}
        {confirmAction && (
          <ConfirmModal
            key="confirm-lock"
            title={confirmAction === 'close' ? `Lock ${period}?` : `Unlock ${period}?`}
            icon={confirmAction === 'close' ? <Lock size={16} /> : <LockOpen size={16} />}
            confirmLabel={confirmAction === 'close' ? 'Lock cycle' : 'Unlock cycle'}
            busyLabel={confirmAction === 'close' ? 'Locking…' : 'Unlocking…'}
            busy={busy}
            onConfirm={confirmAction === 'close' ? closeCycle : reopenCycle}
            onClose={() => setConfirmAction(null)}
          >
            {confirmAction === 'close' ? (
              <>
                <p>PF, ESI, loss of pay and task bonus are fixed for every record from today&apos;s attendance and rules, and payment opens up.</p>
                <p>The figures stop being editable. You can unlock again whenever you need to change something.</p>
              </>
            ) : (
              <>
                <p>The cycle becomes editable again. The PF, ESI, loss of pay and bonus lines are taken off so they are worked out afresh at the next lock.</p>
                <p>Bonuses and deductions added by hand stay as they are.</p>
              </>
            )}
          </ConfirmModal>
        )}
        {docsStaff && (
          <ModalErrorBoundary key="staff-statements" onClose={() => setDocsStaff(null)}>
            <SalaryStatementsModal staff={docsStaff} onClose={() => setDocsStaff(null)} />
          </ModalErrorBoundary>
        )}
        {calendarPerson && (
          <ModalErrorBoundary key="attendance-calendar" onClose={() => setCalendarPerson(null)}>
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
          </ModalErrorBoundary>
        )}
        {/*
          Wrapped like the rest. This one is the whole reason the EPF/ESI flow
          could take the page down: it is what the Remittance Summary tile
          opens, and it mounts @react-pdf/renderer's PDFViewer, by some margin
          the heaviest thing any of these popups render. Left unguarded, an
          uncaught error in it had no boundary between it and the root, so
          React's recovery was to unmount the entire app — a page that still
          looks completely normal and answers nothing, with no dialog to say
          so. The containment added around the other Download Centre popups
          never covered this one.
        */}
        {preview && (
          <ModalErrorBoundary key="statement-preview" onClose={() => setPreview(null)}>
            <StatementPreviewModal spec={preview.spec} title={preview.title} onClose={() => setPreview(null)} sharp />
          </ModalErrorBoundary>
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
  const seg = (on: boolean) => `relative inline-flex items-center gap-1.5 h-8 px-3 rounded-full text-[12.5px] font-semibold whitespace-nowrap transition
    focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B8983C]/60 disabled:cursor-default ${
    on
      ? 'text-white bg-gradient-to-b from-[#3D3B40] to-[#27272A] shadow-[inset_0_1px_0_rgba(255,255,255,.16),0_4px_10px_-4px_rgba(15,23,42,.45)]'
      : 'text-slate-600 hover:text-slate-900 disabled:opacity-45 disabled:hover:text-slate-600'}`
  return (
    <div className="lg-pill inline-flex items-center gap-0.5 p-1 flex-shrink-0" role="group" aria-label="Cycle lock">
      <button
        type="button"
        onClick={() => onSelect('reopen')}
        disabled={disabled || !closed}
        aria-pressed={!closed}
        title={closed ? 'Unlock this cycle to edit it again' : 'This cycle is unlocked and can be edited'}
        className={seg(!closed)}
      >
        <LockOpen size={13} /> Open
      </button>
      <button
        type="button"
        onClick={() => onSelect('close')}
        disabled={disabled || closed}
        aria-pressed={closed}
        title={closed ? 'This cycle is locked' : 'Lock this cycle to fix its figures and allow payment'}
        className={seg(closed)}
      >
        <Lock size={13} /> Locked
      </button>
    </div>
  )
}

/** A sheet cell given a box, so it reads as a field in the expanded card. */
function CellBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-8 flex items-center justify-end rounded-[8px] bg-white border border-[#E2DDD2] px-2 min-w-0 [&>span]:w-full">
      {children}
    </div>
  )
}
