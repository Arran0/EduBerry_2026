'use client'

import React, { useState } from 'react'
import { MapPin, Navigation, Trash2, Plus, Loader2, AlertTriangle, Satellite, Check } from 'lucide-react'
import { LatLng, polygonCentroid, DEFAULT_TRUSTED_ACCURACY_M } from '@/lib/geofence'
import { acquirePosition } from '@/lib/gpsAcquisition'
import { FenceShape } from '@/lib/attendance'

export interface FenceValue {
  shape: FenceShape
  lat: number | null
  lng: number | null
  /** Circle radius, or the outward buffer on a polygon outline. */
  radius_m: number
  polygon: LatLng[] | null
  /** null on a zone means "inherit the school-wide value". */
  trusted_accuracy_m: number | null
}

interface Props {
  value: FenceValue
  onChange: (patch: Partial<FenceValue>) => void
  /** Shown in place of a concrete number when trusted_accuracy_m is null. */
  inheritedAccuracyM?: number
  /** Compact layout for the per-zone editor inside the zones modal. */
  dense?: boolean
  idPrefix: string
}

const inputBase =
  'w-full border border-slate-200 rounded-lg px-2.5 py-2 text-sm bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 transition-colors'

/**
 * A capture this imprecise would shift the whole fence for every member of staff
 * checked against it, so it is refused rather than silently saved. An admin
 * standing in the office with a 300m fix would otherwise move the campus centre
 * 300m and make everyone else's check-in marginal.
 */
const MAX_CAPTURE_ACCURACY_M = 30

export default function FenceEditor({
  value, onChange, inheritedAccuracyM = DEFAULT_TRUSTED_ACCURACY_M, dense = false, idPrefix,
}: Props) {
  const [capturing, setCapturing] = useState<'centre' | 'vertex' | null>(null)
  const [captureAccuracy, setCaptureAccuracy] = useState<number | null>(null)
  const [captureError, setCaptureError] = useState<string | null>(null)

  const polygon = value.polygon ?? []

  /**
   * Captures a point by streaming samples and fusing them, rather than taking a
   * single `getCurrentPosition` reading as the old settings page did. The centre
   * point is the reference every staff member is measured against, so its own
   * error is added to everyone's — it is the one reading in the system worth
   * spending twenty seconds to get right.
   */
  const capture = async (target: 'centre' | 'vertex') => {
    setCapturing(target)
    setCaptureError(null)
    setCaptureAccuracy(null)

    const result = await acquirePosition({ fence: null })

    setCapturing(null)
    if (!result.fix) {
      setCaptureError('Could not get a position. Step outside and try again.')
      return
    }

    setCaptureAccuracy(Math.round(result.fix.accuracy))

    if (result.fix.accuracy > MAX_CAPTURE_ACCURACY_M) {
      setCaptureError(
        `Only accurate to ±${Math.round(result.fix.accuracy)}m — too imprecise to set the fence, ` +
        `which would shift it by that much for every member of staff. Move outside, away from ` +
        `buildings, and capture again.`,
      )
      return
    }

    const point: LatLng = { lat: result.fix.lat, lng: result.fix.lng }
    if (target === 'centre') {
      onChange({ lat: point.lat, lng: point.lng })
    } else {
      const next = [...polygon, point]
      // Keep lat/lng pointing at the outline's centroid so list views and map
      // pins still have a single point to show for a polygon fence.
      const c = polygonCentroid(next)
      onChange({ polygon: next, lat: c.lat, lng: c.lng })
    }
  }

  const removeVertex = (i: number) => {
    const next = polygon.filter((_, idx) => idx !== i)
    const c = next.length >= 1 ? polygonCentroid(next) : null
    onChange({ polygon: next, ...(c ? { lat: c.lat, lng: c.lng } : {}) })
  }

  const label = dense ? 'text-[11px]' : 'text-xs'

  return (
    <div className="space-y-3">
      {/* Shape toggle */}
      <div className="flex gap-1.5 p-1 bg-slate-100 rounded-lg w-fit">
        {(['circle', 'polygon'] as FenceShape[]).map(s => (
          <button
            key={s}
            type="button"
            onClick={() => onChange({ shape: s })}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
              value.shape === s ? 'bg-white text-[#18181B] shadow-sm' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {s === 'circle' ? 'Circle' : 'Campus outline'}
          </button>
        ))}
      </div>

      {value.shape === 'circle' ? (
        <>
          <div className={`grid ${dense ? 'grid-cols-3' : 'grid-cols-1 sm:grid-cols-3'} gap-3`}>
            <div>
              <label htmlFor={`${idPrefix}-lat`} className={`${label} font-medium text-[#71717A] block mb-1`}>Latitude</label>
              <input
                id={`${idPrefix}-lat`} type="number" step="0.000001" className={inputBase}
                value={value.lat ?? ''} placeholder="e.g. 12.971599"
                onChange={e => onChange({ lat: e.target.value ? parseFloat(e.target.value) : null })}
              />
            </div>
            <div>
              <label htmlFor={`${idPrefix}-lng`} className={`${label} font-medium text-[#71717A] block mb-1`}>Longitude</label>
              <input
                id={`${idPrefix}-lng`} type="number" step="0.000001" className={inputBase}
                value={value.lng ?? ''} placeholder="e.g. 77.594566"
                onChange={e => onChange({ lng: e.target.value ? parseFloat(e.target.value) : null })}
              />
            </div>
            <div>
              <label htmlFor={`${idPrefix}-radius`} className={`${label} font-medium text-[#71717A] block mb-1`}>Radius (m)</label>
              <input
                id={`${idPrefix}-radius`} type="number" min={10} max={5000} step={10} className={inputBase}
                value={value.radius_m}
                onChange={e => onChange({ radius_m: parseInt(e.target.value, 10) || 200 })}
              />
            </div>
          </div>

          <button
            type="button" onClick={() => capture('centre')} disabled={capturing !== null}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-50 transition-colors"
          >
            {capturing === 'centre'
              ? <><Loader2 size={13} className="animate-spin" /> Measuring…</>
              : <><Navigation size={13} /> Use my current position</>}
          </button>
        </>
      ) : (
        <>
          <p className={`${label} text-[#71717A] leading-relaxed`}>
            Walk the boundary of the campus and capture a corner at each turn. An outline follows the
            shape of the site, so a long or L-shaped campus no longer needs a circle wide enough to
            swallow the roads around it.
          </p>

          {polygon.length > 0 && (
            <ul className="space-y-1.5">
              {polygon.map((v, i) => (
                <li key={i} className="flex items-center gap-2 px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg">
                  <span className="w-5 h-5 rounded-full bg-[#B8983C]/10 text-[#B8983C] text-[10px] font-bold flex items-center justify-center flex-shrink-0">
                    {i + 1}
                  </span>
                  <span className="text-xs tabular-nums text-[#52525B] flex-1 truncate">
                    {v.lat.toFixed(6)}, {v.lng.toFixed(6)}
                  </span>
                  <button
                    type="button" onClick={() => removeVertex(i)}
                    className="text-slate-400 hover:text-red-500 transition-colors flex-shrink-0"
                    aria-label={`Remove corner ${i + 1}`}
                  >
                    <Trash2 size={13} />
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button" onClick={() => capture('vertex')} disabled={capturing !== null}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-50 transition-colors"
            >
              {capturing === 'vertex'
                ? <><Loader2 size={13} className="animate-spin" /> Measuring…</>
                : <><Plus size={13} /> Capture corner here</>}
            </button>

            <div className="flex items-center gap-1.5">
              <label htmlFor={`${idPrefix}-buffer`} className={`${label} font-medium text-[#71717A]`}>Buffer (m)</label>
              <input
                id={`${idPrefix}-buffer`} type="number" min={0} max={500} step={5}
                className={`${inputBase} w-20`} value={value.radius_m}
                onChange={e => onChange({ radius_m: parseInt(e.target.value, 10) || 0 })}
              />
            </div>
          </div>

          {polygon.length > 0 && polygon.length < 3 && (
            <p className="flex items-center gap-1.5 text-[11px] text-amber-600">
              <AlertTriangle size={12} /> An outline needs at least 3 corners — {3 - polygon.length} more to go.
            </p>
          )}
        </>
      )}

      {/* Capture feedback */}
      {captureError ? (
        <p className="flex items-start gap-1.5 text-[11px] text-red-600 leading-relaxed">
          <AlertTriangle size={12} className="flex-shrink-0 mt-0.5" /> {captureError}
        </p>
      ) : captureAccuracy != null ? (
        <p className="flex items-center gap-1.5 text-[11px] text-emerald-600">
          <Check size={12} /> Captured to ±{captureAccuracy}m.
        </p>
      ) : null}

      {/* Accuracy threshold */}
      <div className="pt-2 border-t border-slate-100">
        <label htmlFor={`${idPrefix}-trusted`} className={`${label} font-medium text-[#71717A] block mb-1`}>
          Trust readings up to (m)
        </label>
        <div className="flex items-center gap-2">
          <input
            id={`${idPrefix}-trusted`} type="number" min={20} max={1000} step={10}
            className={`${inputBase} w-28`}
            value={value.trusted_accuracy_m ?? ''}
            placeholder={`${inheritedAccuracyM}`}
            onChange={e => onChange({ trusted_accuracy_m: e.target.value ? parseInt(e.target.value, 10) : null })}
          />
          <p className="text-[11px] text-[#A1A1AA] leading-relaxed flex-1">
            A reading less precise than this is neither accepted nor refused on its own — it is
            recorded and sent for confirmation. Raising it accepts more coarse readings without
            review; lowering it sends more for review. Check the diagnostics before changing it.
          </p>
        </div>
      </div>
    </div>
  )
}
