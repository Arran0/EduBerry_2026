'use client'

import { useEffect } from 'react'

/**
 * Freeze the page behind an overlay, safely when overlays stack — without
 * touching the page's overflow.
 *
 * It used to set `body.style.overflow = 'hidden'` (and put it back on close).
 * That switches the root scroller off and on, and Chrome answers by tearing
 * down and rebuilding the page's scrolling layer — on every open and every
 * close. When the rebuilt layer isn't rastered by the next frame, Chrome draws
 * that frame black: the intermittent "black blink" on opening or closing the
 * profile card and the calendar popups, there about half the time because it
 * is a race against raster.
 *
 * So the page is never changed. Instead, while any overlay is open, the
 * gestures that would scroll it are cancelled at the document: a wheel or
 * touch drag (or a scrolling key) is let through only when something inside
 * the overlay can still scroll that way, so lists in a popup scroll normally,
 * stop at their ends, and never hand the gesture on to the page behind.
 *
 * Refcounted process-wide, so stacked overlays (a popup opened from a popup,
 * or one mounting during another's exit) share one set of listeners and the
 * last to close removes them.
 */
let lockCount = 0
let touchY = 0
let touchX = 0

const SCROLL_KEYS = new Set([' ', 'PageUp', 'PageDown', 'Home', 'End', 'ArrowUp', 'ArrowDown'])

/** Whether something between `target` and the document can scroll by `dy` (and `dx`). */
function canScrollWithin(target: EventTarget | null, dy: number, dx = 0): boolean {
  let el = target instanceof Element ? target : null
  while (el && el !== document.body && el !== document.documentElement) {
    const cs = getComputedStyle(el)
    if (dy !== 0 && /(auto|scroll|overlay)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 1) {
      if (dy < 0 && el.scrollTop > 0) return true
      if (dy > 0 && el.scrollTop + el.clientHeight < el.scrollHeight - 1) return true
    }
    if (dx !== 0 && /(auto|scroll|overlay)/.test(cs.overflowX) && el.scrollWidth > el.clientWidth + 1) {
      if (dx < 0 && el.scrollLeft > 0) return true
      if (dx > 0 && el.scrollLeft + el.clientWidth < el.scrollWidth - 1) return true
    }
    el = el.parentElement
  }
  return false
}

function onWheel(e: WheelEvent) {
  if (e.ctrlKey) return // pinch-zoom on a trackpad
  if (!canScrollWithin(e.target, e.deltaY, e.deltaX)) e.preventDefault()
}

function onTouchStart(e: TouchEvent) {
  touchY = e.touches[0]?.clientY ?? 0
  touchX = e.touches[0]?.clientX ?? 0
}

function onTouchMove(e: TouchEvent) {
  if (e.touches.length > 1) return // pinch
  const t = e.touches[0]
  const dy = touchY - t.clientY
  const dx = touchX - t.clientX
  const vertical = Math.abs(dy) >= Math.abs(dx)
  if (!canScrollWithin(e.target, vertical ? dy : 0, vertical ? 0 : dx)) e.preventDefault()
}

function onKeyDown(e: KeyboardEvent) {
  if (!SCROLL_KEYS.has(e.key)) return
  const t = e.target as HTMLElement | null
  if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return
  const dy = e.key === 'ArrowUp' || e.key === 'PageUp' || e.key === 'Home' ? -1 : 1
  if (!canScrollWithin(t, dy)) e.preventDefault()
}

/** Whether any overlay currently holds the lock (for tests). */
export function isScrollLocked(): boolean {
  return lockCount > 0
}

const opts: AddEventListenerOptions = { passive: false, capture: true }

/** @param active pass false to hold the hook's position without locking. */
export function useBodyScrollLock(active = true): void {
  useEffect(() => {
    if (!active) return
    if (lockCount === 0) {
      document.addEventListener('wheel', onWheel, opts)
      document.addEventListener('touchstart', onTouchStart, opts)
      document.addEventListener('touchmove', onTouchMove, opts)
      document.addEventListener('keydown', onKeyDown, opts)
    }
    lockCount += 1
    return () => {
      lockCount = Math.max(0, lockCount - 1)
      if (lockCount === 0) {
        document.removeEventListener('wheel', onWheel, opts)
        document.removeEventListener('touchstart', onTouchStart, opts)
        document.removeEventListener('touchmove', onTouchMove, opts)
        document.removeEventListener('keydown', onKeyDown, opts)
      }
    }
  }, [active])
}

export default useBodyScrollLock
