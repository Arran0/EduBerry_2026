'use client'

import React, { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Trophy, Star, PartyPopper } from 'lucide-react'
import { Classroom } from '@/lib/classrooms'
import { fetchClassroomTop3, ClassroomTop3Entry } from '@/lib/smartboard'

const CONGRATS = [
  'Congratulations',
  'Way to go',
  'Outstanding work',
  'Superb effort',
  'You’re on fire',
  'Brilliant job',
  'Keep shining',
  'Top of the class',
  'Phenomenal',
  'Champion stuff',
]

// 7 seconds on each classroom, per spec.
const ROTATE_MS = 7000

interface BoardData {
  classroom: Classroom
  top3: ClassroomTop3Entry[]
}

const RANK_TEXT = ['text-amber-600', 'text-slate-500', 'text-orange-600']

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
      // Loop through every classroom the board belongs to (even ones with no
      // points yet — they show an encouraging placeholder).
      boardsRef.current = results
      setBoards(results)
      setIndex(0)
      setCongrats(CONGRATS[Math.floor(Math.random() * CONGRATS.length)])
      setLoading(false)
    })
    return () => { active = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classroomKey])

  // Rotate every 7s; reshuffle the congrats line on each change.
  useEffect(() => {
    if (boards.length <= 1) return
    const t = setInterval(() => {
      setIndex(i => (i + 1) % boardsRef.current.length)
      setCongrats(CONGRATS[Math.floor(Math.random() * CONGRATS.length)])
    }, ROTATE_MS)
    return () => clearInterval(t)
  }, [boards.length])

  if (loading) {
    return (
      <section className="rounded-2xl border border-amber-200 bg-gradient-to-br from-amber-50 to-white p-5 shadow-sm">
        <div className="h-4 w-32 bg-amber-100 rounded animate-pulse mb-4" />
        <div className="h-3 w-24 bg-amber-100/70 rounded animate-pulse mb-3" />
        <div className="space-y-2">
          {[0, 1, 2].map(i => (
            <div key={i} className="h-7 bg-amber-100/60 rounded-lg animate-pulse" />
          ))}
        </div>
      </section>
    )
  }

  if (boards.length === 0) return null

  const current = boards[Math.min(index, boards.length - 1)]
  const top1 = current.top3[0]

  return (
    <section className="relative overflow-hidden rounded-2xl border border-amber-200 bg-gradient-to-br from-amber-50 to-white p-5 shadow-sm min-h-[220px] flex flex-col">
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
          transition={{ duration: 0.4 }}
          className="flex-1"
        >
          {/* Classroom name heading */}
          <p className="text-sm font-bold text-slate-800 mb-2">
            {current.classroom.title}<span className="text-amber-600">:</span>
          </p>

          {/* Congrats for #1 */}
          {top1 && (
            <motion.div
              key={`${current.classroom.id}-${congrats}`}
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              className="flex items-center gap-2 mb-3 rounded-xl bg-amber-100/80 border border-amber-200 px-3 py-2"
            >
              <PartyPopper size={15} className="text-amber-500 flex-shrink-0" />
              <p className="text-sm text-amber-800 leading-snug">
                <span className="font-semibold">{congrats}</span>, <strong>{top1.full_name}</strong>! 🎉
              </p>
            </motion.div>
          )}

          {/* Numbered top-3 list */}
          {current.top3.length === 0 ? (
            <p className="text-sm text-slate-400 italic">No EduPoints earned yet — be the first!</p>
          ) : (
            <ol className="space-y-1.5">
              {current.top3.map((entry, i) => (
                <li key={entry.student_id} className="flex items-center gap-2.5">
                  <span className={`w-5 text-right font-bold tabular-nums ${RANK_TEXT[Math.min(i, 2)]}`}>{i + 1}.</span>
                  <span className="flex-1 min-w-0 truncate text-sm font-medium text-slate-700">{entry.full_name}</span>
                  <span className="flex items-center gap-1 text-sm font-bold text-amber-600 flex-shrink-0">
                    <Star size={13} /> {entry.points}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </motion.div>
      </AnimatePresence>
    </section>
  )
}
