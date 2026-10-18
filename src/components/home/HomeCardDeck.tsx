'use client'

import React, { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { motion, animate, useMotionValue, useReducedMotion, useTransform, MotionValue } from 'framer-motion'
import { ChevronLeft, ChevronRight, Pause, Play } from 'lucide-react'
import { useHasHover } from '@/hooks/useMediaQuery'

/**
 * One card in the deck. `accent` tints the glass the deck sits on and the
 * pager capsule while the card is up, so the material picks up the colour of
 * what it is carrying. `quickAdvance` marks a card with nothing to say right
 * now (an empty notifications box): it still opens the deck — the deck always
 * starts in the same place — but hands over after a short beat instead of
 * holding the screen for the full interval.
 */
export interface DeckSlot {
  key: string
  label: string
  heading: React.ReactNode
  body: React.ReactNode
  accent: string
  quickAdvance?: boolean
  /** Nothing to show (yet). The card stays mounted — so a card that loads its
   *  own data can still fetch, and can appear in place without a remount once
   *  it has something — but it is out of the strip and the pager. */
  hidden?: boolean
}

interface HomeCardDeckProps {
  slots: DeckSlot[]
  /** Fixed height classes for the whole deck. The deck never takes its height
   *  from the card on screen — swapping cards must not move the page. */
  heightClass: string
  ariaLabel?: string
}

const AUTOPLAY_MS = 7000
const QUICK_MS = 3000
const SPRING = { type: 'spring' as const, stiffness: 300, damping: 32, mass: 0.9 }

/**
 * `inert` on an offscreen slide, spelled so React 18 actually emits it: React
 * 18 drops a boolean `inert` as an unknown attribute, while an empty string is
 * the HTML spelling of a present boolean attribute and passes through. Drop
 * the cast on the React 19 upgrade and write `inert={!active}`.
 */
const INERT_ATTR = { inert: '' } as unknown as { inert?: boolean }

/** A slide that recedes a little as it leaves centre — the depth cue that
 *  makes the strip read as cards on a sheet of glass, not a filmstrip. */
function Slide({
  index, dragX, width, active, total, label, hidden = false, children,
}: {
  hidden?: boolean
  index: number
  dragX: MotionValue<number>
  width: number
  active: boolean
  total: number
  label: string
  children: React.ReactNode
}) {
  const distance = useTransform(dragX, x => (width > 0 ? Math.min(Math.abs(x / width + index), 1) : 0))
  const scale = useTransform(distance, d => 1 - d * 0.06)
  const opacity = useTransform(distance, d => 1 - d * 0.45)
  return (
    <motion.div
      role="group"
      aria-roledescription="slide"
      aria-label={`${index + 1} of ${total}: ${label}`}
      aria-hidden={!active}
      {...(active ? {} : INERT_ATTR)}
      className="h-full flex flex-col px-3 sm:px-4 pt-3.5"
      style={{ width: width || '100%', flexShrink: 0, scale, opacity, display: hidden ? 'none' : undefined }}
    >
      {children}
    </motion.div>
  )
}

/**
 * The home page's swipeable card section, in Liquid Glass.
 *
 * The deck is chrome — it is the thing you push around — so it is the glass:
 * a lensing sheet with a specular rim and a highlight that follows the
 * pointer, floating over ambient colour that takes the active card's accent.
 * The cards on it are content, so they stay solid and legible (see
 * `.lg-deck .home-card` in globals.css); glass never carries the reading.
 *
 * Moves by swipe on touch, by drag, arrows or dots with a pointer, and on its
 * own every 7 s (3 s off a card flagged `quickAdvance`). The rotation stops
 * for reduced motion, the pause control (WCAG 2.2.2), or a pointer/focus
 * inside the deck.
 */
export default function HomeCardDeck({ slots: allSlots, heightClass, ariaLabel = 'Today at a glance' }: HomeCardDeckProps) {
  // The cards actually in the strip; hidden ones are rendered but skipped.
  const slots = allSlots.filter(s => !s.hidden)
  const uid = useId()
  const reduceMotion = useReducedMotion()
  const hasHover = useHasHover()
  const dragX = useMotionValue(0)
  const shellRef = useRef<HTMLDivElement | null>(null)
  const trackRef = useRef<HTMLDivElement | null>(null)
  const [width, setWidth] = useState(0)
  const [activeKey, setActiveKey] = useState<string | null>(slots[0]?.key ?? null)
  const [resetKey, setResetKey] = useState(0)
  const [userPaused, setUserPaused] = useState(false)
  const [held, setHeld] = useState(false)
  const interactedRef = useRef(false)

  // Keyed on the joined keys, not the array: the page hands over a fresh
  // slots array on every render, and the autoplay timer and the gesture
  // listeners below depend on this — re-creating it each render would restart
  // the clock and drop a swipe in progress.
  const keySig = slots.map(s => s.key).join('|')
  const keys = useMemo(() => (keySig ? keySig.split('|') : []), [keySig])
  const activeIdx = Math.max(0, keys.indexOf(activeKey ?? ''))
  const active = slots[activeIdx]

  const activeIdxRef = useRef(activeIdx)
  activeIdxRef.current = activeIdx

  const widthNow = useCallback(() => trackRef.current?.offsetWidth || width || 1, [width])

  useLayoutEffect(() => {
    const el = trackRef.current
    if (!el) return
    const measure = () => {
      setWidth(el.offsetWidth)
      // Re-seat the strip on the active card at the new width.
      dragX.set(-activeIdxRef.current * el.offsetWidth)
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [dragX])

  // The slot list changed: before any interaction the deck stays on its
  // first card; after, it holds the user's card at its new index.
  useEffect(() => {
    if (keys.length === 0) return
    const idx = interactedRef.current ? keys.indexOf(activeKey ?? '') : 0
    const target = idx === -1 ? 0 : idx
    setActiveKey(keys[target])
    dragX.set(-target * widthNow())
    // Only when the list itself changes, never on a swipe.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keySig])

  const goTo = useCallback((idx: number, user = true) => {
    if (keys.length === 0) return
    const target = (idx + keys.length) % keys.length
    if (user) {
      interactedRef.current = true
      setResetKey(k => k + 1)
    }
    setActiveKey(keys[target])
    if (reduceMotion) dragX.set(-target * widthNow())
    else animate(dragX, -target * widthNow(), SPRING)
  }, [keys, dragX, reduceMotion, widthNow])

  const interval = active?.quickAdvance ? QUICK_MS : AUTOPLAY_MS
  const rotating = keys.length > 1 && !reduceMotion && !userPaused && !held

  useEffect(() => {
    if (!rotating) return
    const t = window.setTimeout(() => {
      // A background tab shouldn't burn through the deck.
      if (document.hidden) { setResetKey(k => k + 1); return }
      goTo(activeIdxRef.current + 1, false)
    }, interval)
    return () => window.clearTimeout(t)
  }, [rotating, interval, activeKey, resetKey, goTo])

  const hold = useCallback((h: boolean) => { if (hasHover) setHeld(h) }, [hasHover])

  /* Gestures. Native, non-passive touch handlers so a confirmed horizontal
     swipe can preventDefault() the page scroll (React's synthetic touchmove
     is passive); direction locks from the first few pixels so a vertical
     scroll — of the page or a list inside a card — is left alone. A mouse
     drags the same way through pointer events, and a drag swallows the click
     that ends it so a card's link doesn't fire at the end of a swipe. */
  useEffect(() => {
    const el = trackRef.current
    if (!el) return
    let startX: number | null = null
    let startY = 0
    let base = 0
    let dir: 'h' | 'v' | null = null
    let suppressClick = false

    const begin = (x: number, y: number) => {
      interactedRef.current = true
      startX = x; startY = y; dir = null
      base = dragX.get()
      dragX.stop()
      setResetKey(k => k + 1)
    }
    const move = (x: number, y: number, prevent: () => void) => {
      if (startX === null) return
      const dx = x - startX
      const dy = y - startY
      if (dir === null) {
        if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return
        dir = Math.abs(dx) > Math.abs(dy) ? 'h' : 'v'
      }
      if (dir === 'v') return
      prevent()
      const W = widthNow()
      const raw = base + dx
      const minX = -(keys.length - 1) * W
      const x2 = raw < minX ? minX + (raw - minX) * 0.22 : raw > 0 ? raw * 0.22 : raw
      dragX.set(x2)
    }
    const end = (x: number | null) => {
      if (startX === null) return
      const wasH = dir === 'h'
      const dx = (x ?? startX) - startX
      startX = null; dir = null
      if (!wasH) return
      suppressClick = true
      const W = widthNow()
      const frac = -dragX.get() / W
      let target: number
      if (dx < -40) target = Math.min(Math.ceil(frac - 0.1), keys.length - 1)
      else if (dx > 40) target = Math.max(Math.floor(frac + 0.1), 0)
      else target = Math.max(0, Math.min(Math.round(frac), keys.length - 1))
      setActiveKey(keys[target])
      animate(dragX, -target * W, SPRING)
    }

    const onTouchStart = (e: TouchEvent) => begin(e.touches[0].clientX, e.touches[0].clientY)
    const onTouchMove = (e: TouchEvent) => move(e.touches[0].clientX, e.touches[0].clientY, () => e.preventDefault())
    const onTouchEnd = (e: TouchEvent) => end(e.changedTouches[0]?.clientX ?? null)
    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse' || e.button !== 0) return
      suppressClick = false
      begin(e.clientX, e.clientY)
    }
    const onPointerMove = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return
      move(e.clientX, e.clientY, () => e.preventDefault())
    }
    const onPointerUp = (e: PointerEvent) => { if (e.pointerType === 'mouse') end(e.clientX) }
    const onClickCapture = (e: MouseEvent) => {
      if (suppressClick) { e.preventDefault(); e.stopPropagation(); suppressClick = false }
      setResetKey(k => k + 1)
    }
    // A mouse drag over text would otherwise start a selection.
    const onDragStart = (e: DragEvent) => e.preventDefault()

    el.addEventListener('touchstart', onTouchStart, { passive: true })
    el.addEventListener('touchmove', onTouchMove, { passive: false })
    el.addEventListener('touchend', onTouchEnd, { passive: true })
    el.addEventListener('touchcancel', onTouchEnd, { passive: true })
    el.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    el.addEventListener('click', onClickCapture, true)
    el.addEventListener('dragstart', onDragStart)
    return () => {
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchmove', onTouchMove)
      el.removeEventListener('touchend', onTouchEnd)
      el.removeEventListener('touchcancel', onTouchEnd)
      el.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      el.removeEventListener('click', onClickCapture, true)
      el.removeEventListener('dragstart', onDragStart)
    }
  }, [keys, dragX, widthNow])

  // Specular highlight follows the pointer across the glass.
  const onShellPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = shellRef.current
    if (!el || e.pointerType !== 'mouse') return
    const r = el.getBoundingClientRect()
    el.style.setProperty('--lg-x', `${e.clientX - r.left}px`)
    el.style.setProperty('--lg-y', `${e.clientY - r.top}px`)
  }

  if (allSlots.length === 0) return null

  return (
    <div className={`relative ${heightClass}`}>
      {/* Ambient light under the glass, in the active card's accent. Glass
          over a flat colour reads as a grey blob; this gives it something to
          bend, and lets the material shift colour as the cards change. */}
      <div aria-hidden className="lg-ambient">
        <span style={{ color: active?.accent }} />
        <span style={{ color: active?.accent }} />
      </div>

      <motion.div
        ref={shellRef}
        role="group"
        aria-roledescription="carousel"
        aria-label={ariaLabel}
        className="lg-deck group/deck h-full flex flex-col"
        // Materialises rather than snapping in. Opacity and scale only — an
        // animated blur filter repaints on the main thread every frame.
        initial={reduceMotion ? false : { opacity: 0, scale: 0.97 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={reduceMotion ? { duration: 0 } : { duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        onPointerMove={onShellPointerMove}
        onMouseEnter={() => hold(true)}
        onMouseLeave={() => hold(false)}
        onFocusCapture={() => hold(true)}
        onBlurCapture={() => hold(false)}
      >
        <div
          ref={trackRef}
          className={`relative z-[3] flex-1 min-h-0 overflow-hidden ${hasHover ? 'select-none' : ''}`}
          style={{ touchAction: 'pan-y' }}
        >
          <motion.div className="flex h-full" style={{ x: dragX }}>
            {allSlots.map(slot => {
              const idx = slots.indexOf(slot)
              return (
              <Slide
                key={slot.key}
                index={Math.max(idx, 0)}
                dragX={dragX}
                width={width}
                active={idx !== -1 && idx === activeIdx}
                hidden={idx === -1}
                total={slots.length}
                label={slot.label}
              >
                {slot.heading}
                <div className="flex-1 min-h-0">{slot.body}</div>
              </Slide>
              )
            })}
          </motion.div>
        </div>

        {/* Pager — a glass capsule of its own, the deck's one control strip. */}
        <div className="relative z-[3] flex items-center justify-center gap-1 h-12 flex-shrink-0">
          {hasHover && slots.length > 1 && (
            <button
              type="button"
              onClick={() => goTo(activeIdx - 1)}
              aria-label="Previous card"
              className="lg-control w-8 h-8 opacity-0 group-hover/deck:opacity-100 focus-visible:opacity-100"
            >
              <ChevronLeft size={15} />
            </button>
          )}
          <div className="lg-pill flex items-center px-1.5 h-8">
            {slots.map((slot, idx) => {
              const isActive = idx === activeIdx
              return (
                <button
                  key={slot.key}
                  type="button"
                  onClick={() => { if (!isActive) goTo(idx) }}
                  aria-label={`Show ${slot.label}`}
                  aria-current={isActive}
                  className="relative h-8 px-[3px] flex items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/60"
                >
                  <span className={`relative block h-1.5 rounded-full overflow-hidden transition-[width] duration-300 ${isActive ? 'w-6' : 'w-1.5'}`}>
                    <span className="absolute inset-0 rounded-full bg-slate-400/45" />
                    {isActive && (
                      <motion.span
                        layoutId={`${uid}-dot`}
                        className="absolute inset-0 rounded-full"
                        style={{ background: `${slot.accent}55` }}
                        transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                      />
                    )}
                    {/* The countdown to the next card, filling the capsule. */}
                    {isActive && (
                      <motion.span
                        key={`${slot.key}-${resetKey}-${rotating}`}
                        className="absolute inset-y-0 left-0 rounded-full"
                        style={{ background: slot.accent }}
                        initial={{ width: rotating ? '0%' : '100%' }}
                        animate={{ width: '100%' }}
                        transition={rotating ? { duration: interval / 1000, ease: 'linear' } : { duration: 0 }}
                      />
                    )}
                  </span>
                </button>
              )
            })}
            {slots.length > 1 && !reduceMotion && (
              <button
                type="button"
                onClick={() => setUserPaused(p => !p)}
                aria-label={userPaused ? 'Resume automatic card rotation' : 'Stop automatic card rotation'}
                aria-pressed={userPaused}
                className="ml-1 w-7 h-7 flex items-center justify-center rounded-full text-slate-500 hover:text-slate-800 hover:bg-white/60 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/60"
              >
                {userPaused ? <Play size={11} /> : <Pause size={11} />}
              </button>
            )}
          </div>
          {hasHover && slots.length > 1 && (
            <button
              type="button"
              onClick={() => goTo(activeIdx + 1)}
              aria-label="Next card"
              className="lg-control w-8 h-8 opacity-0 group-hover/deck:opacity-100 focus-visible:opacity-100"
            >
              <ChevronRight size={15} />
            </button>
          )}
        </div>
      </motion.div>
    </div>
  )
}
