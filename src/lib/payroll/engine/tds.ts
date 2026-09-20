// ============================================================================
// TDS on salary — annual projection, spread across the remaining months.
// ----------------------------------------------------------------------------
// Income tax on salary is not a monthly calculation. The employer estimates what
// the employee will earn for the whole financial year, works out the tax on it,
// subtracts what has already been deducted, and spreads the balance over the
// months that are left. That is why a declaration filed in January moves the
// remaining months sharply — and why the projection has to be visible, not just
// the deduction.
//
// Both regimes are computed every time. The comparison is the single most asked
// question a school payroll office gets in January, and answering it costs
// nothing once the machinery exists.
// ============================================================================

import type {
  ResolvedComponent, ExplainNode, RuleSet, TdsRules, TdsRegime, TaxDeclaration, YtdSnapshot,
} from './types'
import { round0, round2, sum } from './money'

function ruleRef(rs: RuleSet<TdsRules>) {
  return { domain: 'tds' as const, ruleSetId: rs.id, version: rs.version, effectiveFrom: rs.effectiveFrom }
}

/** Tax on a taxable income under one regime's slabs, before rebate, surcharge and cess. */
export function taxOnSlabs(taxable: number, slabs: TdsRegime['slabs']): { tax: number; bands: { band: string; amount: number; rate: number; tax: number }[] } {
  let remaining = Math.max(0, taxable)
  let lower = 0
  let tax = 0
  const bands: { band: string; amount: number; rate: number; tax: number }[] = []
  for (const s of slabs) {
    if (remaining <= 0) break
    const upper = s.upTo ?? Infinity
    const width = upper - lower
    const inBand = Math.min(remaining, width)
    if (inBand > 0) {
      const bandTax = inBand * s.rate
      tax += bandTax
      bands.push({
        band: s.upTo === null ? `above ₹${lower.toLocaleString('en-IN')}` : `₹${lower.toLocaleString('en-IN')} – ₹${upper.toLocaleString('en-IN')}`,
        amount: round2(inBand), rate: s.rate, tax: round2(bandTax),
      })
      remaining -= inBand
    }
    lower = upper
  }
  return { tax: round2(tax), bands }
}

export interface RegimeComputation {
  regime: 'old' | 'new'
  grossAnnualIncome: number
  standardDeduction: number
  chapterViaDeductions: number
  allowedDeductionDetail: { section: string; claimed: number; allowed: number }[]
  taxableIncome: number
  taxBeforeRebate: number
  rebate: number
  surcharge: number
  cess: number
  annualLiability: number
  bands: { band: string; amount: number; rate: number; tax: number }[]
}

export function computeRegime(
  regime: TdsRegime,
  projectedGross: number,
  declaration: TaxDeclaration | null,
  professionalTaxPaid: number,
): RegimeComputation {
  const allowedDetail: { section: string; claimed: number; allowed: number }[] = []
  let chapterVia = 0
  for (const [section, claimed] of Object.entries(declaration?.sections ?? {})) {
    // A section the regime does not permit is shown as claimed-but-disallowed
    // rather than dropped, so the employee can see why their new-regime tax is
    // higher than the deductions they entered would suggest.
    const allowed = regime.allowedDeductions.includes(section) ? claimed : 0
    allowedDetail.push({ section, claimed, allowed })
    chapterVia += allowed
  }
  // Professional tax is deductible under section 16(iii) in the old regime only.
  const ptDeduction = regime.allowedDeductions.includes('16(iii)') ? professionalTaxPaid : 0

  const standardDeduction = Math.min(regime.standardDeduction, projectedGross)
  const taxableIncome = Math.max(0, round2(projectedGross - standardDeduction - chapterVia - ptDeduction))

  const { tax, bands } = taxOnSlabs(taxableIncome, regime.slabs)
  const rebate = taxableIncome <= regime.rebateLimit ? Math.min(tax, regime.rebateMax) : 0
  const afterRebate = Math.max(0, round2(tax - rebate))

  const surchargeBand = [...regime.surcharge].sort((a, b) => b.above - a.above).find(s => taxableIncome > s.above)
  const surcharge = surchargeBand ? round2(afterRebate * surchargeBand.rate) : 0
  const cess = round2((afterRebate + surcharge) * regime.cessRate)

  return {
    regime: regime.name,
    grossAnnualIncome: round2(projectedGross),
    standardDeduction,
    chapterViaDeductions: round2(chapterVia + ptDeduction),
    allowedDeductionDetail: allowedDetail,
    taxableIncome,
    taxBeforeRebate: tax,
    rebate,
    surcharge,
    cess,
    annualLiability: round0(afterRebate + surcharge + cess),
    bands,
  }
}

export interface TdsResult {
  monthlyDeduction: number
  chosen: RegimeComputation | null
  comparison: RegimeComputation[]
  trace: ExplainNode
}

export interface TdsArgs {
  components: ResolvedComponent[]
  rs: RuleSet<TdsRules> | null
  declaration: TaxDeclaration | null
  ytd: YtdSnapshot | null
  /** 1..12 within the financial year — April is 1 when the year starts in April. */
  monthIndexInFy: number
  monthsInFy: number
  professionalTaxThisMonth: number
  /** An F&F run settles the whole remaining liability in one go rather than spreading it. */
  isFinalSettlement: boolean
}

export function calcTds(args: TdsArgs): TdsResult {
  const { components, rs, declaration, ytd, monthIndexInFy, monthsInFy, professionalTaxThisMonth, isFinalSettlement } = args
  if (!rs) {
    return { monthlyDeduction: 0, chosen: null, comparison: [], trace: { label: 'TDS', value: 0, unit: 'INR', note: 'No TDS rule set is in force for this period.' } }
  }

  const taxableThisMonth = sum(components.filter(c => c.kind === 'earning' && c.def.isTaxable).map(c => c.amount))
  const monthsRemaining = Math.max(1, monthsInFy - monthIndexInFy + 1)
  const earnedSoFar = ytd?.taxableEarnings ?? 0
  const previousEmployer = declaration?.previousEmployer?.income ?? 0

  // The projection: what is already earned, plus this month and every month left
  // at the current rate, plus anything a previous employer paid this year.
  const projectedGross = round2(earnedSoFar + taxableThisMonth * monthsRemaining + previousEmployer)
  const ptPaidForYear = round2((ytd?.ptDeducted ?? 0) + professionalTaxThisMonth * monthsRemaining)

  const comparison = rs.rules.regimes.map(r => computeRegime(r, projectedGross, declaration, ptPaidForYear))
  const chosenName = declaration?.regime ?? rs.rules.defaultRegime
  const chosen = comparison.find(c => c.regime === chosenName) ?? comparison[0] ?? null
  if (!chosen) {
    return { monthlyDeduction: 0, chosen: null, comparison, trace: { label: 'TDS', value: 0, unit: 'INR', note: 'The TDS rule set defines no regimes.' } }
  }

  const alreadyDeducted = round2((ytd?.tdsDeducted ?? 0) + (declaration?.previousEmployer?.tdsDeducted ?? 0))
  const balance = Math.max(0, round2(chosen.annualLiability - alreadyDeducted))
  const monthly = isFinalSettlement ? round0(balance) : round0(balance / monthsRemaining)

  const cheaper = [...comparison].sort((a, b) => a.annualLiability - b.annualLiability)[0]

  return {
    monthlyDeduction: monthly,
    chosen,
    comparison,
    trace: {
      label: 'Income tax deducted at source', value: monthly, unit: 'INR', rule: ruleRef(rs),
      formula: isFinalSettlement
        ? 'the whole remaining liability, settled with the final payment'
        : `(annual liability − tax already deducted) ÷ ${monthsRemaining} month(s) remaining`,
      inputs: {
        'Regime': `${chosen.regime}${declaration ? ' (declared)' : ' (default — no declaration filed)'}`,
        'Taxable pay this month': taxableThisMonth,
        'Taxable pay so far this year': earnedSoFar,
        'Previous employer income': previousEmployer,
        'Projected annual income': projectedGross,
        'Annual liability': chosen.annualLiability,
        'Already deducted': alreadyDeducted,
        'Months remaining': monthsRemaining,
      },
      note: cheaper && cheaper.regime !== chosen.regime
        ? `The ${cheaper.regime} regime would cost ₹${round0(chosen.annualLiability - cheaper.annualLiability).toLocaleString('en-IN')} less this year on the figures declared.`
        : undefined,
      children: [
        {
          label: `Taxable income (${chosen.regime} regime)`, value: chosen.taxableIncome, unit: 'INR',
          formula: 'projected income − standard deduction − eligible deductions',
          inputs: {
            'Projected income': chosen.grossAnnualIncome,
            'Standard deduction': chosen.standardDeduction,
            'Chapter VI-A and 16(iii)': chosen.chapterViaDeductions,
          },
          children: chosen.allowedDeductionDetail.map(d => ({
            label: `Section ${d.section}`, value: d.allowed, unit: 'INR' as const,
            note: d.allowed < d.claimed ? `₹${d.claimed.toLocaleString('en-IN')} declared, but the ${chosen.regime} regime does not allow this deduction.` : undefined,
          })),
        },
        {
          label: 'Tax on slabs', value: chosen.taxBeforeRebate, unit: 'INR',
          children: chosen.bands.map(b => ({
            label: b.band, value: b.tax, unit: 'INR' as const,
            formula: `₹${b.amount.toLocaleString('en-IN')} × ${(b.rate * 100).toFixed(0)}%`,
          })),
        },
        ...(chosen.rebate > 0 ? [{ label: 'Section 87A rebate', value: -chosen.rebate, unit: 'INR' as const, note: 'Taxable income is within the rebate limit, so the tax is fully rebated.' }] : []),
        ...(chosen.surcharge > 0 ? [{ label: 'Surcharge', value: chosen.surcharge, unit: 'INR' as const }] : []),
        { label: 'Health and education cess', value: chosen.cess, unit: 'INR' },
        { label: 'Annual liability', value: chosen.annualLiability, unit: 'INR' },
      ],
    },
  }
}
