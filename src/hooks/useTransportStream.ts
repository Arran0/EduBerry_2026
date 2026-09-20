'use client'

/**
 * The driver's position stream.
 *
 * Replaces useDriverLocationStream, which was a `watchPosition` behind an
 * 8-second time gate and nothing else. For a bus app that had three fatal
 * gaps: it died silently when the tab was backgrounded or the screen locked,
 * it lost every fix taken with no signal, and it forgot it had been running
 * if the page reloaded. A parent watching a blank map cannot tell any of those
 * apart from "the bus has not left yet".
 *
 * So this hook adds:
 *  - a screen wake lock, reacquired when the page becomes visible again;
 *  - an IndexedDB queue that buffers fixes through a dead zone and flushes them
 *    on reconnect (safe to replay: the telemetry table's unique index absorbs
 *    duplicates, and each fix carries its own capture time, so a flush lands as
 *    correct history rather than as the bus teleporting);
 *  - an adaptive cadence — often while moving, rarely while parked — which
 *    roughly halves both row volume and battery drain;
 *  - resume-on-reload, so a driver who reloads mid-route does not go dark.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { pushFix, pushFixes } from '@/lib/transport/runs'
import type { TransportFix } from '@/lib/transport/types'

/** Minimum gap between writes while the bus is moving. */
const MOVING_INTERVAL_MS = 5_000
/** …and while it is stationary. A parked bus does not need a row every 5s. */
const STATIONARY_INTERVAL_MS = 20_000
/** Below this speed the bus counts as stationary. */
const STATIONARY_KMH = 3
/** Ignore a fix that has barely moved, unless the slow cadence is due anyway. */
const MIN_DISTANCE_M = 30
/** A fix worse than this is too coarse to be worth a row. */
const MAX_ACCURACY_M = 200
/** Cap on the offline queue, oldest dropped first. */
const MAX_QUEUE = 2_000

const DB_NAME = 'edzee-transport'
const STORE = 'pending-fixes'
const RESUME_KEY = 'transport_active_run'

// ── IndexedDB queue ─────────────────────────────────────────────────────────
// Deliberately hand-rolled and tiny: this is the only persistent storage the
// module needs, and a library would be more code than the thing it wraps.

function openDb(): Promise<IDBDatabase | null> {
  return new Promise(resolve => {
    if (typeof indexedDB === 'undefined') { resolve(null); return }
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE, { keyPath: 'key', autoIncrement: true })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => resolve(null)
  })
}

async function queueFix(fix: TransportFix): Promise<void> {
  const db = await openDb()
  if (!db) return
  await new Promise<void>(resolve => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).add(fix)
    tx.oncomplete = () => resolve()
    tx.onerror = () => resolve()
  })
}

async function drainQueue(): Promise<TransportFix[]> {
  const db = await openDb()
  if (!db) return []
  return new Promise(resolve => {
    const tx = db.transaction(STORE, 'readwrite')
    const store = tx.objectStore(STORE)
    const req = store.getAll()
    req.onsuccess = () => {
      const rows = (req.result as (TransportFix & { key?: number })[]) || []
      store.clear()
      // Oldest first, and never more than the cap: a week-old backlog is not
      // worth replaying and would flood the table.
      resolve(rows.slice(-MAX_QUEUE).map(({ key, ...fix }) => fix as TransportFix))
    }
    req.onerror = () => resolve([])
  })
}

async function queueSize(): Promise<number> {
  const db = await openDb()
  if (!db) return 0
  return new Promise(resolve => {
    const tx = db.transaction(STORE, 'readonly')
    const req = tx.objectStore(STORE).count()
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => resolve(0)
  })
}

// ── Geometry ────────────────────────────────────────────────────────────────

function metresBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(s))
}

export interface TransportStreamState {
  sharing: boolean
  error: string | null
  lastSentAt: number | null
  /** Fixes waiting for a connection. Shown so a driver in a dead zone can see
   *  the app is still working rather than assume it has stopped. */
  pending: number
  wakeLockHeld: boolean
  start: () => void
  stop: () => void
}

export function useTransportStream(runId: string | null): TransportStreamState {
  const [sharing, setSharing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastSentAt, setLastSentAt] = useState<number | null>(null)
  const [pending, setPending] = useState(0)
  const [wakeLockHeld, setWakeLockHeld] = useState(false)

  const watchId = useRef<number | null>(null)
  const lastWrite = useRef<number>(0)
  const lastPoint = useRef<{ lat: number; lng: number } | null>(null)
  const wakeLock = useRef<WakeLockSentinel | null>(null)
  const runIdRef = useRef<string | null>(runId)
  runIdRef.current = runId

  const refreshPending = useCallback(async () => {
    setPending(await queueSize())
  }, [])

  const flush = useCallback(async () => {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return
    const queued = await drainQueue()
    if (queued.length === 0) return
    const res = await pushFixes(queued)
    if (!res.success) {
      // Put them back rather than losing them; the next flush tries again.
      for (const f of queued) await queueFix(f)
    }
    refreshPending()
  }, [refreshPending])

  const send = useCallback(async (fix: TransportFix) => {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      await queueFix(fix)
      refreshPending()
      return
    }
    const res = await pushFix(fix)
    if (res.success) {
      setLastSentAt(Date.now())
      setError(null)
      // A successful write means the connection is back — replay the backlog.
      flush()
    } else {
      await queueFix(fix)
      refreshPending()
    }
  }, [flush, refreshPending])

  const acquireWakeLock = useCallback(async () => {
    try {
      if (typeof navigator === 'undefined' || !('wakeLock' in navigator)) return
      wakeLock.current = await navigator.wakeLock.request('screen')
      setWakeLockHeld(true)
      wakeLock.current.addEventListener('release', () => setWakeLockHeld(false))
    } catch {
      // Denied or unsupported. Not fatal — tracking still works while the
      // screen is on, so this is never surfaced as an error to the driver.
      setWakeLockHeld(false)
    }
  }, [])

  const releaseWakeLock = useCallback(async () => {
    try { await wakeLock.current?.release() } catch { /* already gone */ }
    wakeLock.current = null
    setWakeLockHeld(false)
  }, [])

  const stop = useCallback(() => {
    if (watchId.current != null) {
      navigator.geolocation.clearWatch(watchId.current)
      watchId.current = null
    }
    releaseWakeLock()
    setSharing(false)
    try { localStorage.removeItem(RESUME_KEY) } catch { /* private mode */ }
  }, [releaseWakeLock])

  const start = useCallback(() => {
    if (!runIdRef.current) return
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setError('This device cannot share its location.')
      return
    }

    setSharing(true)
    setError(null)
    try { localStorage.setItem(RESUME_KEY, runIdRef.current) } catch { /* private mode */ }
    acquireWakeLock()
    flush()

    watchId.current = navigator.geolocation.watchPosition(
      pos => {
        const run = runIdRef.current
        if (!run) return

        const { latitude, longitude, accuracy, heading, speed } = pos.coords
        if (accuracy != null && accuracy > MAX_ACCURACY_M) return

        // speed is m/s from the platform; the contract is km/h everywhere else.
        const speedKmh = speed != null && speed >= 0 ? speed * 3.6 : null
        const moving = (speedKmh ?? 0) >= STATIONARY_KMH
        const interval = moving ? MOVING_INTERVAL_MS : STATIONARY_INTERVAL_MS

        const now = Date.now()
        const movedFar = lastPoint.current
          ? metresBetween(lastPoint.current, { lat: latitude, lng: longitude }) >= MIN_DISTANCE_M
          : true
        // Write when enough time has passed, or when the bus has clearly moved.
        if (now - lastWrite.current < interval && !movedFar) return

        lastWrite.current = now
        lastPoint.current = { lat: latitude, lng: longitude }

        send({
          runId: run,
          lat: Number(latitude.toFixed(6)),
          lng: Number(longitude.toFixed(6)),
          accuracyM: accuracy ?? null,
          headingDeg: heading != null && !Number.isNaN(heading) ? heading : null,
          speedKmh,
          recordedAt: new Date(pos.timestamp).toISOString(),
        })
      },
      err => {
        setError(
          err.code === err.PERMISSION_DENIED
            ? 'Location permission is off. Turn it on so parents can see the bus.'
            : 'Could not get a location fix. Trying again…',
        )
      },
      { enableHighAccuracy: true, maximumAge: 5_000, timeout: 20_000 },
    )
  }, [acquireWakeLock, flush, send])

  // Resume after a reload: a driver who refreshes mid-route should not have to
  // notice that they have gone dark.
  useEffect(() => {
    if (!runId) return
    let stored: string | null = null
    try { stored = localStorage.getItem(RESUME_KEY) } catch { /* private mode */ }
    if (stored === runId) start()
    refreshPending()
    // Intentionally runs once per run id; `start` is stable enough for that.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId])

  // Reacquire the wake lock the browser drops whenever the tab is hidden, and
  // take the chance to flush anything captured while offline.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible' && sharing) {
        acquireWakeLock()
        flush()
      }
    }
    const onOnline = () => { if (sharing) flush() }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', onOnline)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', onOnline)
    }
  }, [sharing, acquireWakeLock, flush])

  useEffect(() => () => {
    if (watchId.current != null) navigator.geolocation.clearWatch(watchId.current)
    wakeLock.current?.release().catch(() => { /* already gone */ })
  }, [])

  return { sharing, error, lastSentAt, pending, wakeLockHeld, start, stop }
}
