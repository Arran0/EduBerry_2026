'use client'

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence, useMotionValue, animate } from 'framer-motion'
import { Crown, Medal, Sparkles, Star, Trophy } from 'lucide-react'
import { fetchStudentEduStandings, fetchStudentHwEduPoints, EduStanding } from '@/lib/gamification'

interface StudentGameSectionProps {
  userId: string
  userName: string
}

const DOY = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0).getTime()) / 86400000)

function getClassroomMessage(s: EduStanding, first: string, idx: number): string {
  const cls = s.classroom_title
  const rot = DOY + idx
  if (!s.points) {
    const msgs = [
      `${first}, ${cls} is waiting. Start earning EduPoints!`,
      `No points yet in ${cls}, ${first}. First task = first win.`,
      `${cls} has a spot on the leaderboard for you, ${first}.`,
    ]
    return msgs[rot % msgs.length]
  }
  if (s.rank === 1) {
    const msgs = [
      `${first} is #1 in ${cls}. Nobody touches the top.`,
      `${cls} leaderboard? ${first} owns it. Defend that crown.`,
      `Unbeatable in ${cls}, ${first}. The crown stays yours.`,
    ]
    return msgs[rot % msgs.length]
  }
  if (s.rank <= 3) {
    const msgs = [
      `Top 3 in ${cls}, ${first}. That #1 is one push away.`,
      `${first} at #${s.rank} in ${cls}. Almost at the summit!`,
      `${cls}: ${first} hunting the top — #${s.rank} and climbing.`,
    ]
    return msgs[rot % msgs.length]
  }
  if (s.rank <= 10) {
    const msgs = [
      `${first} is #${s.rank} in ${cls}. Top 3 is in striking range.`,
      `${cls}: ${first} holds #${s.rank}. Keep those points flowing.`,
      `#${s.rank} in ${cls}, ${first}. Every point is a step up.`,
    ]
    return msgs[rot % msgs.length]
  }
  const msgs = [
    `${first} has ${s.points} pts in ${cls}. The top 10 is reachable.`,
    `${cls}: ${first} building momentum with ${s.points} pts.`,
    `${s.points} points in ${cls}, ${first}. Keep stacking to climb.`,
  ]
  return msgs[rot % msgs.length]
}

const CONFETTI_COLORS = ['#f59e0b', '#ef4444', '#3b82f6', '#10b981', '#8b5cf6', '#f97316', '#06b6d4']
const CONFETTI = Array.from({ length: 22 }, (_, i) => ({
  x: (i + 0.5) * (100 / 22),
  color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
  delay: (i * 0.08) % 1.6,
  size: [6, 4, 3, 5][i % 4],
  dur: [1.3, 1.5, 1.2, 1.4][i % 4],
}))

/** Visual identity for a classroom brief, keyed off the student's rank. */
function rankTheme(s: EduStanding) {
  const ranked = s.points > 0
  if (ranked && s.rank === 1)
    return {
      tier: 'gold' as const,
      chip: 'linear-gradient(135deg, #fbbf24 0%, #f59e0b 60%, #d97706 100%)',
      glow: 'rgba(251,191,36,0.55)',
      ring: 'rgba(251,191,36,0.40)',
      accent: 'text-amber-600',
      label: 'Champion',
      Icon: Crown,
    }
  if (ranked && s.rank <= 3)
    return {
      tier: 'podium' as const,
      chip: 'linear-gradient(135deg, #fb923c 0%, #f97316 60%, #ea580c 100%)',
      glow: 'rgba(251,146,60,0.40)',
      ring: 'rgba(251,146,60,0.30)',
      accent: 'text-orange-600',
      label: 'Podium',
      Icon: Medal,
    }
  if (ranked && s.rank <= 10)
    return {
      tier: 'top10' as const,
      chip: 'linear-gradient(135deg, #22d3ee 0%, #0891b2 60%, #0e7490 100%)',
      glow: 'rgba(34,211,238,0.32)',
      ring: 'rgba(34,211,238,0.26)',
      accent: 'text-cyan-700',
      label: 'Top 10',
      Icon: Trophy,
    }
  if (ranked)
    return {
      tier: 'ranked' as const,
      chip: 'linear-gradient(135deg, #2dd4bf 0%, #14b8a6 60%, #0d9488 100%)',
      glow: 'rgba(45,212,191,0.28)',
      ring: 'rgba(45,212,191,0.22)',
      accent: 'text-teal-700',
      label: 'Climbing',
      Icon: Star,
    }
  return {
    tier: 'none' as const,
    chip: 'linear-gradient(135deg, #cbd5e1 0%, #94a3b8 100%)',
    glow: 'rgba(148,163,184,0.22)',
    ring: 'rgba(148,163,184,0.20)',
    accent: 'text-slate-500',
    label: 'Get started',
    Icon: Sparkles,
  }
}

/** A single full-width classroom EduPoint brief. */
function ClassroomBrief({
  s, first, idx, width,
}: { s: EduStanding; first: string; idx: number; width: number }) {
  const t = rankTheme(s)
  const Icon = t.Icon
  const ranked = s.points > 0

  return (
    <div style={{ width: width || '100%', flexShrink: 0 }} className="px-5 sm:px-6">
      <div className="flex items-start gap-4 pt-1">
        {/* Rank medallion */}
        <div className="relative flex-shrink-0">
          <motion.div
            className="icon-chip w-14 h-14"
            style={{ background: t.chip, boxShadow: `0 8px 22px -6px ${t.glow}, inset 0 1px 0 rgba(255,255,255,0.5)` }}
            animate={t.tier === 'gold'
              ? { rotate: [-6, 6, -6], scale: [1, 1.06, 1] }
              : { scale: [1, 1.03, 1] }}
            transition={{ duration: t.tier === 'gold' ? 2.4 : 3, repeat: Infinity, ease: 'easeInOut' }}
          >
            <Icon size={26} className="relative z-10 text-white drop-shadow" strokeWidth={2} />
          </motion.div>
          {/* Rank number badge */}
          {ranked && s.rank <= 10 && (
            <div
              className="absolute -bottom-1.5 -right-1.5 min-w-[22px] h-[22px] px-1 rounded-full bg-white flex items-center justify-center shadow-md ring-1 ring-black/5"
              style={{ boxShadow: `0 2px 8px ${t.ring}` }}
            >
              <span className={`text-[11px] font-black tabular-nums ${t.accent}`}>#{s.rank}</span>
            </div>
          )}
        </div>

        {/* Brief body */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className={`eyebrow ${t.accent}`}>{t.label}</span>
            {ranked && (
              <span className="text-[10px] font-semibold text-slate-400">· of {s.total_students}</span>
            )}
          </div>
          <h3 className="font-display text-[1.35rem] font-bold leading-tight headline text-slate-900 truncate mt-1">
            {s.classroom_title}
          </h3>

          {/* Points readout */}
          <div className="flex items-end gap-1.5 mt-1.5">
            <Star size={18} className="text-amber-500 fill-amber-400 mb-1 flex-shrink-0" />
            <span className="font-display text-[2.4rem] font-bold leading-none tabular-nums text-slate-900 headline">
              {s.points}
            </span>
            <span className="text-[11px] font-bold uppercase tracking-widest text-slate-400 mb-1.5">
              EduPoints
            </span>
          </div>
        </div>
      </div>

      {/* Motivational line */}
      <p className={`mt-3.5 text-sm font-bold tracking-tight leading-snug ${t.accent}`}>
        {getClassroomMessage(s, first, idx)}
      </p>
    </div>
  )
}

export default function StudentGameSection({ userId, userName }: StudentGameSectionProps) {
  const [standings, setStandings] = useState<EduStanding[]>([])
  const [loading, setLoading] = useState(true)
  const [idx, setIdx] = useState(0)

  const trackRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const dragX = useMotionValue(0)
  const swipeStartX = useRef<number | null>(null)
  const baseOffset = useRef(0)
  // Mirror of `idx` for effects that must not re-run (and snap) on every change.
  const idxRef = useRef(0)
  idxRef.current = idx

  useEffect(() => {
    let active = true
    Promise.all([
      fetchStudentEduStandings(userId),
      fetchStudentHwEduPoints(userId),
    ]).then(([standings, hwPoints]) => {
      if (!active) return
      // Add homework task points on top of the RPC's file-based totals.
      const merged = standings.map(s => ({
        ...s,
        points: s.points + (hwPoints[s.classroom_id] ?? 0),
      }))
      setStandings(merged)
      setLoading(false)
    })
    return () => { active = false }
  }, [userId])

  const sortedStandings = useMemo(
    () => [...standings].sort((a, b) => a.rank - b.rank || b.points - a.points),
    [standings],
  )

  const firstName = useMemo(() => (userName || 'there').split(' ')[0], [userName])
  const n = sortedStandings.length

  // Measure the track width so each brief snaps to a full panel.
  useLayoutEffect(() => {
    const el = trackRef.current
    if (!el) return
    const measure = () => setWidth(el.offsetWidth)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [loading])

  // Keep the strip aligned when width changes (orientation/resize). Reads the
  // current index from a ref so it doesn't fire — and snap — on every swipe.
  useEffect(() => {
    if (width > 0) dragX.set(-idxRef.current * width)
  }, [width, dragX])

  const snapTo = useCallback((target: number) => {
    if (n === 0 || width === 0) return
    const clamped = ((target % n) + n) % n
    setIdx(clamped)
    animate(dragX, -clamped * width, { type: 'spring', stiffness: 280, damping: 32, mass: 0.9 })
  }, [n, width, dragX])

  // Auto-advance every 4 seconds through the classroom briefs.
  useEffect(() => {
    if (loading || n <= 1 || width === 0) return
    const t = setInterval(() => {
      const cur = Math.round(-dragX.get() / width)
      const next = (cur + 1) % n
      setIdx(next)
      animate(dragX, -next * width, { type: 'spring', stiffness: 280, damping: 32, mass: 0.9 })
    }, 4000)
    return () => clearInterval(t)
  }, [loading, n, width, dragX])

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    swipeStartX.current = e.touches[0].clientX
    baseOffset.current = dragX.get()
  }, [dragX])

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (swipeStartX.current === null || width === 0) return
    const dx = e.touches[0].clientX - swipeStartX.current
    const raw = baseOffset.current + dx
    const minX = -(n - 1) * width
    const maxX = 0
    // Rubber-band resistance at the edges.
    const x = raw < minX ? minX + (raw - minX) * 0.24 : raw > maxX ? raw * 0.24 : raw
    dragX.set(x)
  }, [n, width, dragX])

  const onTouchEnd = useCallback((e: React.TouchEvent) => {
    if (swipeStartX.current === null || width === 0) return
    const dx = e.changedTouches[0].clientX - swipeStartX.current
    swipeStartX.current = null
    const fractional = -dragX.get() / width
    let target: number
    if (dx < -40) target = Math.min(Math.ceil(fractional - 0.1), n - 1)
    else if (dx > 40) target = Math.max(Math.floor(fractional + 0.1), 0)
    else target = Math.max(0, Math.min(Math.round(fractional), n - 1))
    snapTo(target)
  }, [n, width, dragX, snapTo])

  const active = sortedStandings[idx]
  const theme = active ? rankTheme(active) : null

  // Whole-card glow follows the active brief's tier.
  const cardStyle: React.CSSProperties = {
    background: 'linear-gradient(150deg, rgba(255,255,255,0.78) 0%, rgba(255,255,255,0.46) 100%)',
    backdropFilter: 'blur(28px) saturate(165%)',
    WebkitBackdropFilter: 'blur(28px) saturate(165%)',
    border: '1px solid rgba(255,255,255,0.62)',
    boxShadow: theme
      ? `0 1px 1px rgba(15,23,42,0.04), 0 16px 40px -18px ${theme.glow}, inset 0 1px 0 rgba(255,255,255,0.7)`
      : '0 1px 1px rgba(15,23,42,0.04), 0 12px 32px -16px rgba(15,23,42,0.18), inset 0 1px 0 rgba(255,255,255,0.7)',
    transition: 'box-shadow 0.6s ease',
  }

  const isGold = theme?.tier === 'gold'
  const isPodium = theme?.tier === 'gold' || theme?.tier === 'podium'

  return (
    <div className="relative rounded-[1.5rem] overflow-hidden" style={cardStyle}>

      {/* Confetti rain — podium tiers only */}
      {isPodium && CONFETTI.map((c, i) => (
        <motion.div
          key={i}
          className="absolute pointer-events-none rounded-sm z-[1]"
          style={{ left: `${c.x}%`, width: c.size, height: c.size, background: c.color, top: -c.size }}
          animate={{ y: [0, 150], opacity: [1, 1, 0], rotate: [0, 320] }}
          transition={{ duration: c.dur, delay: c.delay, repeat: Infinity, repeatDelay: 1.1, ease: 'easeIn' }}
        />
      ))}

      {/* Soft tier aura in the corner */}
      {theme && (
        <motion.div
          key={theme.tier}
          className="absolute -top-10 -right-10 w-44 h-44 rounded-full pointer-events-none blur-3xl"
          style={{ background: theme.glow }}
          initial={{ opacity: 0 }}
          animate={{ opacity: isGold ? 0.9 : 0.55 }}
          transition={{ duration: 0.7 }}
        />
      )}

      {/* Header */}
      <div className="relative flex items-center gap-2.5 px-5 sm:px-6 pt-4 pb-3">
        <div
          className="icon-chip w-9 h-9 flex-shrink-0"
          style={{ background: 'linear-gradient(135deg, #fbbf24, #f59e0b)' }}
        >
          {isGold ? (
            <motion.div
              animate={{ rotate: [-10, 10, -10], scale: [1, 1.15, 1] }}
              transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
            >
              <Crown size={17} className="relative z-10 text-white drop-shadow-sm" />
            </motion.div>
          ) : (
            <Star size={16} className="relative z-10 text-white fill-white/90 drop-shadow-sm" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className="eyebrow text-slate-400 mb-1">Gamification</p>
          <h2 className="font-display text-[1.4rem] font-bold leading-none headline text-slate-900">
            My EduPoints
          </h2>
        </div>
        {!loading && n > 0 && (
          <span className="flex-shrink-0 text-[10px] font-bold uppercase tracking-wider text-slate-400">
            {idx + 1} / {n}
          </span>
        )}
      </div>

      {/* Swipeable brief strip */}
      {loading ? (
        <div className="px-5 sm:px-6 pb-5 animate-pulse">
          <div className="flex items-start gap-4 pt-1">
            <div className="w-14 h-14 rounded-2xl bg-slate-200/70" />
            <div className="flex-1 space-y-2.5 pt-1">
              <div className="h-3 w-20 rounded bg-slate-200/70" />
              <div className="h-5 w-2/3 rounded bg-slate-200/70" />
              <div className="h-8 w-28 rounded bg-slate-200/70" />
            </div>
          </div>
          <div className="h-4 w-3/4 rounded bg-slate-200/70 mt-4" />
        </div>
      ) : n === 0 ? (
        <div className="px-6 py-8 text-center">
          <div className="w-12 h-12 rounded-2xl bg-amber-50 flex items-center justify-center mx-auto mb-3">
            <Sparkles size={22} className="text-amber-400" />
          </div>
          <p className="text-sm font-semibold text-slate-600">No EduPoints yet</p>
          <p className="text-xs text-slate-400 mt-1">Complete tasks to start earning across your classrooms.</p>
        </div>
      ) : (
        <>
          <div
            ref={trackRef}
            className="overflow-hidden pb-4 select-none"
            onTouchStart={onTouchStart}
            onTouchMove={onTouchMove}
            onTouchEnd={onTouchEnd}
            style={{ touchAction: 'pan-y' }}
          >
            <motion.div style={{ x: dragX, display: 'flex' }}>
              {sortedStandings.map((s, i) => (
                <ClassroomBrief key={s.classroom_id} s={s} first={firstName} idx={i} width={width} />
              ))}
            </motion.div>
          </div>

          {/* Dot indicators */}
          {n > 1 && (
            <div className="flex justify-center items-center gap-1.5 pb-4">
              {n <= 8 ? (
                sortedStandings.map((_, i) => (
                  <button
                    key={i}
                    aria-label={`Go to classroom ${i + 1}`}
                    onClick={() => snapTo(i)}
                    className={`rounded-full transition-all duration-300 ${
                      i === idx ? 'w-5 h-1.5 bg-amber-500' : 'w-1.5 h-1.5 bg-slate-300 hover:bg-slate-400'
                    }`}
                  />
                ))
              ) : (
                <p className="text-[10px] font-semibold text-slate-400">Swipe to explore →</p>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
