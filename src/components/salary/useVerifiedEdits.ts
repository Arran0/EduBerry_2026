'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'

/**
 * Sign-off on hand-edited pay cycle rows.
 *
 * A typed-over figure is the one thing on the sheet nothing else can
 * cross-check: attendance, PF and the bonus all recompute from their sources
 * every load, but an override is only ever as right as the person who keyed
 * it. So each edited row has to be ticked before the cycle can be locked, and
 * the tick is stored against a fingerprint of the values it was given for —
 * change any of them again and the row un-ticks itself, which is the whole
 * point. A sign-off that survived the edit it was signing off would be worse
 * than none.
 *
 * It lives in localStorage rather than the database because it is a working
 * note for the person doing this month's payroll, not a record of the payroll
 * itself: it never leaves the browser it was made in, and it is discarded once
 * the cycle is locked.
 */

const KEY_PREFIX = 'salary-verified-edits:'

type Verified = Record<string, string>

function read(cycleId: string): Verified {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.localStorage.getItem(KEY_PREFIX + cycleId)
    const parsed = raw ? JSON.parse(raw) : null
    return parsed && typeof parsed === 'object' ? (parsed as Verified) : {}
  } catch {
    // A private window, cleared site data, or storage the browser refuses to
    // hand over: no sign-offs, so every edited row simply needs ticking again.
    return {}
  }
}

function write(cycleId: string, value: Verified): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(KEY_PREFIX + cycleId, JSON.stringify(value))
  } catch {
    // Nothing to do — the tick still works for this session, it just won't
    // survive a reload.
  }
}

export interface VerifiedEdits {
  /** True when this row's current values have been signed off. */
  isVerified: (recordId: string, fingerprint: string) => boolean
  /** Tick or untick one row against the values it currently holds. */
  setVerified: (recordId: string, fingerprint: string, verified: boolean) => void
  /** Forget every sign-off for this cycle — called once it is locked. */
  clear: () => void
}

export function useVerifiedEdits(cycleId: string): VerifiedEdits {
  const [verified, setState] = useState<Verified>({})

  // Read on mount rather than in the initialiser: localStorage does not exist
  // during the server render, and seeding from it there would hydrate a
  // different tree than the server sent.
  useEffect(() => { setState(read(cycleId)) }, [cycleId])

  const isVerified = useCallback(
    (recordId: string, fingerprint: string) => verified[recordId] === fingerprint,
    [verified],
  )

  const setVerified = useCallback((recordId: string, fingerprint: string, next: boolean) => {
    setState(prev => {
      const out = { ...prev }
      if (next) out[recordId] = fingerprint
      else delete out[recordId]
      write(cycleId, out)
      return out
    })
  }, [cycleId])

  const clear = useCallback(() => {
    setState({})
    write(cycleId, {})
  }, [cycleId])

  // Stable while the sign-offs are: the sheet derives "which rows still need
  // checking" from this, over every record, and a fresh object each render
  // would re-run that on every keystroke in the search box.
  return useMemo(
    () => ({ isVerified, setVerified, clear }),
    [isVerified, setVerified, clear],
  )
}
