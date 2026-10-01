// ============================================================
// Driving the solver from the UI.
//
// generateTimetable() is synchronous and holds the main thread for as long as
// its budget allows, which is fine for a couple of seconds and not fine for
// twenty. Running it as a series of shorter passes, yielding to the browser in
// between, keeps the page responsive, lets the work be cancelled, and reports
// progress — while still spending as much total effort as the admin asked for.
//
// Each pass is an independent randomized solve; the best one wins. That is the
// same bet the restarts inside a single pass make, so nothing is wasted by
// splitting the work up this way.
// ============================================================

import { generateTimetable } from './generator'
import type { GeneratorInput, GeneratorResult, SolveDiagnostics } from './types'

export type SolveEffortLevel = 'quick' | 'standard' | 'thorough'

interface EffortPreset {
  label: string
  /** What it says it will do, for the button's tooltip. */
  hint: string
  passes: number
  budgetMsPerPass: number
}

export const SOLVE_EFFORTS: Record<SolveEffortLevel, EffortPreset> = {
  quick: {
    label: 'Quick',
    hint: 'About a second. Good while you are still adding requirements.',
    passes: 1,
    budgetMsPerPass: 1200,
  },
  standard: {
    label: 'Standard',
    hint: 'A few seconds. The usual choice.',
    passes: 3,
    budgetMsPerPass: 2000,
  },
  thorough: {
    label: 'Thorough',
    hint: 'Up to half a minute. Worth it when periods will not fit or the week looks untidy.',
    passes: 10,
    budgetMsPerPass: 2500,
  },
}

export interface SolveProgress {
  pass: number
  passes: number
  /** The best result so far, so the admin sees it improving. */
  bestUnplaced: number
  bestPenalty: number
  elapsedMs: number
}

export interface SolveOptions {
  effort?: SolveEffortLevel
  onProgress?: (p: SolveProgress) => void
  /** Checked between passes; stops and returns the best found so far. */
  shouldCancel?: () => boolean
}

/** Fewer unplaced periods wins; ties go to the tidier week. */
function isBetter(a: GeneratorResult, b: GeneratorResult | null): boolean {
  if (!b) return true
  if (a.unplacedCount !== b.unplacedCount) return a.unplacedCount < b.unplacedCount
  return a.softPenalty < b.softPenalty
}

/** Lets the browser paint between passes. */
const yieldToBrowser = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

export async function solveTimetable(
  input: GeneratorInput,
  { effort = 'standard', onProgress, shouldCancel }: SolveOptions = {},
): Promise<GeneratorResult> {
  const preset = SOLVE_EFFORTS[effort]
  const startedAt = Date.now()
  const baseSeed = input.seed ?? Math.floor(Math.random() * 1_000_000)

  let best: GeneratorResult | null = null
  const spent: SolveDiagnostics = {
    restarts: 0, restartCeiling: 0, moves: 0, moveCeiling: 0, elapsedMs: 0, hitBudget: false,
  }

  for (let pass = 0; pass < preset.passes; pass++) {
    if (pass > 0) {
      await yieldToBrowser()
      if (shouldCancel?.()) break
    }
    const result = generateTimetable(
      // Each pass explores from a different random start.
      { ...input, seed: baseSeed + pass * 7_919 },
      { budgetMs: preset.budgetMsPerPass },
    )
    spent.restarts += result.diagnostics.restarts
    spent.restartCeiling += result.diagnostics.restartCeiling
    spent.moves += result.diagnostics.moves
    spent.moveCeiling += result.diagnostics.moveCeiling
    spent.hitBudget = spent.hitBudget || result.diagnostics.hitBudget

    if (isBetter(result, best)) best = result

    onProgress?.({
      pass: pass + 1,
      passes: preset.passes,
      bestUnplaced: best!.unplacedCount,
      bestPenalty: best!.softPenalty,
      elapsedMs: Date.now() - startedAt,
    })

    // Nothing left to improve: every period placed and a flawless week.
    if (best!.unplacedCount === 0 && best!.softPenalty === 0) break
  }

  spent.elapsedMs = Date.now() - startedAt
  // Report the passes actually run, not the preset, so a cancelled solve is
  // not described as a full one.
  return { ...best!, diagnostics: { ...spent, restarts: spent.restarts, moves: spent.moves } }
}

/** How many passes a level runs — for labelling the button before it is pressed. */
export const effortPasses = (effort: SolveEffortLevel) => SOLVE_EFFORTS[effort].passes
