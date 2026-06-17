'use client'

import React, { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { Star } from 'lucide-react'
import { fetchStudentEduStandings, EduStanding } from '@/lib/gamification'

interface StudentGameSectionProps {
  userId: string
  userName: string
}

function getGreeting(name: string): string {
  const h = new Date().getHours()
  const session = h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening'
  const first = name.split(' ')[0]
  const vibes = [
    `Hi ${first}, ready for your ${session} study session?`,
    `${first} is back — let's crush this ${session}!`,
    `Good ${session}, ${first}. Your classmates are already ahead.`,
    `${first} returns. Time to make this ${session} count.`,
    `Hey ${first}! Another ${session}, another step forward.`,
  ]
  const doy = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0).getTime()) / 86400000)
  return vibes[doy % vibes.length]
}

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

  const greeting = useMemo(() => getGreeting(userName || 'there'), [userName])

  return (
    <section className="bg-white border-b border-slate-100 px-4 py-5">
      {/* Personalized greeting */}
      <p className="text-base font-bold text-slate-800 mb-4">{greeting}</p>

      {/* EduPoints columns */}
      {loading ? (
        <div className="flex gap-3">
          {[1, 2, 3].map(n => (
            <div key={n} className="flex flex-col items-center min-w-[64px] gap-1">
              <div className="h-3 w-10 rounded bg-slate-100 animate-pulse" />
              <div className="h-5 w-8 rounded bg-slate-100 animate-pulse" />
            </div>
          ))}
        </div>
      ) : sortedStandings.length === 0 ? (
        <p className="text-xs text-slate-400">Complete tasks to earn Edu Points!</p>
      ) : (
        <div className="flex gap-4 overflow-x-auto scrollbar-hide pb-1">
          {sortedStandings.map((s, i) => (
            <motion.div
              key={s.classroom_id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
              className="flex flex-col items-center min-w-[60px]"
            >
              <span
                className="text-[11px] font-semibold text-slate-500 w-full text-center"
                title={s.classroom_title}
              >
                {s.classroom_title.slice(0, 5)}
              </span>
              <span className="flex items-center gap-0.5 mt-0.5">
                <Star size={11} className="text-amber-500 fill-amber-400 flex-shrink-0" />
                <span className="text-lg font-black text-slate-800 tabular-nums leading-none">{s.points}</span>
              </span>
              {s.rank <= 10 && s.points > 0 && (
                <span className="text-[10px] font-bold text-amber-600 mt-0.5">#{s.rank}</span>
              )}
            </motion.div>
          ))}
        </div>
      )}
    </section>
  )
}
