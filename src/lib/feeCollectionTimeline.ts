import { supabase } from '@/lib/supabase'

// Month-by-month fee collection for the admin home's School Overview chart:
// verified school-fee and bus-fee payments, bucketed by the calendar month
// they were verified in and by fee head (bus fee is the single head '__bus').

/** Twelve months, Jan → Dec; each maps a fee head id to the amount collected. */
export type MonthlyCollections = Record<string, number>[]

const PAGE = 1000

/** Every row of a payments query, a page at a time — PostgREST caps a
 *  response at 1000 rows, and a school's year of payments passes that. */
async function fetchAllPages<T>(
  query: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const rows: T[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await query(from, from + PAGE - 1)
    if (error) throw new Error(error.message)
    rows.push(...(data ?? []))
    if (!data || data.length < PAGE) return rows
  }
}

export async function fetchMonthlyCollections(year: number): Promise<MonthlyCollections> {
  const start = new Date(year, 0, 1).toISOString()
  const end = new Date(year + 1, 0, 1).toISOString()

  type SchoolRow = { amount: number; verified_at: string; fee: { fee_head_id: string | null } | null }
  type BusRow = { amount: number; verified_at: string }

  const [school, bus] = await Promise.all([
    fetchAllPages<SchoolRow>((from, to) => supabase
      .from('school_fee_payments')
      .select('amount, verified_at, fee:school_fees!fee_id(fee_head_id)')
      .eq('status', 'verified')
      .gte('verified_at', start)
      .lt('verified_at', end)
      .order('verified_at')
      .range(from, to) as unknown as PromiseLike<{ data: SchoolRow[] | null; error: { message: string } | null }>),
    fetchAllPages<BusRow>((from, to) => supabase
      .from('bus_payments')
      .select('amount, verified_at')
      .eq('status', 'verified')
      .gte('verified_at', start)
      .lt('verified_at', end)
      .order('verified_at')
      .range(from, to)),
  ])

  const months: MonthlyCollections = Array.from({ length: 12 }, () => ({}))
  const add = (at: string, head: string, amount: number) => {
    const m = new Date(at).getMonth()
    months[m][head] = (months[m][head] ?? 0) + (Number(amount) || 0)
  }
  for (const p of school) add(p.verified_at, p.fee?.fee_head_id ?? '__other', p.amount)
  for (const p of bus) add(p.verified_at, '__bus', p.amount)
  return months
}

/** The calendar years that have any verified payment, oldest first, always
 *  ending at the current year — the chart's year switcher steps through these. */
export async function fetchCollectionYears(): Promise<number[]> {
  const [{ data: s }, { data: b }] = await Promise.all([
    supabase.from('school_fee_payments').select('verified_at').eq('status', 'verified')
      .not('verified_at', 'is', null).order('verified_at').limit(1),
    supabase.from('bus_payments').select('verified_at').eq('status', 'verified')
      .not('verified_at', 'is', null).order('verified_at').limit(1),
  ])
  const now = new Date().getFullYear()
  const firsts = [s?.[0]?.verified_at, b?.[0]?.verified_at]
    .filter((v): v is string => !!v)
    .map(v => new Date(v).getFullYear())
  const first = Math.min(now, ...firsts)
  return Array.from({ length: now - first + 1 }, (_, i) => first + i)
}
