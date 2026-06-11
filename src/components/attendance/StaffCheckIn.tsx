'use client'

import React, { useState, useEffect, useCallback } from 'react'
import {
  MapPin, Navigation, CheckCircle, XCircle, Loader2, AlertTriangle,
  Clock, Lock, Pencil, X, LogOut,
} from 'lucide-react'
import {
  checkInStaff,
  checkOutStaff,
  staffUpdateOwnStatus,
  fetchMyStaffAttendance,
  deriveCheckInStatus,
  GeofenceConfig,
  StaffAttendanceStatus,
  haversineDistance,
  STAFF_ATTENDANCE_STATUS_LABELS,
  STAFF_ATTENDANCE_STATUS_COLORS,
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
  action: 'checkin' | 'checkout' | 'edit'
  editStatus?: StaffAttendanceStatus
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
}

// Statuses that staff can self-edit — WFH removed; only admin panel can set WFH.
const EDIT_STATUSES: StaffAttendanceStatus[] = ['present', 'late', 'half_day', 'absent']

// Statuses that require the staff member to be physically on-site (GPS check).
const GPS_REQUIRED_STATUSES: StaffAttendanceStatus[] = ['present', 'late', 'half_day']

const STATUS_BOX: Record<StaffAttendanceStatus, { bg: string; border: string; icon: string; text: string; sub: string }> = {
  present:  { bg: 'bg-green-50',  border: 'border-green-200',  icon: 'text-green-500',  text: 'text-green-800',  sub: 'text-green-600' },
  late:     { bg: 'bg-amber-50',  border: 'border-amber-200',  icon: 'text-amber-500',  text: 'text-amber-800',  sub: 'text-amber-600' },
  half_day: { bg: 'bg-orange-50', border: 'border-orange-200', icon: 'text-orange-500', text: 'text-orange-800', sub: 'text-orange-600' },
  wfh:      { bg: 'bg-cyan-50',   border: 'border-cyan-200',   icon: 'text-cyan-500',   text: 'text-cyan-800',   sub: 'text-cyan-600' },
  absent:   { bg: 'bg-red-50',    border: 'border-red-200',    icon: 'text-red-500',    text: 'text-red-800',    sub: 'text-red-600' },
  on_leave: { bg: 'bg-blue-50',   border: 'border-blue-200',   icon: 'text-blue-500',   text: 'text-blue-800',   sub: 'text-blue-600' },
}

export default function StaffCheckIn({
  staffId, geofenceConfig, lateCutoff, checkoutCutoff, exempt, onCheckedIn,
}: StaffCheckInProps) {
  const [checkInState, setCheckInState] = useState<CheckInState>('loading')
  const [existingRecord, setExistingRecord] = useState<{
    check_in_time: string | null
    check_out_time: string | null
    status: StaffAttendanceStatus
    geofence_passed: boolean | null
  } | null>(null)
  const [gpsState, setGpsState] = useState<GpsState>('idle')
  const [pending, setPending] = useState<PendingAction | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [editSaving, setEditSaving] = useState(false)
  const [editGpsGetting, setEditGpsGetting] = useState(false)

  const today = new Date().toISOString().split('T')[0]
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

  // ── Geolocation helpers ───────────────────────────────────────────────────────

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
    const result = await checkInStaff(staffId, {
      coords,
      geofenceConfig: geofenceConfig ?? undefined,
      lateCutoff,
    })
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

    if (!geofenceActive) {
      doCheckIn()
      return
    }

    setGpsState('getting')
    const coords = await getGpsCoords()
    setGpsState(coords ? 'got' : 'error')

    if (!coords) {
      if (exempt) {
        setPending({ coords: { lat: 0, lng: 0, accuracy: 0 }, distanceM: 0, reason: 'gps_error', action: 'checkin' })
      } else {
        setError('Location is required. Please enable GPS and try again.')
        setGpsState('idle')
      }
      return
    }

    const { passed, distanceM } = checkGeofence(coords)
    if (passed) {
      doCheckIn(coords)
    } else if (exempt) {
      setPending({ coords, distanceM, reason: 'outside_zone', action: 'checkin' })
    } else {
      setError(`You are ${distanceM}m from school (limit: ${geofenceConfig?.radius_m}m). Check-in blocked.`)
      setGpsState('idle')
    }
  }

  // ── Check-out ─────────────────────────────────────────────────────────────────

  const doCheckOut = async (coords?: { lat: number; lng: number; accuracy: number }) => {
    setCheckInState('saving')
    setPending(null)
    const result = await checkOutStaff(staffId, {
      coords,
      geofenceConfig: geofenceConfig ?? undefined,
      checkoutCutoff,
    })
    if (result.success) {
      await loadTodayRecord()
      onCheckedIn()
      if (result.markedHalfDay) {
        setError(`Early checkout detected — marked as Half Day.`)
      }
    } else {
      setError('Check-out failed. Please try again.')
      setCheckInState('checked_in')
    }
  }

  const handleCheckOut = async () => {
    setError(null)
    setPending(null)

    if (!geofenceActive) {
      doCheckOut()
      return
    }

    setGpsState('getting')
    const coords = await getGpsCoords()
    setGpsState(coords ? 'got' : 'error')

    if (!coords) {
      if (exempt) {
        setPending({ coords: { lat: 0, lng: 0, accuracy: 0 }, distanceM: 0, reason: 'gps_error', action: 'checkout' })
      } else {
        setError('Location is required for checkout. Please enable GPS.')
        setGpsState('idle')
      }
      return
    }

    const { passed, distanceM } = checkGeofence(coords)
    if (passed) {
      doCheckOut(coords)
    } else if (exempt) {
      setPending({ coords, distanceM, reason: 'outside_zone', action: 'checkout' })
    } else {
      setError(`You are ${distanceM}m from school (limit: ${geofenceConfig?.radius_m}m). Checkout blocked.`)
      setGpsState('idle')
    }
  }

  // ── Edit own status ───────────────────────────────────────────────────────────

  const doSaveEdit = async (status: StaffAttendanceStatus, coords?: { lat: number; lng: number; accuracy: number }) => {
    setEditSaving(true)
    let ok: boolean
    if (coords) {
      // Save with GPS coords via staffUpdateOwnStatus (stores coords if needed via checkInStaff)
      ok = await staffUpdateOwnStatus(staffId, today, status)
    } else {
      ok = await staffUpdateOwnStatus(staffId, today, status)
    }
    if (ok) {
      await loadTodayRecord()
      onCheckedIn()
      setEditing(false)
    } else {
      setError('Could not update status.')
    }
    setEditSaving(false)
  }

  const handleEditStatus = async (status: StaffAttendanceStatus) => {
    setError(null)
    const needsGps = geofenceActive && GPS_REQUIRED_STATUSES.includes(status)

    if (!needsGps) {
      doSaveEdit(status)
      return
    }

    setEditGpsGetting(true)
    const coords = await getGpsCoords()
    setEditGpsGetting(false)

    if (!coords) {
      if (exempt) {
        setPending({ coords: { lat: 0, lng: 0, accuracy: 0 }, distanceM: 0, reason: 'gps_error', action: 'edit', editStatus: status })
      } else {
        setError(`Location required to mark as ${STAFF_ATTENDANCE_STATUS_LABELS[status]}. Please enable GPS.`)
      }
      return
    }

    const { passed, distanceM } = checkGeofence(coords)
    if (passed) {
      doSaveEdit(status, coords)
    } else if (exempt) {
      setPending({ coords, distanceM, reason: 'outside_zone', action: 'edit', editStatus: status })
    } else {
      setError(`You are ${distanceM}m from school. Must be within ${geofenceConfig?.radius_m}m to mark as ${STAFF_ATTENDANCE_STATUS_LABELS[status]}.`)
    }
  }

  // ── Pending confirm handler ───────────────────────────────────────────────────

  const confirmPending = () => {
    if (!pending) return
    if (pending.action === 'checkin') doCheckIn(pending.reason === 'gps_error' ? undefined : pending.coords)
    else if (pending.action === 'checkout') doCheckOut(pending.reason === 'gps_error' ? undefined : pending.coords)
    else if (pending.action === 'edit' && pending.editStatus) doSaveEdit(pending.editStatus)
  }

  const cancelPending = () => { setPending(null); setGpsState('idle') }

  // ── Loading ───────────────────────────────────────────────────────────────────

  if (checkInState === 'loading') {
    return (
      <div className="flex items-center gap-2 py-8 justify-center text-slate-400">
        <Loader2 size={18} className="animate-spin" />
        <span className="text-sm">Loading today&apos;s status…</span>
      </div>
    )
  }

  const isBusy = checkInState === 'saving' || gpsState === 'getting' || editGpsGetting

  // ── Pending confirmation UI (shared for check-in, checkout, and edit) ─────────

  const pendingConfirmBlock = pending && (
    <div className={`p-4 rounded-2xl space-y-3 border ${exempt ? 'bg-amber-50 border-amber-200' : 'bg-red-50 border-red-200'}`}>
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
              : exempt ? 'Check in/out without GPS verification?' : 'Location is required. Please enable GPS and try again.'}
          </p>
        </div>
      </div>
      <div className="flex gap-2">
        {exempt && (
          <button
            onClick={confirmPending}
            className="flex-1 py-2.5 text-sm font-semibold bg-amber-500 text-white rounded-xl hover:bg-amber-600 transition-colors active:scale-[0.98]"
          >
            {pending.action === 'checkin' ? 'Check In Anyway' : pending.action === 'checkout' ? 'Check Out Anyway' : 'Save Anyway'}
          </button>
        )}
        <button
          onClick={cancelPending}
          className="flex-1 py-2.5 text-sm font-medium bg-white text-slate-600 border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors"
        >
          {exempt ? 'Cancel' : pending.reason === 'gps_error' ? 'Retry' : 'OK'}
        </button>
      </div>
    </div>
  )

  // ── Already checked in ────────────────────────────────────────────────────────

  if (checkInState === 'checked_in' && existingRecord) {
    const box = STATUS_BOX[existingRecord.status]
    const hasCheckedOut = !!existingRecord.check_out_time

    return (
      <div className="space-y-3">
        {/* Status card */}
        <div className={`p-4 ${box.bg} border ${box.border} rounded-2xl`}>
          <div className="flex items-center gap-3">
            <div className="p-2 bg-white/70 rounded-xl flex-shrink-0">
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
                  <p className={`text-base font-bold leading-tight ${box.text}`}>
                    {formatTime(existingRecord.check_in_time)}
                  </p>
                  <p className={`text-[10px] ${box.sub} flex items-center gap-0.5 justify-end`}>
                    <Clock size={9} /> check-in
                  </p>
                </div>
              )}
              {existingRecord.check_out_time && (
                <div>
                  <p className={`text-base font-bold leading-tight ${box.text}`}>
                    {formatTime(existingRecord.check_out_time)}
                  </p>
                  <p className={`text-[10px] ${box.sub} flex items-center gap-0.5 justify-end`}>
                    <LogOut size={9} /> check-out
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Geofence badge */}
        {existingRecord.geofence_passed !== null && (
          <div className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium ${
            existingRecord.geofence_passed
              ? 'bg-green-50 text-green-700 border border-green-100'
              : 'bg-amber-50 text-amber-700 border border-amber-100'
          }`}>
            <MapPin size={13} className="flex-shrink-0" />
            {existingRecord.geofence_passed ? 'Within School Zone' : 'Outside School Zone'}
          </div>
        )}

        {/* GPS getting for edit */}
        {editGpsGetting && (
          <div className="flex items-center gap-2 p-3 bg-blue-50 border border-blue-100 rounded-xl text-sm text-blue-700">
            <Navigation size={14} className="animate-pulse flex-shrink-0" />
            Verifying your location…
          </div>
        )}

        {/* GPS getting for checkout */}
        {gpsState === 'getting' && (
          <div className="flex items-center gap-2 p-3 bg-blue-50 border border-blue-100 rounded-xl text-sm text-blue-700">
            <Navigation size={14} className="animate-pulse flex-shrink-0" />
            Getting your location for checkout…
          </div>
        )}

        {pendingConfirmBlock}

        {error && (
          <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-xl px-3 py-2">{error}</p>
        )}

        {/* Check-out button — only if not already checked out */}
        {!hasCheckedOut && !pending && (
          <button
            onClick={handleCheckOut}
            disabled={isBusy}
            className="w-full flex items-center justify-center gap-2 py-3.5 text-sm font-semibold rounded-2xl disabled:opacity-50 transition-all active:scale-[0.98] border-2 border-orange-200 text-orange-700 bg-orange-50 hover:bg-orange-100"
          >
            {checkInState === 'saving' ? (
              <><Loader2 size={16} className="animate-spin" /><span>Saving…</span></>
            ) : gpsState === 'getting' ? (
              <><Navigation size={16} className="animate-pulse" /><span>Getting location…</span></>
            ) : (
              <><LogOut size={16} /><span>Check Out</span></>
            )}
          </button>
        )}

        {/* Edit toggle */}
        {!pending && (
          <button
            onClick={() => { setEditing(v => !v); setError(null) }}
            disabled={isBusy}
            className="w-full flex items-center justify-center gap-1.5 py-2.5 text-xs font-medium text-slate-500 bg-slate-50 border border-slate-200 rounded-xl hover:bg-slate-100 transition-colors disabled:opacity-50"
          >
            {editing ? <><X size={13} /> Cancel Edit</> : <><Pencil size={13} /> Edit Status</>}
          </button>
        )}

        {/* Edit panel */}
        {editing && !pending && (
          <div className="p-4 bg-slate-50 border border-slate-100 rounded-2xl space-y-3">
            <p className="text-xs font-semibold text-slate-600">
              Change today&apos;s status
              {geofenceActive && (
                <span className="ml-1 text-slate-400 font-normal">(location required for on-site statuses)</span>
              )}
            </p>
            {editGpsGetting && (
              <div className="flex items-center gap-2 text-xs text-blue-600">
                <Navigation size={12} className="animate-pulse" /> Checking location…
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              {EDIT_STATUSES.map(s => (
                <button
                  key={s}
                  onClick={() => handleEditStatus(s)}
                  disabled={editSaving || editGpsGetting}
                  className={`py-2.5 rounded-xl text-xs font-semibold border transition-colors disabled:opacity-50 active:scale-95 ${
                    existingRecord.status === s
                      ? STAFF_ATTENDANCE_STATUS_COLORS[s]
                      : 'border-slate-200 text-slate-600 bg-white hover:bg-slate-50'
                  }`}
                >
                  {STAFF_ATTENDANCE_STATUS_LABELS[s]}
                  {GPS_REQUIRED_STATUSES.includes(s) && geofenceActive && (
                    <span className="ml-1 opacity-50 text-[9px]">📍</span>
                  )}
                </button>
              ))}
            </div>
            {error && <p className="text-[11px] text-red-600">{error}</p>}
          </div>
        )}
      </div>
    )
  }

  // ── Not checked in ─────────────────────────────────────────────────────────────

  const willBeLate = deriveCheckInStatus(lateCutoff) === 'late'

  return (
    <div className="space-y-3">
      {/* GPS getting indicator */}
      {gpsState === 'getting' && (
        <div className="flex items-center gap-2 p-3 bg-blue-50 border border-blue-100 rounded-xl text-sm text-blue-700">
          <Navigation size={14} className="animate-pulse flex-shrink-0" />
          Getting your location…
        </div>
      )}

      {pendingConfirmBlock}

      {/* GPS error (non-exempt, retry prompt) */}
      {gpsState === 'error' && !pending && (
        <div className="p-4 rounded-2xl space-y-3 border bg-red-50 border-red-200">
          <div className="flex items-start gap-3">
            <XCircle size={18} className="text-red-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-bold text-red-800">Could Not Get Location</p>
              <p className="text-xs mt-1 text-red-700">Location is required. Please enable GPS and try again.</p>
            </div>
          </div>
          <button
            onClick={() => setGpsState('idle')}
            className="w-full py-2.5 text-sm font-medium bg-white text-slate-600 border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors"
          >
            Retry
          </button>
        </div>
      )}

      {error && (
        <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-xl px-3 py-2">{error}</p>
      )}

      {!pending && gpsState !== 'error' && (
        <>
          {willBeLate && (
            <div className="flex items-center gap-2 p-3 bg-amber-50 border border-amber-100 rounded-xl">
              <Clock size={14} className="text-amber-500 flex-shrink-0" />
              <p className="text-xs text-amber-700">
                Late cutoff ({lateCutoff}) has passed — you&apos;ll be marked <strong>Late</strong>.
              </p>
            </div>
          )}

          {/* Primary check-in button */}
          <button
            onClick={handleCheckIn}
            disabled={isBusy}
            className="w-full flex flex-col items-center justify-center gap-1.5 py-5 text-white font-bold rounded-2xl disabled:opacity-50 transition-all shadow-md active:scale-[0.98] text-base"
            style={{ background: 'linear-gradient(135deg, var(--page-gradient-from, #7c3aed), var(--page-gradient-to, #be185d))' }}
          >
            {checkInState === 'saving' ? (
              <><Loader2 size={22} className="animate-spin" /><span>Saving…</span></>
            ) : gpsState === 'getting' ? (
              <><Navigation size={22} className="animate-pulse" /><span>Getting location…</span></>
            ) : (
              <><MapPin size={22} /><span>Check In for Today</span></>
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
