'use client'

/**
 * Every popup in the bus app, in the bus app's glass.
 *
 * A frosted sheet with the header straight on the glass (charcoal-to-bronze
 * icon chip, display title, round close control) and the content on a solid
 * card riding on it — the same two layers as the panels on the page, so a
 * popup reads as one of them lifted forward rather than a different product.
 *
 * Takes both of the props shapes the bus screens used before — the workspace
 * Modal's (`open`, an icon component) and ModalShell's (always open while
 * mounted, an icon element) — so swapping it in is an import change.
 */

import React, { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { X } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import useBodyScrollLock from '@/hooks/useBodyScrollLock'
import { BUS, EASE } from './glass'

const SIZE = {
  sm: 'sm:max-w-md',
  md: 'sm:max-w-2xl',
  lg: 'sm:max-w-4xl',
  xl: 'sm:max-w-6xl',
  '2xl': 'sm:max-w-[96rem]',
} as const

export type BusModalSize = keyof typeof SIZE

export interface BusModalProps {
  /** Defaults to open: a popup rendered conditionally is open while mounted. */
  open?: boolean
  onClose: () => void
  title: React.ReactNode
  subtitle?: React.ReactNode
  /** A lucide icon component or an element. */
  icon?: LucideIcon | React.ReactNode
  /** Accepted for ModalShell compatibility; the chip is always the bus chip. */
  iconClassName?: string
  size?: BusModalSize
  /** Pin to full height, so panels that swap content do not resize. */
  fullHeight?: boolean
  footer?: React.ReactNode
  children: React.ReactNode
}

function isComponent(icon: unknown): icon is LucideIcon {
  return typeof icon === 'function' || (typeof icon === 'object' && icon !== null && '$$typeof' in icon && 'render' in icon)
}

export default function BusModal({
  open = true, onClose, title, subtitle, icon, size = 'lg', fullHeight = false, footer, children,
}: BusModalProps) {
  useBodyScrollLock(open)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (typeof document === 'undefined') return null

  const Icon = isComponent(icon) ? icon : null
  const iconEl = Icon ? <Icon size={17} className="relative z-10 text-white" /> : (icon as React.ReactNode)

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          key="bus-modal-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          // Above Leaflet (map panes 400, controls 1000). No backdrop-filter on
          // the backdrop or the sheet: blurred layers animating in over the
          // page's own glass make Chrome flash black frames. The sheet keeps
          // its glass look from the fill, rim and highlight instead.
          className="fixed inset-0 z-[1200] flex items-end sm:items-center justify-center sm:p-5 bg-[#1c1a1e]/45"
          onClick={onClose}
          data-page-theme="bus"
        >
          <motion.div
            initial={{ y: 28, opacity: 0, scale: 0.985 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 20, opacity: 0, scale: 0.99 }}
            transition={{ duration: 0.24, ease: EASE }}
            onClick={e => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            className={`relative w-full ${SIZE[size]} ${fullHeight ? 'h-[94dvh] sm:h-[88vh]' : 'max-h-[94dvh] sm:max-h-[88vh]'}
              flex flex-col overflow-hidden rounded-t-[28px] sm:rounded-[28px]
              bg-[linear-gradient(160deg,rgba(250,248,244,0.98),rgba(241,238,232,0.97))]
              border border-white/80 shadow-[inset_0_1px_0_rgba(255,255,255,.9),0_30px_80px_-30px_rgba(15,23,42,.55),0_2px_8px_rgba(15,23,42,.08)]`}
          >
            {/* Header, on the glass */}
            <div className="flex-shrink-0 px-4 sm:px-5 pt-2.5 sm:pt-4 pb-3">
              <div className="w-10 h-1 rounded-full bg-slate-400/40 mx-auto mb-2.5 sm:hidden" />
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  {iconEl && (
                    <span className="icon-chip w-10 h-10 flex-shrink-0 text-white [&_svg]:text-white"
                      style={{ background: `linear-gradient(135deg, ${BUS.charcoal}, ${BUS.bronze})` }}>
                      {iconEl}
                    </span>
                  )}
                  <div className="min-w-0">
                    <h2 className="font-display text-[1.1rem] sm:text-[1.2rem] font-bold leading-tight headline text-slate-900 truncate">{title}</h2>
                    {subtitle && <p className="text-[12px] text-slate-500 truncate">{subtitle}</p>}
                  </div>
                </div>
                <button onClick={onClose} aria-label="Close" className="lg-control w-9 h-9 flex-shrink-0">
                  <X size={16} />
                </button>
              </div>
            </div>

            {/* Content, on a solid card */}
            <div className="flex-1 min-h-0 mx-2 sm:mx-2.5 mb-2 sm:mb-2.5 rounded-[20px] bg-white/[.94] border border-white shadow-[0_1px_2px_rgba(15,23,42,.05),0_14px_30px_-22px_rgba(15,23,42,.45)] overflow-y-auto overscroll-contain">
              <div className="p-4 sm:p-5">{children}</div>
            </div>

            {footer && (
              <div className="flex-shrink-0 px-4 sm:px-5 pb-3 sm:pb-4 pt-0.5 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
                {footer}
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}
