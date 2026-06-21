'use client'

import { useEffect, useState } from 'react'

/**
 * Tracks the on-screen keyboard via the `visualViewport` API and exposes the
 * height it occludes at the bottom of the layout viewport.
 *
 * The whole app runs with `interactiveWidget: 'resizes-visual'` (see
 * `src/app/layout.tsx`), so opening the soft keyboard shrinks only the *visual*
 * viewport — the layout viewport (and `position: fixed; bottom: 0`) keeps the
 * full height. To pin UI directly on top of the keyboard we need to know how
 * much of the layout viewport the keyboard is covering.
 *
 * We measure that gap *live* against the real fixed containing block: a
 * zero-height `position: fixed; bottom: 0` probe is appended to `<body>`, and
 * its `getBoundingClientRect().bottom` is exactly where `fixed; bottom: 0`
 * lands at that instant. The keyboard inset is then `probeBottom − visualBottom`
 * (visual-viewport bottom edge = top of the keyboard).
 *
 * Re-reading the probe every viewport frame — rather than deriving the inset
 * from `window.innerHeight` or from a one-time baseline captured while
 * unfocused — makes the measurement immune to iOS Safari's collapsing bottom
 * toolbar, which settles a beat *after* the keyboard animates up and silently
 * shifts the fixed containing block. A captured baseline can't track that late
 * change, so the bar drifts off the keyboard and a gap reopens; the live probe
 * re-derives the true gap on every frame instead.
 *
 * The live value is written to the `--keyboard-inset` CSS custom property on
 * `<html>` on every viewport frame, so consumers can position themselves purely
 * in CSS (`transform: translateY(calc(var(--keyboard-inset) * -1))`) and stay
 * glued to the keyboard's open/close animation without waiting on a React
 * re-render. The returned `open` flag only flips when the keyboard appears or
 * disappears, so it costs at most a couple of renders per session.
 */
export interface KeyboardState {
  /** True while the soft keyboard is occluding the bottom of the viewport. */
  open: boolean
  /** True once a touch-class viewport (< 768 px) with `visualViewport` is detected. */
  isMobile: boolean
}

function isEditableFocused(): boolean {
  const el = document.activeElement as HTMLElement | null
  if (!el) return false
  return (
    el.tagName === 'INPUT' ||
    el.tagName === 'TEXTAREA' ||
    el.isContentEditable === true
  )
}

export function useKeyboardInset(): KeyboardState {
  const [open, setOpen] = useState(false)
  const [isMobile, setIsMobile] = useState(false)

  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return

    const root = document.documentElement
    setIsMobile(window.innerWidth < 768)

    // Zero-height probe pinned to the bottom of the *fixed* containing block.
    // Reading its live position every frame lets us measure the keyboard gap
    // against the real fixed bottom instead of a captured baseline, so iOS
    // Safari's collapsing bottom toolbar can't desync the measurement.
    const probe = document.createElement('div')
    probe.setAttribute('aria-hidden', 'true')
    probe.style.cssText =
      'position:fixed;left:0;bottom:0;width:0;height:0;pointer-events:none;visibility:hidden'
    document.body.appendChild(probe)

    const apply = () => {
      // Where `fixed; bottom: 0` lands right now (layout-viewport coords)…
      const fixedBottom = probe.getBoundingClientRect().bottom
      // …and the visual-viewport bottom edge = top of the keyboard when open.
      const visualBottom = vv.offsetTop + vv.height
      // Only a focused editable can summon the soft keyboard; gating here keeps
      // transient mid-animation geometry from flickering `open`.
      const inset = isEditableFocused()
        ? Math.max(0, Math.round(fixedBottom - visualBottom))
        : 0
      root.style.setProperty('--keyboard-inset', `${inset}px`)
      setOpen(inset > 0)
    }

    const onWindowResize = () => setIsMobile(window.innerWidth < 768)

    vv.addEventListener('resize', apply)
    vv.addEventListener('scroll', apply)
    window.addEventListener('resize', onWindowResize)
    apply()

    return () => {
      vv.removeEventListener('resize', apply)
      vv.removeEventListener('scroll', apply)
      window.removeEventListener('resize', onWindowResize)
      probe.remove()
      root.style.removeProperty('--keyboard-inset')
    }
  }, [])

  return { open, isMobile }
}
