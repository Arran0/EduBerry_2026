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

const EDIT_STATUSES: StaffAttendanceStatus[] = ['present', 'late', 'half_day', 'wfh', 'absent']

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
  const [editSaving, setEditSaving] = useState(false)

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
    setEditSaving(true)
    const ok = await staffUpdateOwnStatus(staffId, today, status)
    if (ok) {
      await loadTodayRecord()
      onCheckedIn()
      setEditing(false)
    } else {
      setError('Could not update status.')
    }
    setEditSaving(false)
  }

  // ── Loading ──────────────────────────────────────────────────────────────────
  if (checkInState === 'loading') {
    return (
      <div className="flex items-center gap-2 py-8 justify-center text-slate-400">
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
            {existingRecord.check_in_time && (
              <div className="text-right flex-shrink-0">
                <p className={`text-lg font-bold leading-tight ${box.text}`}>
                  {formatTime(existingRecord.check_in_time)}
                </p>
                <p className={`text-[10px] ${box.sub} flex items-center gap-0.5 justify-end`}>
                  <Clock size={9} /> check-in
                </p>
              </div>
            )}
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

        {/* Edit toggle */}
        <button
          onClick={() => setEditing(v => !v)}
          className="w-full flex items-center justify-center gap-1.5 py-2.5 text-xs font-medium text-slate-500 bg-slate-50 border border-slate-200 rounded-xl hover:bg-slate-100 transition-colors"
        >
          {editing ? <><X size={13} /> Cancel</> : <><Pencil size={13} /> Edit Status</>}
        </button>

        {/* Edit panel */}
        {editing && (
          <div className="p-4 bg-slate-50 border border-slate-100 rounded-2xl space-y-3">
            <p className="text-xs font-semibold text-slate-600">Change today&apos;s status</p>
            <div className="grid grid-cols-3 gap-2">
              {EDIT_STATUSES.map(s => (
                <button
                  key={s}
                  onClick={() => handleEditStatus(s)}
                  disabled={editSaving}
                  className={`py-2.5 rounded-xl text-xs font-semibold border transition-colors disabled:opacity-50 ${
                    existingRecord.status === s
                      ? STAFF_ATTENDANCE_STATUS_COLORS[s]
                      : 'border-slate-200 text-slate-600 bg-white hover:bg-slate-50 active:scale-95'
                  }`}
                >
                  {STAFF_ATTENDANCE_STATUS_LABELS[s]}
                </button>
              ))}
            </div>
            {error && <p className="text-[11px] text-red-600">{error}</p>}
          </div>
        )}
      </div>
    )
  }

  // ── Not checked in ──────────────────────────────────────────────────────────
  const willBeLate = deriveCheckInStatus(lateCutoff) === 'late'
  const isBusy = checkInState === 'saving' || gpsState === 'getting'

  return (
    <div className="space-y-3">
      {/* GPS getting indicator */}
      {gpsState === 'getting' && (
        <div className="flex items-center gap-2 p-3 bg-blue-50 border border-blue-100 rounded-xl text-sm text-blue-700">
          <Navigation size={14} className="animate-pulse flex-shrink-0" />
          Getting your location…
        </div>
      )}

      {/* Outside school zone */}
      {pending?.reason === 'outside_zone' && (
        <div className={`p-4 rounded-2xl space-y-3 border ${exempt ? 'bg-amber-50 border-amber-200' : 'bg-red-50 border-red-200'}`}>
          <div className="flex items-start gap-3">
            {exempt
              ? <AlertTriangle size={18} className="text-amber-500 flex-shrink-0 mt-0.5" />
              : <Lock size={18} className="text-red-500 flex-shrink-0 mt-0.5" />
            }
            <div>
              <p className={`text-sm font-bold ${exempt ? 'text-amber-800' : 'text-red-800'}`}>Outside School Zone</p>
              <p className={`text-xs mt-1 leading-relaxed ${exempt ? 'text-amber-700' : 'text-red-700'}`}>
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
                className="flex-1 py-2.5 text-sm font-semibold bg-amber-500 text-white rounded-xl hover:bg-amber-600 transition-colors active:scale-[0.98]"
              >
                Check In Anyway
              </button>
            )}
            <button
              onClick={() => { setPending(null); setGpsState('idle') }}
              className="flex-1 py-2.5 text-sm font-medium bg-white text-slate-600 border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors"
            >
              {exempt ? 'Cancel' : 'OK'}
            </button>
          </div>
        </div>
      )}

      {/* GPS error */}
      {pending?.reason === 'gps_error' && (
        <div className={`p-4 rounded-2xl space-y-3 border ${exempt ? 'bg-amber-50 border-amber-200' : 'bg-red-50 border-red-200'}`}>
          <div className="flex items-start gap-3">
            <XCircle size={18} className={`flex-shrink-0 mt-0.5 ${exempt ? 'text-amber-500' : 'text-red-500'}`} />
            <div>
              <p className={`text-sm font-bold ${exempt ? 'text-amber-800' : 'text-red-800'}`}>Could Not Get Location</p>
              <p className={`text-xs mt-1 ${exempt ? 'text-amber-700' : 'text-red-700'}`}>
                {exempt ? 'Check in without GPS?' : 'Location is required. Please enable GPS and try again.'}
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            {exempt && (
              <button
                onClick={() => doCheckIn(pending.mode)}
                className="flex-1 py-2.5 text-sm font-semibold bg-amber-500 text-white rounded-xl hover:bg-amber-600 transition-colors active:scale-[0.98]"
              >
                Check In Without GPS
              </button>
            )}
            <button
              onClick={() => { setPending(null); setGpsState('idle') }}
              className="flex-1 py-2.5 text-sm font-medium bg-white text-slate-600 border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors"
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
            <div className="flex items-center gap-2 p-3 bg-amber-50 border border-amber-100 rounded-xl">
              <Clock size={14} className="text-amber-500 flex-shrink-0" />
              <p className="text-xs text-amber-700">
                Late cutoff ({lateCutoff}) has passed — you&apos;ll be marked <strong>Late</strong>.
              </p>
            </div>
          )}

          {/* Primary check-in button */}
          <button
            onClick={() => handleCheckIn('present')}
            disabled={isBusy}
            className="w-full flex flex-col items-center justify-center gap-1.5 py-5 bg-gradient-to-br from-violet-500 via-purple-600 to-pink-600 text-white font-bold rounded-2xl hover:from-violet-600 hover:to-pink-700 disabled:opacity-50 transition-all shadow-md active:scale-[0.98] text-base"
          >
            {checkInState === 'saving' ? (
              <><Loader2 size={22} className="animate-spin" /><span>Saving…</span></>
            ) : gpsState === 'getting' ? (
              <><Navigation size={22} className="animate-pulse" /><span>Getting location…</span></>
            ) : (
              <><MapPin size={22} /><span>Check In for Today</span></>
            )}
          </button>

          {/* Alternative modes */}
          <div className="grid grid-cols-2 gap-2.5">
            <button
              onClick={() => handleCheckIn('wfh')}
              disabled={isBusy}
              className="flex flex-col items-center gap-1.5 py-4 text-cyan-700 bg-cyan-50 border border-cyan-200 rounded-2xl hover:bg-cyan-100 disabled:opacity-50 transition-colors active:scale-[0.98]"
            >
              <Home size={18} />
              <span className="text-xs font-semibold">Work from Home</span>
            </button>
            <button
              onClick={() => handleCheckIn('half_day')}
              disabled={isBusy}
              className="flex flex-col items-center gap-1.5 py-4 text-orange-700 bg-orange-50 border border-orange-200 rounded-2xl hover:bg-orange-100 disabled:opacity-50 transition-colors active:scale-[0.98]"
            >
              <Coffee size={18} />
              <span className="text-xs font-semibold">Half Day</span>
            </button>
          </div>
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
