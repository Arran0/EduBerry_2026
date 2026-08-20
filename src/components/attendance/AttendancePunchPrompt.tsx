'use client'

import React, { useCallback, useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { AnimatePresence } from 'framer-motion'
import { useAuth } from '@/contexts/AuthContext'
import { isStaffRole } from '@/lib/supabase'
import {
  fetchServerTime,
  fetchAttendanceTimezone,
  dateStringInZone,
  minuteOfDayInZone,
  fetchAttendanceConfig,
  fetchEffectiveCutoffsForStaff,
  fetchEffectiveGeofenceForStaff,
  fetchMyExemption,
  fetchHolidaysForDate,
  fetchStaffAttendanceForDate,
  EffectiveGeofence,
} from '@/lib/attendance'
import PunchPromptModal, { type PunchPromptKind } from '@/components/attendance/PunchPromptModal'

/** How far either side of a cutoff the matching prompt is allowed to appear. */
const WINDOW_MINUTES = 120

/**
 * Grace period after the late cutoff during which the check-in prompt still
 * appears. Arriving a few minutes late is exactly when the reminder is worth
 * the most — the punch is what fixes the record, and the card says plainly
 * that it will be marked Late.
 */
const CHECK_IN_GRACE_MINUTES = 30

/** Path prefixes where the prompt is pointless — the card is already on screen. */
const SUPPRESSED_PATHS = ['/more/staff-attendance']

/**
 * The prompt is mounted by ProtectedLayout, which every page renders, so a
 * plain per-mount evaluation would re-run its handful of queries on every
 * navigation. This module-level stamp throttles it to one evaluation per
 * session per interval, while still letting a long-open app notice that it
 * has crossed into a prompt window.
 */
let lastEvaluatedAt = 0
const RE_EVALUATE_AFTER_MS = 5 * 60 * 1000

/**
 * Prompts closed (or punched) in this browsing session, keyed 'date:kind'.
 *
 * Not persisted, on purpose: the prompt is meant to greet a staff member each
 * time they open the app while they still owe the punch, and the windows
 * around their own cutoffs are what keep that from becoming noise. This only
 * stops the popup from coming straight back at the next re-evaluation after
 * they have dealt with it, and it is gone the moment the app is opened afresh.
 */
const dismissedThisSession = new Set<string>()

/** Minutes since midnight for an "HH:MM" / "HH:MM:SS" cutoff; null if unset. */
function cutoffMinutes(cutoff: string | null | undefined): number | null {
  if (!cutoff) return null
  const [h, m] = cutoff.split(':').map(Number)
  if (Number.isNaN(h) || Number.isNaN(m)) return null
  return h * 60 + m
}

interface PromptState {
  kind: PunchPromptKind
  geofenceConfig: EffectiveGeofence | null
  lateCutoff: string | null
  /** School-timezone date this prompt was raised for. */
  date: string
}

/**
 * Pops the Staff Attendance check-in card the moment a staff member opens the
 * app, when there is a punch they still owe:
 *
 *   • check-in  — they have not checked in, and now is within the two hours
 *                 leading up to *their* late cutoff, or the half hour after it;
 *   • check-out — they are checked in but not out, and now is within the two
 *                 hours following *their* checkout cutoff.
 *
 * "Their" cutoff means the per-date / per-team override that applies to this
 * staff member today, falling back to the school-wide pair — the same
 * resolution the punch itself is scored by. A prompt is skipped entirely on a
 * holiday that covers this staff member, on a day already settled as leave or
 * absence, and once it has been closed for the rest of that session.
 */
export default function AttendancePunchPrompt() {
  const { user, profile } = useAuth()
  const pathname = usePathname()
  const [prompt, setPrompt] = useState<PromptState | null>(null)
  const [exempt, setExempt] = useState(false)

  const suppressed = SUPPRESSED_PATHS.some(p => pathname?.startsWith(p))

  // Staff only, and only staff who are actually on the attendance sheet:
  // a hidden profile has no record to check in against.
  const eligible = !!user && !!profile && isStaffRole(profile.role) && !profile.attendance_hidden

  useEffect(() => {
    if (!eligible || suppressed || prompt) return
    if (Date.now() - lastEvaluatedAt < RE_EVALUATE_AFTER_MS) return
    lastEvaluatedAt = Date.now()

    const staffId = user!.id
    let cancelled = false

    const evaluate = async () => {
      // Clock and zone come from the server: the whole decision is "where is
      // now relative to a cutoff", which a device clock could otherwise answer
      // however it liked.
      const [serverNow, timezone] = await Promise.all([fetchServerTime(), fetchAttendanceTimezone()])
      if (cancelled) return
      const today = dateStringInZone(serverNow, timezone)
      const nowMinutes = minuteOfDayInZone(serverNow, timezone)

      // Both already dealt with in this session — stop before spending any
      // more queries.
      if (dismissedThisSession.has(`${today}:checkin`) && dismissedThisSession.has(`${today}:checkout`)) return

      const [holidays, config, override, records] = await Promise.all([
        fetchHolidaysForDate(today),
        fetchAttendanceConfig(),
        fetchEffectiveCutoffsForStaff(today, staffId),
        fetchStaffAttendanceForDate([staffId], today),
      ])
      if (cancelled) return

      // A holiday for everyone, or one this staff member is named in.
      if (holidays.some(h => h.is_default || h.staff_ids.includes(staffId))) return

      const lateCutoff = (override?.late_cutoff ?? config.late_cutoff)?.slice(0, 5) ?? null
      const checkoutCutoff = (override?.checkout_cutoff ?? config.checkout_cutoff)?.slice(0, 5) ?? null
      const lateMin = cutoffMinutes(lateCutoff)
      const checkoutMin = cutoffMinutes(checkoutCutoff)

      const record = records[0] ?? null
      // A day already settled as leave or absence is not one to nudge about —
      // the record exists, it just has no punch and never will.
      const settled = !!record && !record.check_in_time && (record.status === 'on_leave' || record.status === 'absent')
      if (settled) return

      let kind: PunchPromptKind | null = null
      if (
        !record?.check_in_time &&
        lateMin !== null &&
        nowMinutes >= lateMin - WINDOW_MINUTES &&
        nowMinutes <= lateMin + CHECK_IN_GRACE_MINUTES
      ) {
        kind = 'checkin'
      } else if (
        record?.check_in_time &&
        !record.check_out_time &&
        checkoutMin !== null &&
        nowMinutes >= checkoutMin &&
        nowMinutes <= checkoutMin + WINDOW_MINUTES
      ) {
        kind = 'checkout'
      }

      if (!kind || dismissedThisSession.has(`${today}:${kind}`)) return

      // The card needs the same inputs the attendance page hands it.
      const [geofenceConfig, isExempt] = await Promise.all([
        fetchEffectiveGeofenceForStaff(staffId),
        fetchMyExemption(staffId),
      ])
      if (cancelled) return

      setExempt(isExempt)
      setPrompt({ kind, geofenceConfig, lateCutoff, date: today })
    }

    evaluate().catch(err => console.error('AttendancePunchPrompt evaluate error:', err))
    return () => { cancelled = true }
  }, [eligible, suppressed, prompt, user])

  // Closing settles this prompt for the rest of the session — the record it
  // was raised against is re-read on the next app open anyway, so a punch that
  // has since landed simply means there is nothing left to prompt for.
  const close = useCallback(() => {
    setPrompt(current => {
      if (current) dismissedThisSession.add(`${current.date}:${current.kind}`)
      return null
    })
  }, [])

  // A landed punch leaves the card showing its new state for a beat before the
  // popup steps out of the way.
  const handlePunched = useCallback(() => {
    setTimeout(close, 1500)
  }, [close])

  if (!eligible || suppressed) return null

  return (
    <AnimatePresence>
      {prompt && (
        <PunchPromptModal
          kind={prompt.kind}
          staffId={user!.id}
          geofenceConfig={prompt.geofenceConfig}
          lateCutoff={prompt.lateCutoff}
          exempt={exempt}
          onClose={close}
          onPunched={handlePunched}
        />
      )}
    </AnimatePresence>
  )
}
