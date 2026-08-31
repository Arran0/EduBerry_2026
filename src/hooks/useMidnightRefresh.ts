'use client'

import { useEffect, useRef } from 'react'

/**
 * Fires `onRollover` once the date used for "today" queries elsewhere in the
 * app (`new Date().toISOString().split('T')[0]`) changes — polled once a
 * minute, and re-checked whenever the tab regains visibility/focus so a
 * backgrounded tab (where timers get throttled) doesn't miss the flip.
 */
export function useMidnightRefresh(onRollover: () => void, enabled = true) {
  const dateRef = useRef(new Date().toISOString().split('T')[0])

  useEffect(() => {
    if (!enabled) return

    const check = () => {
      const today = new Date().toISOString().split('T')[0]
      if (today !== dateRef.current) {
        dateRef.current = today
        onRollover()
      }
    }

    const id = setInterval(check, 60_000)
    document.addEventListener('visibilitychange', check)
    window.addEventListener('focus', check)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', check)
      window.removeEventListener('focus', check)
    }
  }, [enabled, onRollover])
}
