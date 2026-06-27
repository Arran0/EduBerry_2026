'use client'

import React from 'react'
import { Calendar, Briefcase, Heart } from 'lucide-react'

interface LeaveBalanceCardProps {
  casual: { used: number; total: number }
  medical: { used: number; total: number }
}

export default function LeaveBalanceCard({ casual, medical }: LeaveBalanceCardProps) {
  const casualRemaining = casual.total - casual.used
  const medicalRemaining = medical.total - medical.used

  const casualPercent = (casual.used / casual.total) * 100
  const medicalPercent = (medical.used / medical.total) * 100

  return (
    <div className="glass-strong rounded-2xl p-3.5">
      <div className="flex items-center gap-2 mb-3">
        <Calendar size={15} className="text-mps-blue-600" />
        <h3 className="font-bold text-slate-800 text-xs uppercase tracking-wide">Leave Balance</h3>
        <span className="text-[10px] text-slate-400 ml-auto">{new Date().getFullYear()}</span>
      </div>

      <div className="space-y-3">
        {/* Casual Leave */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-1.5">
              <Briefcase size={12} className="text-blue-600" />
              <span className="font-medium text-slate-700">Casual (CL)</span>
            </div>
            <div>
              <span className="font-bold text-slate-800">{casualRemaining}</span>
              <span className="text-slate-400"> / {casual.total} days</span>
            </div>
          </div>
          <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                casualPercent > 80 ? 'bg-red-500' : casualPercent > 50 ? 'bg-amber-500' : 'bg-blue-500'
              }`}
              style={{ width: `${casualPercent}%` }}
            />
          </div>
          <p className="text-[10px] text-slate-400">{casual.used} day{casual.used !== 1 ? 's' : ''} used</p>
        </div>

        {/* Medical Leave */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-1.5">
              <Heart size={12} className="text-purple-600" />
              <span className="font-medium text-slate-700">Medical</span>
            </div>
            <div>
              <span className="font-bold text-slate-800">{medicalRemaining}</span>
              <span className="text-slate-400"> / {medical.total} days</span>
            </div>
          </div>
          <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                medicalPercent > 80 ? 'bg-red-500' : medicalPercent > 50 ? 'bg-amber-500' : 'bg-purple-500'
              }`}
              style={{ width: `${medicalPercent}%` }}
            />
          </div>
          <p className="text-[10px] text-slate-400">{medical.used} day{medical.used !== 1 ? 's' : ''} used</p>
        </div>
      </div>
    </div>
  )
}
