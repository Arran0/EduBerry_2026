'use client'

import React, { useState, useEffect, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  MapPin, Navigation, XCircle, Loader2, AlertTriangle, Clock, Lock, LogOut,
  Check, Fingerprint, ShieldCheck, UserCheck,
} from 'lucide-react'
import {
  checkInStaff,
  checkOutStaff,
  fetchMyStaffAttendance,
  fetchProfileNameById,
  fetchServerTime,
  deriveCheckInStatus,
  msUntilActionAllowed,
  MIN_ACTION_GAP_MS,
  GeofenceConfig,
  StaffAttendanceStatus,
  haversineDistance,
  STAFF_ATTENDANCE_STATUS_LABELS,
} from '@/lib/attendance'

interface StaffCheckInProps {
  staffId: string
  geofenceConfig: GeofenceConfig | null
  lateCutoff: string | null
  checkoutCutoff: string | null
  exempt: boolean
  onCheckedIn: () => void
}

type GpsState = 'idle' | 'getting' | 'got' | 'error'
type CheckInState = 'loading' | 'not_checked_in' | 'checked_in' | 'saving'

interface PendingAction {
  coords: { lat: number; lng: number; accuracy: number }
  distanceM: number
  reason: 'outside_zone' | 'gps_error'
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
// A brighter gold that stays legible on the dark charcoal band (the muted
// #B8983C reads as low-contrast mud there).
const GOLD_BRIGHT = '#E7C976'

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
  staffId, geofenceConfig, lateCutoff, checkoutCutoff, exempt, onCheckedIn,
}: StaffCheckInProps) {
  const [checkInState, setCheckInState] = useState<CheckInState>('loading')
  const [existingRecord, setExistingRecord] = useState<{
    check_in_time: string | null
    check_out_time: string | null
    check_in_time_2: string | null
    check_out_time_2: string | null
    status: StaffAttendanceStatus
    geofence_passed: boolean | null
    marked_by: string | null
  } | null>(null)
  // Display name of whoever marked this record (admin quick-set / approved
  // leave). Null for a self check-in — marked_by is left blank there.
  const [markerName, setMarkerName] = useState<string | null>(null)
  const [gpsState, setGpsState] = useState<GpsState>('idle')
  const [pending, setPending] = useState<PendingAction | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [checkoutSaving, setCheckoutSaving] = useState(false)

  // Sourced from the DB server clock, not the device's — a device clock can be set to
  // whatever the user likes, which would otherwise let them dodge the late cutoff notice
  // or the mandatory gap between actions below.
  const [serverNow, setServerNow] = useState<Date | null>(null)
  const serverOffsetMs = useRef(0)
  useEffect(() => {
    fetchServerTime().then(t => {
      serverOffsetMs.current = t.getTime() - Date.now()
      setServerNow(t)
    })
  }, [])

  // Ticking clock for the live time display and the mandatory-gap countdowns,
  // kept in sync with the server via the offset above rather than re-fetching.
  const [clockNow, setClockNow] = useState<Date | null>(null)
  useEffect(() => {
    const id = setInterval(() => setClockNow(new Date(Date.now() + serverOffsetMs.current)), 1000)
    return () => clearInterval(id)
  }, [])

  const today = (serverNow ?? new Date()).toISOString().split('T')[0]
  const [todayYear, todayMonth] = today.split('-').map(Number)
  const geofenceActive = !!(geofenceConfig?.enabled && geofenceConfig.lat != null && geofenceConfig.lng != null)

  const loadTodayRecord = useCallback(async () => {
    setCheckInState('loading')
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
  }, [staffId, today, todayYear, todayMonth])

  useEffect(() => { loadTodayRecord() }, [loadTodayRecord])

  // Late-cutoff notice: shown as a brief toast rather than a persistent banner.
  const willBeLate = !!serverNow && deriveCheckInStatus(lateCutoff, serverNow) === 'late'
  const [showLateNotice, setShowLateNotice] = useState(false)
  useEffect(() => {
    if (!willBeLate) return
    setShowLateNotice(true)
    const t = setTimeout(() => setShowLateNotice(false), 3000)
    return () => clearTimeout(t)
  }, [willBeLate])

  // Transient errors ("you are Xm away", "check-in failed") auto-dismiss so the
  // card collapses back smoothly instead of leaving a persistent red banner.
  useEffect(() => {
    if (!error) return
    const t = setTimeout(() => setError(null), 4000)
    return () => clearTimeout(t)
  }, [error])

  function getGpsCoords(): Promise<{ lat: number; lng: number; accuracy: number } | null> {
    return new Promise(resolve => {
      navigator.geolocation.getCurrentPosition(
        pos => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }),
        () => resolve(null),
        { timeout: 10000, enableHighAccuracy: true }
      )
    })
  }

  function checkGeofence(coords: { lat: number; lng: number; accuracy: number }) {
    if (!geofenceActive) return { passed: true, distanceM: 0 }
    const distanceM = Math.round(
      haversineDistance(coords.lat, coords.lng, geofenceConfig!.lat!, geofenceConfig!.lng!)
    )
    return { passed: distanceM <= geofenceConfig!.radius_m, distanceM }
  }

  // ── Check-in ──────────────────────────────────────────────────────────────────

  const doCheckIn = async (coords?: { lat: number; lng: number; accuracy: number }) => {
    setCheckInState('saving')
    setPending(null)
    const result = await checkInStaff(staffId, { coords, geofenceConfig: geofenceConfig ?? undefined, lateCutoff })
    if (result.success) {
      await loadTodayRecord()
      onCheckedIn()
    } else {
      // Re-sync from the DB rather than assuming 'not_checked_in' — this can also be
      // a failed *second* check-in, which should fall back to 'checked_in', not reset.
      setError(result.tooSoonMs
        ? `Please wait ${formatCountdown(result.tooSoonMs)} before doing that again.`
        : 'Check-in failed. Please try again.')
      await loadTodayRecord()
    }
  }

  const handleCheckIn = async () => {
    setError(null)
    setPending(null)
    if (!geofenceActive) { doCheckIn(); return }

    setGpsState('getting')
    const coords = await getGpsCoords()
    setGpsState(coords ? 'got' : 'error')

    if (!coords) {
      if (exempt) setPending({ coords: { lat: 0, lng: 0, accuracy: 0 }, distanceM: 0, reason: 'gps_error', action: 'checkin' })
      else { setError('Location is required. Please enable GPS and try again.'); setGpsState('idle') }
      return
    }

    const { passed, distanceM } = checkGeofence(coords)
    if (passed) doCheckIn(coords)
    else if (exempt) setPending({ coords, distanceM, reason: 'outside_zone', action: 'checkin' })
    else { setError(`You are ${distanceM}m from school (limit: ${geofenceConfig?.radius_m}m). Check-in blocked.`); setGpsState('idle') }
  }

  // ── Check-out ─────────────────────────────────────────────────────────────────

  const doCheckOut = async (coords?: { lat: number; lng: number; accuracy: number }) => {
    setCheckoutSaving(true)
    setPending(null)
    const result = await checkOutStaff(staffId, { coords, geofenceConfig: geofenceConfig ?? undefined, checkoutCutoff })
    setCheckoutSaving(false)
    if (result.success) {
      await loadTodayRecord()
      onCheckedIn()
      if (result.markedHalfDay) setError('Early checkout detected — marked as Half Day.')
    } else {
      setError(result.tooSoonMs
        ? `Please wait ${formatCountdown(result.tooSoonMs)} before doing that again.`
        : 'Check-out failed. Please try again.')
    }
  }

  const handleCheckOut = async () => {
    setError(null)
    setPending(null)
    if (!geofenceActive) { doCheckOut(); return }

    setGpsState('getting')
    const coords = await getGpsCoords()
    setGpsState(coords ? 'got' : 'error')

    if (!coords) {
      if (exempt) setPending({ coords: { lat: 0, lng: 0, accuracy: 0 }, distanceM: 0, reason: 'gps_error', action: 'checkout' })
      else { setError('Location is required for checkout. Please enable GPS.'); setGpsState('idle') }
      return
    }

    const { passed, distanceM } = checkGeofence(coords)
    if (passed) doCheckOut(coords)
    else if (exempt) setPending({ coords, distanceM, reason: 'outside_zone', action: 'checkout' })
    else { setError(`You are ${distanceM}m from school (limit: ${geofenceConfig?.radius_m}m). Checkout blocked.`); setGpsState('idle') }
  }

  const confirmPending = () => {
    if (!pending) return
    if (pending.action === 'checkin') doCheckIn(pending.reason === 'gps_error' ? undefined : pending.coords)
    else doCheckOut(pending.reason === 'gps_error' ? undefined : pending.coords)
  }

  const isBusy = checkInState === 'saving' || gpsState === 'getting' || checkoutSaving

  // ── Derived: punch timeline, live durations, action gating ─────────────────────

  const rec = existingRecord
  const isCheckedIn = checkInState === 'checked_in' && !!rec

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

  const now = clockNow ?? serverNow
  const clockHM = now
    ? `${now.getHours() % 12 || 12}:${String(now.getMinutes()).padStart(2, '0')}`
    : '--:--'
  const clockSec = now ? String(now.getSeconds()).padStart(2, '0') : '--'
  const clockAmPm = now ? (now.getHours() >= 12 ? 'PM' : 'AM') : ''
  const weekday = now ? now.toLocaleDateString('en-US', { weekday: 'long' }) : ''
  const dateLabel = now ? now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ''

  // ── Notice blocks — each collapses smoothly (height + fade) when it clears ───────

  const smoothWrap = 'overflow-hidden'
  const smoothProps = {
    initial: { opacity: 0, height: 0 },
    animate: { opacity: 1, height: 'auto' as const },
    exit: { opacity: 0, height: 0 },
    transition: { duration: 0.28, ease: [0.4, 0, 0.2, 1] as [number, number, number, number] },
  }

  const pendingConfirmBlock = pending && (
    <div className={`p-4 space-y-3 border rounded-2xl ${exempt ? 'bg-amber-50 border-amber-200' : 'bg-red-50 border-red-200'}`}>
      <div className="flex items-start gap-3">
        {exempt
          ? <AlertTriangle size={18} className="text-amber-500 flex-shrink-0 mt-0.5" />
          : <Lock size={18} className="text-red-500 flex-shrink-0 mt-0.5" />
        }
        <div>
          <p className={`text-sm font-bold ${exempt ? 'text-amber-800' : 'text-red-800'}`}>
            {pending.reason === 'gps_error' ? 'Could Not Get Location' : 'Outside School Zone'}
          </p>
          <p className={`text-xs mt-1 leading-relaxed ${exempt ? 'text-amber-700' : 'text-red-700'}`}>
            {pending.reason === 'outside_zone'
              ? `You are ${pending.distanceM}m from school (limit: ${geofenceConfig?.radius_m}m).${exempt ? ' You are exempted — you may proceed anyway.' : ''}`
              : exempt ? `${pending.action === 'checkin' ? 'Check in' : 'Check out'} without GPS verification?` : 'Location is required. Please enable GPS and try again.'}
          </p>
        </div>
      </div>
      <div className="flex gap-2">
        {exempt && (
          <button onClick={confirmPending} className="flex-1 py-2.5 text-sm font-semibold bg-amber-500 text-white hover:bg-amber-600 transition-colors active:scale-[0.98] rounded-xl">
            {pending.action === 'checkin' ? 'Check In Anyway' : 'Check Out Anyway'}
          </button>
        )}
        <button onClick={() => { setPending(null); setGpsState('idle') }} className="flex-1 py-2.5 text-sm font-medium bg-white text-slate-600 border border-slate-200 hover:bg-slate-50 transition-colors rounded-xl">
          {exempt ? 'Cancel' : pending.reason === 'gps_error' ? 'Retry' : 'OK'}
        </button>
      </div>
    </div>
  )

  // A single stacked notices region; every child animates its own height so the
  // whole card grows/shrinks smoothly as messages come and go.
  const noticesRegion = (
    <AnimatePresence initial={false}>
      {gpsState === 'getting' && (
        <motion.div key="gps-getting" {...smoothProps} className={smoothWrap}>
          <div className="flex items-center gap-2 px-3.5 py-2.5 bg-blue-50 border border-blue-100 text-sm text-blue-700 rounded-xl">
            <Navigation size={14} className="animate-pulse flex-shrink-0" />
            {canSecondCheckIn ? 'Getting your location for return check-in…'
              : isCheckedIn ? 'Getting your location for checkout…'
              : 'Getting your location…'}
          </div>
        </motion.div>
      )}

      {pending && (
        <motion.div key="pending" {...smoothProps} className={smoothWrap}>
          <div className="pt-0.5">{pendingConfirmBlock}</div>
        </motion.div>
      )}

      {gpsState === 'error' && !pending && !isCheckedIn && (
        <motion.div key="gps-error" {...smoothProps} className={smoothWrap}>
          <div className="p-4 space-y-3 border bg-red-50 border-red-200 rounded-2xl">
            <div className="flex items-start gap-3">
              <XCircle size={18} className="text-red-500 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-bold text-red-800">Could Not Get Location</p>
                <p className="text-xs mt-1 text-red-700">Location is required. Please enable GPS and try again.</p>
              </div>
            </div>
            <button onClick={() => setGpsState('idle')} className="w-full py-2.5 text-sm font-medium bg-white text-slate-600 border border-slate-200 hover:bg-slate-50 transition-colors rounded-xl">
              Retry
            </button>
          </div>
        </motion.div>
      )}

      {error && (
        <motion.div key="error" {...smoothProps} className={smoothWrap}>
          <p className="flex items-center gap-2 text-xs text-red-600 bg-red-50 border border-red-100 px-3.5 py-2.5 rounded-xl">
            <AlertTriangle size={13} className="flex-shrink-0" />
            {error}
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
        <span className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-white/10 border border-white/15 backdrop-blur-sm">
          <span className={`w-2 h-2 rounded-full ${STATUS_DOT[rec.status]}`} />
          <span className="text-xs font-bold text-white">
            {STAFF_ATTENDANCE_STATUS_LABELS[rec.status]}
          </span>
        </span>
      ) : (
        <span className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-white/[0.06] border border-white/10">
          <span className="w-2 h-2 rounded-full border border-white/40" />
          <span className="text-xs font-medium text-white/60">
            {checkInState === 'loading' ? 'Loading…' : 'Awaiting check-in'}
          </span>
        </span>
      )}

      {/* Who marked you (admin / approved leave) OR the live worked-time spell. */}
      {rec && markerName ? (
        <p className="flex items-center gap-1.5 text-[11px] text-white/60 max-w-[10rem] sm:max-w-[13rem]">
          <UserCheck size={11} className="flex-shrink-0" style={{ color: GOLD_BRIGHT }} />
          <span className="truncate">Marked by <span className="text-white/90 font-semibold">{markerName}</span></span>
        </p>
      ) : workedMs !== null ? (
        <p className="flex items-center gap-1.5 leading-none">
          <span className="font-display text-lg font-bold text-white tabular-nums">{formatDuration(workedMs)}</span>
          <span className="text-[11px] text-white/55">{liveSince ? 'on campus' : 'total'}</span>
          {liveSince && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />}
        </p>
      ) : rec && !rec.check_in_time ? (
        <p className="text-[11px] text-white/50">No check-in yet</p>
      ) : null}

      {/* Within/outside school zone — moved here off the body. */}
      {isCheckedIn && rec.geofence_passed !== null && (
        <span className={`inline-flex items-center gap-1 text-[11px] font-medium ${
          rec.geofence_passed ? 'text-emerald-300' : 'text-amber-300'
        }`}>
          {rec.geofence_passed ? <ShieldCheck size={11} /> : <MapPin size={11} />}
          {rec.geofence_passed ? 'Within school zone' : 'Outside school zone'}
        </span>
      )}
    </div>
  )

  // ── Render — one stable hero shell across loading / in / out states ────────────

  return (
    <section
      className="relative overflow-hidden rounded-[1.5rem] bg-white border border-[#E4E4E7]"
      style={{ boxShadow: '0 1px 1px rgba(24,24,27,0.04), 0 16px 40px -20px rgba(24,24,27,0.18)' }}
    >
      {/* ── Dark band: live clock + status readout ── */}
      <div
        className="relative overflow-hidden sheen sheen-animate"
        style={{ background: 'linear-gradient(150deg, var(--page-gradient-from, #27272A) 0%, var(--page-gradient-to, #3D3B40) 100%)' }}
      >
        <div
          className="absolute -top-24 -right-16 w-64 h-64 rounded-full pointer-events-none"
          style={{ background: 'radial-gradient(circle, rgba(184,152,60,0.28), transparent 68%)' }}
        />
        <div className="absolute inset-x-0 top-0 h-px bg-white/20 pointer-events-none" />
        <div className="absolute -bottom-10 left-6 opacity-[0.05] pointer-events-none select-none">
          <Fingerprint size={130} className="text-white" />
        </div>

        <div className="relative px-4 py-3.5 sm:px-6 sm:py-4 flex items-center justify-between gap-3">
          {/* Clock */}
          <div className="min-w-0">
            <p className="eyebrow" style={{ color: GOLD_BRIGHT }}>Today · {weekday || '—'}</p>
            <div className="flex items-baseline gap-1.5 mt-2">
              <span className="font-display text-[2.15rem] sm:text-[2.9rem] font-bold leading-none text-white tabular-nums headline">
                {clockHM}
              </span>
              <span className="flex flex-col items-start leading-none gap-0.5 pb-0.5">
                <span className="text-[10px] font-bold text-white/40 tabular-nums">{clockSec}</span>
                <span className="text-[10px] font-bold text-white/60">{clockAmPm}</span>
              </span>
            </div>
            <p className="text-xs text-white/50 mt-1.5">{dateLabel}</p>
          </div>

          {/* Status readout */}
          {statusReadout}
        </div>
      </div>

      {/* ── Light body: punch timeline + actions ── */}
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
