'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  MapPin, Navigation, CheckCircle, XCircle, Loader2, AlertTriangle, Clock, Lock, LogOut,
} from 'lucide-react'
import {
  checkInStaff,
  checkOutStaff,
  fetchMyStaffAttendance,
  fetchServerTime,
  deriveCheckInStatus,
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

const STATUS_BOX: Record<StaffAttendanceStatus, { bg: string; border: string; icon: string; text: string; sub: string }> = {
  present:  { bg: 'bg-green-50',   border: 'border-green-200',   icon: 'text-green-500',   text: 'text-green-800',   sub: 'text-green-600' },
  late:     { bg: 'bg-amber-50',   border: 'border-amber-200',   icon: 'text-amber-500',   text: 'text-amber-800',   sub: 'text-amber-600' },
  half_day: { bg: 'bg-orange-50',  border: 'border-orange-200',  icon: 'text-orange-500',  text: 'text-orange-800',  sub: 'text-orange-600' },
  wfh:      { bg: 'bg-cyan-50',    border: 'border-cyan-200',    icon: 'text-cyan-500',    text: 'text-cyan-800',    sub: 'text-cyan-600' },
  absent:   { bg: 'bg-red-50',     border: 'border-red-200',     icon: 'text-red-500',     text: 'text-red-800',     sub: 'text-red-600' },
  on_leave: { bg: 'bg-blue-50',    border: 'border-blue-200',    icon: 'text-blue-500',    text: 'text-blue-800',    sub: 'text-blue-600' },
  e:        { bg: 'bg-violet-50',  border: 'border-violet-200',  icon: 'text-violet-500',  text: 'text-violet-800',  sub: 'text-violet-600' },
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
  } | null>(null)
  const [gpsState, setGpsState] = useState<GpsState>('idle')
  const [pending, setPending] = useState<PendingAction | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [checkoutSaving, setCheckoutSaving] = useState(false)

  // Sourced from the DB server clock, not the device's — a device clock can be set to
  // whatever the user likes, which would otherwise let them dodge the late cutoff notice.
  const [serverNow, setServerNow] = useState<Date | null>(null)
  useEffect(() => { fetchServerTime().then(setServerNow) }, [])

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
      })
      setCheckInState('checked_in')
    } else {
      setExistingRecord(null)
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
      setError('Check-in failed. Please try again.')
      setCheckInState('not_checked_in')
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
      setError('Check-out failed. Please try again.')
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

  // ── Loading ───────────────────────────────────────────────────────────────────

  if (checkInState === 'loading') {
    return (
      <div className="flex items-center gap-2 py-8 justify-center text-slate-400">
        <Loader2 size={18} className="animate-spin" />
        <span className="text-sm">Loading today&apos;s status…</span>
      </div>
    )
  }

  const isBusy = checkInState === 'saving' || gpsState === 'getting' || checkoutSaving

  // ── Pending confirmation UI ───────────────────────────────────────────────────

  const pendingConfirmBlock = pending && (
    <div className={`p-4 space-y-3 border rounded-xl ${exempt ? 'bg-amber-50 border-amber-200' : 'bg-red-50 border-red-200'}`}>
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
          <button onClick={confirmPending} className="flex-1 py-2.5 text-sm font-semibold bg-amber-500 text-white hover:bg-amber-600 transition-colors active:scale-[0.98] rounded-lg">
            {pending.action === 'checkin' ? 'Check In Anyway' : 'Check Out Anyway'}
          </button>
        )}
        <button onClick={() => { setPending(null); setGpsState('idle') }} className="flex-1 py-2.5 text-sm font-medium bg-white text-slate-600 border border-slate-200 hover:bg-slate-50 transition-colors rounded-lg">
          {exempt ? 'Cancel' : pending.reason === 'gps_error' ? 'Retry' : 'OK'}
        </button>
      </div>
    </div>
  )

  // ── Already checked in ────────────────────────────────────────────────────────

  if (checkInState === 'checked_in' && existingRecord) {
    const box = STATUS_BOX[existingRecord.status]

    const canCheckOut       = !!existingRecord.check_in_time && !existingRecord.check_out_time
    const canSecondCheckIn  = !!existingRecord.check_in_time && !!existingRecord.check_out_time && !existingRecord.check_in_time_2
    const canSecondCheckOut = !!existingRecord.check_in_time_2 && !existingRecord.check_out_time_2
    const isCompleted       = !!existingRecord.check_out_time_2

    return (
      <div className="space-y-3">
        {/* Status card */}
        <div className={`p-4 rounded-xl ${box.bg} border ${box.border}`}>
          <div className="flex items-center gap-3">
            <div className="p-2 bg-white/70 flex-shrink-0 rounded-lg">
              <CheckCircle size={22} className={box.icon} />
            </div>
            <div className="flex-1 min-w-0">
              <p className={`font-bold text-base leading-tight ${box.text}`}>
                {STAFF_ATTENDANCE_STATUS_LABELS[existingRecord.status]}
              </p>
              <p className={`text-xs mt-0.5 ${box.sub}`}>Marked for today</p>
            </div>
            <div className="text-right flex-shrink-0 space-y-1">
              {existingRecord.check_in_time && (
                <div>
                  <p className={`text-base font-bold leading-tight ${box.text}`}>{formatTime(existingRecord.check_in_time)}</p>
                  <p className={`text-[10px] ${box.sub} flex items-center gap-0.5 justify-end`}><Clock size={9} /> check-in</p>
                </div>
              )}
              {existingRecord.check_out_time && (
                <div>
                  <p className={`text-base font-bold leading-tight ${box.text}`}>{formatTime(existingRecord.check_out_time)}</p>
                  <p className={`text-[10px] ${box.sub} flex items-center gap-0.5 justify-end`}><LogOut size={9} /> check-out</p>
                </div>
              )}
              {existingRecord.check_in_time_2 && (
                <div>
                  <p className="text-base font-bold leading-tight text-violet-700">{formatTime(existingRecord.check_in_time_2)}</p>
                  <p className="text-[10px] text-violet-500 flex items-center gap-0.5 justify-end"><Clock size={9} /> return in</p>
                </div>
              )}
              {existingRecord.check_out_time_2 && (
                <div>
                  <p className="text-base font-bold leading-tight text-violet-700">{formatTime(existingRecord.check_out_time_2)}</p>
                  <p className="text-[10px] text-violet-500 flex items-center gap-0.5 justify-end"><LogOut size={9} /> final out</p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Geofence badge */}
        {existingRecord.geofence_passed !== null && (
          <div className={`flex items-center gap-2 px-3 py-2 text-xs font-medium rounded-lg ${
            existingRecord.geofence_passed ? 'bg-green-50 text-green-700 border border-green-100' : 'bg-amber-50 text-amber-700 border border-amber-100'
          }`}>
            <MapPin size={13} className="flex-shrink-0" />
            {existingRecord.geofence_passed ? 'Within School Zone' : 'Outside School Zone'}
          </div>
        )}

        {gpsState === 'getting' && (
          <div className="flex items-center gap-2 p-3 bg-blue-50 border border-blue-100 text-sm text-blue-700 rounded-lg">
            <Navigation size={14} className="animate-pulse flex-shrink-0" />
            {canSecondCheckIn ? 'Getting your location for return check-in…' : 'Getting your location for checkout…'}
          </div>
        )}

        {pendingConfirmBlock}

        {error && <p className="text-xs text-red-600 bg-red-50 border border-red-100 px-3 py-2 rounded-lg">{error}</p>}

        {canCheckOut && !pending && (
          <button
            onClick={handleCheckOut}
            disabled={isBusy}
            className="w-full flex items-center justify-center gap-2 py-3 text-sm font-semibold disabled:opacity-50 transition-all active:scale-[0.98] border border-orange-300 text-orange-700 bg-orange-50 hover:bg-orange-100 rounded-xl"
          >
            {checkoutSaving ? (
              <><Loader2 size={16} className="animate-spin" /><span>Saving…</span></>
            ) : gpsState === 'getting' ? (
              <><Navigation size={16} className="animate-pulse" /><span>Getting location…</span></>
            ) : (
              <><LogOut size={16} /><span>Check Out</span></>
            )}
          </button>
        )}

        {canSecondCheckIn && !pending && (
          <button
            onClick={handleCheckIn}
            disabled={isBusy}
            className="w-full flex items-center justify-center gap-2 py-3 text-sm font-semibold disabled:opacity-50 transition-all active:scale-[0.98] border border-violet-300 text-violet-700 bg-violet-50 hover:bg-violet-100 rounded-xl"
          >
            {gpsState === 'getting' ? (
              <><Navigation size={16} className="animate-pulse" /><span>Getting location…</span></>
            ) : (
              <><MapPin size={16} /><span>Return Check-In</span></>
            )}
          </button>
        )}

        {canSecondCheckOut && !pending && (
          <button
            onClick={handleCheckOut}
            disabled={isBusy}
            className="w-full flex items-center justify-center gap-2 py-3 text-sm font-semibold disabled:opacity-50 transition-all active:scale-[0.98] border border-violet-300 text-violet-700 bg-violet-50 hover:bg-violet-100 rounded-xl"
          >
            {checkoutSaving ? (
              <><Loader2 size={16} className="animate-spin" /><span>Saving…</span></>
            ) : gpsState === 'getting' ? (
              <><Navigation size={16} className="animate-pulse" /><span>Getting location…</span></>
            ) : (
              <><LogOut size={16} /><span>Final Check-Out</span></>
            )}
          </button>
        )}

        {isCompleted && !pending && (
          <p className="text-xs text-violet-600 bg-violet-50 border border-violet-100 px-3 py-2 rounded-lg text-center">
            Permission break recorded — all check-ins and check-outs complete.
          </p>
        )}
      </div>
    )
  }

  // ── Not checked in ─────────────────────────────────────────────────────────────

  return (
    <div className="space-y-3">
      {gpsState === 'getting' && (
        <div className="flex items-center gap-2 p-3 bg-blue-50 border border-blue-100 text-sm text-blue-700">
          <Navigation size={14} className="animate-pulse flex-shrink-0" />
          Getting your location…
        </div>
      )}

      {pendingConfirmBlock}

      {gpsState === 'error' && !pending && (
        <div className="p-4 space-y-3 border bg-red-50 border-red-200 rounded-xl">
          <div className="flex items-start gap-3">
            <XCircle size={18} className="text-red-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-bold text-red-800">Could Not Get Location</p>
              <p className="text-xs mt-1 text-red-700">Location is required. Please enable GPS and try again.</p>
            </div>
          </div>
          <button onClick={() => setGpsState('idle')} className="w-full py-2.5 text-sm font-medium bg-white text-slate-600 border border-slate-200 hover:bg-slate-50 transition-colors rounded-lg">
            Retry
          </button>
        </div>
      )}

      {error && <p className="text-xs text-red-600 bg-red-50 border border-red-100 px-3 py-2 rounded-lg">{error}</p>}

      {!pending && gpsState !== 'error' && (
        <>
          <AnimatePresence>
            {showLateNotice && (
              <motion.div
                initial={{ opacity: 0, y: -6, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -6, scale: 0.97 }}
                transition={{ duration: 0.2 }}
                className="flex items-center gap-2 px-3.5 py-2 bg-amber-50 border border-amber-200 rounded-full shadow-sm"
              >
                <span className="w-5 h-5 rounded-full bg-amber-400 flex items-center justify-center flex-shrink-0">
                  <Clock size={11} className="text-white" />
                </span>
                <p className="text-xs text-amber-700 font-medium">Past {lateCutoff} — you&apos;ll be marked Late</p>
              </motion.div>
            )}
          </AnimatePresence>
          <button
            onClick={handleCheckIn}
            disabled={isBusy}
            className="w-full flex flex-col items-center justify-center gap-1.5 py-8 text-white font-extrabold disabled:opacity-50 transition-all active:scale-[0.98] text-lg rounded-3xl shadow-xl"
            style={{
              background: 'linear-gradient(135deg, var(--page-gradient-from), var(--page-gradient-to))',
              boxShadow: '0 16px 32px -12px var(--page-primary)',
            }}
          >
            {checkInState === 'saving' ? (
              <><Loader2 size={28} className="animate-spin" /><span>Saving…</span></>
            ) : gpsState === 'getting' ? (
              <><Navigation size={28} className="animate-pulse" /><span>Getting location…</span></>
            ) : (
              <><MapPin size={28} /><span>Check In for Today</span></>
            )}
          </button>
        </>
      )}

      {geofenceActive && (
        <p className="text-[11px] text-slate-400 text-center pt-1">
          Geofencing enabled · School radius: {geofenceConfig?.radius_m}m
          {exempt && <span className="text-violet-500 font-medium"> · You are exempted</span>}
        </p>
      )}
    </div>
  )
}
