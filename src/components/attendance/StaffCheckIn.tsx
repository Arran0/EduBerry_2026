'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { MapPin, Navigation, CheckCircle, XCircle, Loader2, AlertTriangle, Clock, Home, Coffee, Lock, Pencil, X } from 'lucide-react'
import {
  checkInStaff,
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
  exempt: boolean
  onCheckedIn: () => void
}

type GpsState = 'idle' | 'getting' | 'got' | 'error'
type CheckInState = 'loading' | 'not_checked_in' | 'checked_in' | 'saving'
type CheckInMode = 'present' | 'wfh' | 'half_day'

interface PendingConfirm {
  coords: { lat: number; lng: number; accuracy: number }
  distanceM: number
  reason: 'outside_zone' | 'gps_error'
  mode: CheckInMode
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
}

// Editable statuses after check-in
const EDIT_STATUSES: StaffAttendanceStatus[] = ['present', 'late', 'half_day', 'wfh', 'absent']

// Per-status colour scheme for the "marked for today" box.
const STATUS_BOX: Record<StaffAttendanceStatus, { bg: string; border: string; icon: string; text: string; sub: string }> = {
  present:  { bg: 'bg-green-50',  border: 'border-green-200',  icon: 'text-green-500',  text: 'text-green-800',  sub: 'text-green-600' },
  late:     { bg: 'bg-amber-50',  border: 'border-amber-200',  icon: 'text-amber-500',  text: 'text-amber-800',  sub: 'text-amber-600' },
  half_day: { bg: 'bg-orange-50', border: 'border-orange-200', icon: 'text-orange-500', text: 'text-orange-800', sub: 'text-orange-600' },
  wfh:      { bg: 'bg-cyan-50',   border: 'border-cyan-200',   icon: 'text-cyan-500',   text: 'text-cyan-800',   sub: 'text-cyan-600' },
  absent:   { bg: 'bg-red-50',    border: 'border-red-200',    icon: 'text-red-500',    text: 'text-red-800',    sub: 'text-red-600' },
  on_leave: { bg: 'bg-blue-50',   border: 'border-blue-200',   icon: 'text-blue-500',   text: 'text-blue-800',   sub: 'text-blue-600' },
}

export default function StaffCheckIn({ staffId, geofenceConfig, lateCutoff, exempt, onCheckedIn }: StaffCheckInProps) {
  const [checkInState, setCheckInState] = useState<CheckInState>('loading')
  const [existingRecord, setExistingRecord] = useState<{ check_in_time: string | null; status: StaffAttendanceStatus; geofence_passed: boolean | null } | null>(null)
  const [gpsState, setGpsState] = useState<GpsState>('idle')
  const [pending, setPending] = useState<PendingConfirm | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)

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

  const doCheckIn = async (mode: CheckInMode, coords?: { lat: number; lng: number; accuracy: number }) => {
    setCheckInState('saving')
    setPending(null)
    const result = await checkInStaff(staffId, {
      coords,
      geofenceConfig: geofenceConfig ?? undefined,
      lateCutoff,
      status: mode === 'present' ? undefined : mode,
    })
    if (result.success) {
      await loadTodayRecord()
      onCheckedIn()
    } else {
      setError('Check-in failed. Please try again.')
      setCheckInState('not_checked_in')
    }
  }

  const handleCheckIn = (mode: CheckInMode) => {
    setError(null)
    setPending(null)

    // WFH does not require being at school — skip geofence entirely.
    if (mode === 'wfh' || !geofenceActive) {
      doCheckIn(mode)
      return
    }

    setGpsState('getting')
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGpsState('got')
        const coords = { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }
        const distanceM = Math.round(
          haversineDistance(coords.lat, coords.lng, geofenceConfig!.lat!, geofenceConfig!.lng!)
        )
        if (distanceM <= geofenceConfig!.radius_m) {
          doCheckIn(mode, coords)
        } else {
          setPending({ coords, distanceM, reason: 'outside_zone', mode })
        }
      },
      () => {
        setGpsState('error')
        setPending({ coords: { lat: 0, lng: 0, accuracy: 0 }, distanceM: 0, reason: 'gps_error', mode })
      },
      { timeout: 10000, enableHighAccuracy: true }
    )
  }

  const handleEditStatus = async (status: StaffAttendanceStatus) => {
    setCheckInState('saving')
    const ok = await staffUpdateOwnStatus(staffId, today, status)
    if (ok) {
      await loadTodayRecord()
      onCheckedIn()
      setEditing(false)
    } else {
      setError('Could not update status.')
      setCheckInState('checked_in')
    }
  }

  if (checkInState === 'loading') {
    return (
      <div className="flex items-center gap-2 py-6 justify-center text-slate-400">
        <Loader2 size={18} className="animate-spin" />
        <span className="text-sm">Loading today&apos;s status…</span>
      </div>
    )
  }

  // ── Already checked in ──────────────────────────────────────────────────────
  if (checkInState === 'checked_in' && existingRecord) {
    const box = STATUS_BOX[existingRecord.status]
    return (
      <div className="space-y-3">
        <div className={`flex items-center gap-3 p-3 ${box.bg} border ${box.border} rounded-xl transition-colors`}>
          <CheckCircle size={20} className={`${box.icon} flex-shrink-0`} />
          <div className="flex-1 min-w-0">
            <p className={`text-sm font-semibold ${box.text}`}>Marked for Today</p>
            {existingRecord.check_in_time && (
              <p className={`text-xs ${box.sub} flex items-center gap-1 mt-0.5`}>
                <Clock size={11} />
                {formatTime(existingRecord.check_in_time)}
              </p>
            )}
          </div>
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium border ${STAFF_ATTENDANCE_STATUS_COLORS[existingRecord.status]}`}>
            {STAFF_ATTENDANCE_STATUS_LABELS[existingRecord.status]}
          </span>
          <button
            onClick={() => setEditing(v => !v)}
            title="Edit status"
            className={`p-1.5 rounded-lg ${box.sub} hover:bg-black/5 transition-colors flex-shrink-0`}
          >
            {editing ? <X size={15} /> : <Pencil size={14} />}
          </button>
        </div>

        {existingRecord.geofence_passed !== null && (
          <div className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium ${
            existingRecord.geofence_passed
              ? 'bg-green-50 text-green-700 border border-green-100'
              : 'bg-amber-50 text-amber-700 border border-amber-100'
          }`}>
            <MapPin size={13} />
            {existingRecord.geofence_passed ? 'Within School Zone' : 'Outside School Zone'}
          </div>
        )}

        {/* Edit status */}
        {editing && (
          <div className="p-3 bg-slate-50 rounded-xl space-y-2">
            <p className="text-xs font-semibold text-slate-600">Update today&apos;s status</p>
            <div className="flex flex-wrap gap-1.5">
              {EDIT_STATUSES.map(s => (
                <button
                  key={s}
                  onClick={() => handleEditStatus(s)}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                    existingRecord.status === s ? STAFF_ATTENDANCE_STATUS_COLORS[s] : 'border-slate-200 text-slate-600 hover:bg-white'
                  }`}
                >
                  {STAFF_ATTENDANCE_STATUS_LABELS[s]}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    )
  }

  // ── Not checked in ──────────────────────────────────────────────────────────
  const willBeLate = deriveCheckInStatus(lateCutoff) === 'late'

  return (
    <div className="space-y-3">
      {gpsState === 'getting' && (
        <div className="flex items-center gap-2 p-3 bg-blue-50 border border-blue-100 rounded-xl text-sm text-blue-700">
          <Navigation size={14} className="animate-pulse" />
          Getting your location…
        </div>
      )}

      {/* Outside zone */}
      {pending?.reason === 'outside_zone' && (
        <div className={`p-3 rounded-xl space-y-2 border ${exempt ? 'bg-amber-50 border-amber-200' : 'bg-red-50 border-red-200'}`}>
          <div className="flex items-start gap-2">
            {exempt ? <AlertTriangle size={16} className="text-amber-500 flex-shrink-0 mt-0.5" /> : <Lock size={16} className="text-red-500 flex-shrink-0 mt-0.5" />}
            <div>
              <p className={`text-sm font-semibold ${exempt ? 'text-amber-800' : 'text-red-800'}`}>Outside School Zone</p>
              <p className={`text-xs mt-0.5 ${exempt ? 'text-amber-700' : 'text-red-700'}`}>
                You are {pending.distanceM}m from school (limit: {geofenceConfig?.radius_m}m).
                {exempt
                  ? ' You are exempted — you may check in anyway.'
                  : ' Only admin-exempted staff can check in from outside the zone.'}
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            {exempt && (
              <button
                onClick={() => doCheckIn(pending.mode, pending.coords)}
                className="flex-1 py-1.5 text-xs font-medium bg-amber-500 text-white rounded-lg hover:bg-amber-600 transition-colors"
              >
                Check In Anyway
              </button>
            )}
            <button
              onClick={() => { setPending(null); setGpsState('idle') }}
              className="flex-1 py-1.5 text-xs font-medium bg-white text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
            >
              {exempt ? 'Cancel' : 'OK'}
            </button>
          </div>
        </div>
      )}

      {/* GPS error */}
      {pending?.reason === 'gps_error' && (
        <div className={`p-3 rounded-xl space-y-2 border ${exempt ? 'bg-amber-50 border-amber-200' : 'bg-red-50 border-red-200'}`}>
          <div className="flex items-start gap-2">
            <XCircle size={16} className={`flex-shrink-0 mt-0.5 ${exempt ? 'text-amber-500' : 'text-red-500'}`} />
            <div>
              <p className={`text-sm font-semibold ${exempt ? 'text-amber-800' : 'text-red-800'}`}>Could Not Get Location</p>
              <p className={`text-xs mt-0.5 ${exempt ? 'text-amber-700' : 'text-red-700'}`}>
                {exempt ? 'Check in without GPS?' : 'Location is required. Please enable GPS and try again.'}
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            {exempt && (
              <button
                onClick={() => doCheckIn(pending.mode)}
                className="flex-1 py-1.5 text-xs font-medium bg-amber-500 text-white rounded-lg hover:bg-amber-600 transition-colors"
              >
                Check In Without GPS
              </button>
            )}
            <button
              onClick={() => { setPending(null); setGpsState('idle') }}
              className="flex-1 py-1.5 text-xs font-medium bg-white text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
            >
              {exempt ? 'Cancel' : 'Retry'}
            </button>
          </div>
        </div>
      )}

      {error && (
        <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-xl px-3 py-2">{error}</p>
      )}

      {!pending && (
        <>
          {willBeLate && (
            <p className="text-[11px] text-amber-600 bg-amber-50 border border-amber-100 rounded-lg px-3 py-1.5 flex items-center gap-1.5">
              <Clock size={12} /> Late cutoff ({lateCutoff}) has passed — you&apos;ll be marked <strong>Late</strong>.
            </p>
          )}

          <button
            onClick={() => handleCheckIn('present')}
            disabled={checkInState === 'saving' || gpsState === 'getting'}
            className="w-full flex items-center justify-center gap-2 py-3 bg-gradient-to-r from-rose-500 to-pink-600 text-white font-semibold rounded-xl hover:from-rose-600 hover:to-pink-700 disabled:opacity-50 transition-all shadow-sm text-sm"
          >
            {checkInState === 'saving' ? (
              <><Loader2 size={16} className="animate-spin" /> Saving…</>
            ) : gpsState === 'getting' ? (
              <><Navigation size={16} className="animate-pulse" /> Getting location…</>
            ) : (
              <><MapPin size={16} /> Check In for Today</>
            )}
          </button>

          {/* Alternative modes */}
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => handleCheckIn('wfh')}
              disabled={checkInState === 'saving' || gpsState === 'getting'}
              className="flex items-center justify-center gap-1.5 py-2 text-xs font-medium text-cyan-700 bg-cyan-50 border border-cyan-200 rounded-xl hover:bg-cyan-100 disabled:opacity-50 transition-colors"
            >
              <Home size={13} /> Work from Home
            </button>
            <button
              onClick={() => handleCheckIn('half_day')}
              disabled={checkInState === 'saving' || gpsState === 'getting'}
              className="flex items-center justify-center gap-1.5 py-2 text-xs font-medium text-orange-700 bg-orange-50 border border-orange-200 rounded-xl hover:bg-orange-100 disabled:opacity-50 transition-colors"
            >
              <Coffee size={13} /> Half Day
            </button>
          </div>
        </>
      )}

      {geofenceActive && (
        <p className="text-[11px] text-slate-400 text-center">
          Geofencing enabled · School radius: {geofenceConfig?.radius_m}m
          {exempt && <span className="text-violet-500 font-medium"> · You are exempted</span>}
        </p>
      )}
    </div>
  )
}
