'use client'

import React, { useState } from 'react'
import { Activity, AlertTriangle, AlertCircle, Info, ChevronDown, ChevronUp } from 'lucide-react'
import type { HealthReport } from '@/lib/timetable/health'

const BAND_COLOR: Record<HealthReport['band'], string> = {
  green: '#059669',
  amber: '#d97706',
  red: '#dc2626',
}

const SEVERITY_ICON = {
  critical: AlertTriangle,
  warning: AlertCircle,
  info: Info,
} as const

const SEVERITY_COLOR = {
  critical: 'text-rose-600',
  warning: 'text-amber-600',
  info: 'text-[#71717A]',
} as const

// Compact health-score panel: the score, a component breakdown, and the top issues.
export default function HealthPanel({ report }: { report: HealthReport }) {
  const [open, setOpen] = useState(false)
  const color = BAND_COLOR[report.band]

  return (
    <div className="border border-[#E4E4E7] bg-white">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-[#FAFAF9] transition-colors"
      >
        <Activity size={16} className="flex-shrink-0" style={{ color }} />
        <div className="flex items-baseline gap-1.5 flex-shrink-0">
          <span className="text-xl font-bold tabular-nums" style={{ color }}>{report.score}</span>
          <span className="text-[11px] text-[#A1A1AA]">/100</span>
        </div>
        <span className="text-[10px] font-bold uppercase tracking-widest flex-shrink-0" style={{ color }}>
          {report.band === 'green' ? 'Healthy' : report.band === 'amber' ? 'Needs work' : 'Problems'}
        </span>
        {/* Inline mini bars */}
        <div className="hidden sm:flex items-center gap-1 flex-1 min-w-0 px-2">
          {report.components.map((c) => (
            <div key={c.key} className="flex-1 h-1.5 bg-[#F0F0F0]" title={`${c.label}: ${Math.round(c.score)}`}>
              <div className="h-full" style={{ width: `${c.score}%`, background: c.score >= 80 ? '#059669' : c.score >= 50 ? '#d97706' : '#dc2626' }} />
            </div>
          ))}
        </div>
        {report.hardViolations > 0 && (
          <span className="text-[11px] text-rose-600 font-medium flex-shrink-0">
            {report.hardViolations} blocker{report.hardViolations > 1 ? 's' : ''}
          </span>
        )}
        {open ? <ChevronUp size={15} className="text-[#A1A1AA] flex-shrink-0" /> : <ChevronDown size={15} className="text-[#A1A1AA] flex-shrink-0" />}
      </button>

      {open && (
        <div className="border-t border-[#E4E4E7] p-3 grid gap-4 md:grid-cols-2">
          {/* Component breakdown */}
          <div className="space-y-2">
            <p className="text-[10px] font-bold uppercase tracking-widest text-[#525252]">Breakdown</p>
            {report.components.map((c) => (
              <div key={c.key} className="flex items-center gap-2 text-xs">
                <span className="w-28 flex-shrink-0 text-[#52525B]">{c.label}</span>
                <div className="flex-1 h-2 bg-[#F0F0F0]">
                  <div className="h-full" style={{ width: `${c.score}%`, background: c.score >= 80 ? '#059669' : c.score >= 50 ? '#d97706' : '#dc2626' }} />
                </div>
                <span className="w-8 text-right tabular-nums text-[#71717A]">{Math.round(c.score)}</span>
              </div>
            ))}
          </div>

          {/* Top issues */}
          <div className="space-y-1.5">
            <p className="text-[10px] font-bold uppercase tracking-widest text-[#525252]">Top issues</p>
            {report.issues.length === 0 ? (
              <p className="text-xs text-emerald-600">No issues — this timetable looks great.</p>
            ) : (
              report.issues.map((issue, i) => {
                const Icon = SEVERITY_ICON[issue.severity]
                return (
                  <div key={i} className="flex items-start gap-1.5 text-xs">
                    <Icon size={13} className={`${SEVERITY_COLOR[issue.severity]} flex-shrink-0 mt-0.5`} />
                    <span className="text-[#52525B]">{issue.message}</span>
                  </div>
                )
              })
            )}
          </div>
        </div>
      )}
    </div>
  )
}
