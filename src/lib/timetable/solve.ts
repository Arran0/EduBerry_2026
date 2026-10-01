// ============================================================
// Driving the solver from the UI.
//
// generateTimetable() is synchronous and holds the main thread for as long as
// its budget allows, which is fine for a second and not fine for ten. Running
// it as a series of shorter passes, yielding to the browser in between, keeps
// the page responsive, lets the work be stopped, and reports progress.
//
// Each pass is an independent randomized solve and the best one wins — the
// same bet the restarts inside a single pass make, so nothing is wasted by
// splitting the work this way. How many passes run is decided by whether they
// are still finding anything better, not by a setting: a small school settles
// in one or two, a hard one keeps going until it stops improving.
// ============================================================

import { generateTimetable } from './generator'
import type { GeneratorInput, GeneratorResult, SolveDiagnostics } from './types'

/** Wall-clock budget per pass. Short enough that stopping feels immediate. */
const PASS_BUDGET_MS = 2500
/** Ceiling on passes, for the pathological case where every one improves. */
const MAX_PASSES = 8
/** Give up after this many passes in a row that found nothing better. */
const PATIENCE = 2

export interface SolveProgress {
  pass: number
  maxPasses: number
  /** The best result so far, so the admin sees it improving. */
  bestUnplaced: number
  bestPenalty: number
  elapsedMs: number
}

export interface SolveOptions {
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
  { onProgress, shouldCancel }: SolveOptions = {},
): Promise<GeneratorResult> {
  const startedAt = Date.now()
  const baseSeed = input.seed ?? Math.floor(Math.random() * 1_000_000)

  let best: GeneratorResult | null = null
  let sinceImproved = 0
  let passes = 0
  const spent: SolveDiagnostics = {
    restarts: 0, restartCeiling: 0, moves: 0, moveCeiling: 0, elapsedMs: 0, hitBudget: false,
  }

  for (let pass = 0; pass < MAX_PASSES; pass++) {
    if (pass > 0) {
      await yieldToBrowser()
      if (shouldCancel?.()) break
    }
    const result = generateTimetable(
      // Each pass explores from a different random start.
      { ...input, seed: baseSeed + pass * 7_919 },
      { budgetMs: PASS_BUDGET_MS },
    )
    passes++
    spent.restarts += result.diagnostics.restarts
    spent.restartCeiling += result.diagnostics.restartCeiling
    spent.moves += result.diagnostics.moves
    spent.moveCeiling += result.diagnostics.moveCeiling
    spent.hitBudget = spent.hitBudget || result.diagnostics.hitBudget

    if (isBetter(result, best)) {
      best = result
      sinceImproved = 0
    } else {
      sinceImproved++
    }

    onProgress?.({
      pass: passes,
      maxPasses: MAX_PASSES,
      bestUnplaced: best!.unplacedCount,
      bestPenalty: best!.softPenalty,
      elapsedMs: Date.now() - startedAt,
    })

    // Settled: more passes of the same are not buying anything.
    if (sinceImproved >= PATIENCE) break
    // Nothing left to improve at all.
    if (best!.unplacedCount === 0 && best!.softPenalty === 0) break
  }

  spent.elapsedMs = Date.now() - startedAt
  return { ...best!, diagnostics: spent }
}
