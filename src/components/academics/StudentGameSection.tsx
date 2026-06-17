'use client'

import React, { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { Star } from 'lucide-react'
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

  return (
    <div
      className="rounded-2xl overflow-hidden border border-white/60 shadow-md"
      style={{
        background: 'linear-gradient(135deg, rgba(255,255,255,0.72) 0%, rgba(255,255,255,0.42) 100%)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
      }}
    >
      {/* Mini header */}
      <div className="flex items-center gap-1.5 px-4 pt-3 pb-2 border-b border-white/50">
        <Star size={11} className="text-amber-500 fill-amber-400" />
        <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">My EduPoints</p>
      </div>

      {/* EduPoints columns — spread across full width */}
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
              transition={{ delay: i * 0.05 }}
              className="flex flex-col items-center flex-1 min-w-[44px]"
            >
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
                <span className="text-[9px] font-bold text-amber-600 mt-0.5">#{s.rank}</span>
              )}
            </motion.div>
          ))}
        </div>
      )}

      {/* Personalized message */}
      {!loading && sortedStandings.length > 0 && (
        <div className="px-4 pb-3 pt-1.5 border-t border-white/40">
          <p className="text-[11px] font-semibold text-slate-600 text-center">{message}</p>
        </div>
      )}
    </div>
  )
}
