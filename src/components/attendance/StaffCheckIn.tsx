'use client'

import React, { useState, useEffect, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  MapPin, Navigation, Loader2, AlertTriangle, Clock, LogOut,
  Check, Fingerprint, ShieldCheck, ShieldAlert, UserCheck, Satellite, Info,
} from 'lucide-react'
import {
  checkInStaff,
  checkOutStaff,
  fetchMyStaffAttendance,
  fetchProfileNameById,
  deriveCheckInStatus,
  msUntilActionAllowed,
  MIN_ACTION_GAP_MS,
  describeLocationWarning,
  EffectiveGeofence,
  StaffAttendanceRecord,
  StaffAttendanceStatus,
  PunchReading,
  PunchResult,
  STAFF_ATTENDANCE_STATUS_LABELS,
} from '@/lib/attendance'
import { fenceFromConfig, FAR_OUTSIDE_CONFIRM_M } from '@/lib/geofence'
import { useSchoolClock } from '@/hooks/useSchoolClock'
import {
  acquirePosition,
  AcquisitionProgress,
  AcquisitionResult,
  ACQUISITION_FAILURE_COPY,
  COARSE_LOCK_COPY,
  DEVICE_PROBLEM_COPY,
  NO_ACCESS_COPY,
  REPORTED_TO_ADMIN_COPY,
  isDeviceProblem,
} from '@/lib/gpsAcquisition'
import {
  LocationWarningBanner,
  LocationReportedNotice,
} from '@/components/attendance/LocationWarning'

interface StaffCheckInProps {
  staffId: string
  geofenceConfig: EffectiveGeofence | null
  /** Only used for the "you'll be marked Late" heads-up; the binding cutoff is
   *  resolved server-side when the punch is written. */
  lateCutoff: string | null
  exempt: boolean
  onCheckedIn: () => void
}

type GpsState = 'idle' | 'getting' | 'got' | 'error'
type CheckInState = 'loading' | 'not_checked_in' | 'checked_in' | 'saving'

/**
 * A punch held back for the staff member to confirm, rather than sent silently.
 * All three are offered to everyone and all three go through on confirmation —
 * there is no location signal left that refuses a punch outright (see
 * attendance_allow_off_campus_flagged.sql) — but they are three different
 * conversations:
 *
 *   device_problem  the device failed to produce a fix in time. Nobody's
 *                   fault, so the panel just states it.
 *   no_access       location access is switched off. The one case where they
 *                   could have produced a location and did not, so the panel
 *                   says plainly that using it is reported before they tap it
 *                   — that warning is the entire justification for accepting
 *                   the punch.
 *   outside_zone    a reading placed them away from campus. Same strict
 *                   "not verified" framing as no_access, for everyone —
 *                   exemption waives the fence, not the record, so it no
 *                   longer softens this one either.
 */
interface PendingAction {
  reading?: PunchReading
  failure?: string | null
  distanceM: number
  reason: 'outside_zone' | 'device_problem' | 'no_access'
  action: 'checkin' | 'checkout'
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
}

/** "4:32" countdown format for the mandatory gap between actions. */
function formatCountdown(ms: number) {
  const totalSeconds = Math.ceil(ms / 1000)
  const m = Math.floor(totalSeconds / 60)
  const s = totalSeconds % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

/** "3h 42m" duration format for the on-campus / total-worked readouts. */
function formatDuration(ms: number) {
  const totalMinutes = Math.max(0, Math.floor(ms / 60000))
  const h = Math.floor(totalMinutes / 60)
  const m = totalMinutes % 60
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

const GOLD = '#B8983C'

// Brand button colours. Check-in actions use Pantone Grasshopper, check-out
// actions use Pantone Red 032 — each with a slightly lighter top stop so the
// filled button reads as a soft gradient rather than a flat slab.
const GRASSHOPPER = '#77824a'
const RED_032 = '#ef3340'
const GREEN_GRAD = 'linear-gradient(135deg, #8d9857 0%, #77824a 100%)'
const RED_GRAD = 'linear-gradient(135deg, #f4515d 0%, #ef3340 100%)'

const STATUS_DOT: Record<StaffAttendanceStatus, string> = {
  present:  'bg-emerald-400',
  late:     'bg-amber-400',
  half_day: 'bg-orange-400',
  wfh:      'bg-cyan-400',
  absent:   'bg-red-400',
  on_leave: 'bg-blue-400',
  e:        'bg-violet-400',
}

export default function StaffCheckIn({
  staffId, geofenceConfig, lateCutoff, exempt, onCheckedIn,
}: StaffCheckInProps) {
  const [checkInState, setCheckInState] = useState<CheckInState>('loading')
  // Today's row, narrowed to what this card renders. The verdict and distance
  // fields are here for describeLocationWarning() — the staff member sees the
  // same flag (and the same off-campus distance) on their own day that the
  // office sees on the report.
  const [existingRecord, setExistingRecord] = useState<Pick<
    StaffAttendanceRecord,
    | 'check_in_time' | 'check_out_time' | 'check_in_time_2' | 'check_out_time_2'
    | 'check_in_verdict' | 'check_out_verdict' | 'check_in_verdict_2' | 'check_out_verdict_2'
    | 'check_in_distance_m' | 'check_out_distance_m' | 'check_in_distance_m_2' | 'check_out_distance_m_2'
    | 'status' | 'geofence_passed' | 'marked_by'
  > | null>(null)
  // Display name of whoever marked this record (admin quick-set / approved
  // leave). Null for a self check-in — marked_by is left blank there.
  const [markerName, setMarkerName] = useState<string | null>(null)
  const [gpsState, setGpsState] = useState<GpsState>('idle')
  const [pending, setPending] = useState<PendingAction | null>(null)
  // Transient line under the card. Tone is carried with the text because not
  // every one of these is a failure: "marked as Half Day" is the outcome of a
  // checkout that worked, and rendering it in red — as this did — reads as
  // though the punch had been rejected.
  const [flash, setFlash] = useState<{ text: string; tone: 'error' | 'notice' } | null>(null)
  const [checkoutSaving, setCheckoutSaving] = useState(false)
  // Set for exactly one punch: the moment attendance is recorded with location
  // access off. Deliberately component state and not persisted — it is a
  // statement made at the moment of the act, not a standing reprimand, and the
  // durable record is the flag on the report.
  const [showReportedNotice, setShowReportedNotice] = useState(false)

  // Time and timezone both come from the DB server clock, never the device's —
  // a device clock (or zone) can be set to whatever the user likes, which would
  // otherwise let them dodge the late cutoff notice or the mandatory gap between
  // actions below. Ticks every second for the live display.
  const { now: clockNow, timezone, today } = useSchoolClock(1000)

  // Nothing loads against a device-derived date: until the server clock lands
  // there is no "today" to load, and the widget stays in its loading state.
  const [todayYear, todayMonth] = today ? today.split('-').map(Number) : [0, 0]
  const geofenceActive = !!(geofenceConfig?.enabled && geofenceConfig.lat != null && geofenceConfig.lng != null)
  // Named group zone if this staff member is in one, so an out-of-range message
  // points at the campus they're actually expected at.
  const zoneName = geofenceConfig?.zone_label ?? 'school'

  const loadTodayRecord = useCallback(async () => {
    if (!today) return // still waiting on the server clock
    setCheckInState('loading')
    try {
      const records = await fetchMyStaffAttendance(staffId, todayYear, todayMonth)
      const todayRec = records.find(r => r.date === today)
      if (todayRec) {
        setExistingRecord({
          check_in_time: todayRec.check_in_time,
          check_out_time: todayRec.check_out_time,
          check_in_time_2: todayRec.check_in_time_2 ?? null,
          check_out_time_2: todayRec.check_out_time_2 ?? null,
          status: todayRec.status,
          geofence_passed: todayRec.geofence_passed,
          marked_by: todayRec.marked_by ?? null,
          check_in_verdict: todayRec.check_in_verdict ?? null,
          check_out_verdict: todayRec.check_out_verdict ?? null,
          check_in_verdict_2: todayRec.check_in_verdict_2 ?? null,
          check_out_verdict_2: todayRec.check_out_verdict_2 ?? null,
          check_in_distance_m: todayRec.check_in_distance_m ?? null,
          check_out_distance_m: todayRec.check_out_distance_m ?? null,
          check_in_distance_m_2: todayRec.check_in_distance_m_2 ?? null,
          check_out_distance_m_2: todayRec.check_out_distance_m_2 ?? null,
        })
        // A row can exist without a check-in time — an admin quick-set or an
        // approved leave/on-duty application writes status only, no GPS check-in.
        // Only treat the day as "checked in" once there's an actual check-in time,
        // otherwise the Check In button (and eventually Check Out) never show up.
        setCheckInState(todayRec.check_in_time ? 'checked_in' : 'not_checked_in')
        // marked_by is only set when someone else marked you — resolve their name.
        if (todayRec.marked_by && todayRec.marked_by !== staffId) {
          fetchProfileNameById(todayRec.marked_by).then(setMarkerName)
        } else {
          setMarkerName(null)
        }
      } else {
        setExistingRecord(null)
        setMarkerName(null)
        setCheckInState('not_checked_in')
      }
    } catch (e) {
      console.error('loadTodayRecord error:', e)
      setFlash({ text: 'Could not load today\'s status. Please check your connection and try again.', tone: 'error' })
      setCheckInState('not_checked_in')
    }
  }, [staffId, today, todayYear, todayMonth])

  useEffect(() => { loadTodayRecord() }, [loadTodayRecord])

  // Late-cutoff notice: shown as a brief toast rather than a persistent banner.
  // Read off the server clock in the school's zone, so the heads-up says the
  // same thing the punch RPC will decide a moment later.
  //
  // Only a heads-up for a check-in that hasn't happened yet: once the day's
  // first punch is in, the status is already settled (and a "Return In" can't
  // change it), so warning about the cutoff would just be noise.
  const willBeLate = checkInState === 'not_checked_in' &&
    !!clockNow && deriveCheckInStatus(lateCutoff, clockNow, timezone) === 'late'
  const [showLateNotice, setShowLateNotice] = useState(false)
  useEffect(() => {
    // Also pulls the toast if it is still up when the check-in lands.
    if (!willBeLate) { setShowLateNotice(false); return }
    setShowLateNotice(true)
    const t = setTimeout(() => setShowLateNotice(false), 3000)
    return () => clearTimeout(t)
  }, [willBeLate])

  // Transient errors ("you are Xm away", "check-in failed") auto-dismiss so the
  // card collapses back smoothly instead of leaving a persistent red banner.
  useEffect(() => {
    if (!flash) return
    const t = setTimeout(() => setFlash(null), 4000)
    return () => clearTimeout(t)
  }, [flash])

  // ── Location acquisition ──────────────────────────────────────────────────────
  // The fence the reading is judged against. Built here for the *live readout*
  // and for deciding whether an off-campus reading gets a confirmation prompt —
  // the binding verdict is the server's, recomputed from the raw coordinates it
  // receives. Nothing the client concludes here is trusted downstream.
  const fence = geofenceActive ? fenceFromConfig(geofenceConfig!) : null

  const [progress, setProgress] = useState<AcquisitionProgress | null>(null)
  const [coarseHint, setCoarseHint] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => () => abortRef.current?.abort(), [])

  /** Turns a server punch result into the message the staff member sees. */
  const applyResult = async (result: PunchResult, action: 'checkin' | 'checkout') => {
    if (result.success) {
      // The punch went in with nothing measured because nothing was allowed to
      // measure. This is the only place that fact can be put in front of the
      // staff member as a consequence rather than a footnote, so it is.
      if (result.verdict === 'location_off') setShowReportedNotice(true)
      await loadTodayRecord()
      onCheckedIn()
      if (result.markedHalfDay) {
        setFlash({ text: 'Checked out before the cutoff — today is recorded as a Half Day.', tone: 'notice' })
      }
      return
    }

    const verb = action === 'checkin' ? 'Check-in' : 'Check-out'

    switch (result.errorCode) {
      case 'too_soon':
        setFlash({ text: `Please wait ${formatCountdown(result.tooSoonMs ?? 0)} before doing that again.`, tone: 'notice' })
        break
      case 'outside_zone':
      case 'no_fix':
        // Only reachable against a server that predates this feature, where an
        // off-campus or missing reading was still a refusal. Both now go
        // through the confirm-and-flag path (pendingConfirmBlock) instead of
        // ever reaching a failed result, so this is legacy-only.
        break
      case 'already_checked_in':
      case 'already_checked_out':
      case 'already_complete':
      case 'not_checked_in':
        // The record moved underneath us (another device, or an admin edit) —
        // re-reading it is more useful than describing the stale state.
        setFlash({ text: 'That action is no longer available. Refreshing your status…', tone: 'notice' })
        break
      default:
        setFlash({ text: `${verb} failed. Please try again.`, tone: 'error' })
    }

    // Re-sync rather than assuming a state: a failed *second* check-in should
    // fall back to 'checked_in', not reset the day to 'not checked in'.
    await loadTodayRecord()
  }

  const submit = async (
    action: 'checkin' | 'checkout',
    reading?: PunchReading,
    failure?: string | null,
  ) => {
    if (action === 'checkin') setCheckInState('saving')
    else setCheckoutSaving(true)
    setPending(null)

    // Decides what the acquisition panel does afterwards (see the finally
    // block): a punch that went through has nothing left to instruct anyone
    // about, even though it got here via a failed acquisition.
    let succeeded = false

    try {
      const result = action === 'checkin'
        ? await checkInStaff(reading, failure)
        : await checkOutStaff(reading, failure)
      succeeded = result.success
      await applyResult(result, action)
    } catch (e) {
      // Guarantees the button never gets stuck mid-save if the network call
      // itself throws rather than resolving normally.
      console.error(`${action} error:`, e)
      setFlash({ text: `${action === 'checkin' ? 'Check-in' : 'Check-out'} failed. Please try again.`, tone: 'error' })
      if (action === 'checkin') setCheckInState('not_checked_in')
    } finally {
      if (action === 'checkout') setCheckoutSaving(false)
      // Whatever the acquisition had to say is stale the moment the server
      // answers — the outcome is now the punch result, not the sensor. An
      // earlier version held gpsState on 'error' here to keep an instruction
      // panel up, which meant "step near a window and try again" flashed
      // underneath a check-in that had just been recorded successfully.
      setGpsState('idle')
      setProgress(null)
    }
  }

  const handlePunch = async (action: 'checkin' | 'checkout') => {
    setFlash(null)
    setPending(null)
    setCoarseHint(false)

    // Geofencing off school-wide — no reading to take, the server records it as
    // 'no_fence' rather than pretending a location was checked.
    if (!geofenceActive) { submit(action); return }

    setGpsState('getting')
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    let result: AcquisitionResult
    try {
      result = await acquirePosition({
        fence,
        trustedAccuracyM: geofenceConfig?.trusted_accuracy_m,
        onProgress: setProgress,
        signal: controller.signal,
      })
    } catch (e) {
      // Acquisition itself blew up rather than reporting a failure. From the
      // staff member's side that is indistinguishable from a device that could
      // not answer, so it gets the same offer instead of a dead end.
      console.error('acquirePosition error:', e)
      setGpsState('error')
      setPending({ failure: 'timeout', distanceM: 0, reason: 'device_problem', action })
      return
    }

    setCoarseHint(result.coarseLock)

    // No usable fix. Both causes are allowed through, so neither is a dead end
    // — but they are not the same offer, and the client only proposes: the
    // server classifies the failure again and makes the binding call
    // (attendance_failure_class in the migration).
    //
    //   device problem  the receiver was asked and could not answer in time.
    //   access off      permission blocked, location services off, or no
    //                   geolocation at all — nothing was ever asked.
    //
    // Exemption is not consulted here any more. It exists to waive a fence
    // result, and there is no fence result when there is no position; both
    // paths below already end in an accepted punch, so an exempt staff member
    // gains nothing from a separate branch and loses the honest verdict on
    // their own row if they get one.
    if (!result.fix) {
      setGpsState('error')
      setPending({
        failure: result.failure,
        distanceM: 0,
        reason: isDeviceProblem(result.failure) ? 'device_problem' : 'no_access',
        action,
      })
      return
    }

    setGpsState('got')
    const reading: PunchReading = {
      lat: result.fix.lat,
      lng: result.fix.lng,
      accuracy: result.fix.accuracy,
      sampleCount: result.fix.sampleCount,
      agreeingCount: result.fix.agreeingCount,
      bestAccuracyM: result.fix.bestAccuracyM,
      spreadM: result.fix.spreadM,
      acquisitionMs: result.elapsedMs,
      coarseLock: result.coarseLock,
    }

    // A reading that placed them off campus is confirmed, not refused, for
    // everyone — exempt or not, the copy is now identical (see pendingCopy).
    if (result.evaluation?.verdict === 'outside') {
      setPending({ reading, distanceM: result.evaluation.distanceM, reason: 'outside_zone', action })
      return
    }

    submit(action, reading)
  }

  const handleCheckIn = () => handlePunch('checkin')
  const handleCheckOut = () => handlePunch('checkout')

  const confirmPending = () => {
    if (!pending) return
    submit(pending.action, pending.reading, pending.failure)
  }

  const isBusy = checkInState === 'saving' || gpsState === 'getting' || checkoutSaving

  // ── Derived: punch timeline, live durations, action gating ─────────────────────

  const rec = existingRecord
  const isCheckedIn = checkInState === 'checked_in' && !!rec

  // The flag on today's row, if any punch was accepted without its location
  // being confirmed. Derived from exactly the same helper the office's report
  // uses, so the staff member is never the last to know their day is marked.
  const todayWarning = describeLocationWarning(rec)

  const canCheckOut       = isCheckedIn && !!rec.check_in_time && !rec.check_out_time
  const canSecondCheckIn  = isCheckedIn && !!rec.check_in_time && !!rec.check_out_time && !rec.check_in_time_2
  const canSecondCheckOut = isCheckedIn && !!rec.check_in_time_2 && !rec.check_out_time_2
  const isCompleted       = isCheckedIn && !!rec.check_out_time_2

  // Mandatory 5-minute gap after the previous action, so a misclick can't
  // immediately undo it. clockNow is null for the first tick or two — treat
  // that as "still gated" rather than flashing the button enabled early.
  const checkoutGateMs       = canCheckOut ? (clockNow ? msUntilActionAllowed(rec!.check_in_time, clockNow) : MIN_ACTION_GAP_MS) : 0
  const secondCheckInGateMs  = canSecondCheckIn ? (clockNow ? msUntilActionAllowed(rec!.check_out_time, clockNow) : MIN_ACTION_GAP_MS) : 0
  const secondCheckOutGateMs = canSecondCheckOut ? (clockNow ? msUntilActionAllowed(rec!.check_in_time_2, clockNow) : MIN_ACTION_GAP_MS) : 0

  // The day's punches. The second (permission-break) pair only joins the
  // timeline once it actually starts — most days are a simple in/out.
  const punches: { key: string; label: string; time: string | null; icon: React.ElementType }[] = [
    { key: 'in',  label: 'Check In',  time: rec?.check_in_time ?? null,  icon: MapPin },
    { key: 'out', label: 'Check Out', time: rec?.check_out_time ?? null, icon: LogOut },
    ...(rec?.check_in_time_2 || rec?.check_out_time_2 ? [
      { key: 'in2',  label: 'Return In', time: rec?.check_in_time_2 ?? null,  icon: MapPin },
      { key: 'out2', label: 'Final Out', time: rec?.check_out_time_2 ?? null, icon: LogOut },
    ] : []),
  ]
  const nextPunchIdx = punches.findIndex(p => !p.time)

  // Live "on campus" spell, or the day's total once fully checked out.
  let liveSince: string | null = null
  if (rec?.check_in_time && !rec.check_out_time) liveSince = rec.check_in_time
  else if (rec?.check_in_time_2 && !rec.check_out_time_2) liveSince = rec.check_in_time_2

  let workedMs: number | null = null
  if (liveSince && clockNow) {
    workedMs = clockNow.getTime() - new Date(liveSince).getTime()
  } else if (rec?.check_in_time && rec.check_out_time) {
    workedMs = new Date(rec.check_out_time).getTime() - new Date(rec.check_in_time).getTime()
    if (rec.check_in_time_2 && rec.check_out_time_2) {
      workedMs += new Date(rec.check_out_time_2).getTime() - new Date(rec.check_in_time_2).getTime()
    }
  }

  // ── Live clock pieces ───────────────────────────────────────────────────────────

  // Read in the school's timezone rather than the device's, so the face on
  // screen is the same clock the cutoffs are judged against.
  const clockParts = clockNow
    ? new Intl.DateTimeFormat('en-US', {
        timeZone: timezone ?? undefined,
        weekday: 'long', month: 'short', day: 'numeric', year: 'numeric',
        hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true,
      }).formatToParts(clockNow)
    : null
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    clockParts?.find(p => p.type === type)?.value ?? ''
  const clockHM = clockParts ? `${part('hour')}:${part('minute')}` : '--:--'
  const clockSec = clockParts ? part('second') : '--'
  const clockAmPm = part('dayPeriod')
  const weekday = part('weekday')
  const dateLabel = clockParts ? `${part('month')} ${part('day')}, ${part('year')}` : ''

  // ── Notice blocks — each collapses smoothly (height + fade) when it clears ───────

  const acquiringLabel = canSecondCheckIn ? 'Checking your location for return check-in…'
    : isCheckedIn ? 'Checking your location for checkout…'
    : 'Checking your location…'

  // The accuracy at which a reading is good enough to stand on its own. Used
  // only to scale the progress bar, so "full" means "this will be accepted".
  const trustedAccuracy = geofenceConfig?.trusted_accuracy_m ?? 100

  const smoothWrap = 'overflow-hidden'
  const smoothProps = {
    initial: { opacity: 0, height: 0 },
    animate: { opacity: 1, height: 'auto' as const },
    exit: { opacity: 0, height: 0 },
    transition: { duration: 0.28, ease: [0.4, 0, 0.2, 1] as [number, number, number, number] },
  }

  const failureCopy = pending
    ? ACQUISITION_FAILURE_COPY[(pending.failure as keyof typeof ACQUISITION_FAILURE_COPY) ?? 'timeout']
    : null

  const pendingCopy: {
    title: string
    detail: string
    /** Emphasised line stating what the record will say. Strict cases only. */
    strictLine?: string
    confirm: string
    strict: boolean
  } | null = !pending ? null
    : pending.reason === 'device_problem'
      ? {
        title: DEVICE_PROBLEM_COPY.title,
        detail: DEVICE_PROBLEM_COPY.detail,
        confirm: pending.action === 'checkin' ? DEVICE_PROBLEM_COPY.confirmIn : DEVICE_PROBLEM_COPY.confirmOut,
        strict: false,
      }
      : pending.reason === 'no_access'
        ? {
          // The cause-specific title and remedy, because "turn on location" is
          // wrong advice for a blocked site permission and vice versa — then
          // the one line that is the same whichever cause it was.
          title: failureCopy?.title ?? 'Location access is switched off',
          detail: failureCopy?.detail ?? 'Your location could not be checked at all.',
          strictLine: NO_ACCESS_COPY.strictLine,
          confirm: pending.action === 'checkin' ? NO_ACCESS_COPY.confirmIn : NO_ACCESS_COPY.confirmOut,
          strict: true,
        }
        // Off campus, exempt or not — exemption waives the fence, not the
        // record, so it no longer changes this copy (see
        // attendance_allow_off_campus_flagged.sql). Same strict framing as
        // no_access. Past FAR_OUTSIDE_CONFIRM_M the metre count stops being
        // something they can act on ("walk closer") and just states the fact.
        : {
          title: 'You are not on campus',
          detail: pending.distanceM >= FAR_OUTSIDE_CONFIRM_M
            ? `Your location does not place you at ${zoneName}.`
            : `You are ${pending.distanceM}m outside ${zoneName}.`,
          strictLine: 'Marking attendance from off campus is reported to the admin, and today\u2019s report will show it as unverified.',
          confirm: pending.action === 'checkin' ? 'Check In Anyway' : 'Check Out Anyway',
          strict: true,
        }

  const pendingConfirmBlock = pending && pendingCopy && (
    <div className={`p-4 space-y-3 border rounded-2xl ${pendingCopy.strict ? 'bg-red-50 border-red-200' : 'bg-amber-50 border-amber-200'}`}>
      <div className="flex items-start gap-3">
        {pendingCopy.strict
          ? <ShieldAlert size={18} className="text-red-500 flex-shrink-0 mt-0.5" />
          : <AlertTriangle size={18} className="text-amber-500 flex-shrink-0 mt-0.5" />
        }
        <div className="min-w-0">
          <p className={`text-sm font-bold ${pendingCopy.strict ? 'text-red-800' : 'text-amber-800'}`}>
            {pendingCopy.title}
          </p>
          <p className={`text-xs mt-1 leading-relaxed ${pendingCopy.strict ? 'text-red-700' : 'text-amber-700'}`}>
            {pendingCopy.detail}
          </p>
          {/* Set apart from the remedy above it, because it is not advice —
              it is what the record will say if they go ahead. */}
          {pendingCopy.strictLine && (
            <p className="text-[11px] font-bold text-red-800 mt-2 pt-2 border-t border-red-200 leading-relaxed">
              {pendingCopy.strictLine}
            </p>
          )}
        </div>
      </div>
      <div className="flex gap-2">
        <button
          onClick={confirmPending}
          className={`flex-1 py-2.5 text-sm font-semibold text-white transition-colors active:scale-[0.98] rounded-xl ${
            pendingCopy.strict ? 'bg-red-600 hover:bg-red-700' : 'bg-amber-500 hover:bg-amber-600'
          }`}
        >
          {pendingCopy.confirm}
        </button>
        {/* Where a retry is genuinely worth more than a dismissal, this button
            re-runs acquisition rather than just closing the panel: a fix that
            failed once often lands a few steps from a window, and a permission
            just granted in another tab needs another attempt to be noticed.
            An off-campus reading is different — retrying a GPS fix does not
            change where someone is standing, so that one is a plain Cancel. */}
        <button
          onClick={() => {
            setPending(null)
            if (pending.reason === 'outside_zone') setGpsState('idle')
            else handlePunch(pending.action)
          }}
          className="flex-1 py-2.5 text-sm font-medium bg-white text-slate-600 border border-slate-200 hover:bg-slate-50 transition-colors rounded-xl"
        >
          {pending.reason === 'outside_zone' ? 'Cancel' : 'Try Again'}
        </button>
      </div>
    </div>
  )

  // A single stacked notices region; every child animates its own height so the
  // whole card grows/shrinks smoothly as messages come and go.
  const noticesRegion = (
    <AnimatePresence initial={false}>
      {/* Shown once, right after a punch recorded with location access off, and
          it takes the whole notices region while it is up — the quieter
          standing flag underneath would only dilute it. Dismissing leaves that
          standing flag in place. */}
      {showReportedNotice && (
        <motion.div key="reported" {...smoothProps} className={smoothWrap}>
          <div className="pt-0.5">
            <LocationReportedNotice
              copy={REPORTED_TO_ADMIN_COPY}
              onAcknowledge={() => setShowReportedNotice(false)}
            />
          </div>
        </motion.div>
      )}

      {/* Today's flag, if the day carries one. Persistent rather than a toast:
          it describes the state of the record, not the outcome of a tap, and it
          stays up for as long as that state does. */}
      {todayWarning && !pending && !showReportedNotice && gpsState !== 'getting' && (
        <motion.div key="location-warning" {...smoothProps} className={smoothWrap}>
          <div className="pt-0.5">
            <LocationWarningBanner
              warning={todayWarning}
              footnote={todayWarning.strict
                ? 'Your attendance still counts. This day sits at the top of today\u2019s report for the admin to review.'
                : 'Your attendance still counts. This day is flagged on today\u2019s report.'}
            />
          </div>
        </motion.div>
      )}

      {gpsState === 'getting' && (
        <motion.div key="gps-getting" {...smoothProps} className={smoothWrap}>
          <div className="px-3.5 py-2.5 bg-blue-50 border border-blue-100 rounded-xl space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-2 text-sm text-blue-700">
                <Navigation size={14} className="animate-pulse flex-shrink-0" />
                {acquiringLabel}
              </span>
              {/* The live accuracy readout. Showing it is not decoration: the
                  single most common cause of a coarse fix is standing deep
                  inside a building, and a number that visibly improves as you
                  walk toward a window tells the staff member that far better
                  than any static instruction could. */}
              {progress?.fix && (
                <span className="flex items-center gap-1.5 text-xs font-bold text-blue-800 tabular-nums flex-shrink-0">
                  <Satellite size={12} />
                  ±{Math.round(progress.fix.accuracy)}m
                </span>
              )}
            </div>

            {progress?.fix && (
              <>
                <div className="h-1.5 w-full bg-blue-100 rounded-full overflow-hidden">
                  <motion.div
                    className="h-full rounded-full"
                    style={{ background: progress.fix.accuracy <= trustedAccuracy ? '#10b981' : '#60a5fa' }}
                    animate={{
                      // Full bar at the trusted threshold, shrinking as the
                      // reading gets coarser — so "nearly there" looks like it.
                      width: `${Math.max(4, Math.min(100, (trustedAccuracy / Math.max(1, progress.fix.accuracy)) * 100))}%`,
                    }}
                    transition={{ duration: 0.4 }}
                  />
                </div>
                <p className="text-[11px] text-blue-600">
                  {progress.fix.sampleCount} reading{progress.fix.sampleCount === 1 ? '' : 's'}
                  {progress.evaluation && progress.evaluation.verdict !== 'uncertain' && (
                    <> · {progress.evaluation.verdict === 'inside' ? 'on campus' : 'off campus'}</>
                  )}
                  {progress.phase === 'refining' && <> · improving accuracy…</>}
                </p>
              </>
            )}
          </div>
        </motion.div>
      )}

      {/* Shown alongside any outcome when the readings look like a network lock
          rather than a satellite one, since that is fixable in device settings. */}
      {coarseHint && !pending && (
        <motion.div key="coarse" {...smoothProps} className={smoothWrap}>
          <div className="flex items-start gap-3 px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl">
            <Satellite size={14} className="text-slate-400 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-bold text-slate-700">{COARSE_LOCK_COPY.title}</p>
              <p className="text-[11px] mt-0.5 leading-relaxed text-slate-600">{COARSE_LOCK_COPY.detail}</p>
            </div>
          </div>
        </motion.div>
      )}

      {pending && (
        <motion.div key="pending" {...smoothProps} className={smoothWrap}>
          <div className="pt-0.5">{pendingConfirmBlock}</div>
        </motion.div>
      )}

      {flash && (
        <motion.div key="flash" {...smoothProps} className={smoothWrap}>
          <p className={`flex items-center gap-2 text-xs px-3.5 py-2.5 border rounded-xl ${
            flash.tone === 'error'
              ? 'text-red-600 bg-red-50 border-red-100'
              : 'text-amber-700 bg-amber-50 border-amber-100'
          }`}>
            {flash.tone === 'error'
              ? <AlertTriangle size={13} className="flex-shrink-0" />
              : <Info size={13} className="flex-shrink-0" />}
            {flash.text}
          </p>
        </motion.div>
      )}

      {showLateNotice && (
        <motion.div key="late" {...smoothProps} className={smoothWrap}>
          <div className="flex items-center gap-2 px-3.5 py-2 bg-amber-50 border border-amber-200 rounded-xl">
            <span className="w-5 h-5 rounded-full bg-amber-400 flex items-center justify-center flex-shrink-0">
              <Clock size={11} className="text-white" />
            </span>
            <p className="text-xs text-amber-700 font-medium">Past {lateCutoff} — you&apos;ll be marked Late</p>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )

  // ── Secondary action buttons (checkout / permission break) ─────────────────────
  // Filled brand buttons: check-out actions in Pantone Red 032, the return
  // check-in in Pantone Grasshopper, each with a matching colour-cast shadow.

  const brandBtnBase =
    'group/btn relative w-full overflow-hidden flex items-center justify-center gap-2.5 px-5 py-3.5 text-sm font-bold text-white disabled:opacity-55 transition-all active:scale-[0.98] rounded-xl sheen'

  const greenBtn = { background: GREEN_GRAD, boxShadow: `0 12px 26px -12px ${GRASSHOPPER}, inset 0 1px 0 rgba(255,255,255,0.22)` }
  const redBtn   = { background: RED_GRAD,   boxShadow: `0 12px 26px -12px ${RED_032}, inset 0 1px 0 rgba(255,255,255,0.25)` }

  const iconBadge = 'w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 bg-white/20 border border-white/25 transition-transform duration-300 group-hover/btn:scale-110'

  const actionButtons = !pending && (
    <>
      {canCheckOut && (
        <button
          onClick={handleCheckOut}
          disabled={isBusy || checkoutGateMs > 0}
          className={brandBtnBase}
          style={redBtn}
        >
          {checkoutSaving ? (
            <span className="relative flex items-center gap-2"><Loader2 size={16} className="animate-spin" />Saving…</span>
          ) : gpsState === 'getting' ? (
            <span className="relative flex items-center gap-2"><Navigation size={16} className="animate-pulse" />Getting location…</span>
          ) : checkoutGateMs > 0 ? (
            <span className="relative flex items-center gap-2"><Clock size={15} />Check Out in {formatCountdown(checkoutGateMs)}</span>
          ) : (
            <span className="relative flex items-center gap-2.5"><span className={iconBadge}><LogOut size={15} /></span>Check Out</span>
          )}
        </button>
      )}

      {canSecondCheckIn && (
        <button
          onClick={handleCheckIn}
          disabled={isBusy || secondCheckInGateMs > 0}
          className={brandBtnBase}
          style={greenBtn}
        >
          {gpsState === 'getting' ? (
            <span className="relative flex items-center gap-2"><Navigation size={16} className="animate-pulse" />Getting location…</span>
          ) : secondCheckInGateMs > 0 ? (
            <span className="relative flex items-center gap-2"><Clock size={15} />Return In in {formatCountdown(secondCheckInGateMs)}</span>
          ) : (
            <span className="relative flex items-center gap-2.5"><span className={iconBadge}><MapPin size={15} /></span>Return Check-In</span>
          )}
        </button>
      )}

      {canSecondCheckOut && (
        <button
          onClick={handleCheckOut}
          disabled={isBusy || secondCheckOutGateMs > 0}
          className={brandBtnBase}
          style={redBtn}
        >
          {checkoutSaving ? (
            <span className="relative flex items-center gap-2"><Loader2 size={16} className="animate-spin" />Saving…</span>
          ) : gpsState === 'getting' ? (
            <span className="relative flex items-center gap-2"><Navigation size={16} className="animate-pulse" />Getting location…</span>
          ) : secondCheckOutGateMs > 0 ? (
            <span className="relative flex items-center gap-2"><Clock size={15} />Final Out in {formatCountdown(secondCheckOutGateMs)}</span>
          ) : (
            <span className="relative flex items-center gap-2.5"><span className={iconBadge}><LogOut size={15} /></span>Final Check-Out</span>
          )}
        </button>
      )}

      {isCompleted && (
        <p className="text-xs text-violet-600 bg-violet-50 border border-violet-100 px-3.5 py-2.5 rounded-xl text-center">
          Permission break recorded — all check-ins and check-outs complete.
        </p>
      )}
    </>
  )

  const hasActions = canCheckOut || canSecondCheckIn || canSecondCheckOut || isCompleted

  // ── Live status readout — lives to the right of the clock in the dark band ──────

  const statusReadout = (
    <div className="flex flex-col items-end gap-1.5 text-right min-w-0 flex-shrink-0">
      {rec ? (
        <span className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-[#F5F5F5] border border-[#E4E4E7]">
          <span className={`w-2 h-2 rounded-full ${STATUS_DOT[rec.status]}`} />
          <span className="text-xs font-bold text-[#18181B]">
            {STAFF_ATTENDANCE_STATUS_LABELS[rec.status]}
          </span>
        </span>
      ) : (
        <span className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-[#FAFAFA] border border-[#E4E4E7]">
          <span className="w-2 h-2 rounded-full border border-[#A1A1AA]" />
          <span className="text-xs font-medium text-[#71717A]">
            {checkInState === 'loading' ? 'Loading…' : 'Awaiting check-in'}
          </span>
        </span>
      )}

      {/* Who marked you (admin / approved leave) OR the live worked-time spell. */}
      {rec && markerName ? (
        <p className="flex items-center gap-1.5 text-[11px] text-[#71717A] max-w-[10rem] sm:max-w-[13rem]">
          <UserCheck size={11} className="flex-shrink-0" style={{ color: GOLD }} />
          <span className="truncate">Marked by <span className="text-[#18181B] font-semibold">{markerName}</span></span>
        </p>
      ) : workedMs !== null ? (
        <p className="flex items-center gap-1.5 leading-none">
          <span className="font-display text-lg font-bold text-[#18181B] tabular-nums">{formatDuration(workedMs)}</span>
          <span className="text-[11px] text-[#71717A]">{liveSince ? 'on campus' : 'total'}</span>
          {liveSince && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />}
        </p>
      ) : rec && !rec.check_in_time ? (
        <p className="text-[11px] text-[#A1A1AA]">No check-in yet</p>
      ) : null}

      {/* Where the day stands on location. A punch accepted without its
          location confirmed takes precedence over the plain zone line: saying
          "within check-in zone" for a reading that never placed anyone
          anywhere would be the one claim this card must not make. */}
      {isCheckedIn && todayWarning ? (
        // One label for every flagged kind — off campus, no access, or a
        // device that could not get a fix all mean the same thing here: the
        // location on this row was not confirmed. The colour still carries
        // severity (red for off-campus/no-access, amber for a device
        // problem); the words no longer need to.
        <span className={`inline-flex items-center gap-1 text-[11px] font-semibold ${
          todayWarning.strict ? 'text-red-600' : 'text-amber-600'
        }`}>
          {todayWarning.strict ? <ShieldAlert size={11} /> : <AlertTriangle size={11} />}
          Location not verified
        </span>
      ) : isCheckedIn && rec.geofence_passed ? (
        // geofence_passed reaching here is always true: false only comes from
        // verdict 'outside', which the todayWarning branch above already
        // catches, and null (no check happened at all) has nothing to show.
        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600">
          <ShieldCheck size={11} />
          Within check-in zone
        </span>
      ) : null}
    </div>
  )

  // ── Render — one stable hero shell across loading / in / out states ────────────

  return (
    <section
      className="relative overflow-hidden rounded-[1.5rem] bg-white border-4"
      style={{
        borderColor: 'var(--page-gradient-from, #27272A)',
        boxShadow: '0 1px 1px rgba(24,24,27,0.04), 0 16px 40px -20px rgba(24,24,27,0.18)',
      }}
    >
      {/* ── Clock + status readout ── */}
      <div className="relative overflow-hidden border-b border-[#E4E4E7]">
        <div
          className="absolute -top-24 -right-16 w-64 h-64 rounded-full pointer-events-none"
          style={{ background: 'radial-gradient(circle, rgba(184,152,60,0.16), transparent 68%)' }}
        />
        <div className="absolute -bottom-10 left-6 opacity-[0.04] pointer-events-none select-none">
          <Fingerprint size={130} className="text-[#18181B]" />
        </div>

        <div className="relative px-4 py-3.5 sm:px-6 sm:py-4 flex items-center justify-between gap-3">
          {/* Clock */}
          <div className="min-w-0">
            <p className="eyebrow" style={{ color: GOLD }}>Today · {weekday || '—'}</p>
            <div className="flex items-baseline gap-1.5 mt-2">
              <span className="font-display text-[2.15rem] sm:text-[2.9rem] font-bold leading-none text-[#18181B] tabular-nums headline">
                {clockHM}
              </span>
              <span className="flex flex-col items-start leading-none gap-0.5 pb-0.5">
                <span className="text-[10px] font-bold text-[#A1A1AA] tabular-nums">{clockSec}</span>
                <span className="text-[10px] font-bold text-[#71717A]">{clockAmPm}</span>
              </span>
            </div>
            <p className="text-xs text-[#71717A] mt-1.5">{dateLabel}</p>
          </div>

          {/* Status readout */}
          {statusReadout}
        </div>
      </div>

      {/* ── Punch timeline + actions ── */}
      <div className="p-4 sm:p-6">
        {checkInState === 'loading' ? (
          <div className="flex flex-col gap-3" aria-label="Loading today's status">
            <div className="h-4 w-44 bg-[#F5F5F5] rounded-lg animate-pulse" />
            <div className="flex flex-col lg:flex-row gap-4">
              <div className="h-16 flex-1 bg-[#F5F5F5] rounded-xl animate-pulse" />
              <div className="h-12 lg:w-[300px] bg-[#F5F5F5] rounded-xl animate-pulse" />
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <p className="eyebrow text-[#A1A1AA]">Today&apos;s Check-in &amp; Check-out</p>

            {/* Timeline (left) + action (right) fill the full width on desktop. */}
            <div className="flex flex-col lg:flex-row lg:items-center gap-4 lg:gap-8">
              {/* Punch timeline */}
              <div className="flex items-start flex-1 min-w-0">
                {punches.map((p, i) => {
                  const done = !!p.time
                  const isNext = i === nextPunchIdx
                  const Icon = p.icon
                  return (
                    <React.Fragment key={p.key}>
                      {i > 0 && (
                        <div className={`flex-1 min-w-[8px] h-[2px] mt-[19px] mx-1 sm:mx-2 rounded-full ${
                          done ? 'bg-[#B8983C]/50' : 'bg-[#E4E4E7]'
                        }`} />
                      )}
                      <div className="flex flex-col items-center gap-1.5 min-w-[56px] sm:min-w-[76px]">
                        <div className="relative">
                          <div
                            className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors ${
                              done
                                ? 'text-white shadow-[0_6px_14px_-4px_rgba(184,152,60,0.55)]'
                                : isNext
                                  ? 'bg-[#B8983C]/[0.07] text-[#B8983C] border-2 border-[#B8983C]/50'
                                  : 'bg-white text-[#D4D4D8] border-2 border-[#E4E4E7]'
                            }`}
                            style={done ? { background: `linear-gradient(135deg, #CBAB55 0%, ${GOLD} 100%)` } : undefined}
                          >
                            {done ? <Check size={16} strokeWidth={3} /> : <Icon size={15} />}
                          </div>
                          {isNext && (
                            <span className="absolute inset-0 rounded-full border-2 border-[#B8983C]/40 animate-ping pointer-events-none" />
                          )}
                        </div>
                        <p className={`text-[10px] font-bold uppercase tracking-wider text-center ${done || isNext ? 'text-[#71717A]' : 'text-[#A1A1AA]'}`}>
                          {p.label}
                        </p>
                        <p className={`text-sm font-bold tabular-nums leading-none ${done ? 'text-[#18181B]' : 'text-[#D4D4D8]'}`}>
                          {p.time ? formatTime(p.time) : '—:—'}
                        </p>
                      </div>
                    </React.Fragment>
                  )
                })}
              </div>

              {/* Action area — sits beside the timeline on desktop, full width on phone. */}
              {!isCheckedIn ? (
                !pending && gpsState !== 'error' && (
                  <button
                    onClick={handleCheckIn}
                    disabled={isBusy}
                    className="group relative w-full lg:w-[320px] flex-shrink-0 overflow-hidden rounded-2xl py-4 text-white font-bold text-base tracking-tight disabled:opacity-55 transition-all active:scale-[0.985] sheen"
                    style={{
                      background: GREEN_GRAD,
                      boxShadow: `0 16px 32px -14px ${GRASSHOPPER}, inset 0 1px 0 rgba(255,255,255,0.22)`,
                    }}
                  >
                    <span className="relative flex items-center justify-center gap-2.5">
                      {checkInState === 'saving' ? (
                        <><Loader2 size={20} className="animate-spin" /><span>Saving…</span></>
                      ) : gpsState === 'getting' ? (
                        <><Navigation size={20} className="animate-pulse" /><span>Getting location…</span></>
                      ) : (
                        <>
                          <span className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 bg-white/20 border border-white/30 transition-transform duration-300 group-hover:scale-110">
                            <MapPin size={15} className="text-white" />
                          </span>
                          <span>Check In for Today</span>
                        </>
                      )}
                    </span>
                  </button>
                )
              ) : hasActions ? (
                <div className="flex flex-col gap-2.5 w-full lg:w-[320px] flex-shrink-0">
                  {actionButtons}
                </div>
              ) : null}
            </div>

            {/* Notices collapse in/out smoothly below the row. */}
            {noticesRegion}
          </div>
        )}
      </div>
    </section>
  )
}
