'use client'

import React from 'react'
import { motion } from 'framer-motion'

/**
 * Shared aesthetic tokens for the whole exam app. Branded surfaces (buttons,
 * active states, accent highlights) and the page background are driven by the
 * page-theme CSS variables — `--page-primary*` and `--page-accent*` — so the
 * exam space follows whatever theme an admin configures under Settings →
 * Themes (key `exam`). Neutral text/borders stay fixed for readability.
 */
export const EXAM = {
  // Surfaces
  card: 'bg-white border border-[#E4E4E7] rounded-xl',
  cardHover: 'bg-white border border-[#E4E4E7] rounded-xl shadow-sm hover:shadow-md transition-shadow',
  // Form controls — focus border follows the theme primary
  input:
    'w-full bg-white border border-[#E4E4E7] rounded-lg px-3 py-2.5 text-sm text-[#27272A] placeholder:text-[#A1A1AA] focus:outline-none focus:border-[var(--page-primary)] transition-colors',
  field:
    'w-full bg-white border border-[#E4E4E7] rounded-lg px-3 py-2 text-sm text-[#27272A] placeholder:text-[#A1A1AA] focus:outline-none focus:border-[var(--page-primary)] transition-colors',
  label: 'text-[10px] font-bold uppercase tracking-widest text-[#71717A]',
  fieldLabel: 'block text-xs font-medium text-[#71717A] mb-1',
  // Buttons — primary (solid theme) and accent (gold-equivalent)
  darkBtn:
    'inline-flex items-center justify-center gap-1.5 bg-[var(--page-primary)] hover:bg-[var(--page-primary-dark)] text-white text-xs font-semibold px-3 py-2 rounded-lg transition-colors disabled:opacity-50',
  goldBtn:
    'inline-flex items-center justify-center gap-1.5 bg-[var(--page-accent)] hover:brightness-95 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-all disabled:opacity-50',
  ghostBtn:
    'inline-flex items-center justify-center gap-1.5 bg-white border border-[#E4E4E7] text-[#71717A] hover:text-[#27272A] hover:border-[#D4D4D8] text-xs font-semibold px-3 py-2 rounded-lg transition-colors disabled:opacity-50',
} as const

/** A shimmering placeholder block. Pass sizing/rounding via `className`. */
export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`skeleton rounded-lg ${className}`} />
}

/**
 * Smooth fade-up entrance. `index` staggers siblings without each needing its
 * own variants block — pass the map index for a gentle cascade.
 */
export function FadeIn({
  children,
  index = 0,
  className = '',
}: {
  children: React.ReactNode
  index?: number
  className?: string
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, delay: Math.min(index * 0.04, 0.32), ease: [0.22, 0.61, 0.36, 1] }}
      className={className}
    >
      {children}
    </motion.div>
  )
}

/** Placeholder for a single exam list/queue card. */
export function ExamCardSkeleton() {
  return (
    <div className={`${EXAM.card} p-4 shadow-sm`}>
      <div className="flex items-center gap-3">
        <Skeleton className="w-10 h-10 rounded-lg shrink-0" />
        <div className="flex-1 min-w-0 space-y-2">
          <Skeleton className="h-3.5 w-2/5" />
          <Skeleton className="h-2.5 w-3/5" />
        </div>
        <Skeleton className="h-8 w-16 rounded-lg shrink-0" />
      </div>
    </div>
  )
}

/** A vertical stack of card skeletons for list-style loading states. */
export function ExamListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }).map((_, i) => (
        <ExamCardSkeleton key={i} />
      ))}
    </div>
  )
}

/** Placeholder grid for the summary/stat cards that overlap the banner. */
export function ExamStatsSkeleton({ count = 2 }: { count?: number }) {
  return (
    <div className={`grid gap-2.5 sm:gap-3 ${count <= 2 ? 'grid-cols-2' : 'grid-cols-2 lg:grid-cols-4'}`}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className={`${EXAM.card} p-3.5 sm:p-4 shadow-sm`}>
          <Skeleton className="h-2.5 w-12 mb-3" />
          <Skeleton className="h-5 w-16 mb-1.5" />
          <Skeleton className="h-2 w-14" />
        </div>
      ))}
    </div>
  )
}

export type ExamStatTone = 'dark' | 'light' | 'muted'

export interface ExamStatCard {
  label: string
  value: string
  sub: string
  icon: React.ReactNode
  tone: ExamStatTone
}

/** Summary stat cards mirroring the Fee Manager's collection cards. */
export function ExamStats({ cards }: { cards: ExamStatCard[] }) {
  return (
    <div className={`grid gap-2.5 sm:gap-3 ${cards.length <= 2 ? 'grid-cols-2' : 'grid-cols-2 lg:grid-cols-4'}`}>
      {cards.map((c, i) => {
        const base =
          c.tone === 'dark'
            ? 'bg-[var(--page-primary)] border-[var(--page-primary)]'
            : c.tone === 'muted'
            ? 'bg-[var(--page-accent-light)] border-[#E7E2D8]'
            : 'bg-white border-[#E4E4E7]'
        const labelCls = c.tone === 'dark' ? 'text-white/55' : 'text-[#71717A]'
        const valueCls = c.tone === 'dark' ? 'text-white' : 'text-[#18181B]'
        const subCls = c.tone === 'dark' ? 'text-white/45' : 'text-[#A1A1AA]'
        return (
          <motion.div
            key={c.label}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.28, delay: Math.min(i * 0.05, 0.2), ease: [0.22, 0.61, 0.36, 1] }}
            className={`rounded-xl border p-3.5 sm:p-4 shadow-sm ${base}`}
          >
            <div className="flex items-center justify-between mb-1.5 sm:mb-2">
              <span className={`text-[10px] sm:text-xs font-bold uppercase tracking-widest ${labelCls}`}>{c.label}</span>
              {c.icon}
            </div>
            <p className={`text-lg sm:text-xl font-bold tabular-nums leading-tight ${valueCls}`}>{c.value}</p>
            <p className={`text-[10px] sm:text-[11px] mt-0.5 truncate ${subCls}`}>{c.sub}</p>
          </motion.div>
        )
      })}
    </div>
  )
}
