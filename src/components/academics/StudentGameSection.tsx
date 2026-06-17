'use client'

import React, { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { Flame, Star, Trophy, Quote as QuoteIcon, Sparkles } from 'lucide-react'
import { fetchStreak, fetchStudentEduStandings, EduStanding } from '@/lib/gamification'
import { getDailyQuote } from '@/lib/quotes'

interface StudentGameSectionProps {
  userId: string
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}

const CONGRATS_TEMPLATES = [
  (place: string, room: string) => `You're currently placed ${place} in ${room} — wow, keep it up!`,
  (place: string, room: string) => `Amazing! You're sitting ${place} on the ${room} leaderboard.`,
  (place: string, room: string) => `Top of the class energy — ${place} place in ${room}!`,
  (place: string, room: string) => `Brilliant work! ${place} in ${room}. The podium is calling.`,
  (place: string, room: string) => `You're ${place} in ${room} — your effort is really paying off!`,
]

// ─── Author portrait (Wikipedia thumbnail → initials fallback) ───────────────────

function AuthorPortrait({ wiki, author }: { wiki: string; author: string }) {
  const [src, setSrc] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let active = true
    setSrc(null); setFailed(false)
    if (!wiki || wiki === 'Anonymous') { setFailed(true); return }
    const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(wiki.replace(/ /g, '_'))}`
    fetch(url)
      .then(r => (r.ok ? r.json() : Promise.reject()))
      .then(j => {
        const thumb = j?.thumbnail?.source as string | undefined
        if (active && thumb) setSrc(thumb)
        else if (active) setFailed(true)
      })
      .catch(() => { if (active) setFailed(true) })
    return () => { active = false }
  }, [wiki])

  const initials = author.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase()

  if (src && !failed) {
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img
        src={src}
        alt={author}
        onError={() => setFailed(true)}
        className="w-12 h-12 rounded-full object-cover grayscale border border-slate-200 flex-shrink-0"
      />
    )
  }
  return (
    <div className="w-12 h-12 rounded-full flex-shrink-0 bg-gradient-to-br from-slate-300 to-slate-400 grayscale flex items-center justify-center text-white font-bold text-sm border border-slate-200">
      {initials}
    </div>
  )
}

// ─── Main section ─────────────────────────────────────────────────────────────

export default function StudentGameSection({ userId }: StudentGameSectionProps) {
  const [streak, setStreak] = useState<number | null>(null)
  const [standings, setStandings] = useState<EduStanding[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    setLoading(true)
    Promise.all([fetchStreak(userId), fetchStudentEduStandings(userId)])
      .then(([s, st]) => {
        if (!active) return
        setStreak(s?.current_streak ?? 0)
        setStandings(st)
      })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [userId])

  const totalPoints = useMemo(() => standings.reduce((sum, s) => sum + s.points, 0), [standings])
  const sortedStandings = useMemo(
    () => [...standings].sort((a, b) => a.rank - b.rank || b.points - a.points),
    [standings],
  )

  // Best top-10 placement across classrooms → congrats banner.
  const bestPlacement = useMemo(() => {
    const top = standings.filter(s => s.rank <= 10 && s.points > 0)
    if (top.length === 0) return null
    return top.reduce((best, s) => (s.rank < best.rank ? s : best), top[0])
  }, [standings])

  const quote = useMemo(() => getDailyQuote(), [])
  const days = streak ?? 0

  return (
    <section className="space-y-3">
      {/* ── Streak + points hero ── */}
      <div className="relative glass rounded-2xl overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-orange-50 via-amber-50 to-rose-50 pointer-events-none" />
        <div className="absolute -top-10 -right-8 w-40 h-40 rounded-full bg-orange-200/30 blur-3xl pointer-events-none" />
        <div className="relative p-5 flex items-center gap-5 flex-wrap sm:flex-nowrap">
          {/* Animated fire */}
          <div className="relative flex-shrink-0 flex flex-col items-center">
            <motion.div
              animate={{ scale: [1, 1.12, 1], rotate: [-2, 2, -2] }}
              transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
              className="relative"
            >
              <div className="absolute inset-0 blur-xl bg-orange-400/40 rounded-full" />
              <Flame size={64} className="relative text-orange-500 fill-amber-400/80" strokeWidth={1.5} />
            </motion.div>
            <div className="mt-1 text-center">
              <motion.p
                key={days}
                initial={{ scale: 0.6, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: 'spring', stiffness: 360, damping: 22 }}
                className="text-3xl font-black text-orange-600 leading-none tabular-nums"
              >
                {loading ? '·' : days}
              </motion.p>
              <p className="text-[10px] font-bold uppercase tracking-wider text-orange-400 mt-0.5">
                day{days === 1 ? '' : 's'} streak
              </p>
            </div>
          </div>

          {/* Greeting + total points */}
          <div className="flex-1 min-w-0">
            <h2 className="font-display text-lg font-bold text-slate-800 flex items-center gap-2">
              <Sparkles size={18} className="text-amber-500" />
              {days >= 2 ? `You're on a ${days}-day roll!` : 'Welcome back!'}
            </h2>
            <p className="text-sm text-slate-600 mt-0.5">
              {days >= 2
                ? 'Keep opening EduBerry every day to grow your streak.'
                : 'Open the app daily to build a streak and earn Edu Points.'}
            </p>
            <div className="mt-3 inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-white/70 border border-amber-200">
              <Star size={15} className="text-amber-500 fill-amber-400" />
              <span className="text-sm font-bold text-slate-800 tabular-nums">{totalPoints}</span>
              <span className="text-xs text-slate-500 font-medium">Edu Points total</span>
            </div>
          </div>
        </div>
      </div>

      {/* ── Top-10 congrats ── */}
      {bestPlacement && (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          className="relative rounded-2xl overflow-hidden border border-amber-200 bg-gradient-to-r from-amber-50 to-yellow-50"
        >
          <div className="flex items-center gap-3 px-5 py-3.5">
            <div className="w-10 h-10 rounded-full bg-amber-100 border border-amber-300 flex items-center justify-center flex-shrink-0">
              <Trophy size={18} className="text-amber-600" />
            </div>
            <p className="text-sm font-semibold text-amber-800 leading-snug">
              {CONGRATS_TEMPLATES[(bestPlacement.rank + bestPlacement.classroom_title.length) % CONGRATS_TEMPLATES.length](
                ordinal(bestPlacement.rank),
                bestPlacement.classroom_title,
              )}
            </p>
          </div>
        </motion.div>
      )}

      {/* ── EduPoints per classroom ── */}
      <div className="glass rounded-2xl overflow-hidden">
        <div className="flex items-center gap-2 px-4 pt-4 pb-3 border-b border-slate-100/80">
          <div className="p-1.5 bg-amber-100 rounded-lg">
            <Star size={14} className="text-amber-600" />
          </div>
          <h2 className="font-semibold text-slate-700 text-sm">My Edu Points</h2>
          <span className="text-xs text-slate-400 ml-auto hidden sm:block">Points &amp; class rank</span>
        </div>
        <div className="p-3">
          {loading ? (
            <p className="text-sm text-slate-400 text-center py-4">Loading your points…</p>
          ) : sortedStandings.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-4">
              Complete homework and classwork with Edu Points to start earning!
            </p>
          ) : (
            <div className="space-y-1.5">
              {sortedStandings.map((s, i) => {
                const isTop3 = s.rank <= 3 && s.points > 0
                const medal = ['from-amber-400 to-yellow-500', 'from-slate-300 to-slate-400', 'from-orange-400 to-amber-500']
                return (
                  <motion.div
                    key={s.classroom_id}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.04 }}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-white border border-slate-100"
                  >
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 text-xs font-black ${
                      isTop3 ? `bg-gradient-to-br ${medal[s.rank - 1]} text-white` : 'bg-slate-100 text-slate-500'
                    }`}>
                      {s.points > 0 ? `#${s.rank}` : '—'}
                    </div>
                    <p className="flex-1 min-w-0 text-sm font-semibold text-slate-700 truncate">{s.classroom_title}</p>
                    <span className="text-[10px] text-slate-400 hidden sm:block">
                      of {s.total_students}
                    </span>
                    <span className="flex items-center gap-1 px-2 py-1 rounded-lg bg-amber-50 border border-amber-100 flex-shrink-0">
                      <Star size={12} className="text-amber-500 fill-amber-400" />
                      <span className="text-sm font-bold text-slate-800 tabular-nums">{s.points}</span>
                    </span>
                  </motion.div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── Daily quote ── */}
      <div className="relative glass rounded-2xl overflow-hidden">
        <QuoteIcon size={80} className="absolute -bottom-3 -right-2 text-slate-100 pointer-events-none" />
        <div className="relative flex items-start gap-4 p-5">
          <AuthorPortrait wiki={quote.wiki} author={quote.author} />
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">Quote of the day</p>
            <p className="text-sm text-slate-700 leading-relaxed font-medium">“{quote.text}”</p>
            <p className="text-xs text-slate-500 mt-1.5 font-semibold">— {quote.author}</p>
          </div>
        </div>
      </div>
    </section>
  )
}
