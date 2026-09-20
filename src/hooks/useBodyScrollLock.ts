'use client'

import { useEffect } from 'react'

/**
 * Freeze the page behind an overlay, safely when overlays stack.
 *
 * The naive version — each modal saves `body.style.overflow`, sets it to
 * `hidden`, and restores what it saw on unmount — breaks the moment two
 * overlays are open at once. The second one saves `'hidden'` (the first one's
 * doing), so when both close the last unmount writes `'hidden'` back and the
 * page is left permanently unscrollable and looking frozen. It is easy to hit
 * without meaning to: any popup opened from inside another, or a second one
 * mounting during the first's exit animation.
 *
 * So the lock is refcounted process-wide instead. The *first* locker records
 * the page's real overflow; only the last one to release puts it back.
 */
let lockCount = 0
let restoreTo = ''

/** @param active pass false to hold the hook's position without locking. */
export function useBodyScrollLock(active = true): void {
  useEffect(() => {
    if (!active) return
    if (lockCount === 0) {
      restoreTo = document.body.style.overflow
      document.body.style.overflow = 'hidden'
    }
    lockCount += 1
    return () => {
      lockCount = Math.max(0, lockCount - 1)
      if (lockCount === 0) document.body.style.overflow = restoreTo
    }
  }, [active])
}

export default useBodyScrollLock
