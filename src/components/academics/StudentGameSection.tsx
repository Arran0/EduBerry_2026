'use client'

import React, { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { Crown, Sparkles, Star } from 'lucide-react'
import { fetchStudentEduStandings, EduStanding } from '@/lib/gamification'

interface StudentGameSectionProps {
  userId: string
  userName: string
}

const TOP_MSGS: Array<(first: string, rank: number, cls: string) => string> = [
  (f, r, c) => `${f}, you're crushing it — top ${r} in ${c}.`,
  (f, r, c) => `${f} is elite — ranked #${r} in ${c}. Keep the fire!`,
  (f, r, c) => `Top ${r} in ${c}? ${f} is on another level.`,
  (f, r, c) => `${f} owns the #${r} spot in ${c}. Absolute legend.`,
  (f, r, c) => `#${r} in ${c} — that's ${f}'s zone. Stay relentless.`,
  (f, r, c) => `${f} at #${r} in ${c}. Consistency is the cheat code.`,
]

const BOOST_MSGS: Array<(first: string) => string> = [
  (f) => `${f}, the top 10 is within reach. Push harder!`,
  (f) => `Every point counts, ${f}. Your ranking is rising.`,
  (f) => `${f}, consistency beats talent. Keep going!`,
  (f) => `The leaderboard won't know what hit it, ${f}.`,
  (f) => `${f}, today's effort is tomorrow's rank.`,
  (f) => `${f}, champions are built in quiet moments like this.`,
  (f) => `Keep stacking, ${f}. The top 10 is watching.`,
]

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

  useEffect(() => {
    let active = true
    fetchStudentEduStandings(userId).then(st => {
      if (active) { setStandings(st); setLoading(false) }
    })
    return () => { active = false }
  }, [userId])

  const sortedStandings = useMemo(
    () => [...standings].sort((a, b) => a.rank - b.rank || b.points - a.points),
    [standings],
  )

  const bestRank = useMemo(
    () => sortedStandings.filter(s => s.points > 0).reduce((m, s) => Math.min(m, s.rank), Infinity),
    [sortedStandings],
  )

  const isTop1 = bestRank === 1
  const isTop3 = isFinite(bestRank) && bestRank <= 3
  const isTop5 = isFinite(bestRank) && bestRank <= 5
  const isTop10 = isFinite(bestRank) && bestRank <= 10

  const message = useMemo(() => {
    const doy = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0).getTime()) / 86400000)
    const first = (userName || 'there').split(' ')[0]
    const bestTop = sortedStandings.find(s => s.rank <= 10 && s.points > 0)
    if (bestTop) {
      const cls = bestTop.classroom_title.slice(0, 3).toUpperCase()
      return TOP_MSGS[doy % TOP_MSGS.length](first, bestTop.rank, cls)
    }
    return BOOST_MSGS[doy % BOOST_MSGS.length](first)
  }, [sortedStandings, userName])

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
        <div className="flex justify-between overflow-x-auto scrollbar-hide px-4 py-3 gap-1">
          {sortedStandings.map((s, i) => (
            <motion.div
              key={s.classroom_id}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.06 }}
              className="flex flex-col items-center flex-1 min-w-[44px]"
            >
              {/* Achievement badge above column */}
              {s.rank === 1 && s.points > 0 && (
                <motion.div
                  animate={{ rotate: [-8, 8, -8], scale: [1, 1.15, 1] }}
                  transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
                >
                  <Crown size={11} className="text-amber-500 fill-amber-400 mb-0.5" />
                </motion.div>
              )}
              {s.rank >= 2 && s.rank <= 3 && s.points > 0 && (
                <motion.div
                  animate={{ scale: [0.9, 1.2, 0.9], opacity: [0.7, 1, 0.7] }}
                  transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
                >
                  <Sparkles size={10} className="text-amber-400 mb-0.5" />
                </motion.div>
              )}
              <span
                className="text-[10px] font-bold text-slate-400 w-full text-center uppercase tracking-wider"
                title={s.classroom_title}
              >
                {s.classroom_title.slice(0, 3)}
              </span>
              <span className="flex items-center gap-0.5 mt-0.5">
                <Star size={10} className="text-amber-500 fill-amber-400 flex-shrink-0" />
                <span className="text-base font-black text-slate-800 tabular-nums leading-none">{s.points}</span>
              </span>
              {s.rank <= 10 && s.points > 0 && (
                <span className={`text-[9px] font-black mt-0.5 ${
                  s.rank === 1 ? 'text-amber-500' : s.rank <= 3 ? 'text-amber-600' : 'text-amber-700/70'
                }`}>
                  #{s.rank}
                </span>
              )}
            </motion.div>
          ))}
        </div>
      )}

      {/* Personalized message */}
      {!loading && sortedStandings.length > 0 && (
        <motion.div
          className={`px-4 pb-3 pt-2 border-t ${isTop1 ? 'border-amber-200/60' : 'border-white/40'}`}
          initial={{ opacity: 0, y: 3 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4, duration: 0.4 }}
        >
          <p className={`text-sm font-black text-center tracking-tight leading-snug ${
            isTop1 ? 'text-amber-600' : isTop10 ? 'text-amber-700' : 'text-slate-700'
          }`}>
            {message}
          </p>
        </motion.div>
      )}
    </div>
  )
}
