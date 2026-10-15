'use client'

import React, { useId, useMemo, useState } from 'react'
import Link from 'next/link'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import {
  BarChart3,
  Briefcase,
  ArrowUpRight,
  CalendarCheck,
  ChevronRight,
  CreditCard,
  Users,
} from 'lucide-react'
import AnimatedNumber from '@/components/charts/AnimatedNumber'
import { fmtINR, fmtINRExact } from '@/lib/formatMoney'
import { AttendanceTally, HomeAttendanceCounts } from './AttendanceInfographicPanel'
import { SkeletonBar } from '../HomeCardSkeletons'
import { HomeFeesSummary } from './FeesInfographicPanel'

/* ──────────────────────────────────────────────────────────────────────────
   Data
   ────────────────────────────────────────────────────────────────────────── */

/** One fee head's slice of the year's ledger. Bus fee is one of these. */
export interface FeeHeadStat {
  id: string
  name: string
  color: string
  collected: number
  outstanding: number
  todayCollection: number
  studentsWithDues: number
  /** Where "today's collection" and "students with dues" lead for this head. */
  todayHref: string
  duesHref: string
}

/** The fee ledger as one figure, broken down by head. */
export interface HomeFeeBreakdown {
  total: HomeFeesSummary
  heads: FeeHeadStat[]
}

const PRESENT = '#10b981'
const ABSENT = '#ef4444'
const IRREGULAR = '#f59e0b'
const EASE = [0.16, 1, 0.3, 1] as const

const countFmt = (n: number) => Math.round(n).toLocaleString('en-IN')
const pctFmt = (n: number) => `${Math.round(n)}%`

/* ──────────────────────────────────────────────────────────────────────────
   Attendance — a dial per population
   ────────────────────────────────────────────────────────────────────────── */

const TICKS = 60

/**
 * One population's day as a dial.
 *
 * The ring is the present / absent / irregular split: gradient arcs with
 * rounded ends and a gap between them, winding on one after another from 12
 * o'clock while the whole ring turns into place. Around it a ring of ticks
 * lights up to the attendance rate, tick by tick, in step with the figure
 * counting up on the glass disc in the middle. Hovering a row lifts its arc,
 * dims the others and puts that row's count on the disc.
 */
function AttendanceDial({
  title, icon: Icon, tally, reportHref, hrefs, loading, delay,
}: {
  title: string
  icon: React.ElementType
  tally: AttendanceTally | null
  reportHref: string
  hrefs: { present: string; absent: string; exception: string }
  loading: boolean
  delay: number
}) {
  const reduceMotion = useReducedMotion()
  const gid = useId().replace(/:/g, '')
  const [hover, setHover] = useState<number | null>(null)
  const present = tally?.present ?? 0
  const absent = tally?.absent ?? 0
  const exception = tally?.exception ?? 0
  const total = present + absent + exception
  const rate = total > 0 ? (present / total) * 100 : 0

  const size = 148
  const c = size / 2
  const stroke = 13
  const r = c - 16 - stroke / 2
  const C = 2 * Math.PI * r
  const rows = [
    { label: 'Present', value: present, color: PRESENT, light: '#6ee7b7', href: hrefs.present },
    { label: 'Absent', value: absent, color: ABSENT, light: '#fca5a5', href: hrefs.absent },
    { label: 'Irregular', value: exception, color: IRREGULAR, light: '#fcd34d', href: hrefs.exception },
  ]
  const nonZero = rows.filter(row => row.value > 0).length
  // Round caps reach stroke/2 past each end, so the drawn dash is shortened
  // by a stroke plus the visible gap; a lone segment is a closed ring.
  const trim = nonZero > 1 ? stroke + 5 : 0
  let acc = 0
  const arcs = rows.map(row => {
    const f = total > 0 ? row.value / total : 0
    const len = nonZero > 1 ? Math.max(f * C - trim, 0.01) : f * C
    const arc = { ...row, f, len, start: acc * C + trim / 2 }
    acc += f
    return arc
  })
  const litTicks = Math.round((rate / 100) * TICKS)

  return (
    <div className="lg-content flex-1 min-w-0 p-4 xl:p-5 flex flex-col">
      <div className="flex items-center justify-between mb-2">
        <span className="flex items-center gap-1.5">
          <Icon size={13} className="text-slate-500" />
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{title}</span>
        </span>
        <Link
          href={reportHref}
          className="group/rl flex items-center gap-0.5 text-[11px] font-semibold text-sky-700 hover:text-sky-800 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/60 rounded"
        >
          View report <ChevronRight size={12} className="transition-transform group-hover/rl:translate-x-0.5" />
        </Link>
      </div>

      <div className="flex-1 flex items-center gap-4">
        <div className="relative flex-shrink-0" style={{ width: size, height: size }}>
          <motion.svg
            width={size}
            height={size}
            viewBox={`0 0 ${size} ${size}`}
            role="img"
            aria-label={`${title} attendance today: ${present} present, ${absent} absent, ${exception} irregular out of ${total}.`}
            initial={reduceMotion ? false : { rotate: -150, opacity: 0, scale: 0.85 }}
            animate={{ rotate: -90, opacity: 1, scale: 1 }}
            transition={reduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 70, damping: 15, delay }}
          >
            <defs>
              {rows.map((row, i) => (
                <linearGradient key={row.label} id={`${gid}-g${i}`} x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stopColor={row.light} />
                  <stop offset="100%" stopColor={row.color} />
                </linearGradient>
              ))}
            </defs>

            {/* Tick ring — lights up to the rate. */}
            {Array.from({ length: TICKS }).map((_, i) => {
              const a = (i / TICKS) * Math.PI * 2
              const lit = !loading && i < litTicks
              const r1 = c - 4
              const r2 = c - (i % 5 === 0 ? 10 : 8)
              return (
                <motion.line
                  key={i}
                  x1={c + r1 * Math.cos(a)} y1={c + r1 * Math.sin(a)}
                  x2={c + r2 * Math.cos(a)} y2={c + r2 * Math.sin(a)}
                  strokeWidth={i % 5 === 0 ? 2 : 1.4}
                  strokeLinecap="round"
                  initial={{ stroke: '#e2e8f0' }}
                  animate={{ stroke: lit ? PRESENT : '#e2e8f0' }}
                  transition={{ duration: 0.25, delay: reduceMotion ? 0 : delay + 0.45 + i * (1.3 / TICKS) }}
                />
              )
            })}

            {/* Track. */}
            <circle cx={c} cy={c} r={r} fill="none" stroke="#eef2f7" strokeWidth={stroke} />

            {!loading && arcs.map((arc, i) => arc.f > 0 && (
              <motion.circle
                key={arc.label}
                cx={c}
                cy={c}
                r={r}
                fill="none"
                stroke={`url(#${gid}-g${i})`}
                strokeLinecap={nonZero > 1 ? 'round' : 'butt'}
                strokeDashoffset={-arc.start}
                initial={{
                  strokeDasharray: reduceMotion ? `${arc.len} ${C}` : `0 ${C}`,
                  strokeWidth: stroke,
                  opacity: 1,
                }}
                animate={{
                  strokeDasharray: `${arc.len} ${C}`,
                  strokeWidth: hover === i ? stroke + 5 : stroke,
                  opacity: hover !== null && hover !== i ? 0.25 : 1,
                }}
                transition={{
                  strokeDasharray: reduceMotion
                    ? { duration: 0 }
                    : { duration: 0.55 + arc.f * 0.9, delay: delay + 0.35 + (arc.start / C) * 1.1, ease: EASE },
                  strokeWidth: { type: 'spring', stiffness: 500, damping: 26 },
                  opacity: { duration: 0.18 },
                }}
                style={{ filter: hover === i ? `drop-shadow(0 0 6px ${arc.color}88)` : undefined }}
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(h => (h === i ? null : h))}
              />
            ))}
          </motion.svg>

          {/* The glass disc in the middle. */}
          <motion.div
            className="lg-disc absolute flex flex-col items-center justify-center text-center pointer-events-none"
            style={{ inset: 16 + stroke + 5 }}
            initial={reduceMotion ? false : { scale: 0.4, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={reduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 260, damping: 14, delay: delay + 0.25 }}
          >
            {loading ? (
              <SkeletonBar w={40} h={16} cool />
            ) : total > 0 ? (
              <>
                <span className="font-display text-[1.45rem] font-black leading-none tabular-nums" style={{ color: hover !== null ? rows[hover].color : '#0f172a' }}>
                  {hover !== null
                    ? countFmt(rows[hover].value)
                    : <AnimatedNumber value={rate} format={pctFmt} delay={delay + 0.45} duration={1.4} />}
                </span>
                <span className="mt-0.5 text-[9px] font-bold uppercase tracking-wider text-slate-500">
                  {hover !== null ? rows[hover].label : 'present'}
                </span>
              </>
            ) : (
              <>
                <span className="font-display text-[1.3rem] font-black leading-none text-slate-400">—</span>
                <span className="mt-0.5 text-[9px] font-bold uppercase tracking-wider text-slate-500 leading-tight">not marked</span>
              </>
            )}
          </motion.div>
        </div>

        <div className="flex-1 min-w-0 space-y-1">
          {arcs.map((arc, i) => (
            <Link
              key={arc.label}
              href={arc.href}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(h => (h === i ? null : h))}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(h => (h === i ? null : h))}
              className={`block rounded-xl px-2.5 py-1.5 transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/60 ${hover === i ? 'bg-white shadow-sm -translate-y-px' : 'hover:bg-white/80'}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-[12px] font-semibold text-slate-700">
                  <span className="w-2 h-2 rounded-full" style={{ background: `linear-gradient(135deg, ${arc.light}, ${arc.color})` }} />
                  {arc.label}
                </span>
                <span className="text-sm font-black text-slate-900 tabular-nums">
                  {loading ? <SkeletonBar w={22} h={12} cool /> : <AnimatedNumber value={arc.value} format={countFmt} delay={delay + 0.35 + i * 0.12} />}
                </span>
              </div>
              <div className="mt-1 h-1 rounded-full bg-slate-200/70 overflow-hidden">
                {!loading && (
                  <motion.div
                    className="h-full rounded-full"
                    style={{ background: `linear-gradient(90deg, ${arc.light}, ${arc.color})`, transformOrigin: 'left' }}
                    initial={reduceMotion ? false : { scaleX: 0 }}
                    animate={{ scaleX: arc.f }}
                    transition={reduceMotion ? { duration: 0 } : { duration: 0.9, delay: delay + 0.5 + i * 0.12, ease: EASE }}
                  />
                )}
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}

/* ──────────────────────────────────────────────────────────────────────────
   Fees — one ledger, broken down by head
   ────────────────────────────────────────────────────────────────────────── */

/**
 * A follow-up from the fee bar as a deep-tinted tile: the figure large on a
 * gradient, a glass bubble for the icon, a watermark of the same icon, and a
 * light that sweeps across on hover. White on the 700-level gradient ends
 * holds 5:1 or better.
 */
function FeeActionTile({
  href, icon: Icon, from, to, eyebrow, value, format, loading, delay, detail, detailDot, title,
}: {
  href: string
  icon: React.ElementType
  from: string
  to: string
  eyebrow: string
  value: number
  format: (n: number) => string
  loading: boolean
  delay: number
  detail: string
  detailDot?: string
  title?: string
}) {
  const reduceMotion = useReducedMotion()
  return (
    <motion.div
      initial={reduceMotion ? false : { opacity: 0, y: 14, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={reduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 220, damping: 20, delay }}
      whileHover={reduceMotion ? undefined : { y: -3 }}
      whileTap={reduceMotion ? undefined : { scale: 0.98 }}
    >
      <Link
        href={href}
        title={title}
        className="fee-tile group/ft"
        style={{ ['--ft-from' as string]: from, ['--ft-to' as string]: to }}
      >
        <Icon aria-hidden className="fee-tile-mark" size={96} strokeWidth={1.4} />
        <span className="relative flex items-start justify-between gap-2">
          <span className="fee-tile-bubble">
            <Icon size={17} />
          </span>
          <ArrowUpRight size={18} className="text-white/70 transition-transform duration-300 group-hover/ft:translate-x-0.5 group-hover/ft:-translate-y-0.5 group-hover/ft:text-white" />
        </span>
        <span className="relative mt-3 block text-[10.5px] font-bold uppercase tracking-[0.12em] text-white/85">{eyebrow}</span>
        <span className="relative mt-1 block font-display text-[1.75rem] xl:text-[2rem] font-black leading-none text-white tabular-nums">
          {loading ? <SkeletonBar w={70} h={24} className="opacity-40" /> : <AnimatedNumber value={value} format={format} delay={delay} />}
        </span>
        <span className="relative mt-2 flex items-center gap-1.5 text-[11px] font-semibold text-white/85 truncate">
          {detailDot && <span className="w-2 h-2 rounded-full ring-2 ring-white/60 flex-shrink-0" style={{ background: detailDot }} />}
          <span className="truncate">{loading ? '' : detail}</span>
        </span>
      </Link>
    </motion.div>
  )
}

interface BarPiece {
  head: FeeHeadStat
  kind: 'collected' | 'outstanding'
  value: number
  /** Share of the year's billing, 0–1. */
  share: number
}

/**
 * The year's fees as one bar: everything collected on the left, everything
 * still owed on the right, and inside each half a band per fee head in that
 * head's colour (solid where it has been paid, striped and drifting where it
 * is still owed). The seam between the halves is the collection rate.
 *
 * Pointing at any band — or at a head in the legend — selects that head: the
 * other bands step back, a tooltip reads off its collected and outstanding
 * figures, and the headline, Today's Collection and Students with Dues all
 * glide to that head's numbers. Leaving returns them to the whole school.
 * A click on a legend chip pins the selection, which is how a touch screen
 * (no hover) gets the same read-out.
 */
function FeeLedger({ fees, loading }: {
  fees: HomeFeeBreakdown | null
  loading: boolean
}) {
  const reduceMotion = useReducedMotion()
  const [hoverId, setHoverId] = useState<string | null>(null)
  const [pinnedId, setPinnedId] = useState<string | null>(null)
  const activeId = hoverId ?? pinnedId
  const heads = useMemo(() => fees?.heads ?? [], [fees])
  const active = heads.find(h => h.id === activeId) ?? null

  const total = fees?.total
  const billed = (total?.collected ?? 0) + (total?.outstanding ?? 0)
  const rate = billed > 0 ? ((total?.collected ?? 0) / billed) * 100 : 0

  const pieces: BarPiece[] = useMemo(() => {
    if (billed <= 0) return []
    const collected = heads
      .filter(h => h.collected > 0)
      .map(h => ({ head: h, kind: 'collected' as const, value: h.collected, share: h.collected / billed }))
    const outstanding = heads
      .filter(h => h.outstanding > 0)
      .map(h => ({ head: h, kind: 'outstanding' as const, value: h.outstanding, share: h.outstanding / billed }))
    return [...collected, ...outstanding]
  }, [heads, billed])

  // Where the hovered head's bands sit, for the tooltip's anchor: the middle
  // of its widest band.
  const tooltipAt = useMemo(() => {
    if (!active) return null
    let acc = 0
    let best: { mid: number; share: number } | null = null
    for (const p of pieces) {
      if (p.head.id === active.id && (!best || p.share > best.share)) best = { mid: acc + p.share / 2, share: p.share }
      acc += p.share
    }
    // Kept off the ends so the one-line read-out never runs past the card.
    return best ? Math.min(Math.max(best.mid, 0.3), 0.7) : null
  }, [active, pieces])

  const shown = active ?? null
  const shownCollected = shown ? shown.collected : (total?.collected ?? 0)
  const shownOutstanding = shown ? shown.outstanding : (total?.outstanding ?? 0)
  const shownBilled = shownCollected + shownOutstanding
  const shownRate = shownBilled > 0 ? (shownCollected / shownBilled) * 100 : 0
  const shownToday = shown ? shown.todayCollection : (total?.todayCollection ?? 0)
  const shownDues = shown ? shown.studentsWithDues : (total?.studentsWithDues ?? 0)
  const todayHref = shown?.todayHref ?? '/more/fees?section=collection'
  const duesHref = shown?.duesHref ?? '/more/fees?section=issued&filter=outstanding'

  let offset = 0

  return (
    <div className="lg-content p-4 xl:p-5 min-w-0 flex flex-col h-full">
      <div className="flex items-center justify-between mb-3">
        <span className="flex items-center gap-1.5">
          <CreditCard size={13} className="text-slate-500" />
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Fees · this year</span>
        </span>
        <Link
          href="/more/fees"
          className="group/rl flex items-center gap-0.5 text-[11px] font-semibold text-sky-700 hover:text-sky-800 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/60 rounded"
        >
          Fee Manager <ChevronRight size={12} className="transition-transform group-hover/rl:translate-x-0.5" />
        </Link>
      </div>

      {/* Headline — whole school, or the selected head. */}
      <div className="flex items-end justify-between gap-4">
        <div className="min-w-0">
          <div className="h-4 mb-1 relative overflow-hidden">
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.p
                key={shown?.id ?? 'all'}
                initial={{ y: 12, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: -12, opacity: 0 }}
                transition={{ duration: 0.22, ease: EASE }}
                className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-500 truncate"
              >
                {shown && <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: shown.color }} />}
                {shown ? `${shown.name} · collected` : 'Collected · all fee heads'}
              </motion.p>
            </AnimatePresence>
          </div>
          <p className="font-display text-[2rem] xl:text-[2.3rem] font-black leading-none text-slate-900 tabular-nums" title={fmtINRExact(shownCollected)}>
            {loading ? <SkeletonBar w={140} h={30} cool /> : <AnimatedNumber value={shownCollected} format={fmtINR} delay={0.25} />}
          </p>
          <p className="mt-1.5 text-xs text-slate-500 tabular-nums">
            {loading ? <SkeletonBar w={160} h={10} cool /> : (
              <>
                of <AnimatedNumber value={shownBilled} format={fmtINR} delay={0.3} className="font-semibold text-slate-700" /> billed ·{' '}
                <AnimatedNumber value={shownOutstanding} format={fmtINR} delay={0.35} className="font-semibold text-amber-700" /> outstanding
              </>
            )}
          </p>
        </div>
        <div className="text-right flex-shrink-0">
          <p className="font-display text-[1.6rem] font-black leading-none tabular-nums" style={{ color: shown?.color ?? '#0f766e' }}>
            {loading ? <SkeletonBar w={52} h={22} cool /> : <AnimatedNumber value={shownRate} format={pctFmt} delay={0.4} />}
          </p>
          <p className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">collected</p>
        </div>
      </div>

      {/* The bar. Room above it for the selected head's read-out. */}
      <div className="relative mt-11" onMouseLeave={() => setHoverId(null)}>
        <AnimatePresence>
          {active && tooltipAt !== null && (
            <motion.div
              key="tip"
              role="status"
              className="lg-tooltip absolute bottom-full mb-2.5 z-20 whitespace-nowrap pointer-events-none flex items-center gap-2 text-[11px] tabular-nums"
              initial={{ opacity: 0, x: '-50%', y: 6, scale: 0.96, left: `${tooltipAt * 100}%` }}
              animate={{ opacity: 1, x: '-50%', y: 0, scale: 1, left: `${tooltipAt * 100}%` }}
              exit={{ opacity: 0, x: '-50%', y: 6, scale: 0.96 }}
              transition={{ type: 'spring', stiffness: 420, damping: 32 }}
            >
              <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: active.color }} />
              <span className="font-bold text-slate-900">{active.name}</span>
              <span className="text-slate-300">|</span>
              <span className="font-bold text-emerald-700">{fmtINRExact(active.collected)}</span>
              <span className="text-slate-500">collected</span>
              <span className="text-slate-300">·</span>
              <span className="font-bold text-amber-700">{fmtINRExact(active.outstanding)}</span>
              <span className="text-slate-500">outstanding</span>
            </motion.div>
          )}
        </AnimatePresence>
        <div className="relative h-5 rounded-full bg-slate-200/70 shadow-[inset_0_1px_2px_rgba(15,23,42,0.12)]">
          {loading ? (
            <div className="absolute inset-0 rounded-full overflow-hidden"><SkeletonBar w="100%" h="100%" cool /></div>
          ) : billed <= 0 ? (
            <p className="absolute inset-0 flex items-center justify-center text-[10px] font-semibold text-slate-500">Nothing billed yet this year</p>
          ) : (
            <motion.div
              className="absolute inset-0 flex rounded-full overflow-hidden"
              initial={reduceMotion ? false : { clipPath: 'inset(0 100% 0 0 round 9999px)' }}
              animate={{ clipPath: 'inset(0 0% 0 0 round 9999px)' }}
              transition={reduceMotion ? { duration: 0 } : { duration: 1.4, delay: 0.2, ease: [0.65, 0, 0.35, 1] }}
            >
              {pieces.map((p, i) => {
                const left = offset
                offset += p.share
                const dim = activeId !== null && p.head.id !== activeId
                const lift = activeId !== null && p.head.id === activeId
                return (
                  <motion.button
                    key={`${p.kind}-${p.head.id}`}
                    type="button"
                    tabIndex={-1}
                    aria-hidden
                    onMouseEnter={() => setHoverId(p.head.id)}
                    onClick={() => setPinnedId(id => (id === p.head.id ? null : p.head.id))}
                    className={`relative h-full flex-shrink-0 ${p.kind === 'outstanding' ? 'fee-stripes' : 'fee-solid'} ${i > 0 ? 'border-l border-white/70' : ''}`}
                    style={{
                      width: `${p.share * 100}%`,
                      // Solid where paid; striped where still owed.
                      ['--fee-c' as string]: p.head.color,
                    }}
                    initial={reduceMotion ? false : { opacity: 0, scaleY: 0.4 }}
                    animate={{ opacity: dim ? 0.28 : 1, scaleY: lift ? 1.3 : 1 }}
                    transition={{
                      opacity: { duration: 0.2 },
                      scaleY: reduceMotion
                        ? { duration: 0 }
                        : { type: 'spring', stiffness: 380, damping: 22, delay: lift || dim ? 0 : 0.25 + left * 1.3 },
                    }}
                    title={`${p.head.name} · ${p.kind}: ${fmtINRExact(p.value)}`}
                  />
                )
              })}
              {/* A glint that sweeps the paid half now and then. */}
              {!reduceMotion && (
                <span
                  aria-hidden
                  className="fee-glint absolute inset-y-0 left-0 pointer-events-none"
                  style={{ width: `${(billed > 0 ? (total!.collected / billed) : 0) * 100}%` }}
                />
              )}
            </motion.div>
          )}

          {/* The seam between paid and owed — the collection rate. */}
          {!loading && billed > 0 && (
            <motion.div
              aria-hidden
              className="absolute -top-1.5 -bottom-1.5 w-[3px] -ml-[1.5px] rounded-full bg-slate-900 shadow-[0_0_0_2px_rgba(255,255,255,0.9)] z-10 pointer-events-none"
              initial={reduceMotion ? false : { left: '0%', opacity: 0 }}
              animate={{ left: `${rate}%`, opacity: 1 }}
              transition={reduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 60, damping: 16, delay: 0.5 }}
            />
          )}
        </div>
        <div className="mt-1.5 flex justify-between text-[10px] font-semibold uppercase tracking-wide text-slate-500">
          <span>Collected</span>
          <span>Outstanding</span>
        </div>
      </div>

      {/* The two follow-ups, right under the bar and keyed to the selection:
          deep-tinted tiles with a glass bubble, the figure large, and the
          context it needs (whose figure it is; what is still owed). */}
      <div className="mt-4 grid grid-cols-2 gap-3">
        <FeeActionTile
          href={todayHref}
          icon={CalendarCheck}
          from="#047857"
          to="#0e7490"
          eyebrow="Today's collection"
          value={shownToday}
          format={fmtINR}
          loading={loading}
          delay={0.55}
          detail={shown ? shown.name : 'All fee heads'}
          detailDot={shown?.color}
          title={`Today's collection: ${fmtINRExact(shownToday)}`}
        />
        <FeeActionTile
          href={duesHref}
          icon={Users}
          from="#c2410c"
          to="#be123c"
          eyebrow="Students with dues"
          value={shownDues}
          format={countFmt}
          loading={loading}
          delay={0.65}
          detail={`${fmtINR(shownOutstanding)} outstanding${shown ? ` · ${shown.name}` : ''}`}
          detailDot={shown?.color}
        />
      </div>

      {/* Per head — names the bar's colours, gives each head its own
          paid-vs-owed line, and is the keyboard and touch way to select one
          (a click pins it). */}
      {!loading && heads.length > 0 && (
        <div
          className="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-x-4 gap-y-1 min-h-0 -mx-1.5 px-1.5"
          role="group"
          aria-label="Fee heads"
        >
          {heads.map((h, i) => {
            const billedH = h.collected + h.outstanding
            const rateH = billedH > 0 ? (h.collected / billedH) * 100 : 0
            const isActive = activeId === h.id
            return (
              <motion.button
                key={h.id}
                type="button"
                aria-pressed={pinnedId === h.id}
                onMouseEnter={() => setHoverId(h.id)}
                onMouseLeave={() => setHoverId(null)}
                onFocus={() => setHoverId(h.id)}
                onBlur={() => setHoverId(null)}
                onClick={() => setPinnedId(id => (id === h.id ? null : h.id))}
                initial={reduceMotion ? false : { opacity: 0, x: -8 }}
                animate={{ opacity: activeId !== null && !isActive ? 0.5 : 1, x: 0 }}
                transition={{ duration: 0.35, delay: reduceMotion || activeId !== null ? 0 : 0.8 + i * 0.07 }}
                className={`w-full text-left px-2.5 py-2 rounded-xl transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/60 ${isActive ? 'bg-white shadow-sm' : 'hover:bg-white/70'} ${pinnedId === h.id ? 'ring-1 ring-slate-300' : ''}`}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 min-w-0 text-[12px] font-semibold text-slate-700">
                    <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: h.color }} />
                    <span className="truncate">{h.name}</span>
                  </span>
                  <span className="flex-shrink-0 text-[11px] tabular-nums text-slate-500">
                    <span className="font-bold text-slate-800">{fmtINR(h.collected)}</span> of {fmtINR(billedH)}
                    <span className="ml-1.5 font-bold" style={{ color: h.color }}>{Math.round(rateH)}%</span>
                  </span>
                </span>
                <span className="mt-1.5 flex h-1.5 rounded-full overflow-hidden bg-slate-200/80">
                  <motion.span
                    className="fee-solid h-full block"
                    style={{ ['--fee-c' as string]: h.color, width: `${rateH}%`, transformOrigin: 'left' }}
                    initial={reduceMotion ? false : { scaleX: 0 }}
                    animate={{ scaleX: 1 }}
                    transition={{ duration: reduceMotion ? 0 : 0.9, ease: EASE, delay: reduceMotion ? 0 : 0.9 + i * 0.07 }}
                  />
                  <span className="fee-stripes h-full block flex-1" style={{ ['--fee-c' as string]: h.color }} />
                </span>
              </motion.button>
            )
          })}
        </div>
      )}
    </div>
  )
}

/* ──────────────────────────────────────────────────────────────────────────
   The panel
   ────────────────────────────────────────────────────────────────────────── */

export interface SchoolOverviewPanelProps {
  attendance: { counts: HomeAttendanceCounts | null; subtitle?: string } | null
  /** The whole fee ledger, bus fee included as one of its heads. Null while
   *  it loads. */
  fees: HomeFeeBreakdown | null
  /** Which halves this account is entitled to. */
  showAttendance: boolean
  showFees: boolean
  /** Today, pre-formatted by the page so the whole page agrees on the date. */
  today: string
}

/**
 * The admin's standing statistics as one Liquid Glass panel: today's
 * attendance as two dials in the narrow column, the year's fees in the wide
 * one.
 *
 * The sheet is glass — a lensing surface with a specular rim and a highlight
 * that follows the pointer, over ambient colour — and the dials and the
 * ledger sit on it as solid content cards, so nothing is read off the glass.
 * Fees are one ledger, bus fee simply one of its heads, and get the larger
 * share of the width: the ledger is the half with the most to say.
 */
export default function SchoolOverviewPanel({
  attendance, fees, showAttendance, showFees, today,
}: SchoolOverviewPanelProps) {
  const reduceMotion = useReducedMotion()
  const attendanceLoading = attendance !== null && attendance.counts === null
  const both = showAttendance && showFees

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== 'mouse') return
    const el = e.currentTarget
    const r = el.getBoundingClientRect()
    el.style.setProperty('--lg-x', `${e.clientX - r.left}px`)
    el.style.setProperty('--lg-y', `${e.clientY - r.top}px`)
  }

  return (
    <div className="relative">
      {/* Ambient light for the glass to bend. */}
      <div aria-hidden className="lg-ambient lg-ambient-overview">
        <span style={{ background: '#10b981' }} />
        <span style={{ background: '#0ea5e9' }} />
        <span style={{ background: '#f59e0b' }} />
      </div>

      <motion.div
        className="lg-deck lg-panel"
        onPointerMove={onPointerMove}
        initial={reduceMotion ? false : { opacity: 0, y: 16, scale: 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={reduceMotion ? { duration: 0 } : { duration: 0.7, ease: EASE }}
      >
        {/* Header — sits straight on the glass. */}
        <div className="relative z-[3] flex items-center justify-between gap-3 px-5 pt-4 pb-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="icon-chip w-9 h-9 flex-shrink-0 bg-gradient-to-br from-emerald-400 to-teal-500">
              <BarChart3 size={16} className="relative z-10 text-white drop-shadow-sm" />
            </div>
            <div className="min-w-0">
              <p className="eyebrow text-slate-500 mb-1">Today</p>
              <h2 className="font-display text-[1.3rem] font-bold leading-none headline text-slate-900 truncate">
                School Overview
              </h2>
            </div>
          </div>
          <div className="lg-pill flex items-center gap-2.5 h-8 px-3 flex-shrink-0">
            {attendance?.subtitle && (
              <span className="hidden xl:inline text-[11px] font-medium text-slate-600 truncate max-w-[16rem]">
                {attendance.subtitle}
              </span>
            )}
            <span className="flex items-center gap-1.5">
              <span className="relative flex w-1.5 h-1.5">
                <span className="absolute inset-0 rounded-full bg-emerald-500 animate-ping opacity-60" />
                <span className="relative w-1.5 h-1.5 rounded-full bg-emerald-500" />
              </span>
              <span className="text-[10.5px] font-bold text-emerald-700">Live</span>
            </span>
            <span className="w-px h-3.5 bg-slate-300" />
            <span className="text-xs font-semibold text-slate-600 tabular-nums">{today}</span>
          </div>
        </div>

        <div className={`relative z-[3] grid grid-cols-1 gap-3 px-3 pb-3 ${both ? 'xl:grid-cols-12' : ''}`}>
          {showAttendance && (
            <section
              className={`min-w-0 flex flex-col lg:flex-row gap-3 ${both ? 'xl:col-span-4 xl:flex-col' : ''}`}
              aria-label="Attendance today"
            >
              <AttendanceDial
                loading={attendanceLoading}
                icon={Users}
                title="Students"
                tally={attendance?.counts?.students ?? null}
                reportHref="/more/attendance"
                hrefs={{
                  present: '/more/attendance#student-present',
                  absent: '/more/attendance#student-absent',
                  exception: '/more/attendance#student-irregular',
                }}
                delay={0.1}
              />
              <AttendanceDial
                loading={attendanceLoading}
                icon={Briefcase}
                title="Staff"
                tally={attendance?.counts?.staff ?? null}
                reportHref="/more/staff-attendance"
                hrefs={{
                  present: '/more/staff-attendance#staff-present',
                  absent: '/more/staff-attendance#staff-absent',
                  exception: '/more/staff-attendance#staff-exceptions',
                }}
                delay={0.3}
              />
            </section>
          )}

          {showFees && (
            <section aria-label="Fee collection" className={`min-w-0 ${both ? 'xl:col-span-8' : ''}`}>
              <FeeLedger fees={fees} loading={fees === null} />
            </section>
          )}
        </div>
      </motion.div>
    </div>
  )
}
