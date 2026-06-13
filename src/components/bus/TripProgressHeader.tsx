'use client'

import React from 'react'
import { motion } from 'framer-motion'
import { Users, CheckCircle2, MapPin } from 'lucide-react'

interface TripProgressHeaderProps {
  tripName: string
  pickupTime?: string | null
  dropTime?: string | null
  pickedUp: number
  dropped: number
  total: number
}

function fmtTime(t?: string | null): string | null {
  if (!t) return null
  // t is "HH:MM[:SS]" — render as 12-hour.
  const [h, m] = t.split(':')
  const hour = parseInt(h, 10)
  const ampm = hour >= 12 ? 'PM' : 'AM'
  const h12 = hour % 12 === 0 ? 12 : hour % 12
  return `${h12}:${m} ${ampm}`
}

export default function TripProgressHeader({
  tripName, pickupTime, dropTime, pickedUp, dropped, total,
}: TripProgressHeaderProps) {
  // Progress = passengers no longer waiting (picked up or dropped).
  const handled = Math.min(pickedUp + dropped, total)
  const pct = total > 0 ? Math.round((handled / total) * 100) : 0
  const pickup = fmtTime(pickupTime)
  const drop = fmtTime(dropTime)

  return (
    <div className="bg-gradient-to-br from-orange-500 to-amber-600 rounded-2xl p-5 text-white shadow-lg">
      <h2 className="text-xl font-bold leading-tight">{tripName}</h2>
      {(pickup || drop) && (
        <p className="text-white/80 text-xs mt-1 flex items-center gap-1.5">
          <MapPin size={12} />
          {pickup && <span>Pickup {pickup}</span>}
          {pickup && drop && <span>·</span>}
          {drop && <span>Drop {drop}</span>}
        </p>
      )}

      {/* Big handled / total counter */}
      <div className="flex items-end gap-2 mt-4">
        <span className="text-5xl font-extrabold leading-none tabular-nums">{handled}</span>
        <span className="text-xl font-semibold text-white/70 mb-1">/ {total}</span>
        <span className="text-sm text-white/80 mb-1.5 ml-1">handled</span>
      </div>

      {/* Progress bar */}
      <div className="mt-3 h-2.5 rounded-full bg-white/25 overflow-hidden">
        <motion.div
          className="h-full rounded-full bg-white"
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ type: 'spring', stiffness: 120, damping: 20 }}
        />
      </div>

      {/* Breakdown */}
      <div className="flex items-center gap-4 mt-3 text-xs">
        <span className="flex items-center gap-1.5">
          <Users size={14} className="text-white/80" /> {pickedUp} picked up
        </span>
        <span className="flex items-center gap-1.5">
          <CheckCircle2 size={14} className="text-white/80" /> {dropped} dropped
        </span>
      </div>
    </div>
  )
}
