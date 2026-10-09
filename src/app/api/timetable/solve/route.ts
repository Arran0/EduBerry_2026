import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { requireAdmin } from '@/lib/payroll/serverGuard'

/**
 * The authenticated front door to the CP-SAT solver service.
 *
 * The solver itself is a private Vercel service: it has no top-level rewrite,
 * so it is unreachable from the internet and only this route can call it,
 * through the deployment's service binding. That is deliberate — a timetable
 * problem contains every class, teacher and subject in the school, and the
 * solver has no notion of who is asking. Authentication lives here, where the
 * rest of the app's already does.
 *
 * The problem is built in the browser by src/lib/timetable/solverPayload.ts
 * rather than reassembled here. The admin workspace already holds the whole
 * draft in memory — requirements, constraints, the pinned cells, the week it
 * is looking at — and rebuilding that server-side would be a second copy of
 * the loading code that could disagree with the grid the admin can see.
 */

export const maxDuration = 300

/** A whole-school problem is ~450KB. Past this, something is wrong. */
const MAX_BODY_BYTES = 8 * 1024 * 1024

type Mode = 'prove' | 'optimise'

export async function POST(request: NextRequest) {
  const guard = await requireAdmin(request)
  if (!guard.ok) return guard.response

  const solverUrl = process.env.SOLVER_INTERNAL_URL
  const secret = process.env.SOLVER_SHARED_SECRET
  if (!solverUrl || !secret) {
    return NextResponse.json(
      {
        success: false,
        error:
          'The constraint solver is not configured for this deployment. ' +
          'Generate still works — this only affects "check if possible" and "improve".',
      },
      { status: 503 },
    )
  }

  const raw = await request.text()
  if (raw.length > MAX_BODY_BYTES) {
    return NextResponse.json({ success: false, error: 'Problem too large' }, { status: 413 })
  }

  let body: { mode?: Mode; problem?: unknown; hint?: unknown; budgetSeconds?: number }
  try {
    body = JSON.parse(raw)
  } catch {
    return NextResponse.json({ success: false, error: 'Bad request body' }, { status: 400 })
  }

  const mode: Mode = body.mode === 'optimise' ? 'optimise' : 'prove'
  if (!body.problem || typeof body.problem !== 'object') {
    return NextResponse.json({ success: false, error: 'No problem supplied' }, { status: 400 })
  }

  // The platform cuts the function off at maxDuration, so the solver is given
  // a budget that ends before that — a result it has found is worth far more
  // than a connection that died mid-search.
  const budgetSeconds = Math.min(Math.max(body.budgetSeconds ?? 45, 5), 240)

  try {
    const upstream = await fetch(new URL(`/${mode}`, solverUrl), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Solver-Secret': secret },
      body: JSON.stringify({
        problem: body.problem,
        hint: body.hint ?? null,
        budgetSeconds,
      }),
      signal: AbortSignal.timeout((budgetSeconds + 30) * 1000),
    })
    if (!upstream.ok) {
      const detail = await upstream.text()
      console.error('solver service error:', upstream.status, detail.slice(0, 500))
      return NextResponse.json(
        { success: false, error: `Solver returned ${upstream.status}` },
        { status: 502 },
      )
    }
    return NextResponse.json({ success: true, result: await upstream.json() })
  } catch (err) {
    const timedOut = err instanceof Error && err.name === 'TimeoutError'
    console.error('solver service unreachable:', err)
    return NextResponse.json(
      {
        success: false,
        error: timedOut
          ? 'The solver ran out of time. Try a shorter budget, or fix the problems already reported.'
          : 'Could not reach the solver service.',
      },
      { status: timedOut ? 504 : 502 },
    )
  }
}
