'use client'

import React, { useEffect, useState } from 'react'
import Link from 'next/link'
import { ClipboardList, ChevronRight } from 'lucide-react'
import { ClassroomWithDetails, ClassroomAssessment, fetchAssessments } from '@/lib/classrooms'
import { SkeletonRows } from './HomeCardSkeletons'

interface MiniAssessment {
  assessment: ClassroomAssessment
  classroomId: string
  classroomTitle: string
}

const TAG_COLORS: Record<ClassroomAssessment['tag'], string> = {
  main: 'bg-amber-500',
  other: 'bg-slate-400',
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return 'No date'
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

interface LatestAssessmentsMiniListProps {
  classrooms: ClassroomWithDetails[]
}

/** The 5 most recently released assessments across a student's classrooms,
 *  each a button leading to that classroom's assessments tab. */
export default function LatestAssessmentsMiniList({ classrooms }: LatestAssessmentsMiniListProps) {
  const [items, setItems] = useState<MiniAssessment[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    if (classrooms.length === 0) { setItems([]); setLoading(false); return }
    setLoading(true)
    Promise.all(classrooms.map(c => fetchAssessments(c.id).then(list => list.map(a => ({
      assessment: a,
      classroomId: c.id,
      classroomTitle: c.title,
    })))))
      .then(arrays => {
        if (cancelled) return
        const flat = arrays.flat().sort((a, b) => {
          const aTime = a.assessment.date ? new Date(a.assessment.date).getTime() : new Date(a.assessment.created_at).getTime()
          const bTime = b.assessment.date ? new Date(b.assessment.date).getTime() : new Date(b.assessment.created_at).getTime()
          return bTime - aTime
        })
        setItems(flat.slice(0, 5))
      })
      .catch(err => {
        console.error('Failed to load latest assessments for home card:', err)
        if (!cancelled) setItems([])
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [classrooms])

  return (
    <div className="home-card glass-card rounded-[1.4rem] h-[260px] overflow-hidden flex flex-col">
      {loading ? (
        <SkeletonRows rows={4} />
      ) : items.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center">
          <div className="w-12 h-12 rounded-2xl bg-white/50 flex items-center justify-center mb-3">
            <ClipboardList size={22} className="text-slate-300" />
          </div>
          <p className="text-sm font-medium text-slate-400">No assessments yet</p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto scrollbar-hide divide-y divide-white/25">
          {items.map(({ assessment, classroomId, classroomTitle }) => (
            <Link key={assessment.id} href={`/classrooms/${classroomId}?tab=assessments`}>
              <div className="home-card-row flex items-center gap-3 px-5 py-3.5 hover:bg-white/45 transition-colors group cursor-pointer">
                <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${TAG_COLORS[assessment.tag]}`} />
                <div className="flex-1 min-w-0">
                  <h4 className="font-semibold text-slate-800 text-sm truncate group-hover:text-slate-900 transition-colors">{assessment.title}</h4>
                  <p className="text-[11px] text-slate-400 truncate">{classroomTitle}</p>
                </div>
                <span className="flex-shrink-0 text-[11px] font-medium px-2 py-0.5 rounded-full bg-white/55 text-slate-500 group-hover:bg-white/80 transition-colors">
                  {formatDate(assessment.date)}
                </span>
                <ChevronRight size={14} className="flex-shrink-0 text-slate-300 transition-all duration-200 group-hover:text-slate-500 group-hover:translate-x-0.5" />
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
