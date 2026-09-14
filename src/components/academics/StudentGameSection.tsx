'use client'

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { motion, useMotionValue, useTransform, animate, MotionValue } from 'framer-motion'
import { ArrowUp, ChevronLeft, ChevronRight, Crown, Medal, Sparkles, Star, Trophy } from 'lucide-react'
import {
  fetchStudentEduDashboard, rankTrendOf, EduDashboardRow, EduStanding,
} from '@/lib/gamification'

interface StudentGameSectionProps {
  userId: string
}

const DOY = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0).getTime()) / 86400000)

type Tier = 'champion' | 'podium' | 'top5' | 'top10' | 'base'

interface Brief extends EduStanding {
  tier: Tier
  improved: boolean
  delta: number
}

function tierOf(rank: number, points: number): Tier {
  if (!points) return 'base'
  if (rank === 1) return 'champion'
  if (rank <= 3) return 'podium'
  if (rank <= 5) return 'top5'
  if (rank <= 10) return 'top10'
  return 'base'
}

function tierTheme(tier: Tier) {
  switch (tier) {
    case 'champion':
      return {
        Icon: Crown, label: 'Champion',
        chip: 'linear-gradient(135deg, #fbbf24 0%, #f59e0b 55%, #d97706 100%)',
        glow: 'rgba(251,191,36,0.55)', accent: 'text-amber-600',
        cardBg: 'linear-gradient(150deg, rgba(255,251,235,0.95) 0%, rgba(255,247,237,0.7) 100%)',
        activeCardBg: 'linear-gradient(150deg, #fffbeb 0%, #fff7ed 100%)',
        border: 'rgba(251,191,36,0.6)',
      }
    case 'podium':
      return {
        Icon: Medal, label: 'Podium',
        chip: 'linear-gradient(135deg, #fb923c 0%, #f97316 55%, #ea580c 100%)',
        glow: 'rgba(251,146,60,0.45)', accent: 'text-orange-600',
        cardBg: 'linear-gradient(150deg, rgba(255,247,237,0.95) 0%, rgba(255,251,235,0.7) 100%)',
        activeCardBg: 'linear-gradient(150deg, #fff7ed 0%, #fffbeb 100%)',
        border: 'rgba(251,146,60,0.5)',
      }
    case 'top5':
      return {
        Icon: Trophy, label: 'Top 5',
        chip: 'linear-gradient(135deg, #a78bfa 0%, #8b5cf6 55%, #7c3aed 100%)',
        glow: 'rgba(167,139,250,0.42)', accent: 'text-violet-600',
        cardBg: 'linear-gradient(150deg, rgba(250,245,255,0.95) 0%, rgba(245,243,255,0.7) 100%)',
        activeCardBg: 'linear-gradient(150deg, #faf5ff 0%, #f5f3ff 100%)',
        border: 'rgba(167,139,250,0.5)',
      }
    case 'top10':
      return {
        Icon: Star, label: 'Top 10',
        chip: 'linear-gradient(135deg, #22d3ee 0%, #0891b2 55%, #0e7490 100%)',
        glow: 'rgba(34,211,238,0.4)', accent: 'text-cyan-700',
        cardBg: 'linear-gradient(150deg, rgba(236,254,255,0.95) 0%, rgba(240,253,250,0.7) 100%)',
        activeCardBg: 'linear-gradient(150deg, #ecfeff 0%, #f0fdf4 100%)',
        border: 'rgba(34,211,238,0.46)',
      }
    default:
      return {
        Icon: Star, label: 'Earning',
        chip: 'linear-gradient(135deg, #2dd4bf 0%, #14b8a6 55%, #0d9488 100%)',
        glow: 'rgba(45,212,191,0.32)', accent: 'text-teal-700',
        cardBg: 'linear-gradient(150deg, rgba(255,255,255,0.92) 0%, rgba(248,250,252,0.7) 100%)',
        activeCardBg: 'linear-gradient(150deg, #ffffff 0%, #f8fafc 100%)',
        border: 'rgba(148,163,184,0.4)',
      }
  }
}

function getShortMessage(s: EduStanding, idx: number, improved: boolean, delta: number): string {
  const rot = DOY + idx
  if (improved && s.points) {
    const msgs = [`Climbed ${delta} spot${delta === 1 ? '' : 's'} this month!`, `Up ${delta} — momentum is real!`]
    return msgs[rot % msgs.length]
  }
  if (!s.points) return 'Earn your first EduPoints here!'
  if (s.rank === 1) {
    const msgs = ['Leading the board. Defend that crown!', 'Unbeatable. Stay #1!']
    return msgs[rot % msgs.length]
  }
  if (s.rank <= 3) {
    const msgs = [`#${s.rank} and climbing — push to the top!`, 'Top 3! One push to #1.']
    return msgs[rot % msgs.length]
  }
  if (s.rank <= 10) {
    const msgs = [`#${s.rank} — top 3 is within reach!`, 'Keep going — the top is close!']
    return msgs[rot % msgs.length]
  }
  const msgs = ['Keep stacking points and climb!', 'Every point gets you closer!']
  return msgs[rot % msgs.length]
}

/* ─────────────────────────── tier animation overlays ─────────────────────────── */

const CONFETTI_COLORS = ['#f59e0b', '#ef4444', '#3b82f6', '#10b981', '#8b5cf6', '#f97316', '#06b6d4']

function ConfettiRain() {
  const bits = useMemo(() => Array.from({ length: 16 }, (_, i) => ({
    x: (i + 0.5) * (100 / 16),
    color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
    delay: (i * 0.11) % 1.7,
    size: [6, 4, 5, 3][i % 4],
    dur: [1.4, 1.7, 1.3, 1.6][i % 4],
  })), [])
  return (
    <>
      {bits.map((c, i) => (
        <motion.span
          key={i}
          className="absolute pointer-events-none rounded-[1px]"
          style={{ left: `${c.x}%`, width: c.size, height: c.size, background: c.color, top: -c.size, zIndex: 5 }}
          animate={{ y: ['0%', '2400%'], opacity: [1, 1, 0], rotate: [0, 340] }}
          transition={{ duration: c.dur, delay: c.delay, repeat: Infinity, repeatDelay: 0.9, ease: 'easeIn' }}
        />
      ))}
    </>
  )
}

function CornerSparkles() {
  const spots = [
    { top: '8%', left: '10%', size: 7, delay: 0 },
    { top: '12%', right: '12%', size: 6, delay: 0.5 },
    { bottom: '14%', right: '16%', size: 5, delay: 0.9 },
    { bottom: '18%', left: '14%', size: 5, delay: 0.3 },
  ]
  return (
    <>
      {spots.map((s, i) => (
        <motion.div
          key={i}
          className="absolute pointer-events-none"
          style={{ ...s, zIndex: 5 }}
          animate={{ scale: [0.5, 1.4, 0.5], opacity: [0.2, 1, 0.2], rotate: [0, 25, 0] }}
          transition={{ duration: 1.5, delay: s.delay, repeat: Infinity, ease: 'easeInOut' }}
        >
          <Sparkles size={s.size} className="text-amber-400" />
        </motion.div>
      ))}
    </>
  )
}

function GlowRing({ color }: { color: string }) {
  return (
    <motion.div
      className="absolute inset-0 rounded-2xl pointer-events-none"
      style={{ boxShadow: `inset 0 0 0 1.5px ${color}` }}
      animate={{ opacity: [0.25, 0.85, 0.25], scale: [0.985, 1, 0.985] }}
      transition={{ duration: 2.2, repeat: Infinity, ease: 'easeInOut' }}
    />
  )
}

function RisingParticles() {
  const arr = useMemo(() => Array.from({ length: 7 }, (_, i) => ({
    x: 12 + i * 12,
    delay: (i * 0.24) % 1.6,
    size: 5 + (i % 3),
  })), [])
  return (
    <>
      {arr.map((p, i) => (
        <motion.div
          key={i}
          className="absolute pointer-events-none text-emerald-500"
          style={{ left: `${p.x}%`, bottom: '6%', zIndex: 5 }}
          animate={{ y: ['0%', '-260%'], opacity: [0, 0.9, 0], scale: [0.6, 1, 0.6] }}
          transition={{ duration: 1.8, delay: p.delay, repeat: Infinity, ease: 'easeOut' }}
        >
          <ArrowUp size={p.size} strokeWidth={3} />
        </motion.div>
      ))}
    </>
  )
}

/* ─────────────────────────────── cover card ─────────────────────────────── */

function CoverCard({
  pos, spacingMV, index, isActive, cardW, cardH, brief,
}: {
  pos: MotionValue<number>
  spacingMV: MotionValue<number>
  index: number
  isActive: boolean
  cardW: number
  cardH: number
  brief: Brief
}) {
  const x = useTransform([pos, spacingMV], (v: number[]) => (index - v[0]) * v[1])
  const dist = useTransform(pos, p => Math.min(Math.abs(index - p), 1))
  const scale = useTransform(dist, d => 1 - 0.3 * d)        // center 1.0 → sides 0.7
  const opacity = useTransform(dist, d => 1 - 0.35 * d)     // center bright → sides slightly dimmed
  const blur = useTransform(dist, d => `blur(${(d * 1.0).toFixed(2)}px) brightness(${(1 - d * 0.08).toFixed(3)})`)
  const zIndex = useTransform(dist, d => 30 - Math.round(d * 5))

  const t = tierTheme(brief.tier)
  const Icon = t.Icon
  const ranked = brief.points > 0
  const showRankUp = brief.improved && ranked

  return (
    /* Taps are handled by the carousel wrapper, not here: it owns pointer
       capture for dragging, and a captured pointer delivers its click to the
       capture target rather than to the card under the finger. */
    <motion.div
      style={{
        x, scale, opacity, zIndex, filter: blur,
        width: cardW, height: cardH,
        position: 'absolute', left: '50%', top: 0, marginLeft: -cardW / 2,
        cursor: isActive ? 'default' : 'pointer',
      }}
      className="select-none"
    >
      <div
        className="relative w-full h-full rounded-2xl overflow-hidden flex flex-col"
        style={{
          background: isActive ? t.activeCardBg : t.cardBg,
          backdropFilter: isActive ? 'none' : 'blur(20px) saturate(160%)',
          WebkitBackdropFilter: isActive ? 'none' : 'blur(20px) saturate(160%)',
          border: `1px solid ${t.border}`,
          boxShadow: isActive
            ? `0 1px 1px rgba(15,23,42,0.05), 0 22px 50px -18px ${t.glow}, inset 0 1px 0 rgba(255,255,255,0.75)`
            : '0 8px 24px -16px rgba(15,23,42,0.3), inset 0 1px 0 rgba(255,255,255,0.6)',
        }}
      >
        {/* Tier aura */}
        <div
          className="absolute -top-4 -right-4 w-14 h-14 rounded-full blur-xl pointer-events-none"
          style={{ background: t.glow, opacity: isActive ? 0.9 : 0.4 }}
        />

        {/* Active-only celebration animations, distinct per trigger */}
        {isActive && (
          <>
            {brief.tier === 'champion' && (<><ConfettiRain /><GlowRing color="rgba(251,191,36,0.7)" /></>)}
            {brief.tier === 'podium' && <CornerSparkles />}
            {brief.tier === 'top5' && <GlowRing color="rgba(167,139,250,0.65)" />}
            {brief.tier === 'top10' && <GlowRing color="rgba(34,211,238,0.6)" />}
            {showRankUp && <RisingParticles />}
          </>
        )}

        <div className="relative z-[6] flex flex-col h-full p-2">
          {/* Top: medallion + rank */}
          <div className="flex items-start justify-between">
            <motion.div
              className="icon-chip w-7 h-7 flex-shrink-0"
              style={{ background: t.chip, boxShadow: `0 3px 8px -3px ${t.glow}, inset 0 1px 0 rgba(255,255,255,0.5)` }}
              animate={isActive && brief.tier === 'champion'
                ? { rotate: [-8, 8, -8], scale: [1, 1.08, 1] }
                : isActive && (brief.tier === 'podium' || brief.tier === 'top5')
                ? { y: [0, -2, 0] }
                : {}}
              transition={{ duration: brief.tier === 'champion' ? 2 : 2.4, repeat: Infinity, ease: 'easeInOut' }}
            >
              <Icon size={14} className="relative z-10 text-white drop-shadow" strokeWidth={2} />
            </motion.div>

            <div className="flex flex-col items-end gap-0.5">
              {ranked ? (
                <span className={`text-[11px] font-black tabular-nums ${t.accent}`}>
                  #{brief.rank}
                  <span className="text-[9px] font-bold text-slate-400"> / {brief.total_students}</span>
                </span>
              ) : (
                <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Unranked</span>
              )}
              {showRankUp && (
                <motion.span
                  className="inline-flex items-center gap-0.5 px-1 py-0 rounded-full bg-emerald-100 text-emerald-700 text-[8px] font-black"
                  animate={{ scale: [1, 1.12, 1] }}
                  transition={{ duration: 1.1, repeat: Infinity, ease: 'easeInOut' }}
                >
                  <ArrowUp size={7} strokeWidth={3} />{brief.delta}
                </motion.span>
              )}
            </div>
          </div>

          {/* Classroom name */}
          <p className={`mt-1.5 text-[9px] font-black uppercase tracking-widest ${t.accent}`}>{t.label}</p>
          <h3 className="font-display text-[0.7rem] font-bold leading-tight headline text-slate-900 line-clamp-2">
            {brief.classroom_title}
          </h3>

          {/* Points readout */}
          <div className="flex items-end gap-0.5 mt-1">
            <Star size={11} className="text-amber-500 fill-amber-400 mb-0.5 flex-shrink-0" />
            <span className="font-display text-[1.1rem] font-bold leading-none tabular-nums text-slate-900 headline">
              {brief.points}
            </span>
            <span className="text-[9px] font-bold uppercase tracking-widest text-slate-400 mb-0.5">pts</span>
          </div>


        </div>
      </div>
    </motion.div>
  )
}

/* ─────────────────────────────── carousel ─────────────────────────────── */

/** Movement (px) past which a gesture counts as a swipe rather than a tap. */
const TAP_SLOP = 8
/** Swipe speed (px/ms) that carries the strip one card further than the nearest. */
const FLICK_VELOCITY = 0.35

/**
 * Presentational coverflow: shows three cards at a time — a magnified, bright
 * centre flanked by two dimmed, scaled-down neighbours. Tapping a card slides
 * the strip so that card becomes the centre, and dragging/flicking moves it
 * with the finger. Auto-advances right every 5s. Pure props, no data fetching,
 * so it can be previewed in isolation.
 */
export function EduPointsCarousel({ briefs }: { briefs: Brief[] }) {
  const [active, setActive] = useState(0)
  const activeRef = useRef(0)
  activeRef.current = active

  const wrapRef = useRef<HTMLDivElement>(null)
  const [cardW, setCardW] = useState(132)
  const [cardH, setCardH] = useState(132)
  const pos = useMotionValue(0)
  const spacingMV = useMotionValue(144)

  // drag state
  const draggingRef = useRef(false)
  const startXRef = useRef(0)
  const startTRef = useRef(0)
  const lastXRef = useRef(0)
  const basePosRef = useRef(0)
  const movedRef = useRef(false)

  const n = briefs.length

  // Measure to size the centre card & the gap between cards.
  useLayoutEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const measure = () => {
      const w = el.offsetWidth
      const isMobile = w < 640
      // Phone: 0.28 × 1.20 = 0.336 (20% bigger than previous); always square.
      // Wide: capped well below the phone-relative share it used to take —
      // three cards of a readable size, not a band of the page. The strip is
      // a glance at where the student stands, so it earns a strip's height.
      const cw = isMobile
        ? Math.round(Math.min(132, Math.max(72, w * 0.336)))
        : Math.round(Math.min(128, Math.max(96, w * 0.10)))
      const ch = cw  // always square
      const sp = Math.round(cw * 1.09)  // 9% gap (halved from previous 18%)
      setCardW(cw)
      setCardH(ch)
      spacingMV.set(sp)
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [spacingMV])

  // Clamp the active index if the dataset shrinks.
  useEffect(() => {
    if (n > 0 && active >= n) { setActive(0); pos.set(0) }
  }, [n, active, pos])

  const go = useCallback((target: number) => {
    if (n === 0) return
    const clamped = ((target % n) + n) % n
    setActive(clamped)
    activeRef.current = clamped
    animate(pos, clamped, { type: 'spring', stiffness: 300, damping: 22, mass: 0.85 })
  }, [n, pos])

  /** Like `go`, but stops at the ends instead of wrapping — gestures should
   *  never jump the whole strip back to the other side. */
  const goClamped = useCallback((target: number) => {
    go(Math.max(0, Math.min(n - 1, target)))
  }, [go, n])

  // Auto-advance one card to the right every 5 seconds (paused while dragging).
  useEffect(() => {
    if (n <= 1) return
    const t = setInterval(() => {
      if (draggingRef.current) return
      go(activeRef.current + 1)
    }, 5000)
    return () => clearInterval(t)
  }, [n, go])

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (n <= 1) return
    draggingRef.current = true
    movedRef.current = false
    startXRef.current = e.clientX
    lastXRef.current = e.clientX
    startTRef.current = performance.now()
    basePosRef.current = pos.get()
    ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
  }, [n, pos])

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!draggingRef.current) return
    const sp = spacingMV.get() || 1
    const dx = e.clientX - startXRef.current
    if (Math.abs(dx) > TAP_SLOP) movedRef.current = true
    lastXRef.current = e.clientX
    let p = basePosRef.current - dx / sp
    // rubber-band past the ends
    if (p < 0) p = p * 0.32
    else if (p > n - 1) p = (n - 1) + (p - (n - 1)) * 0.32
    pos.set(p)
  }, [n, pos, spacingMV])

  /** Pointer released: either a tap on a card, or the end of a swipe. */
  const endDrag = useCallback((e: React.PointerEvent) => {
    if (!draggingRef.current) return
    draggingRef.current = false
    const sp = spacingMV.get() || 1

    // Tap — cards sit at (index - pos) × spacing from the centre, so the card
    // under the finger is pos + (offset from centre) / spacing. Tapping the
    // card on the left therefore slides the strip right, and vice versa.
    if (!movedRef.current) {
      const rect = wrapRef.current?.getBoundingClientRect()
      if (!rect) return
      const offset = e.clientX - (rect.left + rect.width / 2)
      goClamped(Math.round(pos.get() + offset / sp))
      return
    }

    // Swipe — settle on the nearest card, but let a quick flick carry one
    // further in the direction of travel so short, fast swipes still advance.
    const totalDx  = lastXRef.current - startXRef.current
    const velocity = Math.abs(totalDx) / Math.max(1, performance.now() - startTRef.current)
    const nearest  = Math.round(pos.get())
    if (velocity < FLICK_VELOCITY || totalDx === 0) { goClamped(nearest); return }
    // Dragging left (negative dx) advances the strip, dragging right rewinds it.
    const flick = Math.round(basePosRef.current) + (totalDx < 0 ? 1 : -1)
    goClamped(totalDx < 0 ? Math.max(nearest, flick) : Math.min(nearest, flick))
  }, [pos, spacingMV, goClamped])

  /** The gesture was taken away (system scroll, etc.) — just settle. */
  const cancelDrag = useCallback(() => {
    if (!draggingRef.current) return
    draggingRef.current = false
    goClamped(Math.round(pos.get()))
  }, [pos, goClamped])

  if (n === 0) {
    return (
      <div className="glass-card rounded-[1.5rem] px-6 py-9 text-center">
        <div className="w-12 h-12 rounded-2xl bg-amber-50 flex items-center justify-center mx-auto mb-3">
          <Sparkles size={22} className="text-amber-400" />
        </div>
        <p className="text-sm font-semibold text-slate-600">No EduPoints yet</p>
        <p className="text-xs text-slate-400 mt-1">Complete tasks to start earning across your classrooms.</p>
      </div>
    )
  }

  const activeBrief = briefs[active]
  return (
    <>
      {/* The strip is clipped to its card rather than bleeding to the
          viewport: it lives inside the section's bordered container now, and
          the side cards are cut by that edge. */}
      <div style={{
        position: 'relative', width: '100%',
        overflowX: 'clip', zIndex: 0, isolation: 'isolate', paddingBottom: '8px',
      }}>
        <div
          ref={wrapRef}
          className="w-full relative group/strip"
          style={{ height: cardH, touchAction: 'pan-y', overflow: 'visible' }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={cancelDrag}
        >
          {briefs.map((b, i) => (
            <CoverCard
              key={b.classroom_id}
              pos={pos}
              spacingMV={spacingMV}
              index={i}
              isActive={i === active}
              cardW={cardW}
              cardH={cardH}
              brief={b}
            />
          ))}

          {/* Prev/next: dragging is a touch affordance, so a mouse gets real
              controls. Anchored to the card box and revealed on hover or
              keyboard focus, so touch (which has neither) keeps the swipe and
              the dots alone. */}
          {n > 1 && ([-1, 1] as const).map(dir => (
            <button
              key={dir}
              // The strip captures the pointer to drive dragging, and a
              // captured pointer delivers its click to the capture target
              // rather than this button — so keep pointerdown from reaching it.
              onPointerDown={e => e.stopPropagation()}
              onClick={() => go(activeRef.current + dir)}
              aria-label={dir < 0 ? 'Previous classroom' : 'Next classroom'}
              style={{ [dir < 0 ? 'right' : 'left']: `calc(50% + ${cardW * 0.62}px)` }}
              className="absolute top-1/2 -translate-y-1/2 z-[31] w-8 h-8 inline-flex items-center justify-center rounded-full bg-white/85 backdrop-blur-sm border border-white/70 text-slate-500 shadow-sm opacity-0 group-hover/strip:opacity-100 focus-visible:opacity-100 hover:text-amber-600 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/70"
            >
              {dir < 0 ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}
            </button>
          ))}
        </div>

        {/* Dots */}
        {n > 1 && (
          <div className="flex justify-center items-center gap-1.5 mt-3">
            {n <= 10 ? (
              briefs.map((_, i) => (
                <button
                  key={i}
                  aria-label={`Go to classroom ${i + 1}`}
                  onClick={() => go(i)}
                  className={`rounded-full transition-all duration-300 ${
                    i === active ? 'w-5 h-1.5 bg-amber-500' : 'w-1.5 h-1.5 bg-slate-300 hover:bg-slate-400'
                  }`}
                />
              ))
            ) : (
              <p className="text-[10px] font-semibold text-slate-400">{active + 1} / {n} · swipe →</p>
            )}
          </div>
        )}
      </div>

      {/* Per-card motivation — centered, below the carousel */}
      <p className="text-center text-[13px] font-semibold text-slate-500 mt-2 leading-snug">
        {getShortMessage(activeBrief, active, activeBrief.improved, activeBrief.delta)}
      </p>
    </>
  )
}

/* ───────────────────────── data wrapper (default export) ───────────────────────── */

export default function StudentGameSection({ userId }: StudentGameSectionProps) {
  const [rows, setRows] = useState<EduDashboardRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    fetchStudentEduDashboard(userId).then(data => {
      if (!alive) return
      setRows(data)
      setLoading(false)
    })
    return () => { alive = false }
  }, [userId])

  const briefs = useMemo<Brief[]>(() => {
    return [...rows]
      .sort((a, b) => a.rank - b.rank || b.points - a.points)
      .map(row => {
        // Homework points count towards the displayed total; the rank itself is
        // the leaderboard's own, which is derived from coursework.
        const points = row.points + row.hw_points
        const trend = rankTrendOf(row)
        return {
          ...row,
          points,
          tier: tierOf(row.rank, points),
          improved: trend.improved,
          delta: trend.delta,
        }
      })
  }, [rows])

  if (loading) {
    return (
      <div className="relative h-[132px] flex items-center justify-center gap-2">
        {[0.75, 1, 0.75].map((s, i) => (
          <div
            key={i}
            className="rounded-2xl bg-white/55 border border-white/60 animate-pulse"
            style={{ width: 132 * s, height: 132 * s, opacity: i === 1 ? 1 : 0.55 }}
          />
        ))}
      </div>
    )
  }

  return <EduPointsCarousel briefs={briefs} />
}
