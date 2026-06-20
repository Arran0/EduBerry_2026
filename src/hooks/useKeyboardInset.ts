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
 * Rather than derive that from `window.innerHeight - visualViewport.height`
 * (which is unreliable on iOS Safari, where the collapsing bottom toolbar makes
 * `innerHeight` disagree with the real `position: fixed` containing block and
 * leaves the bar floating in a gap above the keyboard), we calibrate against a
 * *baseline*: the largest visual-viewport bottom edge observed while no text
 * field is focused. The keyboard inset is then simply how far the current
 * bottom edge has risen from that baseline. This makes the measurement immune
 * to browser-chrome quirks and to the `safe-area`/`viewportFit: cover` offset.
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

    // Baseline = the full usable visual-viewport bottom edge with no keyboard.
    let fullBottom = vv.offsetTop + vv.height

    const apply = () => {
      const bottom = vv.offsetTop + vv.height
      let inset = 0
      if (isEditableFocused()) {
        // Keyboard may be up: anything below the baseline is the keyboard.
        inset = Math.max(0, Math.round(fullBottom - bottom))
      } else {
        // No field focused → trust the current geometry as the true baseline.
        // (Only ever grow it so a transient mid-animation reading can't shrink
        // the reference and under-report the next keyboard.)
        fullBottom = Math.max(fullBottom, bottom)
      }
      root.style.setProperty('--keyboard-inset', `${inset}px`)
      setOpen(inset > 0)
    }

    const onWindowResize = () => {
      setIsMobile(window.innerWidth < 768)
      // Re-baseline on rotation / chrome changes when no keyboard is involved.
      if (!isEditableFocused()) fullBottom = vv.offsetTop + vv.height
    }

    vv.addEventListener('resize', apply)
    vv.addEventListener('scroll', apply)
    window.addEventListener('resize', onWindowResize)
    apply()

    return () => {
      vv.removeEventListener('resize', apply)
      vv.removeEventListener('scroll', apply)
      window.removeEventListener('resize', onWindowResize)
      root.style.removeProperty('--keyboard-inset')
    }
  }, [])

  return { open, isMobile }
}
