'use client'

import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { BusLocation, fetchLatestLocation } from '@/lib/bus'

/**
 * Live bus position for a trip. Seeds with the last persisted location, then
 * subscribes to Supabase Realtime INSERTs on bus_locations for this trip so the
 * marker updates as the driver streams GPS fixes.
 */
export function useBusLocation(tripId: string | null): BusLocation | null {
  const [location, setLocation] = useState<BusLocation | null>(null)

  useEffect(() => {
    if (!tripId) { setLocation(null); return }
    let active = true

    fetchLatestLocation(tripId).then(l => { if (active && l) setLocation(l) })

    const channel = supabase
      .channel(`bus_loc_${tripId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'bus_locations', filter: `trip_id=eq.${tripId}` },
        payload => { if (active) setLocation(payload.new as BusLocation) },
      )
      .subscribe()

    return () => {
      active = false
      supabase.removeChannel(channel)
    }
  }, [tripId])

  return location
}
