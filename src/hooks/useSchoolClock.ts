'use client'

import { useEffect, useRef, useState } from 'react'
import { dateStringInZone, fetchAttendanceTimezone, fetchServerTime } from '@/lib/attendance'

export interface SchoolClock {
  /** Server-sourced "now", ticking locally off a one-time offset. Null until ready. */
  now: Date | null
  /** IANA zone the school's cutoffs are read in; null means fall back to the device zone. */
  timezone: string | null
  /** True once the server time and timezone have both landed. */
  ready: boolean
  /** Today's date as 'YYYY-MM-DD' in the school's zone. Null until ready. */
  today: string | null
}

/**
 * The clock every attendance decision on screen should be read from: the
 * database server's time, in the school's timezone.
 *
 * Neither piece may come from the device. Its clock can be set to anything the
 * person holding it likes, and its timezone shifts the meaning of every cutoff
 * — both of which would otherwise decide whether a check-in reads as Late. The
 * punch itself is scored server-side regardless, so this is what keeps the UI
 * agreeing with the record that actually gets written.
 *
 * The server is asked for the time once; after that the clock ticks locally
 * against the offset measured on that reply, so a running seconds display costs
 * one round trip rather than one per tick.
 *
 * @param tickMs how often the returned `now` advances. The default suits a
 *   view that only needs the current minute; pass 1000 for a seconds display.
 */
export function useSchoolClock(tickMs = 30_000): SchoolClock {
  const [now, setNow] = useState<Date | null>(null)
  const [timezone, setTimezone] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const offsetMs = useRef(0)

  useEffect(() => {
    let cancelled = false
    Promise.all([fetchServerTime(), fetchAttendanceTimezone()]).then(([serverNow, tz]) => {
      if (cancelled) return
      offsetMs.current = serverNow.getTime() - Date.now()
      setTimezone(tz)
      setNow(serverNow)
      setReady(true)
    })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!ready) return
    const id = setInterval(() => setNow(new Date(Date.now() + offsetMs.current)), tickMs)
    return () => clearInterval(id)
  }, [ready, tickMs])

  return { now, timezone, ready, today: now ? dateStringInZone(now, timezone) : null }
}
