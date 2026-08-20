'use client'

/**
 * Per-user record of which check-in / check-out prompts have already popped
 * today.
 *
 * The prompts are a nudge, not a queue: each one is meant to appear at most
 * once a day per staff member, so opening the app a second time inside the
 * same window must not put it back on screen. Only one day is remembered —
 * a new date replaces the entry wholesale — because yesterday's marker has no
 * meaning once the date rolls over.
 *
 * The date stored here is always the school-timezone date off the server
 * clock, never the device's: a device in another zone (or with its clock
 * moved) would otherwise get a second showing at the day boundary.
 */

export type PunchPromptKind = 'checkin' | 'checkout'

const STORAGE_KEY_PREFIX = 'attendance_punch_prompt_'

interface StoredDay {
  date: string
  kinds: PunchPromptKind[]
}

function storageKey(userId: string): string {
  return `${STORAGE_KEY_PREFIX}${userId}`
}

function read(userId: string): StoredDay | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(storageKey(userId))
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<StoredDay>
    if (typeof parsed?.date !== 'string' || !Array.isArray(parsed.kinds)) return null
    return {
      date: parsed.date,
      kinds: parsed.kinds.filter((k): k is PunchPromptKind => k === 'checkin' || k === 'checkout'),
    }
  } catch {
    return null
  }
}

/** Whether this prompt has already been shown to this user on this date. */
export function wasPunchPromptShown(userId: string, date: string, kind: PunchPromptKind): boolean {
  const stored = read(userId)
  return !!stored && stored.date === date && stored.kinds.includes(kind)
}

/** Remembers that the prompt has been shown, so it does not pop again today. */
export function markPunchPromptShown(userId: string, date: string, kind: PunchPromptKind): void {
  if (typeof window === 'undefined') return
  const stored = read(userId)
  const kinds = stored && stored.date === date ? stored.kinds : []
  if (kinds.includes(kind)) return
  try {
    localStorage.setItem(storageKey(userId), JSON.stringify({ date, kinds: [...kinds, kind] } satisfies StoredDay))
  } catch {
    // Storage full or unavailable — at worst the prompt shows once more.
  }
}
