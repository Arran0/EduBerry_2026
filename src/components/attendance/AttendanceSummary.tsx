'use client'

import React from 'react'
import { CheckCircle2, XCircle, BookOpen, Briefcase, CalendarDays, TrendingUp } from 'lucide-react'
import { AttendanceSummary } from '@/lib/attendance'

interface AttendanceSummaryProps {
  summary: AttendanceSummary
  label?: string
  sublabel?: string
}

const STATS = [
  { key: 'total_days' as const,  label: 'Total',   Icon: CalendarDays, from: '#64748b', to: '#475569' },
  { key: 'present'    as const,  label: 'Present', Icon: CheckCircle2, from: '#10b981', to: '#059669' },
  { key: 'absent'     as const,  label: 'Absent',  Icon: XCircle,      from: '#f43f5e', to: '#e11d48' },
  { key: 'on_leave'   as const,  label: 'OL',      Icon: BookOpen,     from: '#0ea5e9', to: '#0284c7' },
  { key: 'on_duty'    as const,  label: 'OD',      Icon: Briefcase,    from: '#14b8a6', to: '#0d9488' },
]

function rateInfo(pct: number) {
  if (pct >= 90) return { label: 'Excellent', color: '#10b981', track: '#d1fae5', ring: '#10b981' }
  if (pct >= 75) return { label: 'Good',      color: '#f59e0b', track: '#fef3c7', ring: '#f59e0b' }
  return           { label: 'Low',         color: '#f43f5e', track: '#ffe4e6', ring: '#f43f5e' }
}

export default function AttendanceSummaryCard({ summary, label, sublabel }: AttendanceSummaryProps) {
  const { present_pct } = summary
  const info = rateInfo(present_pct)
  const R = 28
  const circ = 2 * Math.PI * R
  const offset = circ - (present_pct / 100) * circ

  return (
    <div className="rounded-2xl overflow-hidden border border-slate-200 shadow-sm bg-white">

      {/* ── Header with gradient ── */}
      <div className="px-4 pt-4 pb-5 bg-gradient-to-br from-violet-600 via-purple-600 to-indigo-600 relative overflow-hidden">
        {/* Subtle bg pattern circle */}
        <div className="absolute -right-8 -top-8 w-32 h-32 rounded-full bg-white/10" />
        <div className="absolute -right-2 bottom-0 w-16 h-16 rounded-full bg-white/[0.07]" />

        <div className="relative z-10 flex items-end justify-between">
          {/* Labels */}
          <div>
            {sublabel && <p className="text-violet-300 text-[10px] font-semibold uppercase tracking-widest mb-0.5">{sublabel}</p>}
            {label   && <p className="text-white text-sm font-bold">{label}</p>}
          </div>

          {/* Rate badge */}
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/15 border border-white/20">
            <TrendingUp size={11} className="text-white/80" />
            <span className="text-white text-[11px] font-semibold">{info.label}</span>
          </div>
        </div>
      </div>

      {/* ── Attendance ring + percentage ── */}
      <div className="px-4 py-4 border-b border-slate-100 flex items-center gap-4">
        <div className="relative flex-shrink-0 w-[68px] h-[68px]">
          <svg className="w-full h-full -rotate-90" viewBox="0 0 72 72">
            <circle cx="36" cy="36" r={R} fill="none" stroke={info.track} strokeWidth="6" />
            <circle
              cx="36" cy="36" r={R} fill="none"
              stroke={info.ring} strokeWidth="6"
              strokeDasharray={circ} strokeDashoffset={offset}
              strokeLinecap="round"
              className="transition-all duration-700"
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-base font-extrabold leading-none" style={{ color: info.color }}>
              {present_pct}%
            </span>
          </div>
        </div>

        <div>
          <p className="text-sm font-bold text-slate-800">Attendance Rate</p>
          <p className="text-[11px] text-slate-400 mt-0.5">Excluding leave days</p>
          <div className="flex items-center gap-1 mt-1.5">
            <div className="h-1.5 rounded-full flex-1 bg-slate-100" style={{ maxWidth: 80 }}>
              <div className="h-full rounded-full transition-all duration-700"
                style={{ width: `${present_pct}%`, background: info.color }} />
            </div>
          </div>
        </div>
      </div>

      {/* ── Stat grid ── */}
      <div className="grid grid-cols-3 gap-px bg-slate-100">
        {STATS.map(({ key, label: statLabel, Icon, from, to }) => (
          <div key={key} className="bg-white flex flex-col items-center gap-1 py-3 px-2">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center mb-0.5"
              style={{ background: `linear-gradient(135deg, ${from}20, ${to}20)` }}>
              <Icon size={14} style={{ color: from }} />
            </div>
            <span className="text-lg font-extrabold leading-none text-slate-800">{summary[key]}</span>
            <span className="text-[9px] font-semibold uppercase tracking-wide text-slate-400">{statLabel}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
