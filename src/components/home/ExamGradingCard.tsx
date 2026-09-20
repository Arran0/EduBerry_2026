'use client'

import React from 'react'
import Link from 'next/link'
import { ClipboardCheck, ChevronRight } from 'lucide-react'
import { type GraderExamProgress } from '@/lib/exam'

interface ExamGradingCardProps {
  /** Exams under grading that this user grades. */
  queues: GraderExamProgress[]
}

/** Staff card: for each exam the user grades that is under grading, shows how
 *  many submissions are graded vs still to grade, linking to the exam's
 *  grading tab. The mobile carousel only carries this card when a queue is
 *  waiting; the desktop dashboard shows it either way, so an empty queue says
 *  so rather than leaving the card blank. */
export default function ExamGradingCard({ queues }: ExamGradingCardProps) {
  return (
    <div className="home-card pro-card h-[260px] overflow-hidden flex flex-col">
      <div className="px-5 pt-4 pb-3 border-b border-slate-200 flex items-center gap-2">
        <ClipboardCheck size={16} className="text-indigo-500" />
        <span className="text-sm font-bold text-slate-700">Grading</span>
      </div>
      {queues.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center">
          <div className="w-12 h-12 bg-slate-100 flex items-center justify-center mb-3">
            <ClipboardCheck size={22} className="text-slate-300" />
          </div>
          <p className="text-sm font-medium text-slate-400">Nothing to grade</p>
          <p className="text-xs text-slate-300 mt-1">You&apos;re up to date</p>
        </div>
      ) : (
      <div className="flex-1 overflow-y-auto scrollbar-hide divide-y divide-slate-200">
        {queues.map(q => {
          const total = q.gradedCount + q.toGradeCount
          const pct = total > 0 ? Math.round((q.gradedCount / total) * 100) : 0
          return (
            <Link key={q.examId} href={`/more/exam/${q.examId}?tab=grading`}>
              <div className="home-card-row px-5 py-3 hover:bg-slate-50 transition-colors group cursor-pointer">
                <div className="flex items-center gap-2 mb-1.5">
                  <h4 className="flex-1 min-w-0 font-semibold text-slate-800 text-sm truncate group-hover:text-slate-900 transition-colors">{q.title}</h4>
                  <ChevronRight size={14} className="flex-shrink-0 text-slate-300 transition-all duration-200 group-hover:text-slate-500 group-hover:translate-x-0.5" />
                </div>
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="text-[11px] font-semibold text-emerald-600">{q.gradedCount} graded</span>
                  <span className="text-slate-300">·</span>
                  <span className="text-[11px] font-semibold text-amber-600">{q.toGradeCount} to grade</span>
                </div>
                <div className="h-1.5 bg-slate-200/70 overflow-hidden">
                  <div className="h-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />
                </div>
              </div>
            </Link>
          )
        })}
      </div>
      )}
    </div>
  )
}
