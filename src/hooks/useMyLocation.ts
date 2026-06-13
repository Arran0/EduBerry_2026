'use client'

import { useState, useEffect } from 'react'

export interface Coords {
  lat: number
  lng: number
  accuracy: number | null
}

/**
 * Watches the browser's geolocation while `enabled` is true.
 * Returns the latest position (or null) plus any permission/availability error.
 */
export function useMyLocation(enabled: boolean): { coords: Coords | null; error: string | null } {
  const [coords, setCoords] = useState<Coords | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!enabled) return
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setError('Location is not available on this device')
      return
    }
    setError(null)
    const id = navigator.geolocation.watchPosition(
      pos => setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }),
      err => setError(err.message),
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: 20_000 },
    )
    return () => navigator.geolocation.clearWatch(id)
  }, [enabled])

  return { coords, error }
}
