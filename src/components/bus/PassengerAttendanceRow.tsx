'use client'

import React from 'react'
import { motion } from 'framer-motion'
import { Check, ArrowDownToLine, Circle } from 'lucide-react'
import Avatar from '@/components/Avatar'
import { UserProfile } from '@/lib/supabase'
import { TripAttendanceStatus } from '@/lib/bus'

interface PassengerAttendanceRowProps {
  passenger: UserProfile
  status: TripAttendanceStatus
  busy?: boolean
  onCycle: () => void
}

// Visual config per status. 'absent' covers the unmarked/waiting state.
const STATUS_UI: Record<TripAttendanceStatus, {
  label: string
  chip: string
  ring: string
  icon: React.ReactNode
}> = {
  absent: {
    label: 'Waiting',
    chip: 'bg-slate-100 text-slate-500',
    ring: 'border-slate-200',
    icon: <Circle size={16} className="text-slate-300" />,
  },
  picked_up: {
    label: 'Picked up',
    chip: 'bg-emerald-100 text-emerald-700',
    ring: 'border-emerald-300',
    icon: <Check size={16} className="text-emerald-600" />,
  },
  dropped: {
    label: 'Dropped',
    chip: 'bg-blue-100 text-blue-700',
    ring: 'border-blue-300',
    icon: <ArrowDownToLine size={16} className="text-blue-600" />,
  },
}

export default function PassengerAttendanceRow({
  passenger, status, busy, onCycle,
}: PassengerAttendanceRowProps) {
  const ui = STATUS_UI[status]
  return (
    <motion.button
      type="button"
      onClick={onCycle}
      disabled={busy}
      whileTap={{ scale: 0.98 }}
      className={`w-full flex items-center gap-3 bg-white rounded-2xl p-3 border ${ui.ring} shadow-sm text-left transition-colors disabled:opacity-60`}
    >
      <Avatar avatarUrl={passenger.avatar_url} name={passenger.full_name} size={40} userId={passenger.id} />
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-slate-800 text-sm truncate">{passenger.full_name}</p>
        {passenger.role === 'student' && passenger.grade && (
          <p className="text-[11px] text-slate-400">
            Grade {passenger.grade}{passenger.section ? ` · ${passenger.section}` : ''}
          </p>
        )}
      </div>
      <span className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full ${ui.chip}`}>
        {ui.icon}
        {ui.label}
      </span>
    </motion.button>
  )
}
