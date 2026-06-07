'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { MapPin, Navigation, CheckCircle, XCircle, Loader2, AlertTriangle, Clock } from 'lucide-react'
import { checkInStaff, fetchMyStaffAttendance, GeofenceConfig, haversineDistance, STAFF_ATTENDANCE_STATUS_LABELS } from '@/lib/attendance'

interface StaffCheckInProps {
  staffId: string
  geofenceConfig: GeofenceConfig | null
  onCheckedIn: () => void
}

type GpsState = 'idle' | 'getting' | 'got' | 'error'
type CheckInState = 'loading' | 'not_checked_in' | 'checked_in' | 'saving'

interface PendingConfirm {
  coords: { lat: number; lng: number; accuracy: number }
  distanceM: number
  geofencePassed: boolean
  reason: 'outside_zone' | 'gps_error'
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
}

export default function StaffCheckIn({ staffId, geofenceConfig, onCheckedIn }: StaffCheckInProps) {
  const [checkInState, setCheckInState] = useState<CheckInState>('loading')
  const [existingRecord, setExistingRecord] = useState<{ check_in_time: string | null; status: string; geofence_passed: boolean | null } | null>(null)
  const [gpsState, setGpsState] = useState<GpsState>('idle')
  const [pending, setPending] = useState<PendingConfirm | null>(null)
  const [error, setError] = useState<string | null>(null)

  const today = new Date().toISOString().split('T')[0]
  const [todayYear, todayMonth] = today.split('-').map(Number)

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

  const doCheckIn = async (coords?: { lat: number; lng: number; accuracy: number }) => {
    setCheckInState('saving')
    setPending(null)
    const result = await checkInStaff(staffId, coords, geofenceConfig ?? undefined)
    if (result.success) {
      await loadTodayRecord()
      onCheckedIn()
    } else {
      setError('Check-in failed. Please try again.')
      setCheckInState('not_checked_in')
    }
  }

  const handleCheckInButton = () => {
    setError(null)
    setPending(null)

    // If geofence is enabled and configured, get GPS first
    if (geofenceConfig?.enabled && geofenceConfig.lat != null && geofenceConfig.lng != null) {
      setGpsState('getting')
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setGpsState('got')
          const coords = {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
          }
          const distanceM = Math.round(
            haversineDistance(coords.lat, coords.lng, geofenceConfig.lat!, geofenceConfig.lng!)
          )
          const geofencePassed = distanceM <= geofenceConfig.radius_m
          if (geofencePassed) {
            // Auto-confirm
            doCheckIn(coords)
          } else {
            setPending({ coords, distanceM, geofencePassed: false, reason: 'outside_zone' })
          }
        },
        () => {
          setGpsState('error')
          setPending({ coords: { lat: 0, lng: 0, accuracy: 0 }, distanceM: 0, geofencePassed: false, reason: 'gps_error' })
        },
        { timeout: 10000, enableHighAccuracy: true }
      )
    } else {
      // No geofence — check in immediately
      doCheckIn()
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

  if (checkInState === 'checked_in' && existingRecord) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-3 p-3 bg-green-50 border border-green-200 rounded-xl">
          <CheckCircle size={20} className="text-green-500 flex-shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-green-800">Checked In</p>
            {existingRecord.check_in_time && (
              <p className="text-xs text-green-600 flex items-center gap-1 mt-0.5">
                <Clock size={11} />
                {formatTime(existingRecord.check_in_time)}
              </p>
            )}
          </div>
          <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700 font-medium border border-green-200">
            {STAFF_ATTENDANCE_STATUS_LABELS[existingRecord.status as keyof typeof STAFF_ATTENDANCE_STATUS_LABELS] ?? existingRecord.status}
          </span>
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
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* GPS status indicator */}
      {gpsState === 'getting' && (
        <div className="flex items-center gap-2 p-3 bg-blue-50 border border-blue-100 rounded-xl text-sm text-blue-700">
          <Navigation size={14} className="animate-pulse" />
          Getting your location…
        </div>
      )}

      {/* Pending confirmation — outside zone */}
      {pending?.reason === 'outside_zone' && (
        <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl space-y-2">
          <div className="flex items-start gap-2">
            <AlertTriangle size={16} className="text-amber-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-amber-800">Outside School Zone</p>
              <p className="text-xs text-amber-700 mt-0.5">
                You are {pending.distanceM}m from school (limit: {geofenceConfig?.radius_m}m). Check in anyway?
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => doCheckIn(pending.coords)}
              disabled={checkInState === 'saving'}
              className="flex-1 py-1.5 text-xs font-medium bg-amber-500 text-white rounded-lg hover:bg-amber-600 disabled:opacity-50 transition-colors"
            >
              Check In Anyway
            </button>
            <button
              onClick={() => { setPending(null); setGpsState('idle') }}
              className="flex-1 py-1.5 text-xs font-medium bg-white text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Pending confirmation — GPS error */}
      {pending?.reason === 'gps_error' && (
        <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl space-y-2">
          <div className="flex items-start gap-2">
            <XCircle size={16} className="text-amber-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-amber-800">Could Not Get Location</p>
              <p className="text-xs text-amber-700 mt-0.5">Check in without GPS?</p>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => doCheckIn()}
              disabled={checkInState === 'saving'}
              className="flex-1 py-1.5 text-xs font-medium bg-amber-500 text-white rounded-lg hover:bg-amber-600 disabled:opacity-50 transition-colors"
            >
              Check In Without GPS
            </button>
            <button
              onClick={() => { setPending(null); setGpsState('idle') }}
              className="flex-1 py-1.5 text-xs font-medium bg-white text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {error && (
        <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-xl px-3 py-2">{error}</p>
      )}

      {/* Main check-in button */}
      {!pending && (
        <button
          onClick={handleCheckInButton}
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
      )}

      {geofenceConfig?.enabled && geofenceConfig.lat != null && (
        <p className="text-[11px] text-slate-400 text-center">
          Geofencing enabled · School radius: {geofenceConfig.radius_m}m
        </p>
      )}
    </div>
  )
}
