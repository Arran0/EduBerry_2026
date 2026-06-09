'use client'

import React from 'react'
import { AttendanceSummary } from '@/lib/attendance'

interface AttendanceSummaryProps {
  summary: AttendanceSummary
  label?: string
  sublabel?: string
}

const STAT_PILLS: { key: keyof AttendanceSummary; label: string; color: string }[] = [
  { key: 'total_days', label: 'Total',    color: 'bg-slate-100 text-slate-700' },
  { key: 'present',    label: 'Present',  color: 'bg-green-100 text-green-700' },
  { key: 'absent',     label: 'Absent',   color: 'bg-red-100 text-red-700' },
  { key: 'late',       label: 'Late',     color: 'bg-amber-100 text-amber-700' },
  { key: 'on_leave',   label: 'Leave',    color: 'bg-blue-100 text-blue-700' },
  { key: 'excused',    label: 'Excused',  color: 'bg-purple-100 text-purple-700' },
]

function pctColor(pct: number) {
  if (pct >= 85) return 'text-green-600'
  if (pct >= 75) return 'text-amber-500'
  return 'text-red-500'
}

function pctRingColor(pct: number) {
  if (pct >= 85) return 'stroke-green-500'
  if (pct >= 75) return 'stroke-amber-400'
  return 'stroke-red-500'
}

export default function AttendanceSummaryCard({ summary, label, sublabel }: AttendanceSummaryProps) {
  const { present_pct } = summary
  const radius = 28
  const circumference = 2 * Math.PI * radius
  const progress = circumference - (present_pct / 100) * circumference

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
      {(sublabel || label) && (
        <div className="mb-3 pb-3 border-b border-slate-100">
          {sublabel && <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-0.5">{sublabel}</p>}
          {label && <p className="text-sm font-semibold text-slate-700">{label}</p>}
        </div>
      )}

      <div className="flex items-center gap-4">
        {/* Circular progress */}
        <div className="relative flex-shrink-0 w-16 h-16">
          <svg className="w-16 h-16 -rotate-90" viewBox="0 0 72 72">
            <circle cx="36" cy="36" r={radius} fill="none" stroke="#f1f5f9" strokeWidth="6" />
            <circle
              cx="36" cy="36" r={radius}
              fill="none"
              strokeWidth="6"
              strokeDasharray={circumference}
              strokeDashoffset={progress}
              strokeLinecap="round"
              className={`transition-all duration-500 ${pctRingColor(present_pct)}`}
            />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <span className={`text-sm font-bold leading-none ${pctColor(present_pct)}`}>
              {present_pct}%
            </span>
          </div>
        </div>

        <div className="flex-1 min-w-0">
          <p className="font-semibold text-slate-800 text-sm">Attendance Rate</p>
          <p className="text-[11px] text-slate-400 mt-0.5">Leave days excluded from calculation</p>
        </div>
      </div>

      {/* Stat pills */}
      <div className="flex flex-wrap gap-2 mt-3">
        {STAT_PILLS.map(({ key, label: pillLabel, color }) => (
          <div key={key} className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${color}`}>
            <span>{pillLabel}</span>
            <span className="font-bold">{summary[key]}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
