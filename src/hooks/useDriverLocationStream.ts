'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { pushLocation } from '@/lib/bus'

// Don't write more than one breadcrumb per this interval, to bound row volume.
const MIN_WRITE_INTERVAL_MS = 8_000

/**
 * Lets a driver stream their GPS for a trip. While sharing, geolocation fixes
 * are throttled and written to bus_locations (which fans out to passengers via
 * Realtime). Stops on demand and on unmount.
 */
export function useDriverLocationStream(tripId: string): {
  sharing: boolean
  error: string | null
  lastSentAt: number | null
  start: () => void
  stop: () => void
} {
  const [sharing, setSharing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastSentAt, setLastSentAt] = useState<number | null>(null)
  const watchId = useRef<number | null>(null)
  const lastWrite = useRef(0)

  const stop = useCallback(() => {
    if (watchId.current !== null) {
      navigator.geolocation.clearWatch(watchId.current)
      watchId.current = null
    }
    setSharing(false)
  }, [])

  const start = useCallback(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setError('Location is not available on this device')
      return
    }
    setError(null)
    watchId.current = navigator.geolocation.watchPosition(
      async pos => {
        const now = Date.now()
        if (now - lastWrite.current < MIN_WRITE_INTERVAL_MS) return
        lastWrite.current = now
        const result = await pushLocation(tripId, {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          heading: pos.coords.heading,
          speed: pos.coords.speed,
          accuracy: pos.coords.accuracy,
        })
        if (result.success) setLastSentAt(now)
        else setError(result.error ?? 'Could not send location')
      },
      err => setError(err.message),
      { enableHighAccuracy: true, maximumAge: 5_000, timeout: 20_000 },
    )
    setSharing(true)
  }, [tripId])

  // Clean up the watch if the component unmounts while still sharing.
  useEffect(() => () => {
    if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current)
  }, [])

  return { sharing, error, lastSentAt, start, stop }
}
