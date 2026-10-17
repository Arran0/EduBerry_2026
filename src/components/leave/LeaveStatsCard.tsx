'use client'

import React from 'react'
import { LeaveStats } from '@/lib/leave'

interface LeaveStatsCardProps {
  stats: LeaveStats
}

const ITEMS = [
  { key: 'applied',  label: 'Applied',  dot: '#64748b' },
  { key: 'pending',  label: 'Pending',  dot: '#f59e0b' },
  { key: 'approved', label: 'Approved', dot: '#10b981' },
  { key: 'rejected', label: 'Rejected', dot: '#f43f5e' },
] as const

/**
 * The applicant's tally, read left to right like a status bar: four figures in
 * one solid strip, and under them a single bar splitting what has been asked
 * for into approved / pending / rejected. Solid rather than frosted — this sits
 * inside a popup, and frosted layers under popups are what flashed black.
 */
export default function LeaveStatsCard({ stats }: LeaveStatsCardProps) {
  const decided = stats.approved + stats.pending + stats.rejected
  const share = (n: number) => (decided > 0 ? `${(n / decided) * 100}%` : '0%')

  return (
    <div className="rounded-2xl bg-white ring-1 ring-slate-900/[0.06] shadow-[0_1px_2px_rgba(15,23,42,0.05),0_8px_20px_-14px_rgba(15,23,42,0.25)] overflow-hidden">
      <div className="grid grid-cols-4 divide-x divide-slate-100">
        {ITEMS.map(({ key, label, dot }) => (
          <div key={key} className="px-2 sm:px-3 py-2 min-w-0">
            <div className="flex items-center gap-1 sm:gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: dot }} />
              <span className="text-[10.5px] sm:text-[11px] font-medium text-slate-500 truncate">{label}</span>
            </div>
            <p className="mt-0.5 text-lg font-bold text-slate-900 leading-tight tabular-nums">{stats[key]}</p>
          </div>
        ))}
      </div>
      <div className="flex h-1 bg-slate-100" aria-hidden>
        <span className="h-full transition-[width] duration-500" style={{ width: share(stats.approved), background: '#10b981' }} />
        <span className="h-full transition-[width] duration-500" style={{ width: share(stats.pending), background: '#f59e0b' }} />
        <span className="h-full transition-[width] duration-500" style={{ width: share(stats.rejected), background: '#f43f5e' }} />
      </div>
    </div>
  )
}
