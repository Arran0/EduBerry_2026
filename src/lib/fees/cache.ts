// A per-session cache for the two reads every fee screen repeats.
//
// The module opens its tools as popups over one page now, so a clerk who looks
// at Reminders, then Late fees, then Concessions used to pull the whole roster
// down three times in thirty seconds — nine hundred profiles, their names and
// their admission numbers, each time.
//
// What is cached is chosen by what can safely go stale for a minute, and
// nothing that money is computed from:
//
//   The price list         invalidated by every write that changes it, and
//                          expiring anyway, because a second administrator
//                          editing it must not leave this browser wrong for
//                          the rest of the day.
//   Names, admission nos   keyed per student and never expired within a page
//                          session. A name that changes mid-session is not a
//                          correctness problem on a fee screen; a stale
//                          balance would be, and balances are never cached.
//
// Deliberately not a React Query dependency: this is two maps and a timestamp,
// and every consumer is a plain async function rather than a hook.

interface Entry<T> { at: number; value: T }

const TTL_MS = 60_000

const store = new Map<string, Entry<unknown>>()

/** Read through the cache, computing on a miss or once the entry is stale. */
export async function cached<T>(key: string, compute: () => Promise<T>): Promise<T> {
  const hit = store.get(key) as Entry<T> | undefined
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value
  const value = await compute()
  store.set(key, { at: Date.now(), value })
  return value
}

/** Drop everything under a prefix — called by the writes that invalidate it. */
export function invalidate(prefix: string): void {
  for (const key of Array.from(store.keys())) {
    if (key.startsWith(prefix)) store.delete(key)
  }
}

/**
 * Per-student facts that do not move: the display name and the admission
 * number. Separate from the TTL store because these are filled in batches and
 * read one id at a time.
 */
export interface Person { full_name: string; grade: number | null; section: string | null }

export const personCache = new Map<string, Person>()
export const admissionCache = new Map<string, string | null>()

/** Everything, for a sign-out or a session change. */
export function clearFeeCaches(): void {
  store.clear()
  personCache.clear()
  admissionCache.clear()
}
