'use client'

import React from 'react'
import { CalendarDays } from 'lucide-react'
import { LeaveStats } from '@/lib/leave'

interface LeaveStatsCardProps {
  stats: LeaveStats
}

export default function LeaveStatsCard({ stats }: LeaveStatsCardProps) {
  return (
    <div className="glass-strong rounded-2xl p-3.5">
      <div className="flex items-center gap-2 mb-3">
        <CalendarDays size={15} className="text-rose-500" />
        <h3 className="font-bold text-slate-800 text-xs uppercase tracking-wide">Leave Summary</h3>
      </div>
      <div className="grid grid-cols-4 gap-2">
        <div className="bg-slate-50 rounded-xl p-2.5 text-center">
          <p className="text-xl font-bold text-slate-700">{stats.applied}</p>
          <p className="text-[10px] text-slate-500 mt-0.5">Total</p>
        </div>
        <div className="bg-amber-50 rounded-xl p-2.5 text-center">
          <p className="text-xl font-bold text-amber-700">{stats.pending}</p>
          <p className="text-[10px] text-amber-600 mt-0.5">Pending</p>
        </div>
        <div className="bg-green-50 rounded-xl p-2.5 text-center">
          <p className="text-xl font-bold text-green-700">{stats.approved}</p>
          <p className="text-[10px] text-green-600 mt-0.5">Approved</p>
        </div>
        <div className="bg-red-50 rounded-xl p-2.5 text-center">
          <p className="text-xl font-bold text-red-700">{stats.rejected}</p>
          <p className="text-[10px] text-red-600 mt-0.5">Rejected</p>
        </div>
      </div>
    </div>
  )
}
