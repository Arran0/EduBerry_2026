import { fetchSetting, saveSetting } from './pageConfig'

// ============================================================================
// EPF (ECR) and ESI (Monthly Contribution) return engine.
//
// A locked pay cycle already knows what each person earned and what PF/ESI was
// deducted (src/lib/payroll.ts). This module turns that into the two monthly
// statutory returns the school has to upload:
//
//   EPFO — Electronic Challan-cum-Return. One line per member, eleven fields
//          separated by `#~#`. The same eleven fields also go out as a CSV and
//          as the working spreadsheet the office keeps.
//   ESIC — Monthly Contribution. Six columns per Insured Person, uploaded as
//          an Excel 97-2003 workbook.
//
// Everything here is pure: callers hand in one `StatutorySourceRow` per record
// and get back rows ready to be serialised. That keeps the arithmetic testable
// and stops the file writers from having any opinion about payroll.
// ============================================================================

// ============================================
// Establishment configuration
// ============================================

export interface StatutoryConfig {
  /** EPFO establishment id, e.g. `TNMAS0012345000`. Shown on the summary, not in the ECR itself. */
  epf_establishment_id: string
  /** 17-digit ESIC employer code. Shown on the summary, not in the MC file itself. */
  esi_employer_code: string

  /** Employee EPF share — 12% of EPF wages. */
  epf_rate: number
  /** Employer share diverted to the pension scheme — 8.33% of EPS wages. */
  eps_rate: number
  /** EPS is only payable on wages up to this ceiling (₹15,000 statutory). */
  eps_wage_ceiling: number
  /** EDLI is only payable on wages up to this ceiling (₹15,000 statutory). */
  edli_wage_ceiling: number
  /**
   * Cap EPF wages themselves at the pension ceiling. Off by default: most
   * schools contribute on the member's actual PF wage even above ₹15,000, and
   * capping would silently reduce what the ECR claims was remitted.
   */
  cap_epf_wages: boolean

  /** EDLI contribution — 0.50% of EDLI wages (A/c 21). */
  edli_rate: number
  /** EPF administrative charges — 0.50% of EPF wages (A/c 2). */
  epf_admin_rate: number
  /** Minimum monthly EPF administrative charge, whatever 0.50% works out to. */
  epf_admin_minimum: number

  /** Employee ESI share — 0.75% of ESI wages. */
  esi_employee_rate: number
  /** Employer ESI share — 3.25% of ESI wages. */
  esi_employer_rate: number
}

export const DEFAULT_STATUTORY_CONFIG: StatutoryConfig = {
  epf_establishment_id: '',
  esi_employer_code: '',
  epf_rate: 0.12,
  eps_rate: 0.0833,
  eps_wage_ceiling: 15000,
  edli_wage_ceiling: 15000,
  cap_epf_wages: false,
  edli_rate: 0.005,
  epf_admin_rate: 0.005,
  epf_admin_minimum: 500,
  esi_employee_rate: 0.0075,
  esi_employer_rate: 0.0325,
}

export const fetchStatutoryConfig = () =>
  fetchSetting<StatutoryConfig>('statutory_config', DEFAULT_STATUTORY_CONFIG)

export const saveStatutoryConfig = (cfg: StatutoryConfig) =>
  saveSetting('statutory_config', cfg)

// ============================================
// Input
// ============================================

/** One pay-cycle record, flattened into everything the two returns need. */
export interface StatutorySourceRow {
  staffId: string
  /** Display name, as stored. Each portal's own name rule is applied when the row is built. */
  name: string
  /** Monthly base salary for this cycle, before loss of pay. */
  baseAmount: number
  /** Days the month is paid across (the cycle's working-days figure). */
  workingDays: number
  /** Loss-of-pay days — late + leave, as computed for this cycle. May be fractional. */
  lopDays: number
  /** The wage PF is calculated on. Usually lower than gross. */
  pfBasic: number | null
  pfApplicable: boolean
  epsApplicable: boolean
  esiApplicable: boolean
  uan: string | null
  ipNumber: string | null
  /** PF actually deducted on the cycle — used to flag rows the ECR would disagree with. */
  deductedPf: number
  /** ESI actually deducted on the cycle — used the same way. */
  deductedEsi: number
}

// ============================================
// Shared helpers
// ============================================

/**
 * Member name for the ECR: capitals, letters, spaces and the dot after an
 * initial. The dot survives because the EPFO matches the name against the one
 * held for the UAN, and "P. MANJULA" on the portal is not "P MANJULA" —
 * cleaning it up would introduce the mismatch it looks like it prevents.
 */
export function epfMemberName(name: string): string {
  return (name || '')
    .toUpperCase()
    .replace(/[^A-Z. ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * IP name for the ESIC template, which asks for "only alphabets and space" in
 * as many words. An initial keeps its letter and loses the dot.
 */
export function esiPersonName(name: string): string {
  return (name || '')
    .toUpperCase()
    .replace(/[^A-Z ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Keep digits only — portal identifiers are typed with stray spaces and dashes surprisingly often. */
export function digitsOnly(v: string | null | undefined): string {
  return (v || '').replace(/\D+/g, '')
}

/** Days actually paid for, and the fraction of the month they represent. */
function paidPortion(row: StatutorySourceRow): { paidDays: number; ratio: number } {
  const paidDays = Math.max(0, row.workingDays - row.lopDays)
  const ratio = row.workingDays > 0 ? paidDays / row.workingDays : 0
  return { paidDays, ratio }
}

// ============================================
// EPF — Electronic Challan-cum-Return
// ============================================

export interface EcrRow {
  staffId: string
  uan: string
  name: string
  /** Full wages earned for the month, after loss of pay. */
  grossWages: number
  /** The PF wage, reduced in the same proportion as the days actually paid. */
  epfWages: number
  epsWages: number
  edliWages: number
  /** Whether this member is in the pension scheme at all — a zero EPS wage alone cannot say. */
  epsApplicable: boolean
  /** 12% of EPF wages. */
  epfContribution: number
  /** 8.33% of EPS wages. */
  epsContribution: number
  /** The employer's 3.67% — filed as the difference of the two above. */
  epfEpsDiff: number
  /** Non-contributory period: whole days in the month no wages were paid for. */
  ncpDays: number
  refundOfAdvances: number
  /** What the cycle actually deducted, so a mismatch can be surfaced. */
  deductedPf: number
  /** Reasons this row cannot be filed as-is. A row with issues is previewed but left out of the file. */
  issues: string[]
}

/**
 * Build one ECR line per PF member.
 *
 * Wages fall with attendance: a member who lost five of thirty paid days is
 * filed at 25/30ths of their wage, with five NCP days, which is what the EPFO
 * expects an absence to look like. A member who earned nothing at all is filed
 * at zero wages for the whole month rather than being dropped — leaving a
 * mapped member out of the return is what triggers a portal error.
 *
 * `daysInMonth` is the calendar length of the cycle's month; it is the NCP
 * figure for anyone who earned nothing.
 */
export function buildEcrRows(
  rows: StatutorySourceRow[],
  cfg: StatutoryConfig,
  daysInMonth: number,
): EcrRow[] {
  return rows.filter(r => r.pfApplicable).map(r => {
    const { ratio } = paidPortion(r)
    const grossWages = Math.round(r.baseAmount * ratio)

    let epfWages = Math.round((r.pfBasic ?? 0) * ratio)
    if (cfg.cap_epf_wages) epfWages = Math.min(epfWages, cfg.eps_wage_ceiling)
    const epsWages = r.epsApplicable ? Math.min(epfWages, cfg.eps_wage_ceiling) : 0
    const edliWages = Math.min(epfWages, cfg.edli_wage_ceiling)

    const epfContribution = Math.round(epfWages * cfg.epf_rate)
    const epsContribution = Math.round(epsWages * cfg.eps_rate)

    // Someone with no wage at all is absent for the whole month, however the
    // cycle's own working-days figure was set.
    const ncpDays = grossWages <= 0 && epfWages <= 0
      ? daysInMonth
      : Math.min(daysInMonth, Math.round(r.lopDays))

    const uan = digitsOnly(r.uan)
    const name = epfMemberName(r.name)
    const issues: string[] = []
    if (!uan) issues.push('No UAN on file')
    else if (uan.length !== 12) issues.push(`UAN is ${uan.length} digits, expected 12`)
    if (!name.replace(/[. ]/g, '')) issues.push('Name has no alphabetic characters')
    if (epfContribution !== Math.round(r.deductedPf)) {
      issues.push(`Cycle deducted ₹${Math.round(r.deductedPf)} PF, return claims ₹${epfContribution}`)
    }

    return {
      staffId: r.staffId,
      uan, name,
      grossWages, epfWages, epsWages, edliWages,
      epsApplicable: r.epsApplicable,
      epfContribution, epsContribution,
      epfEpsDiff: epfContribution - epsContribution,
      ncpDays, refundOfAdvances: 0,
      deductedPf: Math.round(r.deductedPf),
      issues,
    }
  })
}

/**
 * A row that would be rejected on upload. Contribution mismatches are a warning
 * to reconcile, not a blocker — the return still describes a valid member.
 */
export function ecrRowIsFilable(row: EcrRow): boolean {
  return row.uan.length === 12 && row.name.length > 0
}

/** The eleven ECR fields, in portal order. */
export function ecrFields(row: EcrRow): (string | number)[] {
  return [
    row.uan, row.name,
    row.grossWages, row.epfWages, row.epsWages, row.edliWages,
    row.epfContribution, row.epsContribution, row.epfEpsDiff,
    row.ncpDays, row.refundOfAdvances,
  ]
}

export const ECR_COLUMN_LABELS = [
  'UAN', 'Member Name', 'Gross Wages', 'EPF Wages', 'EPS Wages', 'EDLI Wages',
  'EPF Contri Remitted', 'EPS Contri Remitted', 'EPF EPS Diff Remitted',
  'NCP Days', 'Refund of Advances',
] as const

// ============================================
// ESI — Monthly Contribution
// ============================================

/**
 * ESIC reason codes for a member with zero paid days. Only the codes that need
 * no last-working-day are offered: the rest remove the person from the
 * employer's roll, which is a decision to make on the ESIC portal itself and
 * not a side effect of running payroll.
 */
export const ESI_REASON_CODES: Record<string, string> = {
  '0': 'Working — wages paid',
  '1': 'On leave',
  '8': 'Suspension of work',
  '9': 'Strike / lockout',
  '11': 'No work',
}

export interface EsiRow {
  staffId: string
  ipNumber: string
  ipName: string
  /** Whole days wages were paid or are payable for, rounded up per the template's own instructions. */
  daysWorked: number
  totalMonthlyWages: number
  /** '0' whenever any day was paid; the zero-day reason otherwise. */
  reasonCode: string
  /** Always blank here — the codes used never require one. */
  lastWorkingDay: string
  /** 0.75% of wages, rounded up to the rupee. */
  employeeContribution: number
  /** 3.25% of wages, rounded up to the rupee. */
  employerContribution: number
  deductedEsi: number
  issues: string[]
}

/**
 * Build one Monthly Contribution row per Insured Person.
 *
 * `zeroDayReason` is the code applied to anyone with no paid days this month —
 * "on leave" by default, which keeps them on the employer's roll.
 */
export function buildEsiRows(
  rows: StatutorySourceRow[],
  cfg: StatutoryConfig,
  zeroDayReason = '1',
): EsiRow[] {
  return rows.filter(r => r.esiApplicable).map(r => {
    const { paidDays, ratio } = paidPortion(r)
    // The template requires whole days and says to round fractions up, so half
    // a day lost to a late mark still counts as a day worked.
    const daysWorked = Math.ceil(paidDays)
    const totalMonthlyWages = Math.round(r.baseAmount * ratio)

    const employeeContribution = Math.ceil(totalMonthlyWages * cfg.esi_employee_rate)
    const employerContribution = Math.ceil(totalMonthlyWages * cfg.esi_employer_rate)

    const ipNumber = digitsOnly(r.ipNumber)
    const ipName = esiPersonName(r.name)
    const issues: string[] = []
    if (!ipNumber) issues.push('No ESI IP number on file')
    else if (ipNumber.length !== 10) issues.push(`IP number is ${ipNumber.length} digits, expected 10`)
    if (!ipName) issues.push('Name has no alphabetic characters')
    if (employeeContribution !== Math.round(r.deductedEsi)) {
      issues.push(`Cycle deducted ₹${Math.round(r.deductedEsi)} ESI, return claims ₹${employeeContribution}`)
    }

    return {
      staffId: r.staffId,
      ipNumber, ipName,
      daysWorked, totalMonthlyWages,
      reasonCode: daysWorked > 0 ? '0' : zeroDayReason,
      lastWorkingDay: '',
      employeeContribution, employerContribution,
      deductedEsi: Math.round(r.deductedEsi),
      issues,
    }
  })
}

export function esiRowIsFilable(row: EsiRow): boolean {
  return row.ipNumber.length === 10 && row.ipName.length > 0
}

/** The six MC columns, in template order. All of them upload as text. */
export function esiFields(row: EsiRow): string[] {
  return [
    row.ipNumber, row.ipName,
    String(row.daysWorked), String(row.totalMonthlyWages),
    row.reasonCode, row.lastWorkingDay,
  ]
}

/**
 * The MC template's own column headings, reproduced character for character
 * (line breaks and leading spaces included). ESIC matches the uploaded sheet
 * against the template it issued, so these are not ours to tidy up.
 */
export const ESI_COLUMN_HEADERS = [
  'IP Number \n(10 Digits)',
  'IP Name\n( Only alphabets and space )',
  'No of Days for which wages paid/payable during the month',
  'Total Monthly Wages',
  ' Reason Code for Zero workings days(numeric only; provide 0 for all other reasons- Click on the link for reference)',
  ' Last Working Day\n( Format DD/MM/YYYY  or DD-MM-YYYY)',
] as const

// ============================================
// Remittance totals
// ============================================

export interface EpfTotals {
  members: number
  grossWages: number
  epfWages: number
  epsWages: number
  edliWages: number
  /** A/c 1 — employee 12% plus the employer's 3.67% differential. */
  accountOne: number
  employeeShare: number
  employerDiff: number
  /** A/c 10 — the pension fund. */
  accountTen: number
  /** A/c 21 — EDLI at 0.50% of EDLI wages. */
  accountTwentyOne: number
  /** A/c 2 — administrative charges, subject to the monthly minimum. */
  accountTwo: number
  grandTotal: number
}

export function epfTotals(rows: EcrRow[], cfg: StatutoryConfig): EpfTotals {
  const sum = (pick: (r: EcrRow) => number) => rows.reduce((s, r) => s + pick(r), 0)
  const epfWages = sum(r => r.epfWages)
  const employeeShare = sum(r => r.epfContribution)
  const employerDiff = sum(r => r.epfEpsDiff)
  const accountTen = sum(r => r.epsContribution)
  const accountTwentyOne = Math.round(sum(r => r.edliWages) * cfg.edli_rate)
  const accountTwo = rows.length === 0
    ? 0
    : Math.max(cfg.epf_admin_minimum, Math.round(epfWages * cfg.epf_admin_rate))
  const accountOne = employeeShare + employerDiff

  return {
    members: rows.length,
    grossWages: sum(r => r.grossWages),
    epfWages,
    epsWages: sum(r => r.epsWages),
    edliWages: sum(r => r.edliWages),
    accountOne, employeeShare, employerDiff,
    accountTen, accountTwentyOne, accountTwo,
    grandTotal: accountOne + accountTen + accountTwentyOne + accountTwo,
  }
}

export interface EsiTotals {
  members: number
  totalWages: number
  employeeShare: number
  employerShare: number
  grandTotal: number
}

export function esiTotals(rows: EsiRow[]): EsiTotals {
  const sum = (pick: (r: EsiRow) => number) => rows.reduce((s, r) => s + pick(r), 0)
  const employeeShare = sum(r => r.employeeContribution)
  const employerShare = sum(r => r.employerContribution)
  return {
    members: rows.length,
    totalWages: sum(r => r.totalMonthlyWages),
    employeeShare, employerShare,
    grandTotal: employeeShare + employerShare,
  }
}
