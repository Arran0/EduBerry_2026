'use client'

import React from 'react'
import { CheckCircle2, XCircle, Clock3, BookOpen, ShieldCheck, CalendarDays } from 'lucide-react'
import { AttendanceSummary } from '@/lib/attendance'

interface AttendanceSummaryProps {
  summary: AttendanceSummary
  label?: string
  sublabel?: string
}

interface StatConfig {
  key: keyof AttendanceSummary
  label: string
  Icon: React.ElementType
  bg: string
  text: string
  dot: string
}

const STATS: StatConfig[] = [
  { key: 'total_days', label: 'Total',   Icon: CalendarDays,  bg: 'bg-slate-100',   text: 'text-slate-700',   dot: 'bg-slate-400' },
  { key: 'present',    label: 'Present', Icon: CheckCircle2,  bg: 'bg-emerald-100', text: 'text-emerald-700', dot: 'bg-emerald-400' },
  { key: 'absent',     label: 'Absent',  Icon: XCircle,       bg: 'bg-rose-100',    text: 'text-rose-700',    dot: 'bg-rose-400' },
  { key: 'late',       label: 'Late',    Icon: Clock3,        bg: 'bg-amber-100',   text: 'text-amber-700',   dot: 'bg-amber-400' },
  { key: 'on_leave',   label: 'Leave',   Icon: BookOpen,      bg: 'bg-sky-100',     text: 'text-sky-700',     dot: 'bg-sky-400' },
  { key: 'excused',    label: 'Excused', Icon: ShieldCheck,   bg: 'bg-violet-100',  text: 'text-violet-700',  dot: 'bg-violet-400' },
]

function ringColor(pct: number): string {
  if (pct >= 85) return '#10b981'
  if (pct >= 75) return '#f59e0b'
  return '#f43f5e'
}

function ringTrackColor(pct: number): string {
  if (pct >= 85) return '#d1fae5'
  if (pct >= 75) return '#fef3c7'
  return '#ffe4e6'
}

function rateLabel(pct: number): { text: string; color: string } {
  if (pct >= 85) return { text: 'Excellent', color: 'text-emerald-600' }
  if (pct >= 75) return { text: 'Fair',      color: 'text-amber-500' }
  return { text: 'Low',       color: 'text-rose-500' }
}

export default function AttendanceSummaryCard({ summary, label, sublabel }: AttendanceSummaryProps) {
  const { present_pct } = summary
  const radius = 30
  const circumference = 2 * Math.PI * radius
  const progress = circumference - (present_pct / 100) * circumference
  const color = ringColor(present_pct)
  const trackColor = ringTrackColor(present_pct)
  const { text: rateText, color: rateColor } = rateLabel(present_pct)

  return (
    <div className="rounded-2xl overflow-hidden shadow-sm border border-slate-200 bg-white">

      {/* ── Gradient header ── */}
      <div className="px-4 py-3 bg-gradient-to-r from-violet-600 to-purple-500">
        {sublabel && (
          <p className="text-[10px] font-semibold text-violet-200 uppercase tracking-widest mb-0.5">{sublabel}</p>
        )}
        {label && (
          <p className="text-sm font-bold text-white">{label}</p>
        )}
      </div>

      {/* ── Main body ── */}
      <div className="p-4">

        {/* Circular progress + rate info */}
        <div className="flex items-center gap-4 mb-4 pb-4 border-b border-slate-100">
          <div className="relative flex-shrink-0 w-[72px] h-[72px]">
            <svg className="w-full h-full -rotate-90" viewBox="0 0 72 72">
              <circle
                cx="36" cy="36" r={radius}
                fill="none"
                stroke={trackColor}
                strokeWidth="6"
              />
              <circle
                cx="36" cy="36" r={radius}
                fill="none"
                stroke={color}
                strokeWidth="6"
                strokeDasharray={circumference}
                strokeDashoffset={progress}
                strokeLinecap="round"
                className="transition-all duration-700"
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-base font-extrabold leading-none" style={{ color }}>{present_pct}%</span>
            </div>
          </div>

          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-slate-800">Attendance Rate</p>
            <span className={`text-xs font-semibold ${rateColor}`}>{rateText}</span>
            <p className="text-[10px] text-slate-400 mt-0.5">Leave days excluded</p>
          </div>
        </div>

        {/* Stat grid */}
        <div className="grid grid-cols-3 gap-2">
          {STATS.map(({ key, label: statLabel, Icon, bg, text }) => (
            <div key={key} className={`flex flex-col items-center gap-1 py-2 px-1.5 rounded-xl ${bg}`}>
              <Icon size={13} className={text} />
              <span className={`text-base font-extrabold leading-none ${text}`}>{summary[key]}</span>
              <span className={`text-[9px] font-semibold uppercase tracking-wide ${text} opacity-80`}>{statLabel}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
