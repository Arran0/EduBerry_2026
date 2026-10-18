/**
 * How every popup sheet (ModalShell) and the profile card come and go.
 *
 * Transform only. The sheet rises from below the screen and drops back down;
 * it never fades. Fading a panel means animating its opacity, and Chrome can
 * only fade a subtree that has layers of its own (a scrolling list, an image
 * fading in) by first painting the whole panel into an offscreen surface — a
 * new surface on every open and close, and when it isn't ready in time that
 * frame is drawn black: the intermittent black blink. A translated panel needs
 * no such surface. The dim behind it still fades — it is one plain colour, a
 * single layer, and safe to fade.
 *
 * With reduced motion asked for, the sheet simply appears and disappears.
 */
import type { MotionProps } from 'framer-motion'

export function sheetMotion(reduce: boolean | null): Pick<MotionProps, 'initial' | 'animate' | 'exit' | 'transition'> {
  if (reduce) return { initial: false, animate: { y: 0 }, exit: { y: 0, transition: { duration: 0 } }, transition: { duration: 0 } }
  return {
    initial: { y: '100vh' },
    animate: { y: 0 },
    exit: { y: '100vh', transition: { duration: 0.24, ease: [0.4, 0, 1, 1] } },
    transition: { type: 'spring', stiffness: 380, damping: 40, mass: 0.9 },
  }
}

export const SCRIM_MOTION: Pick<MotionProps, 'initial' | 'animate' | 'exit' | 'transition'> = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
  transition: { duration: 0.2 },
}

/** The same motion for a sheet that doesn't check reduced motion itself. */
export const SHEET_MOTION = sheetMotion(false)
