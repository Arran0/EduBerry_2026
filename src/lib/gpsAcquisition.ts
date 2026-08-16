'use client'

/**
 * Decision-driven GPS acquisition.
 *
 * The previous implementation streamed `watchPosition` samples, kept whichever
 * one reported the smallest accuracy, and stopped as soon as any sample came in
 * under a fixed 30m — otherwise waiting the full 15s and returning the best it
 * had seen. Three things went wrong with that:
 *
 *   1. **The target was fixed, but the question isn't.** Someone stood in the
 *      middle of a 200m campus is decisively inside at 90m accuracy; someone at
 *      the far edge isn't decisive even at 20m. Waiting for 30m in the first case
 *      wastes ten seconds; accepting 30m in the second is a coin flip. What
 *      matters is not the accuracy number, it's whether the answer has stopped
 *      being in doubt — so that is what this module waits for.
 *
 *   2. **Single best sample, no corroboration.** "Smallest reported accuracy"
 *      is not the same as "most correct". A stale cached fix, or a Wi-Fi
 *      trilateration that happens to report optimistically, can win that contest
 *      outright. Samples are now cross-checked against each other and fused.
 *
 *   3. **Failure was a single undifferentiated `null`.** Permission denied,
 *      location services off, indoors with no lock, and iOS precise-location
 *      disabled all produced the same "Could not get location", so staff were
 *      told to "enable GPS" when GPS was already on. Each is now distinguished
 *      and gets its own instruction.
 *
 * The asymmetry worth noting: an `inside` verdict settles as soon as it is
 * corroborated, but an `outside` verdict has to hold steady for several seconds
 * before it is accepted. Cold-starting phones routinely hand over a stale fix
 * from wherever they last had a lock — often the staff member's home — and that
 * lands as a confident, precise-looking `outside`. Being quick to admit someone
 * costs nothing; being quick to turn them away costs them their attendance.
 */

import {
  Fence,
  GeofenceEvaluation,
  LatLng,
  COARSE_LOCK_ACCURACY_M,
  DEFAULT_TRUSTED_ACCURACY_M,
  evaluateGeofence,
  haversineDistance,
} from './geofence'

export interface LocationSample {
  lat: number
  lng: number
  accuracy: number
  /** Device timestamp of the fix, used to spot a stale cached position. */
  timestamp: number
}

export interface FusedFix {
  lat: number
  lng: number
  accuracy: number
  /** How many samples arrived in total (including ones rejected as outliers). */
  sampleCount: number
  /** How many samples agreed with each other and fed the fused position. */
  agreeingCount: number
  /** Best single-sample accuracy seen. */
  bestAccuracyM: number
  /** Spread between the agreeing samples — a cross-check on the reported accuracy. */
  spreadM: number
}

export type AcquisitionFailure =
  /** The user (or a policy) refused the location permission. */
  | 'permission_denied'
  /** Location services are off, or the platform could not produce any fix. */
  | 'unavailable'
  /** Samples never arrived within the time budget. */
  | 'timeout'
  /** No geolocation API at all (very old browser, or a non-secure origin). */
  | 'unsupported'

export type AcquisitionPhase = 'requesting' | 'acquiring' | 'refining' | 'settled' | 'failed'

export interface AcquisitionProgress {
  phase: AcquisitionPhase
  /** Current fused best estimate, if any samples have arrived. */
  fix: FusedFix | null
  /** Verdict against the fence as it currently stands — drives the live readout. */
  evaluation: GeofenceEvaluation | null
  sampleCount: number
  elapsedMs: number
  /** Set once the readings look like a network lock rather than a satellite one. */
  coarseLock: boolean
}

export interface AcquisitionResult {
  fix: FusedFix | null
  evaluation: GeofenceEvaluation | null
  failure: AcquisitionFailure | null
  elapsedMs: number
  /** Every sample seen, oldest first — attached to the telemetry row. */
  samples: LocationSample[]
  coarseLock: boolean
}

export interface AcquireOptions {
  /** Fence to decide against. When null, acquisition just maximises precision. */
  fence: Fence | null
  trustedAccuracyM?: number
  onProgress?: (p: AcquisitionProgress) => void
  signal?: AbortSignal
}

/** Total time budget. Beyond this the best available answer is returned. */
const MAX_WAIT_MS = 20000
/**
 * An `outside` verdict must hold for this long before it is accepted, so a stale
 * cached fix from the staff member's home cannot turn them away instantly.
 */
const OUTSIDE_CONFIRM_MS = 6000
/** A fix older than this is treated as cached rather than live. */
const STALE_FIX_MS = 10000
/**
 * Once the fence question is settled, keep going only if precision is still
 * improving meaningfully — otherwise there is nothing to gain from waiting.
 */
const REFINE_IMPROVEMENT_RATIO = 0.7

/**
 * Fuses agreeing samples into one estimate.
 *
 * Samples are weighted by 1/accuracy² (inverse-variance, so a 10m fix counts a
 * hundred times a 100m one), but the fused accuracy is deliberately *not*
 * reduced below the best single sample. Statistically, independent readings
 * would justify claiming a tighter bound — but consecutive GPS samples from one
 * stationary receiver are strongly correlated, sharing the same multipath and
 * atmospheric error, so that claim would be a fiction. Fusing improves *where*
 * we think the person is; it is not evidence that we know it better than the
 * hardware says we do.
 */
function fuse(samples: LocationSample[]): FusedFix | null {
  if (samples.length === 0) return null

  // Anchor on the most precise sample; anything whose uncertainty disc cannot
  // overlap the anchor's is a different reading of a different place, not a
  // noisier reading of the same one.
  const anchor = samples.reduce((a, s) => (s.accuracy < a.accuracy ? s : a))
  const agreeing = samples.filter(
    s => haversineDistance(s.lat, s.lng, anchor.lat, anchor.lng) <= anchor.accuracy + s.accuracy,
  )

  let sumW = 0
  let sumLat = 0
  let sumLng = 0
  for (const s of agreeing) {
    const w = 1 / Math.max(1, s.accuracy) ** 2
    sumW += w
    sumLat += s.lat * w
    sumLng += s.lng * w
  }

  const lat = sumLat / sumW
  const lng = sumLng / sumW
  const spreadM = agreeing.reduce(
    (max, s) => Math.max(max, haversineDistance(s.lat, s.lng, lat, lng)),
    0,
  )

  return {
    lat,
    lng,
    accuracy: anchor.accuracy,
    sampleCount: samples.length,
    agreeingCount: agreeing.length,
    bestAccuracyM: anchor.accuracy,
    spreadM: Math.round(spreadM),
  }
}

/**
 * Asks the Permissions API whether location is already blocked.
 *
 * Worth doing up front: a denied permission makes `watchPosition` fail silently
 * on some browsers and hang until timeout on others, and either way the staff
 * member sits watching a spinner for twenty seconds before being told something
 * the browser knew immediately. Not universally supported, so a negative answer
 * here is informative and anything else is simply ignored.
 */
async function isPermissionDenied(): Promise<boolean> {
  try {
    if (typeof navigator === 'undefined' || !navigator.permissions?.query) return false
    const status = await navigator.permissions.query({ name: 'geolocation' as PermissionName })
    return status.state === 'denied'
  } catch {
    return false
  }
}

export async function acquirePosition(options: AcquireOptions): Promise<AcquisitionResult> {
  const { fence, trustedAccuracyM = DEFAULT_TRUSTED_ACCURACY_M, onProgress, signal } = options
  const startedAt = Date.now()

  const emptyResult = (failure: AcquisitionFailure): AcquisitionResult => ({
    fix: null,
    evaluation: null,
    failure,
    elapsedMs: Date.now() - startedAt,
    samples: [],
    coarseLock: false,
  })

  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    onProgress?.({ phase: 'failed', fix: null, evaluation: null, sampleCount: 0, elapsedMs: 0, coarseLock: false })
    return emptyResult('unsupported')
  }

  if (await isPermissionDenied()) {
    onProgress?.({ phase: 'failed', fix: null, evaluation: null, sampleCount: 0, elapsedMs: 0, coarseLock: false })
    return emptyResult('permission_denied')
  }

  onProgress?.({ phase: 'requesting', fix: null, evaluation: null, sampleCount: 0, elapsedMs: 0, coarseLock: false })

  return new Promise<AcquisitionResult>(resolve => {
    const samples: LocationSample[] = []
    let watchId: number | null = null
    let settled = false
    let lastError: GeolocationPositionError | null = null
    /** When the verdict first became a stable `outside`, for the confirm delay. */
    let outsideSince: number | null = null
    let bestAccuracyAtSettleCheck = Infinity

    const evaluateNow = (fix: FusedFix | null): GeofenceEvaluation | null => {
      if (!fix || !fence) return null
      return evaluateGeofence({ lat: fix.lat, lng: fix.lng } as LatLng, fix.accuracy, fence, trustedAccuracyM)
    }

    const finish = (failure: AcquisitionFailure | null) => {
      if (settled) return
      settled = true
      if (watchId != null) navigator.geolocation.clearWatch(watchId)
      clearTimeout(deadline)
      signal?.removeEventListener('abort', onAbort)

      const fix = fuse(samples)
      const evaluation = evaluateNow(fix)
      const coarseLock = !!fix && fix.bestAccuracyM > COARSE_LOCK_ACCURACY_M

      // Samples arrived but none was usable against the fence — still a result,
      // not a failure; the verdict model decides what to do with a coarse fix.
      const resolvedFailure = fix ? null : failure ?? 'timeout'

      onProgress?.({
        phase: resolvedFailure ? 'failed' : 'settled',
        fix,
        evaluation,
        sampleCount: samples.length,
        elapsedMs: Date.now() - startedAt,
        coarseLock,
      })

      resolve({
        fix,
        evaluation,
        failure: resolvedFailure,
        elapsedMs: Date.now() - startedAt,
        samples,
        coarseLock,
      })
    }

    const onAbort = () => finish('timeout')
    signal?.addEventListener('abort', onAbort, { once: true })

    const deadline = setTimeout(() => finish('timeout'), MAX_WAIT_MS)

    watchId = navigator.geolocation.watchPosition(
      pos => {
        if (settled) return

        samples.push({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          timestamp: pos.timestamp,
        })

        const fix = fuse(samples)!
        const evaluation = evaluateNow(fix)
        const elapsedMs = Date.now() - startedAt
        const coarseLock = fix.bestAccuracyM > COARSE_LOCK_ACCURACY_M

        // A lone sample whose device timestamp predates this attempt is a cached
        // position, not a live one. It is kept — it may well be correct — but it
        // is not allowed to end the attempt by itself, because the whole point of
        // streaming samples is to catch the case where it is wrong.
        const onlyStaleSample =
          samples.length === 1 && Date.now() - pos.timestamp > STALE_FIX_MS

        let phase: AcquisitionPhase = 'acquiring'
        let done = false

        if (evaluation && !onlyStaleSample) {
          if (evaluation.verdict === 'inside') {
            // Settled in the staff member's favour — take it and stop.
            done = true
          } else if (evaluation.verdict === 'outside') {
            outsideSince ??= Date.now()
            phase = 'refining'
            // Hold for the confirm window, giving a satellite lock time to
            // supersede whatever stale or coarse fix produced this.
            done = Date.now() - outsideSince >= OUTSIDE_CONFIRM_MS && samples.length >= 2
          } else {
            // Uncertain: only precision can resolve it, so keep sampling while
            // precision is still meaningfully improving.
            outsideSince = null
            phase = 'refining'
            const improved = fix.bestAccuracyM < bestAccuracyAtSettleCheck * REFINE_IMPROVEMENT_RATIO
            if (improved) bestAccuracyAtSettleCheck = fix.bestAccuracyM
          }
        }

        // No fence configured — nothing to decide against, so take the first
        // live sample as-is. This also covers admin fence-point capture, where
        // there is no "inside/outside" question to corroborate; waiting for a
        // second sample here only matters on a device whose watchPosition
        // fires repeatedly, and on many desktop/laptop browsers it fires once
        // and then goes quiet, which would otherwise stall the whole call
        // until the 20s timeout on every single use.
        if (!fence && !onlyStaleSample) done = true

        onProgress?.({
          phase: done ? 'settled' : phase,
          fix,
          evaluation,
          sampleCount: samples.length,
          elapsedMs,
          coarseLock,
        })

        if (done) finish(null)
      },
      err => {
        lastError = err
        // Transient errors are expected while a lock is being acquired, so they
        // only end the attempt when they are terminal or nothing has arrived yet.
        if (err.code === err.PERMISSION_DENIED) {
          finish('permission_denied')
        } else if (samples.length === 0 && err.code === err.POSITION_UNAVAILABLE) {
          finish('unavailable')
        }
      },
      // maximumAge:0 asks for a live fix. It is not honoured everywhere, which is
      // exactly why staleness is also checked explicitly above rather than trusted.
      { enableHighAccuracy: true, maximumAge: 0, timeout: MAX_WAIT_MS },
    )

    // Keeps the lint-visible reference meaningful: the last error only matters if
    // nothing ever arrived, which the deadline path handles.
    void lastError
  })
}

/** Human-facing copy for each failure mode, so the UI never says "enable GPS" to
 *  someone whose GPS is already on. */
export const ACQUISITION_FAILURE_COPY: Record<AcquisitionFailure, { title: string; detail: string }> = {
  permission_denied: {
    title: 'Location permission blocked',
    detail:
      'This site is blocked from seeing your location. Open your browser’s site settings for this page, set Location to Allow, then try again.',
  },
  unavailable: {
    title: 'Location services are off',
    detail:
      'Your device could not produce a position at all. Turn on Location Services in your device settings, then try again.',
  },
  timeout: {
    title: 'Could not get a fix in time',
    detail:
      'No usable position arrived. Step near a window or outside for a moment — thick walls block satellite signals — then try again.',
  },
  unsupported: {
    title: 'Location not available on this browser',
    detail: 'This browser cannot provide a location. Please use the school app or a current browser.',
  },
}

/** Extra guidance shown when the readings look like a network lock. */
export const COARSE_LOCK_COPY = {
  title: 'Approximate location only',
  detail:
    'Your device is reporting an approximate position rather than a precise one. On iPhone, open Settings → Privacy & Security → Location Services, find your browser, and turn on “Precise Location”. On Android, set Location accuracy to High.',
}
