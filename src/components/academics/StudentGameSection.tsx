'use client'

import React, { useEffect, useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Crown, Sparkles, Star } from 'lucide-react'
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
const CONFETTI = Array.from({ length: 20 }, (_, i) => ({
  x: (i + 0.5) * (100 / 20),
  color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
  delay: (i * 0.08) % 1.6,
  size: [5, 4, 3, 4][i % 4],
  dur: [1.2, 1.4, 1.1, 1.3][i % 4],
}))

export default function StudentGameSection({ userId, userName }: StudentGameSectionProps) {
  const [standings, setStandings] = useState<EduStanding[]>([])
  const [loading, setLoading] = useState(true)
  const [msgIdx, setMsgIdx] = useState(0)

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

  useEffect(() => {
    if (loading || sortedStandings.length === 0) return
    const t = setInterval(() => {
      setMsgIdx(i => (i + 1) % sortedStandings.length)
    }, 8000)
    return () => clearInterval(t)
  }, [loading, sortedStandings.length])

  const bestRank = useMemo(
    () => sortedStandings.filter(s => s.points > 0).reduce((m, s) => Math.min(m, s.rank), Infinity),
    [sortedStandings],
  )

  const isTop1 = bestRank === 1
  const isTop3 = isFinite(bestRank) && bestRank <= 3
  const isTop5 = isFinite(bestRank) && bestRank <= 5
  const isTop10 = isFinite(bestRank) && bestRank <= 10

  const cardStyle: React.CSSProperties = isTop1
    ? {
        background: 'linear-gradient(135deg, rgba(255,251,235,0.90) 0%, rgba(255,255,255,0.60) 100%)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        borderColor: 'rgba(251,191,36,0.55)',
        boxShadow: '0 0 0 1.5px rgba(251,191,36,0.25), 0 6px 20px rgba(251,191,36,0.2)',
      }
    : isTop3
    ? {
        background: 'linear-gradient(135deg, rgba(255,255,255,0.82) 0%, rgba(255,250,240,0.58) 100%)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        borderColor: 'rgba(251,146,60,0.38)',
        boxShadow: '0 0 0 1px rgba(251,146,60,0.2), 0 4px 14px rgba(251,146,60,0.1)',
      }
    : {
        background: 'linear-gradient(135deg, rgba(255,255,255,0.72) 0%, rgba(255,255,255,0.42) 100%)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        borderColor: 'rgba(255,255,255,0.6)',
      }

  return (
    <div className="relative rounded-2xl overflow-hidden border shadow-md" style={cardStyle}>

      {/* Confetti rain for top 5 */}
      {isTop5 && CONFETTI.map((c, i) => (
        <motion.div
          key={i}
          className="absolute pointer-events-none rounded-sm"
          style={{ left: `${c.x}%`, width: c.size, height: c.size, background: c.color, top: -c.size }}
          animate={{ y: [0, 88], opacity: [1, 1, 0], rotate: [0, 300] }}
          transition={{ duration: c.dur, delay: c.delay, repeat: Infinity, repeatDelay: 1.0, ease: 'easeIn' }}
        />
      ))}

      {/* Firework Sparkles for top 3 */}
      {isTop3 && (
        <>
          <motion.div
            className="absolute top-2.5 right-14 pointer-events-none"
            animate={{ scale: [0.6, 1.5, 0.6], opacity: [0.3, 1, 0.3], rotate: [0, 25, 0] }}
            transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut', delay: 0.5 }}
          >
            <Sparkles size={16} className="text-amber-400" />
          </motion.div>
          <motion.div
            className="absolute top-1 right-4 pointer-events-none"
            animate={{ scale: [1, 1.6, 1], opacity: [0.25, 1, 0.25], rotate: [0, -25, 0] }}
            transition={{ duration: 1.2, repeat: Infinity, ease: 'easeInOut' }}
          >
            <Sparkles size={12} className="text-amber-300" />
          </motion.div>
          <motion.div
            className="absolute bottom-7 right-8 pointer-events-none"
            animate={{ scale: [0.7, 1.4, 0.7], opacity: [0.15, 0.7, 0.15] }}
            transition={{ duration: 1.9, repeat: Infinity, ease: 'easeInOut', delay: 0.9 }}
          >
            <Sparkles size={10} className="text-orange-400" />
          </motion.div>
        </>
      )}

      {/* Mini header */}
      <div className="flex items-center gap-1.5 px-4 pt-3 pb-2 border-b border-white/50">
        {isTop1 ? (
          <motion.div
            animate={{ rotate: [-10, 10, -10], scale: [1, 1.2, 1] }}
            transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
          >
            <Crown size={12} className="text-amber-500 fill-amber-400" />
          </motion.div>
        ) : (
          <Star size={11} className="text-amber-500 fill-amber-400" />
        )}
        <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">My EduPoints</p>
      </div>

      {/* EduPoints columns */}
      {loading ? (
        <div className="flex justify-between px-4 py-3">
          {[1, 2, 3].map(n => (
            <div key={n} className="flex flex-col items-center gap-1">
              <div className="h-3 w-8 rounded bg-slate-100 animate-pulse" />
              <div className="h-5 w-6 rounded bg-slate-100 animate-pulse" />
            </div>
          ))}
        </div>
      ) : sortedStandings.length === 0 ? (
        <p className="text-xs text-slate-400 px-4 py-4 text-center">Complete tasks to earn Edu Points!</p>
      ) : (
        <div className="flex overflow-x-auto scrollbar-hide divide-x divide-slate-200/50">
          {sortedStandings.map((s, i) => {
            const isActive = i === msgIdx
            return (
              <motion.div
                key={s.classroom_id}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.06 }}
                className="flex-1 min-w-[68px] py-2 px-1 flex flex-col items-center transition-colors duration-500"
                style={isActive
                  ? { background: 'rgba(255,255,255,0.45)' }
                  : { background: 'transparent' }}
              >
                {/* Fixed-height badge zone — only animate when active */}
                <div className="h-[18px] flex items-center justify-center">
                  {s.rank === 1 && s.points > 0 && (
                    isActive ? (
                      <motion.div
                        animate={{ rotate: [-8, 8, -8], scale: [1, 1.15, 1] }}
                        transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
                      >
                        <Crown size={11} className="text-amber-500 fill-amber-400" />
                      </motion.div>
                    ) : (
                      <Crown size={11} className="text-amber-400/60 fill-amber-300/60" />
                    )
                  )}
                  {s.rank >= 2 && s.rank <= 3 && s.points > 0 && (
                    isActive ? (
                      <motion.div
                        animate={{ scale: [0.9, 1.2, 0.9], opacity: [0.7, 1, 0.7] }}
                        transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
                      >
                        <Sparkles size={10} className="text-amber-400" />
                      </motion.div>
                    ) : (
                      <Sparkles size={10} className="text-amber-300/60" />
                    )
                  )}
                </div>

                {/* Classroom name */}
                <span
                  className={`text-[10px] font-bold w-full text-center uppercase tracking-wider transition-colors duration-500 ${isActive ? 'text-slate-600' : 'text-slate-400/70'}`}
                  title={s.classroom_title}
                >
                  {s.classroom_title.slice(0, 3)}
                </span>

                {/* Points */}
                <span className="flex items-center gap-0.5 mt-0.5">
                  <Star size={10} className={`flex-shrink-0 transition-colors duration-500 ${isActive ? 'text-amber-500 fill-amber-400' : 'text-amber-400/50 fill-amber-300/50'}`} />
                  <span className={`text-base font-black tabular-nums leading-none transition-colors duration-500 ${isActive ? 'text-slate-800' : 'text-slate-500/70'}`}>{s.points}</span>
                </span>

                {/* Fixed-height rank zone */}
                <div className="h-[14px] flex items-center justify-center mt-0.5">
                  {s.rank <= 10 && s.points > 0 && (
                    <span className={`text-[9px] font-black transition-colors duration-500 ${
                      isActive
                        ? s.rank === 1 ? 'text-amber-500' : s.rank <= 3 ? 'text-amber-600' : 'text-amber-700/70'
                        : 'text-slate-400/60'
                    }`}>
                      #{s.rank}
                    </span>
                  )}
                </div>
              </motion.div>
            )
          })}
        </div>
      )}

      {/* Per-classroom message carousel */}
      {!loading && sortedStandings.length > 0 && (
        <div className={`px-4 pb-3 pt-2 border-t ${isTop1 ? 'border-amber-200/60' : 'border-white/40'}`}>
          <AnimatePresence mode="wait">
            <motion.p
              key={`msg-${msgIdx}`}
              initial={{ opacity: 0, x: 16 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -16 }}
              transition={{ duration: 0.35, ease: 'easeOut' }}
              className={`text-sm font-black text-center tracking-tight leading-snug ${
                sortedStandings[msgIdx]?.rank === 1 ? 'text-amber-600'
                : isTop10 ? 'text-amber-700'
                : 'text-slate-700'
              }`}
            >
              {sortedStandings[msgIdx] && getClassroomMessage(sortedStandings[msgIdx], firstName, msgIdx)}
            </motion.p>
          </AnimatePresence>
          {sortedStandings.length > 1 && (
            <div className="flex justify-center items-center gap-1 mt-1.5">
              {sortedStandings.length <= 8 ? (
                sortedStandings.map((_, i) => (
                  <div key={i} className={`rounded-full transition-all duration-300 ${
                    i === msgIdx ? 'w-4 h-1.5 bg-amber-500' : 'w-1.5 h-1.5 bg-slate-300/60'
                  }`} />
                ))
              ) : (
                <p className="text-[9px] text-slate-400 font-semibold">{msgIdx + 1} / {sortedStandings.length}</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
