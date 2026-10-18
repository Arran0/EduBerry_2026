'use client'

import React, { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { motion, useDragControls, useIsPresent, useReducedMotion, PanInfo } from 'framer-motion'
import { sheetMotion, SCRIM_MOTION } from '@/lib/sheetMotion'
import { X } from 'lucide-react'
import useBodyScrollLock from '@/hooks/useBodyScrollLock'

/**
 * ModalShell — the shared popup surface for the classroom experience.
 *
 * Phones get a bottom sheet: grab handle, drag-to-dismiss, safe-area padding.
 * Larger screens get a centered dialog with a soft spring rise.
 * Render inside <AnimatePresence> for exit animations.
 *
 * `bare` skips the built-in surface & padding for content (e.g. existing
 * forms) that draws its own card — the shell still provides the backdrop,
 * positioning, animation and sheet behaviour.
 */

/**
 * Every mounted shell, oldest first. Mutated by the Escape effect below; the
 * last entry is whichever shell is on top, and it is the only one that answers
 * the key.
 */
const ESCAPE_STACK: object[] = []

const SIZE_CLASS = {
  sm: 'sm:max-w-sm',
  md: 'sm:max-w-md',
  lg: 'sm:max-w-lg',
  xl: 'sm:max-w-2xl',
  '2xl': 'sm:max-w-4xl',
} as const

// '2xl' gets extra vertical room too — it's used for dense, table-like
// content (e.g. marksheets) that benefits from showing more rows at once.
const MAX_H_CLASS: Record<keyof typeof SIZE_CLASS, string> = {
  sm: 'sm:max-h-[min(88dvh,46rem)]',
  md: 'sm:max-h-[min(88dvh,46rem)]',
  lg: 'sm:max-h-[min(88dvh,46rem)]',
  xl: 'sm:max-h-[min(88dvh,46rem)]',
  '2xl': 'sm:max-h-[min(92dvh,60rem)]',
}

interface ModalShellProps {
  onClose: () => void
  size?: keyof typeof SIZE_CLASS
  /** Header — omitted entirely when no title is given (bare content). */
  title?: React.ReactNode
  subtitle?: React.ReactNode
  icon?: React.ReactNode
  /** Tailwind classes for the icon chip, e.g. "bg-violet-100 text-violet-600". */
  iconClassName?: string
  headerActions?: React.ReactNode
  footer?: React.ReactNode
  bare?: boolean
  zClass?: string
  /** Extra classes for the scrolling body (non-bare). */
  bodyClassName?: string
  /**
   * Floor for the panel's height, e.g. "sm:min-h-[32rem]". Without one a
   * popup whose content is short collapses to a sliver — fine for a
   * confirmation, wrong for something with tabs and a list, where the box
   * would jump in size every time the folder changed.
   */
  minHClass?: string
  /**
   * Square the panel, its icon chip and its close button. The admin sheets
   * (Salary, Fees) are drawn with hard 90° edges, and a pill-shaped popup
   * floating over one reads as a different product.
   */
  sharp?: boolean
  /**
   * The Liquid Glass sheet: a frosted panel with the header straight on the
   * glass and the body on a solid card riding on it (the home deck's two
   * layers). Defaults on for the pages listed in GLASS_THEMES, so every popup
   * raised from them matches without each one opting in.
   */
  glass?: boolean
  /**
   * Glass only: the body sits straight on the sheet (no solid card around it)
   * — for content that is already its own card, such as the month calendar.
   * The sheet is then exactly as tall as its content.
   */
  cardless?: boolean
  children: React.ReactNode
}

/** Page themes whose popups default to the glass sheet. */
const GLASS_THEMES = new Set(['staff-attendance', 'staff-leave', 'student-attendance', 'student-leave'])

export default function ModalShell({
  onClose,
  size = 'md',
  title,
  subtitle,
  icon,
  iconClassName = 'bg-slate-100 text-slate-600',
  headerActions,
  footer,
  bare = false,
  zClass = 'z-50',
  bodyClassName = '',
  minHClass = '',
  sharp = false,
  glass: glassProp,
  cardless = false,
  children,
}: ModalShellProps) {
  const dragControls = useDragControls()
  const reduceMotion = useReducedMotion()
  const panelRef = useRef<HTMLDivElement>(null)
  // Phones still keep a slight top radius on the sheet even when sharp, so the
  // panel reads as a sheet rising over the page rather than a stuck banner.
  const radius = sharp ? 'rounded-t-lg sm:rounded-none' : 'rounded-t-[1.75rem] sm:rounded-[1.75rem]'

  /**
   * Whether AnimatePresence still considers this shell part of the tree, or
   * has begun animating it away. True when rendered outside an
   * AnimatePresence at all.
   *
   * Everything below that keys off this is a safety net rather than a
   * behaviour: a shell on its way out stops holding the page hostage the
   * instant it is told to leave, rather than at the end of its exit
   * animation. In the normal case those two moments are ~200ms apart and
   * nobody notices.
   *
   * The case worth guarding is an exit that never completes at all. This
   * shell's portal root covers the whole viewport, so one left mounted at
   * opacity 0 is invisible and still takes every click — a page that looks
   * completely normal and responds to nothing, with no error to explain it.
   * That is a bad enough failure, and a hard enough one to diagnose from a
   * bug report, to be worth making structurally impossible rather than
   * merely unlikely.
   */
  const isPresent = useIsPresent()

  // Escape to close. Body scroll is frozen by the shared refcounted lock, so
  // two shells open at once still leave the page scrollable once both close.
  // Released as soon as the shell starts leaving — a stuck exit must not be
  // able to strand the page permanently unscrollable.
  useBodyScrollLock(isPresent)

  // Only the topmost shell answers Escape. Every open shell listens on the
  // same window, so without this one keypress closes the whole stack — press
  // Escape to dismiss a "why are you waiving this?" prompt and the screen it
  // was asked from disappears with it. The stack is a module-level array
  // rather than context because the shells are portals into <body> with no
  // common provider between them.
  useEffect(() => {
    const token = {}
    ESCAPE_STACK.push(token)
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (ESCAPE_STACK[ESCAPE_STACK.length - 1] !== token) return
      onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      const at = ESCAPE_STACK.indexOf(token)
      if (at !== -1) ESCAPE_STACK.splice(at, 1)
    }
  }, [onClose])

  const handleDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.y > 90 || info.velocity.y > 600) onClose()
  }

  if (typeof document === 'undefined') return null

  // The page's palette lives on its [data-page-theme] element (globals.css for
  // the defaults, PageConfigContext for whatever an admin picked in app
  // settings). A portal lands on <body>, outside that element, so carry the
  // attribute across — otherwise every --page-* variable inside a modal falls
  // back to its default and the sheet ignores the school's colours.
  const pageTheme = document.querySelector('[data-page-theme]')
    ?.getAttribute('data-page-theme') ?? undefined
  const glass = glassProp ?? (!!pageTheme && GLASS_THEMES.has(pageTheme))

  if (glass) {
    return createPortal(
      <div
        data-page-theme={pageTheme}
        className={`modal-portal fixed inset-0 ${zClass} flex items-end sm:items-center justify-center`}
        style={isPresent ? undefined : { pointerEvents: 'none' }}
      >
        {/* No backdrop-filter here or on the sheet: a blurred layer animating
            in over glass makes Chrome flash black frames (see BusModal). The
            sheet reads as glass from its fill, rim and highlight instead. */}
        <motion.div
          className="absolute inset-0 bg-[#1c1a1e]/45"
          {...SCRIM_MOTION}
          onClick={onClose}
        />

        <motion.div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          className={`lg-sheet relative flex flex-col w-full ${SIZE_CLASS[size]} max-h-[94dvh] ${MAX_H_CLASS[size]} ${minHClass} sm:mx-4 overflow-hidden rounded-t-[28px] sm:rounded-[28px]`}
          // Slides, never fades — see lib/sheetMotion.
          {...sheetMotion(reduceMotion)}
          drag="y"
          dragControls={dragControls}
          dragListener={false}
          dragConstraints={{ top: 0, bottom: 0 }}
          dragElastic={{ top: 0, bottom: 0.55 }}
          onDragEnd={handleDragEnd}
        >
          <div
            className={`sm:hidden flex-shrink-0 flex justify-center pt-2.5 pb-1 cursor-grab active:cursor-grabbing touch-none ${bare ? 'absolute top-0 left-0 right-0 z-20' : ''}`}
            onPointerDown={e => dragControls.start(e)}
          >
            <div className="w-10 h-1.5 !rounded-full bg-slate-500/30" />
          </div>

          {/* Header, straight on the glass */}
          {title != null && !bare && (
            <div className="relative z-[3] flex-shrink-0 flex items-center gap-3 px-4 sm:px-5 pt-1.5 sm:pt-4 pb-3">
              {icon && (
                <div className={`icon-chip w-10 h-10 flex-shrink-0 ${iconClassName}`}>
                  <span className="relative z-10 flex">{icon}</span>
                </div>
              )}
              <div className="flex-1 min-w-0">
                <h2 className="font-display text-[1.05rem] sm:text-[1.15rem] font-bold text-slate-900 leading-tight headline truncate">{title}</h2>
                {subtitle != null && (
                  <p className="text-[12px] text-slate-500 truncate mt-0.5">{subtitle}</p>
                )}
              </div>
              {headerActions}
              <button onClick={onClose} aria-label="Close" className="lg-control w-9 h-9 flex-shrink-0">
                <X size={16} strokeWidth={2.4} />
              </button>
            </div>
          )}

          {/* Body, on a solid card riding on the glass */}
          {bare ? (
            <div className="relative z-[3] overflow-y-auto overflow-x-hidden overscroll-contain pb-[env(safe-area-inset-bottom)]">
              {children}
            </div>
          ) : (
            <div className={`${cardless ? '' : 'lg-sheet-card '}relative z-[3] flex-1 min-h-0 mx-2 sm:mx-2.5 ${footer ? '' : 'mb-[max(0.5rem,env(safe-area-inset-bottom))] sm:mb-2.5'} overflow-y-auto overflow-x-hidden overscroll-contain`}>
              <div className={`px-4 sm:px-5 py-4 ${bodyClassName}`}>{children}</div>
            </div>
          )}

          {footer && !bare && (
            <div className="relative z-[3] flex-shrink-0 px-4 sm:px-5 pt-2.5 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:pb-3.5">
              {footer}
            </div>
          )}
        </motion.div>
      </div>,
      document.body
    )
  }

  return createPortal(
    // modal-portal marks this subtree as page chrome that was raised out of the
    // page: a pro-chrome (staff) page squares its modals through that hook,
    // since the portal lands on <body>, outside the page's own scope.
    <div
      data-page-theme={pageTheme}
      className={`modal-portal fixed inset-0 ${zClass} flex items-end sm:items-center justify-center`}
      // A leaving shell is inert: its backdrop and panel inherit this, so the
      // page underneath is clickable again from the moment the exit starts —
      // and stays clickable even if the exit never finishes.
      style={isPresent ? undefined : { pointerEvents: 'none' }}
    >
      {/* Backdrop — a plain dim, no backdrop-filter. A full-screen blur that
          fades in and out, with more popups (a profile card, a confirmation)
          fading over it in turn, is what made Chrome flash black frames. */}
      <motion.div
        className="absolute inset-0 bg-slate-950/50"
        {...SCRIM_MOTION}
        onClick={onClose}
      />

      {/* Panel */}
      <motion.div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        className={`relative flex flex-col w-full ${SIZE_CLASS[size]} max-h-[92dvh] ${MAX_H_CLASS[size]} ${minHClass} sm:mx-4 ${
          bare
            ? `overflow-hidden ${radius}`
            : `overflow-hidden ${radius} bg-white ring-1 ring-slate-900/[0.06] shadow-[inset_0_1px_0_rgba(255,255,255,1),0_-12px_48px_-12px_rgba(15,23,42,0.32)] sm:shadow-[inset_0_1px_0_rgba(255,255,255,1),0_32px_80px_-20px_rgba(15,23,42,0.4)]`
        }`}
        // Slides, never fades — see lib/sheetMotion.
        {...sheetMotion(reduceMotion)}
        drag="y"
        dragControls={dragControls}
        dragListener={false}
        dragConstraints={{ top: 0, bottom: 0 }}
        dragElastic={{ top: 0, bottom: 0.55 }}
        onDragEnd={handleDragEnd}
      >
        {/* Grab handle — phones only; the touch strip starts the drag */}
        <div
          className={`sm:hidden flex-shrink-0 flex justify-center pt-2.5 pb-1 cursor-grab active:cursor-grabbing touch-none ${bare ? 'absolute top-0 left-0 right-0 z-20' : ''}`}
          onPointerDown={e => dragControls.start(e)}
        >
          <div className={`w-10 h-1.5 !rounded-full ${bare ? 'bg-slate-900/20' : 'bg-slate-300/80'}`} />
        </div>

        {/* Header */}
        {title != null && !bare && (
          <div className="flex-shrink-0 flex items-center gap-3 px-5 pt-2 pb-3.5 sm:pt-5 border-b border-slate-100 bg-white">
            {icon && (
              <div className={`w-9 h-9 ${sharp ? '' : '!rounded-xl'} flex items-center justify-center flex-shrink-0 ${iconClassName}`}>
                {icon}
              </div>
            )}
            <div className="flex-1 min-w-0">
              <h2 className="text-[15px] font-bold text-slate-900 leading-tight truncate">{title}</h2>
              {subtitle != null && (
                <p className="text-xs text-slate-400 truncate mt-0.5">{subtitle}</p>
              )}
            </div>
            {headerActions}
            <button
              onClick={onClose}
              aria-label="Close"
              className={`w-8 h-8 flex-shrink-0 flex items-center justify-center ${sharp ? '' : '!rounded-full'} bg-slate-100 text-slate-500 hover:bg-slate-200 hover:text-slate-700 active:scale-95 transition-all`}
            >
              <X size={15} strokeWidth={2.5} />
            </button>
          </div>
        )}

        {/* Body */}
        {bare ? (
          // White backing on phones so the embedded card's rounded bottom
          // corners don't leak the backdrop at the sheet's bottom edge.
          <div className="overflow-y-auto overscroll-contain pb-[env(safe-area-inset-bottom)] bg-white sm:bg-transparent">
            {children}
          </div>
        ) : (
          <div className={`flex-1 overflow-y-auto overflow-x-hidden overscroll-contain px-5 py-4 ${footer ? '' : 'pb-[max(1.25rem,env(safe-area-inset-bottom))]'} ${bodyClassName}`}>
            {children}
          </div>
        )}

        {/* Footer */}
        {footer && !bare && (
          <div className="flex-shrink-0 px-5 pt-3 pb-[max(0.875rem,env(safe-area-inset-bottom))] border-t border-slate-100 bg-white">
            {footer}
          </div>
        )}
      </motion.div>
    </div>,
    document.body
  )
}
