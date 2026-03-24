'use client'

import React from 'react'
import { CalendarDays, CheckCircle, Clock } from 'lucide-react'
import { LeaveStats } from '@/lib/leave'

interface LeaveStatsCardProps {
  stats: LeaveStats
}

export default function LeaveStatsCard({ stats }: LeaveStatsCardProps) {
  return (
    <div className="glass rounded-2xl p-5">
      <div className="flex items-center gap-2 mb-4">
        <CalendarDays size={18} className="text-rose-500" />
        <h3 className="font-bold text-slate-800 text-sm">My Leave Summary</h3>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-slate-50 rounded-xl p-3 text-center">
          <p className="text-2xl font-bold text-slate-800">{stats.applied}</p>
          <p className="text-xs text-slate-500 mt-0.5">Applied</p>
        </div>
        <div className="bg-amber-50 rounded-xl p-3 text-center">
          <Clock size={14} className="text-amber-500 mx-auto mb-0.5" />
          <p className="text-2xl font-bold text-amber-700">{stats.pending}</p>
          <p className="text-xs text-amber-600 mt-0.5">Pending</p>
        </div>
        <div className="bg-green-50 rounded-xl p-3 text-center">
          <CheckCircle size={14} className="text-green-500 mx-auto mb-0.5" />
          <p className="text-2xl font-bold text-green-700">{stats.approved}</p>
          <p className="text-xs text-green-600 mt-0.5">Approved</p>
        </div>
      </div>
    </div>
  )
}
