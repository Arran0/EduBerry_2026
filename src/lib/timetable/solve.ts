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
/**
 * Give up after this many passes in a row that found nothing better.
 *
 * Higher while periods are still unplaced. A tidier week is a nice-to-have and
 * two flat passes are a fair sign there is no more of it to find; a week with
 * lessons missing from it is not usable at all, and settling for one after two
 * flat passes was giving up with most of the budget unspent. Each pass is an
 * independent randomized solve, so another one is a real chance at the periods
 * this one could not seat.
 */
const PATIENCE_COMPLETE = 2
const PATIENCE_UNPLACED = 4

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

/**
 * Hands the browser a frame.
 *
 * `setTimeout(0)` alone only promises another macrotask, not a painted frame, so
 * the caller's "working…" state could still be invisible when the next pass
 * seizes the thread. Waiting for an animation frame and then yielding again puts
 * this after the paint that frame produces — which is what makes the button
 * react the instant it is pressed instead of a pass later.
 */
const yieldToBrowser = () =>
  new Promise<void>((resolve) => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => setTimeout(resolve, 0))
    } else {
      setTimeout(resolve, 0)
    }
  })

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
    // Before EVERY pass, the first included. Each one blocks the thread for its
    // whole budget, so skipping the yield on pass 0 meant the caller's spinner
    // and disabled button were queued behind seconds of solving and the UI sat
    // there looking dead and still clickable.
    await yieldToBrowser()
    if (pass > 0 && shouldCancel?.()) break
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
    const patience = best!.unplacedCount > 0 ? PATIENCE_UNPLACED : PATIENCE_COMPLETE
    if (sinceImproved >= patience) break
    // Nothing left to improve at all.
    if (best!.unplacedCount === 0 && best!.softPenalty === 0) break
  }

  spent.elapsedMs = Date.now() - startedAt
  return { ...best!, diagnostics: spent }
}
