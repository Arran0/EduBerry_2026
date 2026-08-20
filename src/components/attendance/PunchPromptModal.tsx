'use client'

import React from 'react'
import dynamic from 'next/dynamic'
import { X } from 'lucide-react'
import ModalShell from '@/components/ui/ModalShell'
import { EffectiveGeofence } from '@/lib/attendance'
import type { PunchPromptKind } from '@/lib/punchPromptDismissals'

// The very same widget the Staff Attendance page hosts — the popup is that
// section, lifted onto a backdrop, not a re-drawn imitation of it. Loaded on
// demand so the prompt costs nothing on the days it never fires.
const StaffCheckIn = dynamic(() => import('@/components/attendance/StaffCheckIn'), {
  ssr: false,
  loading: () => (
    <div className="rounded-[1.5rem] bg-white border-4 border-[#27272A] p-6 space-y-3">
      <div className="h-5 w-40 bg-[#F5F5F5] rounded-lg animate-pulse" />
      <div className="h-16 bg-[#F5F5F5] rounded-xl animate-pulse" />
      <div className="h-11 bg-[#F5F5F5] rounded-xl animate-pulse" />
    </div>
  ),
})

interface PunchPromptModalProps {
  kind: PunchPromptKind
  staffId: string
  geofenceConfig: EffectiveGeofence | null
  lateCutoff: string | null
  exempt: boolean
  onClose: () => void
  /** Fired after a punch lands, so the caller can close and refresh. */
  onPunched: () => void
}

/**
 * The check-in / check-out nudge: the Staff Attendance check-in card in a
 * popup, with nothing added but a small close button.
 *
 * Deliberately thin — every piece of behaviour (server clock, geofenced
 * punch, late notice, the mandatory gap between actions) belongs to
 * StaffCheckIn and is not duplicated here, so the popup can never drift from
 * the page it mirrors.
 */
export default function PunchPromptModal({
  kind, staffId, geofenceConfig, lateCutoff, exempt, onClose, onPunched,
}: PunchPromptModalProps) {
  return (
    <ModalShell onClose={onClose} size="2xl" bare zClass="z-40">
      <div className="relative px-3 pb-3 pt-9 sm:px-0 sm:pb-0 sm:pt-0">
        {/* Small close button, floated over the card's top-right corner so the
            card itself stays exactly as it looks on the attendance page. */}
        <button
          onClick={onClose}
          aria-label={kind === 'checkin' ? 'Close check-in reminder' : 'Close check-out reminder'}
          className="absolute top-1 right-4 sm:-top-3 sm:-right-3 z-20 w-8 h-8 flex items-center justify-center rounded-full bg-white text-slate-500 ring-1 ring-slate-900/10 shadow-[0_6px_18px_-6px_rgba(15,23,42,0.45)] hover:bg-slate-50 hover:text-slate-700 active:scale-95 transition-all"
        >
          <X size={15} strokeWidth={2.5} />
        </button>

        <StaffCheckIn
          staffId={staffId}
          geofenceConfig={geofenceConfig}
          lateCutoff={lateCutoff}
          exempt={exempt}
          onCheckedIn={onPunched}
        />
      </div>
    </ModalShell>
  )
}
