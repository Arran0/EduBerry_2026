'use client'

import { useEffect, useState } from 'react'

/**
 * Subscribes to a CSS media query. SSR-safe: the first render always reports
 * `false` (the mobile assumption) and upgrades on mount, so the server and the
 * first client paint agree and the desktop branch never causes a hydration
 * mismatch.
 *
 * Use this for anything that is part of the server-rendered HTML. For a subtree
 * that only ever mounts *after* hydration — behind an auth gate, a modal, a
 * lazy boundary — prefer `useMediaQuerySync`: there is no server render to
 * agree with, so reporting `false` for one frame buys nothing and costs a
 * visible flash of the phone layout.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false)
  return useMediaQuerySubscription(query, matches, setMatches)
}

/**
 * The same subscription, resolved on the first render rather than the first
 * effect.
 *
 * Only for subtrees that are not in the server HTML. The home dashboard is the
 * motivating case: it renders inside ProtectedLayout, which shows a spinner
 * while auth resolves and so is the only thing the server ever emits for the
 * route. By the time the dashboard's first render runs, hydration is long over
 * and `window.matchMedia` is both available and authoritative — but the hook
 * above still said "phone", so a 1440px window laid out the swipe carousel,
 * committed it, and only then flipped to the three-column grid. That flip was
 * the first thing anyone saw on opening the app.
 */
export function useMediaQuerySync(query: string): boolean {
  const [matches, setMatches] = useState(
    () => (typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(query).matches
      : false),
  )
  return useMediaQuerySubscription(query, matches, setMatches)
}

/** Shared listener wiring for the two hooks above. */
function useMediaQuerySubscription(
  query: string,
  matches: boolean,
  setMatches: (v: boolean) => void,
): boolean {
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const mq = window.matchMedia(query)
    const update = () => setMatches(mq.matches)
    update()
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
    // setMatches is a stable setState binding; re-subscribing on it would tear
    // the listener down and back up on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query])

  return matches
}

/** The app's desktop hinge — Tailwind's `lg:` breakpoint (≥1024px). */
export function useIsDesktop(): boolean {
  return useMediaQuerySync('(min-width: 1024px)')
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
  return useMediaQuerySync('(min-width: 768px)')
}

/** Phones, where the hero band is deeper relative to the viewport (<640px). */
export function useIsPhone(): boolean {
  return useMediaQuerySync('(max-width: 639px)')
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
  return useMediaQuerySync('(hover: hover) and (pointer: fine)')
}
