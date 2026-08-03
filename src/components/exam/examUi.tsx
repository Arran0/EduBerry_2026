'use client'

import React from 'react'
import { motion } from 'framer-motion'

/**
 * Shared aesthetic tokens for the whole exam app — a refined "black & gold"
 * examination-hall aesthetic. Ink (near-black) carries primary actions and
 * structure; gold is the single accent, used deliberately for emphasis,
 * hairline borders and highlights. Gold is set to an explicit, vivid value
 * (rather than a theme variable) so it always reads as gold and never washes
 * out against the cream/white surfaces.
 */
export const GOLD = '#B8983C'
export const GOLD_DARK = '#9C7F2C'
export const INK = '#1C1C1F'

export const EXAM = {
  // Surfaces — soft, layered, with a hairline border and gentle elevation.
  card: 'bg-white border border-[#EAE7DF] rounded-2xl',
  cardHover:
    'bg-white border border-[#EAE7DF] rounded-2xl shadow-[0_1px_2px_rgba(28,28,31,0.04)] hover:shadow-[0_8px_24px_-12px_rgba(28,28,31,0.18)] hover:border-[#D8D2C4] transition-all duration-200',
  // A premium icon tile — ink fill with a hairline gold ring + faint glow.
  iconTile:
    'rounded-xl bg-gradient-to-br from-[#27272A] to-[#18181B] ring-1 ring-inset ring-[#B8983C]/70 shadow-[0_4px_14px_-6px_rgba(0,0,0,0.5)] flex items-center justify-center shrink-0',
  // Form controls — focus ring tinted gold for a cohesive accent.
  input:
    'w-full bg-white border border-[#E4E1D8] rounded-xl px-3.5 py-2.5 text-sm text-[#27272A] placeholder:text-[#A8A29A] focus:outline-none focus:border-[#B8983C] focus:ring-2 focus:ring-[#B8983C]/15 transition-all',
  field:
    'w-full bg-white border border-[#E4E1D8] rounded-xl px-3.5 py-2.5 text-sm text-[#27272A] placeholder:text-[#A8A29A] focus:outline-none focus:border-[#B8983C] focus:ring-2 focus:ring-[#B8983C]/15 transition-all',
  label: 'text-[10px] font-bold uppercase tracking-[0.14em] text-[#8A8578]',
  fieldLabel: 'block text-[11px] font-semibold uppercase tracking-wider text-[#8A8578] mb-1.5',
  // Buttons — ink primary, gold accent (the headline CTA), and quiet ghost.
  darkBtn:
    'inline-flex items-center justify-center gap-1.5 bg-[#1C1C1F] hover:bg-black text-white text-xs font-semibold px-3.5 py-2 rounded-xl shadow-[0_2px_8px_-3px_rgba(0,0,0,0.4)] transition-colors disabled:opacity-50',
  goldBtn:
    'inline-flex items-center justify-center gap-1.5 bg-[#B8983C] hover:bg-[#9C7F2C] text-white text-sm font-semibold px-4 py-2.5 rounded-xl shadow-[0_4px_14px_-4px_rgba(184,152,60,0.55)] transition-colors disabled:opacity-50 disabled:shadow-none',
  ghostBtn:
    'inline-flex items-center justify-center gap-1.5 bg-white border border-[#E4E1D8] text-[#71717A] hover:text-[#27272A] hover:border-[#D8D2C4] text-xs font-semibold px-3.5 py-2 rounded-xl transition-colors disabled:opacity-50',
} as const

/**
 * A question's attached figure — always shown at full size (never a
 * collapsed thumbnail) so diagrams/graphs stay legible wherever a question
 * is rendered: the builder, taking an exam, review, grading and the answer key.
 */
export function QuestionImage({ src, alt, className = '' }: { src?: string | null; alt?: string; className?: string }) {
  if (!src) return null
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt ?? 'Question figure'}
      className={`w-full max-h-[28rem] object-contain rounded-xl border border-[#EAE7DF] bg-[#FAFAF9] ${className}`}
    />
  )
}

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
        <div key={i} className={`${EXAM.card} p-4 sm:p-5 shadow-sm`}>
          <div className="flex items-center justify-between mb-3">
            <Skeleton className="h-2.5 w-12" />
            <Skeleton className="h-7 w-7 rounded-lg" />
          </div>
          <Skeleton className="h-7 w-16 mb-2" />
          <Skeleton className="h-2.5 w-20" />
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

/** Summary stat cards — a refined black & gold "scoreboard" row. */
export function ExamStats({ cards }: { cards: ExamStatCard[] }) {
  return (
    <div className={`grid gap-3 ${cards.length <= 2 ? 'grid-cols-2' : 'grid-cols-2 lg:grid-cols-4'}`}>
      {cards.map((c, i) => {
        const dark = c.tone === 'dark'
        // The ink "number" card carries a vivid, full-strength gold hairline
        // border — the signature of the exam space.
        const base =
          dark
            ? 'bg-gradient-to-br from-[#27272A] to-[#161618] border-[#B8983C]'
            : c.tone === 'muted'
            ? 'bg-[#F4F2EC] border-[#E7E2D8]'
            : 'bg-white border-[#EAE7DF]'
        const labelCls = dark ? 'text-[#C9B681]' : 'text-[#8A8578]'
        const valueCls = dark ? 'text-white' : 'text-[#18181B]'
        const subCls = dark ? 'text-white/55' : 'text-[#A8A29A]'
        const iconWrap = dark
          ? 'bg-[#B8983C]/15 ring-1 ring-[#B8983C]/40'
          : 'bg-[#F4F2EC] ring-1 ring-[#E7E2D8]'
        return (
          <motion.div
            key={c.label}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: Math.min(i * 0.05, 0.2), ease: [0.22, 0.61, 0.36, 1] }}
            className={`relative overflow-hidden rounded-2xl border p-4 sm:p-5 shadow-[0_4px_18px_-10px_rgba(28,28,31,0.25)] ${base}`}
          >
            <div className="flex items-start justify-between gap-2 mb-3">
              <span className={`text-[10px] sm:text-[11px] font-bold uppercase tracking-[0.14em] ${labelCls}`}>{c.label}</span>
              <span className={`flex items-center justify-center w-7 h-7 rounded-lg ${iconWrap}`}>{c.icon}</span>
            </div>
            <p className={`text-2xl sm:text-3xl font-bold tabular-nums leading-none tracking-tight ${valueCls}`}>{c.value}</p>
            <p className={`text-[11px] mt-1.5 truncate ${subCls}`}>{c.sub}</p>
          </motion.div>
        )
      })}
    </div>
  )
}
