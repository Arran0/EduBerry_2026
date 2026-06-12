'use client'

import React from 'react'
import { Sparkles } from 'lucide-react'
import type { TimetableConfig } from '@/lib/timetable'

// Placeholder — the constraint solver, editable grid, and publish flow are
// implemented in Round 3.
export default function GenerateTab({ config }: { config: TimetableConfig }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-10 text-center">
      <div className="w-14 h-14 mx-auto rounded-2xl bg-indigo-50 flex items-center justify-center mb-4">
        <Sparkles className="w-7 h-7 text-indigo-500" strokeWidth={1.5} />
      </div>
      <h2 className="font-display text-lg font-semibold text-slate-800">Generate &amp; publish</h2>
      <p className="text-slate-500 text-sm mt-1 max-w-md mx-auto">
        The automatic generator for <strong>{config.name}</strong> arrives next. It will read your
        period slots, requirements, and teacher availability to build a conflict-free timetable you
        can fine-tune and publish.
      </p>
    </div>
  )
}
