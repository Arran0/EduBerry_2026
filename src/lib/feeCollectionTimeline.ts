import { supabase, isMissingRelation } from '@/lib/supabase'

// Month-by-month fee collection for the admin home's School Overview chart:
// verified payments on fee bills, bucketed by the calendar month they were paid
// in and by fee head (fee_home_collections). A head is keyed by its name, since
// heads are created per session and the chart spans two; transport heads come
// back as '__bus', and late fees, fines, brought-forward balances and bills
// without fee lines as late_fee · fine · carry_forward · other.

/** Twelve months, Jan → Dec; each maps a fee head key to the amount collected. */
export type MonthlyCollections = Record<string, number>[]

interface CollectionsResponse {
  first_year: number | null
  months: { month: number; head: string; collected: number | null }[]
}

/** The chart asks for the year list and this year's months at the same time;
 *  both come out of one response, so they share the request while it is open.
 *  Settled requests are dropped, so a later visit reads fresh figures. */
const inFlight = new Map<number, Promise<CollectionsResponse>>()

function load(year: number): Promise<CollectionsResponse> {
  let p = inFlight.get(year)
  if (!p) {
    p = (async () => {
      const { data, error } = await supabase.rpc('fee_home_collections', { p_year: year })
      if (error) {
        if (isMissingRelation(error)) return { first_year: null, months: [] }
        throw new Error(error.message)
      }
      return (data ?? { first_year: null, months: [] }) as CollectionsResponse
    })()
    inFlight.set(year, p)
    p.then(() => inFlight.delete(year), () => inFlight.delete(year))
  }
  return p
}

export async function fetchMonthlyCollections(year: number): Promise<MonthlyCollections> {
  const r = await load(year)
  const months: MonthlyCollections = Array.from({ length: 12 }, () => ({}))
  for (const m of r.months ?? []) {
    const slot = months[m.month - 1]
    if (!slot) continue
    slot[m.head] = (slot[m.head] ?? 0) + (Number(m.collected) || 0)
  }
  return months
}

/** The calendar years that have any verified payment, oldest first, always
 *  ending at the current year — the chart's year switcher steps through these. */
export async function fetchCollectionYears(): Promise<number[]> {
  const now = new Date().getFullYear()
  const r = await load(now)
  const first = Math.min(now, r.first_year ?? now)
  return Array.from({ length: now - first + 1 }, (_, i) => first + i)
}
