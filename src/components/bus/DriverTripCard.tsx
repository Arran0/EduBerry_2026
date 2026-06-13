'use client'

import React from 'react'
import Link from 'next/link'
import { motion } from 'framer-motion'
import { Bus, ChevronRight, Users } from 'lucide-react'
import { BusTrip } from '@/lib/bus'

interface DriverTripCardProps {
  trip: BusTrip
  pickedUp: number
  dropped: number
  total: number
  /** True when this driver is covering the trip via a per-date override. */
  isSubstitute?: boolean
}

function fmtTime(t?: string | null): string | null {
  if (!t) return null
  const [h, m] = t.split(':')
  const hour = parseInt(h, 10)
  const ampm = hour >= 12 ? 'PM' : 'AM'
  const h12 = hour % 12 === 0 ? 12 : hour % 12
  return `${h12}:${m} ${ampm}`
}

export default function DriverTripCard({ trip, pickedUp, dropped, total, isSubstitute }: DriverTripCardProps) {
  const handled = Math.min(pickedUp + dropped, total)
  const pct = total > 0 ? Math.round((handled / total) * 100) : 0
  const pickup = fmtTime(trip.pickup_time)

  return (
    <Link href={`/driver/trip/${trip.id}`}>
      <motion.div
        whileTap={{ scale: 0.99 }}
        className="bg-white rounded-2xl p-4 border border-slate-200 shadow-sm hover:shadow-md transition-shadow"
      >
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-orange-500 to-amber-600 flex items-center justify-center flex-shrink-0">
            <Bus size={20} className="text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <p className="font-semibold text-slate-800 truncate">{trip.name}</p>
              {isSubstitute && (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-medium flex-shrink-0">
                  Substitute
                </span>
              )}
            </div>
            <p className="text-xs text-slate-400 flex items-center gap-1.5 mt-0.5">
              <Users size={12} /> {total} passenger{total === 1 ? '' : 's'}
              {pickup && <span>· Pickup {pickup}</span>}
            </p>
          </div>
          <ChevronRight size={18} className="text-slate-300 flex-shrink-0" />
        </div>

        <div className="mt-3 flex items-center gap-2">
          <div className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden">
            <div className="h-full rounded-full bg-gradient-to-r from-orange-500 to-amber-500" style={{ width: `${pct}%` }} />
          </div>
          <span className="text-xs font-semibold text-slate-500 tabular-nums">{handled}/{total}</span>
        </div>
      </motion.div>
    </Link>
  )
}
