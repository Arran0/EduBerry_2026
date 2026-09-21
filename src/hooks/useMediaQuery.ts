'use client'

import { useEffect, useState } from 'react'

/**
 * Subscribes to a CSS media query. SSR-safe: the first render always reports
 * `false` (the mobile assumption) and upgrades on mount, so the server and the
 * first client paint agree and the desktop branch never causes a hydration
 * mismatch.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false)

  useEffect(() => {
    const mq = window.matchMedia(query)
    const update = () => setMatches(mq.matches)
    update()
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [query])

  return matches
}

/** The app's desktop hinge — Tailwind's `lg:` breakpoint (≥1024px). */
export function useIsDesktop(): boolean {
  return useMediaQuery('(min-width: 1024px)')
}
