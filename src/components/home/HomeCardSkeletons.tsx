'use client'

import React from 'react'

/* ────────────────────────────────────────────────────────────────────────────
   Home-card loading placeholders.

   Every card on the home page is a fixed 260px box, so what loads inside one
   can never move the page. What it *shows* while it loads still decides whether
   the page reads as filling in or as broken: a 1300×260 box with a single 24px
   spinner in the middle of it is a hole, and six of them at once — which is
   what a teacher's dashboard opened with — is a page that looks like it failed.

   These draw the shape the card is about to have instead: rows where rows are
   coming, seven day columns where the week calendar is coming, three tiles
   where three tiles are coming. The eye reads the layout before the data
   arrives, so the swap to real content is a fill rather than a replacement.

   All of them use the `.skeleton` shimmer from globals.css (which already sits
   out under `prefers-reduced-motion`), and stagger their sweep with `--sk-delay`
   so a column of placeholders fills top-to-bottom rather than flashing as one
   block.
   ──────────────────────────────────────────────────────────────────────────── */

/** One shimmering block. `w`/`h` are any CSS length; `delay` is in seconds. */
export function SkeletonBar({
  w = '100%',
  h = 10,
  delay = 0,
  rounded = true,
  cool = false,
  className = '',
}: {
  w?: number | string
  h?: number | string
  delay?: number
  rounded?: boolean
  cool?: boolean
  className?: string
}) {
  return (
    <span
      aria-hidden="true"
      className={`block skeleton ${cool ? 'skeleton-cool' : ''} ${rounded ? 'rounded-full' : ''} ${className}`}
      style={{ width: w, height: h, ['--sk-delay' as string]: `${delay}s` }}
    />
  )
}

/**
 * A list card's rows: a leading dot and two text lines each, ragged so it reads
 * as sentences rather than a bar chart. Matches the row rhythm shared by the
 * notifications box, the assessments and report-card lists, the timetable and
 * the exams card.
 */
export function SkeletonRows({
  rows = 4,
  cool = false,
  lead = 'dot',
}: {
  rows?: number
  /** Cool grey base — for rows on a white `pro-card` rather than glass. */
  cool?: boolean
  /** What the row leads with, matching the card it stands in for: a status dot
   *  (notifications, assessments), a fixed-width time column (the timetable),
   *  or nothing at all. */
  lead?: 'dot' | 'time' | 'none'
}) {
  return (
    <div className={`flex-1 divide-y ${cool ? 'divide-slate-200' : 'divide-white/25'}`}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="home-card-row flex items-start gap-2.5 px-5 py-3">
          {lead === 'dot' && (
            <SkeletonBar w={15} h={15} delay={i * 0.09} cool={cool} className="mt-0.5 flex-shrink-0" />
          )}
          {lead === 'time' && (
            <SkeletonBar w={38} h={9} delay={i * 0.09} cool={cool} className="mt-1 flex-shrink-0" />
          )}
          <div className="flex-1 min-w-0 space-y-1.5 py-0.5">
            <SkeletonBar w={`${85 - i * 8}%`} h={10} delay={i * 0.09} cool={cool} />
            <SkeletonBar w={`${55 - i * 5}%`} h={10} delay={i * 0.09 + 0.05} cool={cool} />
          </div>
        </div>
      ))}
    </div>
  )
}

/**
 * The attendance cards' block of three tiles under a scope caption — drawn at
 * the tiles' real size and in their real tints, so the numbers land in boxes
 * that are already where they will be.
 */
export function SkeletonTileRow({ delay = 0 }: { delay?: number }) {
  return (
    <div className="px-4 pt-3 pb-2">
      <div className="flex items-center justify-between mb-2.5 gap-2">
        <SkeletonBar w={110} h={9} delay={delay} cool />
        <SkeletonBar w={62} h={9} delay={delay + 0.05} cool />
      </div>
      <div className="grid grid-cols-3 gap-2">
        {['bg-emerald-50/70 border-emerald-200/50', 'bg-red-50/70 border-red-200/50', 'bg-amber-50/70 border-amber-200/50'].map((tint, i) => (
          /* The real tile stacks icon, figure and caption. The placeholder
             leaves the icon out: three centred blocks in that order read as a
             little head-and-shoulders silhouette, which is a picture of
             something, and a placeholder should be a picture of nothing. The
             tile's own size and tint already carry the shape. */
          <div key={i} className={`flex flex-col items-center justify-center py-2.5 border ${tint}`}>
            <SkeletonBar w={32} h={14} delay={delay + i * 0.07} cool />
            <SkeletonBar w={46} h={7} delay={delay + i * 0.07 + 0.06} cool className="mt-2.5" />
          </div>
        ))}
      </div>
    </div>
  )
}

/** Two tile rows — the shape both attendance cards settle into. */
export function SkeletonTiles({ rows = 2 }: { rows?: number }) {
  return (
    <div className="flex-1 divide-y divide-slate-200">
      {Array.from({ length: rows }).map((_, i) => (
        <SkeletonTileRow key={i} delay={i * 0.12} />
      ))}
    </div>
  )
}

/**
 * A donut-and-rows infographic block, at the size the real chart occupies, for
 * the desktop statistics panels. Those panels take `null` data and render a
 * confident `0` / `0%` while their fetch is in flight — a reading nobody took,
 * which is worse than an obvious placeholder.
 */
export function SkeletonDonutBlock({ size = 118 }: { size?: number }) {
  return (
    <div className="flex-1 w-full min-w-0 flex items-center gap-4 xl:gap-5">
      <div
        aria-hidden="true"
        className="skeleton skeleton-cool rounded-full flex-shrink-0"
        style={{
          width: size,
          height: size,
          // Ring, not disc — the real chart is a donut with its rate in the hole.
          WebkitMask: `radial-gradient(farthest-side, transparent calc(100% - 13px), #000 calc(100% - 13px))`,
          mask: `radial-gradient(farthest-side, transparent calc(100% - 13px), #000 calc(100% - 13px))`,
        }}
      />
      <div className="flex-1 min-w-0 space-y-2.5">
        {[0, 1, 2].map(i => (
          <div key={i} className="space-y-1">
            <div className="flex items-center justify-between gap-2">
              <SkeletonBar w={56} h={9} delay={i * 0.09} cool />
              <SkeletonBar w={24} h={9} delay={i * 0.09 + 0.04} cool />
            </div>
            <SkeletonBar w={`${78 - i * 20}%`} h={6} delay={i * 0.09 + 0.07} cool />
          </div>
        ))}
      </div>
    </div>
  )
}
