'use client'

import React, { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { motion, useDragControls, PanInfo } from 'framer-motion'
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
  children: React.ReactNode
}

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
  children,
}: ModalShellProps) {
  const dragControls = useDragControls()
  const panelRef = useRef<HTMLDivElement>(null)
  // Phones still keep a slight top radius on the sheet even when sharp, so the
  // panel reads as a sheet rising over the page rather than a stuck banner.
  const radius = sharp ? 'rounded-t-lg sm:rounded-none' : 'rounded-t-[1.75rem] sm:rounded-[1.75rem]'

  // Escape to close. Body scroll is frozen by the shared refcounted lock, so
  // two shells open at once still leave the page scrollable once both close.
  useBodyScrollLock()
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
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

  return createPortal(
    // modal-portal marks this subtree as page chrome that was raised out of the
    // page: a pro-chrome (staff) page squares its modals through that hook,
    // since the portal lands on <body>, outside the page's own scope.
    <div
      data-page-theme={pageTheme}
      className={`modal-portal fixed inset-0 ${zClass} flex items-end sm:items-center justify-center`}
    >
      {/* Backdrop */}
      <motion.div
        className="absolute inset-0 bg-slate-950/45 backdrop-blur-md"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.18 }}
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
            : `overflow-hidden ${radius} bg-white ring-1 ring-slate-900/[0.06] shadow-[0_-12px_48px_-12px_rgba(15,23,42,0.32)] sm:shadow-[0_32px_80px_-20px_rgba(15,23,42,0.4)]`
        }`}
        initial={{ opacity: 0, y: 56, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 56, scale: 0.97 }}
        transition={{ type: 'spring', stiffness: 340, damping: 30 }}
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
          <div className={`w-10 h-1.5 !rounded-full ${bare ? 'bg-slate-900/15 backdrop-blur-sm' : 'bg-slate-300/80'}`} />
        </div>

        {/* Header */}
        {title != null && !bare && (
          <div className="flex-shrink-0 flex items-center gap-3 px-5 pt-2 pb-3.5 sm:pt-5 border-b border-slate-100 bg-white/90 backdrop-blur-xl">
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
          <div className={`flex-1 overflow-y-auto overscroll-contain px-5 py-4 ${footer ? '' : 'pb-[max(1.25rem,env(safe-area-inset-bottom))]'} ${bodyClassName}`}>
            {children}
          </div>
        )}

        {/* Footer */}
        {footer && !bare && (
          <div className="flex-shrink-0 px-5 pt-3 pb-[max(0.875rem,env(safe-area-inset-bottom))] border-t border-slate-100 bg-white/90 backdrop-blur-xl">
            {footer}
          </div>
        )}
      </motion.div>
    </div>,
    document.body
  )
}
