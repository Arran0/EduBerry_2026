// ============================================================================
// Payroll engine — types.
// ----------------------------------------------------------------------------
// This module is pure: no `supabase` import, no `fetch`, no `Date.now()`. Every
// input the engine needs is handed to it fully hydrated, which is what lets the
// browser run it for a live preview and a route handler run the *same* code for
// the authoritative calculation and get identical output.
//
// Anything that reads from the database belongs in `src/lib/payroll/*.ts`, one
// level up. Nothing in `engine/` may import from there.
// ============================================================================

import type { RoundingMode } from './money'

// ============================================
// Explainability
// ============================================

/**
 * One node of the reasoning behind a number.
 *
 * The trace is not a debug artifact — it is stored on the run line and is what
 * the payslip drill-down, the "Why?" panel and any statutory query read from.
 * That is deliberate: a figure and its explanation are produced together and
 * stored together, so an explanation can never drift from the money it explains
 * the way a re-derived one would.
 */
export interface ExplainNode {
  /** Human label, shown as the row title. */
  label: string
  value: number
  unit: 'INR' | 'days' | 'percent' | 'count'
  /** The arithmetic in words, e.g. "PF wages × 12%". */
  formula?: string
  /** Named inputs to that formula, so the reader can check it themselves. */
  inputs?: Record<string, number | string | null>
  /** Which version of which statutory rule decided this. */
  rule?: { domain: RuleDomain; ruleSetId: string; version: number; effectiveFrom: string }
  /** Which policy group won, and why it won over the others. */
  policy?: PolicySource
  children?: ExplainNode[]
  /** Anything the reader needs that is not a number — a cap that bound, a rule that did not apply. */
  note?: string
}

export function node(n: ExplainNode): ExplainNode { return n }

// ============================================
// People
// ============================================

export type EmployeeCategory = 'teaching' | 'non_teaching' | 'transport' | 'support'

export interface EngineEmployee {
  id: string
  name: string
  category: EmployeeCategory
  /** 'YYYY-MM-DD'. Drives proration in the joining month. */
  dateOfJoining: string | null
  /** 'YYYY-MM-DD'. Drives proration in the exit month and F&F eligibility. */
  dateOfExit: string | null
  department: string | null
  designation: string | null
  // Statutory identity — absence of these becomes a run exception, not a crash.
  pan: string | null
  uan: string | null
  esiIpNumber: string | null
  /** Per-person statutory switches that the rules cannot infer. */
  pfApplicable: boolean
  epsApplicable: boolean
  /** null = let the rule set decide from wages; true/false = forced. */
  esiOverride: boolean | null
  /**
   * Whether the member was covered by ESI on the first day of the current
   * contribution period. Statute keeps a member covered to the end of the period
   * even once their wages cross the ceiling, so this — not the current month's
   * wages alone — is what decides coverage. The current app makes a human toggle
   * this by hand; here the data layer derives it from the previous run.
   */
  esiCoveredAtPeriodStart: boolean | null
  /** Explicit PF wage where the school contributes on something other than the derived PF wages. */
  pfWageOverride: number | null
  /**
   * Per-person override of the work location's state, e.g. 'IN-TN'. Normally
   * null: the office someone works at is what decides which state's
   * Professional Tax and LWF apply, and `resolveJurisdiction` reads it from the
   * work location. This exists for the genuine exception — someone taxed where
   * they live rather than where the school is — and for nothing else.
   */
  jurisdictionOverride: string | null
}

// ============================================
// Salary structure
// ============================================

export type ComponentKind = 'earning' | 'deduction' | 'employer_contribution' | 'informational'
export type CalcType = 'fixed' | 'percent_of' | 'formula' | 'slab' | 'balance'

/** A salary head in the catalogue. The flags are what give a head meaning to the rest of the engine. */
export interface ComponentDef {
  id: string
  code: string
  name: string
  kind: ComponentKind
  calcType: CalcType
  /** For `percent_of`: another component's code, or the pseudo-codes GROSS / CTC. */
  percentOf: string | null
  /** For `formula`: an expression over component codes. See `expr.ts` for the grammar. */
  formula: string | null
  /** For `slab`: ascending bands over the anchor amount. */
  slabs: { upTo: number | null; amount: number }[] | null
  /** Evaluation order. Lower runs first; `balance` heads are forced last. */
  sequence: number
  rounding: RoundingMode
  isTaxable: boolean
  countsForPf: boolean
  countsForEsi: boolean
  countsForPt: boolean
  /** Whether loss of pay reduces this head. Reimbursements and fixed allowances often do not. */
  lopApplicable: boolean
  /** Whether a mid-month join or exit prorates this head. */
  prorateOnJoinExit: boolean
  showOnPayslip: boolean
  /** System heads (PF, ESI, PT, LWF, TDS, LOP, arrears, recoveries) are emitted by the engine, not by a structure. */
  isSystem: boolean
}

/** One head inside a structure, with the value that structure assigns it. */
export interface StructureComponent {
  componentCode: string
  /** Overrides the catalogue calcType when set — lets one head be fixed in one structure and a percentage in another. */
  calcType: CalcType | null
  value: number | null
  formula: string | null
  sequence: number | null
}

export interface EngineStructure {
  id: string
  name: string
  version: number
  effectiveFrom: string
  effectiveTo: string | null
  components: StructureComponent[]
}

/** The employee's assignment to a structure over a date range. Append-only upstream. */
export interface EngineAssignment {
  id: string
  structureId: string
  effectiveFrom: string
  effectiveTo: string | null
  /** What percentages and `balance` heads resolve against. */
  anchorAmount: number
  revisionId: string | null
  reason: string | null
}

/** A per-person override of one head inside their assigned structure. */
export interface EngineOverride {
  componentCode: string
  calcType: CalcType | null
  value: number | null
  formula: string | null
  effectiveFrom: string
  effectiveTo: string | null
  reason: string | null
}

/** A resolved head with its money, ready to print. */
export interface ResolvedComponent {
  code: string
  name: string
  kind: ComponentKind
  amount: number
  /** Full-month amount before LOP and proration — the "as per structure" figure. */
  fullAmount: number
  def: ComponentDef
  trace: ExplainNode
}

// ============================================
// Policy groups and calendars
// ============================================

/** Why a particular policy group applies to this employee. Never optional — it is the Why? panel's first line. */
export interface PolicySource {
  groupId: string
  groupName: string
  /** How it was reached: an explicit member list, a rule match, or the fallback default. */
  rank: 'explicit' | 'matched' | 'default' | 'builtin'
  priority: number
  why: string
}

/**
 * A work location — an office, a campus, a branch. It carries the state, and
 * the state carries Professional Tax and the Labour Welfare Fund; it carries
 * the EPFO establishment id and ESIC employer code, and the monthly returns are
 * filed per establishment.
 *
 * Resolved with the same precedence as policy groups and calendars, except that
 * membership is effective-dated: a transfer is a dated event with tax
 * consequences on both sides of it.
 */
export interface WorkLocation {
  id: string
  entityId: string
  entityName: string
  name: string
  /** ISO 3166-2:IN, e.g. 'IN-TN'. Matched directly against a rule set's jurisdiction. */
  stateCode: string
  isDefault: boolean
  priority: number
  effectiveFrom: string
  effectiveTo: string | null
  match: { categories?: string[]; departments?: string[]; designations?: string[] } | null
  members: { employeeId: string; effectiveFrom: string; effectiveTo: string | null }[]
  epfEstablishmentId: string | null
  esiEmployerCode: string | null
  ptRegistrationNo: string | null
  lwfRegistrationNo: string | null
}

export interface LopTier {
  /** How many occurrences this tier covers. null absorbs everything remaining. */
  count: number | null
  lopDaysEach: number
}

export interface LopRule {
  /** Occurrences allowed per period before any LOP applies. */
  freeCount: number
  tiers: LopTier[]
}

export type LeaveTreatment = 'paid' | 'unpaid' | 'half' | 'lop'

export interface PayrollPolicy {
  lop: { late: LopRule; leave: LopRule; halfDay: LopRule }
  /** How each leave type is paid. Keys match `LeaveType` in src/lib/leave.ts plus 'unapproved'. */
  leaveTreatment: Record<string, LeaveTreatment>
  /** What a day of pay is divided by. */
  lopBasis: 'calendar_days' | 'working_days' | 'fixed_days'
  fixedDays: number
  halfDayFraction: number
  lateGraceMinutes: number
  /** LOP days are rounded to this granularity — 0.5 for half-day precision, 0 to disable. */
  roundLopTo: number
  encashment: { rateBasis: 'basic' | 'gross'; maxDays: number; enabled: boolean }
  noticePeriodDays: number
  /** Applied to net pay at the very end. */
  netRounding: RoundingMode
}

export interface PolicyGroup {
  id: string
  name: string
  isDefault: boolean
  priority: number
  effectiveFrom: string
  effectiveTo: string | null
  memberIds: string[]
  /** Used only when `memberIds` is empty. */
  match: { categories?: EmployeeCategory[]; departments?: string[]; designations?: string[] } | null
  policy: PayrollPolicy
}

export type WeekdayMode = 'full' | 'half' | 'off'

export interface WorkingCalendar {
  id: string
  name: string
  isDefault: boolean
  priority: number
  effectiveFrom: string
  effectiveTo: string | null
  memberIds: string[]
  match: { categories?: EmployeeCategory[]; departments?: string[] } | null
  basis: 'calendar_days' | 'fixed_days' | 'calendar_minus_holidays' | 'actual_working_days'
  fixedDays: number
  /** Index 0 = Sunday .. 6 = Saturday. */
  weekPattern: WeekdayMode[]
  /**
   * "2nd and 4th Saturday off" and friends. `nth` is 1-based within the month;
   * -1 means the last occurrence of that weekday.
   */
  nthWeekdayRules: { weekday: number; nth: number[]; mode: WeekdayMode }[]
}

export interface EngineHoliday {
  date: string
  name: string
  /** Empty = whole school. Otherwise only these employees. */
  staffIds: string[]
  isDefault: boolean
}

// ============================================
// Attendance
// ============================================

export type CalendarDayStatus = 'working' | 'half_working' | 'week_off' | 'holiday' | 'before_join' | 'after_exit'

export interface EngineAttendanceDay {
  date: string
  /** Mirrors StaffAttendanceStatus in src/lib/attendance.ts. */
  status: 'present' | 'late' | 'absent' | 'on_leave' | 'half_day' | null
  leaveType: string | null
  leaveApplicationId: string | null
  lateByMinutes: number | null
  /** An approved correction that supersedes the raw record. */
  correctionId: string | null
}

/** One day of the period, fully adjudicated. The list of these *is* the LOP explanation. */
export interface DayVerdict {
  date: string
  calendarStatus: CalendarDayStatus
  attendanceStatus: EngineAttendanceDay['status']
  leaveType: string | null
  leaveApplicationId: string | null
  correctionId: string | null
  /** Fraction of the day that is payable, 0..1. */
  paidFraction: number
  /** Fraction of the day lost, 0..1. Not necessarily 1 - paidFraction on a week off. */
  lopFraction: number
  /** Plain-language reason, printed verbatim in the day grid. */
  reason: string
  countsAsLateOccurrence: boolean
  countsAsLeaveOccurrence: boolean
}

export interface AttendanceResult {
  days: DayVerdict[]
  /** Days the period is paid across — the divisor for a day's pay. */
  payableDays: number
  /** Days actually paid for, after LOP. */
  paidDays: number
  lopDays: number
  lopFromLate: number
  lopFromLeave: number
  lateOccurrences: number
  leaveOccurrences: number
  trace: ExplainNode
}

// ============================================
// Statutory rules — versioned, pinned per run
// ============================================

export type RuleDomain = 'pf' | 'esi' | 'pt' | 'lwf' | 'tds' | 'gratuity' | 'bonus'

export interface RuleSetMeta {
  id: string
  domain: RuleDomain
  jurisdiction: string
  version: number
  effectiveFrom: string
  effectiveTo: string | null
  sourceNote: string | null
}

export interface PfRules {
  employeeRate: number
  employerRate: number
  epsRate: number
  epsWageCeiling: number
  edliRate: number
  edliWageCeiling: number
  adminRate: number
  adminMinimum: number
  /** Cap PF wages themselves at the pension ceiling. Most schools do not. */
  capPfWages: boolean
  pfWageCeiling: number
  /** Members earning above this at joining may be excluded entirely. */
  exemptionWageAtJoining: number
}

export interface EsiRules {
  employeeRate: number
  employerRate: number
  wageCeiling: number
  /**
   * The two contribution periods. Once a member is covered on the first day of a
   * period they stay covered to the end of it even after crossing the ceiling —
   * this is the rule the current app makes a human toggle by hand.
   */
  contributionPeriods: { startMonth: number; endMonth: number; label: string }[]
}

export interface PtSlab { upTo: number | null; amount: number }
export interface PtRules {
  /** Professional Tax is levied per half-year in Tamil Nadu, monthly elsewhere. */
  frequency: 'monthly' | 'half_yearly'
  /** For half-yearly: the months the deduction is taken in. */
  deductionMonths: number[]
  /** Slabs are read against aggregate wages for the period the frequency describes. */
  slabs: PtSlab[]
  annualMaximum: number
}

export interface LwfRules {
  frequency: 'monthly' | 'half_yearly' | 'annual'
  deductionMonths: number[]
  employeeAmount: number
  employerAmount: number
  /** Employees earning above this are outside the scheme. 0 = no ceiling. */
  wageCeiling: number
}

export interface TdsSlab { upTo: number | null; rate: number }
export interface TdsRegime {
  name: 'old' | 'new'
  slabs: TdsSlab[]
  standardDeduction: number
  /** Section 87A: full rebate when taxable income is at or under `rebateLimit`. */
  rebateLimit: number
  rebateMax: number
  cessRate: number
  surcharge: { above: number; rate: number }[]
  /** Chapter VI-A deductions this regime permits. */
  allowedDeductions: string[]
}
export interface TdsRules {
  financialYear: string
  regimes: TdsRegime[]
  defaultRegime: 'old' | 'new'
}

export interface GratuityRules {
  /** 15 days' wages for every completed year, on a 26-day month. */
  daysPerYear: number
  monthDays: number
  minimumYears: number
  /** The "4 years and 240 days counts as 5" reading. */
  qualifyingDaysInFinalYear: number
  maximumAmount: number
  /** Which heads gratuity is computed on. */
  wageBasis: 'basic' | 'basic_plus_da' | 'gross'
}

export interface BonusRules {
  minimumRate: number
  maximumRate: number
  /** Employees earning above this monthly are not eligible. */
  eligibilityWageCeiling: number
  /** Bonus is computed on the lower of actual wages and this. */
  calculationWageCeiling: number
  minimumWorkingDays: number
}

export type RuleBody =
  | PfRules | EsiRules | PtRules | LwfRules | TdsRules | GratuityRules | BonusRules

export interface RuleSet<T = RuleBody> extends RuleSetMeta { rules: T }

/** Every rule set pinned to one run, indexed by domain. */
export interface PinnedRules {
  pf: RuleSet<PfRules> | null
  esi: RuleSet<EsiRules> | null
  pt: RuleSet<PtRules> | null
  lwf: RuleSet<LwfRules> | null
  tds: RuleSet<TdsRules> | null
  gratuity: RuleSet<GratuityRules> | null
  bonus: RuleSet<BonusRules> | null
}

// ============================================
// Money owed
// ============================================

export interface EngineArrear {
  id: string
  amount: number
  fromPeriod: string
  toPeriod: string
  label: string
  breakdown: { period: string; componentCode: string; was: number; now: number; delta: number }[]
}

export interface EngineAdvance {
  id: string
  label: string
  outstanding: number
  recoveryMode: 'single' | 'emi'
  emiAmount: number
  startPeriod: string
  status: 'active' | 'on_hold' | 'closed'
}

export interface EngineLoan {
  id: string
  label: string
  principal: number
  outstanding: number
  emiAmount: number
  interestType: 'none' | 'flat' | 'reducing'
  interestRate: number
  tenureMonths: number
  startPeriod: string
  status: 'active' | 'on_hold' | 'closed' | 'written_off'
}

/** What was actually recovered this period, after the negative-net guard. */
export interface RecoveryResult {
  componentCode: string
  label: string
  sourceId: string
  sourceKind: 'advance' | 'loan'
  due: number
  recovered: number
  principalPart: number
  interestPart: number
  carriedForward: number
  trace: ExplainNode
}

// ============================================
// Tax declaration
// ============================================

export interface TaxDeclaration {
  financialYear: string
  regime: 'old' | 'new'
  /** Section code → declared amount, e.g. { '80C': 150000, '80D': 25000 }. */
  sections: Record<string, number>
  /** Income and TDS from a previous employer this financial year. */
  previousEmployer: { income: number; tdsDeducted: number; pf: number } | null
  status: 'draft' | 'submitted' | 'verified' | 'rejected'
}

/** What the employee has already been paid and taxed this financial year. */
export interface YtdSnapshot {
  taxableEarnings: number
  tdsDeducted: number
  pfEmployee: number
  ptDeducted: number
  monthsPaid: number
}

// ============================================
// Engine input and output
// ============================================

export interface EnginePeriod {
  year: number
  month: number
  /** Inclusive 'YYYY-MM-DD' bounds. Normally the calendar month; a mid-cycle F&F narrows it. */
  from: string
  to: string
  /** The financial year this period falls in, e.g. '2026-27'. */
  financialYear: string
}

export interface EngineInput {
  period: EnginePeriod
  employee: EngineEmployee
  /** Every assignment the employee has ever had; the engine picks the one effective in the period. */
  assignments: EngineAssignment[]
  structures: EngineStructure[]
  overrides: EngineOverride[]
  components: ComponentDef[]
  policyGroups: PolicyGroup[]
  calendars: WorkingCalendar[]
  locations: WorkLocation[]
  /** The state to fall back on when no location and no override applies, e.g. 'IN-TN'. */
  defaultJurisdiction: string
  holidays: EngineHoliday[]
  attendance: EngineAttendanceDay[]
  /**
   * Pinned for the jurisdiction this employee resolves to. The hydrator picks
   * them with the same `resolveJurisdiction` the engine uses below, so what a
   * run records having used and what it actually used cannot diverge.
   */
  rules: PinnedRules
  arrears: EngineArrear[]
  advances: EngineAdvance[]
  loans: EngineLoan[]
  declaration: TaxDeclaration | null
  ytd: YtdSnapshot | null
  /** Free-form one-off additions for this period only (a manual bonus, an agreed deduction). */
  adjustments: { code: string; label: string; amount: number; kind: ComponentKind; note: string | null }[]
  /** Set for an F&F run — switches on encashment, notice recovery, gratuity and the tax true-up. */
  settlement: SettlementInput | null
}

export interface SettlementInput {
  lastWorkingDay: string
  noticeDaysRequired: number
  noticeDaysServed: number
  /** Encashable leave balance in days, resolved upstream from the leave ledger. */
  encashableLeaveDays: number
  /** Completed years of service, computed upstream from date of joining. */
  serviceYears: number
  serviceDaysInFinalYear: number
  /** Days worked in the bonus year, for the proportionate statutory bonus. */
  bonusEligibleDays: number
  bonusYearWages: number
}

export interface EngineResult {
  employeeId: string
  components: ResolvedComponent[]
  grossEarnings: number
  totalDeductions: number
  employerContributions: number
  employerCost: number
  netPay: number
  payableDays: number
  paidDays: number
  lopDays: number
  /** The structure and policy actually used, snapshotted for the run line. */
  structureId: string | null
  policyGroupId: string | null
  calendarId: string | null
  locationId: string | null
  entityId: string | null
  /** The state whose PT and LWF priced this line. Snapshotted; a later transfer must not move it. */
  jurisdiction: string
  attendance: AttendanceResult
  /**
   * The wage bases each statutory contribution was calculated on. The monthly
   * EPFO and ESIC returns file these as their own columns, and a return that
   * recomputed them from the payslip instead of reading what the run used would
   * be a second, disagreeing answer to a question already settled.
   */
  statutoryBases: StatutoryBases
  recoveries: RecoveryResult[]
  /** Root of the explanation. Every figure above appears somewhere beneath it. */
  trace: ExplainNode
  /** Non-fatal problems the run should surface as exceptions. */
  warnings: EngineWarning[]
}

export interface StatutoryBases {
  pfWages: number
  epsWages: number
  edliWages: number
  esiWages: number
  pfApplicable: boolean
  esiApplicable: boolean
  /** Whole days in the period no wages were paid for — the ECR's NCP figure. */
  ncpDays: number
  /** Whole days wages were paid or are payable for — the ESIC MC figure. */
  paidDaysWhole: number
}

export interface EngineWarning {
  code: string
  severity: 'block' | 'warn' | 'info'
  message: string
  details?: Record<string, unknown>
}
