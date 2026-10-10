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

/**
 * The app's tablet hinge — Tailwind's `md:` breakpoint (≥768px), i.e. anything
 * that isn't a phone.
 *
 * Paired with `useIsDesktop` these are two hinges with two different jobs, and
 * the home dashboard needs both: at `md:` a swipe strip should already have
 * become a grid (a pointer has no swipe, and two cards fit side by side), while
 * the statistics only have the width to become chart-plus-rows infographics at
 * `lg:`. Collapsing both decisions onto one breakpoint forces a choice between
 * a carousel on a 900px window and a donut squeezed into 360px.
 */
export function useIsTabletUp(): boolean {
  return useMediaQuery('(min-width: 768px)')
}

/**
 * A real pointing device — a mouse or trackpad, not a finger.
 *
 * For behaviour that keys off *hover* rather than width. A touch tap on iOS
 * Safari synthesises `mouseenter` and leaves the element "hovered" until
 * something else is tapped, so hover-driven state (pausing a carousel while
 * the pointer rests on it, say) latches on and never releases on a phone.
 * Gating those handlers on this keeps them to the devices that can actually
 * hover; `(min-width: 1024px)` is the wrong test for it — a touchscreen laptop
 * matches it and a mouse-driven small window doesn't.
 */
export function useHasHover(): boolean {
  return useMediaQuery('(hover: hover) and (pointer: fine)')
}
