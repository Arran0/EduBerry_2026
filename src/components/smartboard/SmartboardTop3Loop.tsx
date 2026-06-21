'use client'

import React, { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Trophy, Star, Crown, Loader2, PartyPopper } from 'lucide-react'
import Avatar from '@/components/Avatar'
import { Classroom } from '@/lib/classrooms'
import { fetchClassroomTop3, ClassroomTop3Entry } from '@/lib/smartboard'

const CONGRATS = [
  'congratulations',
  'way to go',
  'outstanding work',
  'superb effort',
  'you’re on fire',
  'brilliant job',
  'keep shining',
  'top of the class',
  'phenomenal',
  'champion stuff',
]

const ROTATE_MS = 5000

interface BoardData {
  classroom: Classroom
  top3: ClassroomTop3Entry[]
}

const RANK_STYLE = [
  { ring: 'ring-amber-400', bg: 'bg-amber-50', text: 'text-amber-700', medal: '🥇' },
  { ring: 'ring-slate-300', bg: 'bg-slate-50', text: 'text-slate-600', medal: '🥈' },
  { ring: 'ring-orange-300', bg: 'bg-orange-50', text: 'text-orange-700', medal: '🥉' },
]

export default function SmartboardTop3Loop({ classrooms }: { classrooms: Classroom[] }) {
  const [boards, setBoards] = useState<BoardData[]>([])
  const [loading, setLoading] = useState(true)
  const [index, setIndex] = useState(0)
  const [congrats, setCongrats] = useState(CONGRATS[0])
  // Stable id-list so the rotation effect doesn't restart on every render.
  const classroomKey = classrooms.map(c => c.id).join(',')
  const boardsRef = useRef<BoardData[]>([])

  useEffect(() => {
    let active = true
    setLoading(true)
    Promise.all(
      classrooms.map(async classroom => ({ classroom, top3: await fetchClassroomTop3(classroom.id) })),
    ).then(results => {
      if (!active) return
      const withData = results.filter(r => r.top3.length > 0)
      boardsRef.current = withData
      setBoards(withData)
      setIndex(0)
      setCongrats(CONGRATS[Math.floor(Math.random() * CONGRATS.length)])
      setLoading(false)
    })
    return () => { active = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classroomKey])

  // Rotate every 5s; reshuffle the congrats line on each change.
  useEffect(() => {
    if (boards.length === 0) return
    const t = setInterval(() => {
      setIndex(i => (i + 1) % boardsRef.current.length)
      setCongrats(CONGRATS[Math.floor(Math.random() * CONGRATS.length)])
    }, ROTATE_MS)
    return () => clearInterval(t)
  }, [boards.length])

  if (loading) {
    return (
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Loader2 size={14} className="animate-spin" /> Loading standings…
        </div>
      </section>
    )
  }

  if (boards.length === 0) return null

  const current = boards[Math.min(index, boards.length - 1)]
  const top1 = current.top3[0]

  return (
    <section className="relative overflow-hidden rounded-2xl border border-amber-200 bg-gradient-to-br from-amber-50 to-white p-5 shadow-sm">
      <div className="flex items-center gap-2 mb-3">
        <Trophy size={18} className="text-amber-500" />
        <h2 className="font-display text-lg font-bold text-slate-800 flex-1">Top of the Class</h2>
        {boards.length > 1 && (
          <div className="flex items-center gap-1">
            {boards.map((_, i) => (
              <span key={i} className={`h-1.5 rounded-full transition-all ${i === index ? 'w-5 bg-amber-500' : 'w-1.5 bg-amber-200'}`} />
            ))}
          </div>
        )}
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={current.classroom.id}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -12 }}
          transition={{ duration: 0.35 }}
        >
          <p className="text-xs font-semibold uppercase tracking-widest text-amber-600 mb-3">{current.classroom.title}</p>

          {/* Congrats banner for #1 */}
          {top1 && (
            <motion.div
              key={`${current.classroom.id}-${congrats}`}
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              className="flex items-center gap-2 mb-3 rounded-xl bg-amber-100/80 border border-amber-200 px-3 py-2"
            >
              <PartyPopper size={16} className="text-amber-500 flex-shrink-0" />
              <p className="text-sm text-amber-800">
                <span className="capitalize font-semibold">{congrats}</span>, <strong>{top1.full_name}</strong>! 🎉
              </p>
            </motion.div>
          )}

          {/* Podium */}
          <div className="space-y-2">
            {current.top3.map((entry, i) => {
              const style = RANK_STYLE[Math.min(i, 2)]
              return (
                <div key={entry.student_id} className={`flex items-center gap-3 rounded-xl border border-slate-100 px-3 py-2 ${style.bg}`}>
                  <span className="text-lg w-6 text-center flex-shrink-0">{style.medal}</span>
                  <div className={`rounded-full ring-2 ${style.ring} flex-shrink-0`}>
                    <Avatar avatarUrl={entry.avatar_url ?? undefined} name={entry.full_name} size={32} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-700 truncate flex items-center gap-1">
                      {i === 0 && <Crown size={13} className="text-amber-500 flex-shrink-0" />}
                      {entry.full_name}
                    </p>
                  </div>
                  <span className={`flex items-center gap-1 text-sm font-bold ${style.text} flex-shrink-0`}>
                    <Star size={13} /> {entry.points}
                  </span>
                </div>
              )
            })}
          </div>
        </motion.div>
      </AnimatePresence>
    </section>
  )
}
