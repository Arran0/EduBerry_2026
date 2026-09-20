'use client'

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import {
  MapPin, Trash2, ArrowUp, ArrowDown, LocateFixed, School, Loader2, Route as RouteIcon,
} from 'lucide-react'
import { ADMIN } from '@/components/bus/adminUI'
import { acquirePosition } from '@/lib/gpsAcquisition'
import {
  fetchStops, createStop, updateStop, deleteStop, reorderStops, nextSeq,
  fetchRoutePaths, derivePathFromStops,
} from '@/lib/transport/stops'
import { updateRoute } from '@/lib/transport/routes'
import type { LatLng, TransportRoute, TransportRoutePath, TransportStop } from '@/lib/transport/types'
import { Field, TextInput } from './formUI'

// Leaflet touches `window` at import time, so the map can only load client-side.
const TransportMap = dynamic(() => import('./TransportMap'), {
  ssr: false,
  loading: () => (
    <div className="h-[380px] rounded-xl border border-[#E4E4E7] bg-[#FAFAFA] flex items-center justify-center">
      <Loader2 className="animate-spin text-[#A1A1AA]" size={20} />
    </div>
  ),
})

/**
 * The admin's capture must be at least this precise to be worth storing.
 * Mirrors `MAX_CAPTURE_ACCURACY_M` in the attendance FenceEditor: a 300 m fix
 * placed as a bus stop would put the geofence on the wrong street.
 */
const MAX_CAPTURE_ACCURACY_M = 30

export default function StopEditor({ route }: { route: TransportRoute }) {
  const [stops, setStops] = useState<TransportStop[]>([])
  const [paths, setPaths] = useState<TransportRoutePath[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [capture, setCapture] = useState<{ running: boolean; message: string | null }>({ running: false, message: null })

  const load = useCallback(async () => {
    setLoading(true)
    const [s, p] = await Promise.all([fetchStops(route.id), fetchRoutePaths(route.id)])
    setStops(s); setPaths(p); setLoading(false)
  }, [route.id])

  useEffect(() => { load() }, [load])

  const inboundPath = useMemo(() => paths.find(p => p.direction === 'inbound') ?? null, [paths])

  const mapStops = useMemo(
    () => stops.map(s => ({
      id: s.id, seq: s.seq, name: s.name, lat: s.lat, lng: s.lng,
      radius_m: s.radius_m, shape: s.shape, polygon: s.polygon,
      isSchool: s.kind === 'school',
    })),
    [stops],
  )

  const addStopAt = async (point: LatLng, name?: string) => {
    setBusy(true)
    const res = await createStop({
      route_id: route.id,
      seq: nextSeq(stops),
      name: name ?? `Stop ${nextSeq(stops)}`,
      lat: Number(point.lat.toFixed(6)),
      lng: Number(point.lng.toFixed(6)),
    })
    setBusy(false)
    if (res.success) { await load(); setSelectedId(res.id ?? null) }
  }

  const patchStop = async (stopId: string, patch: Partial<TransportStop>) => {
    // Optimistic so dragging a pin or nudging a radius slider feels direct.
    setStops(ss => ss.map(s => (s.id === stopId ? { ...s, ...patch } : s)))
    await updateStop(stopId, patch as never)
  }

  const move = async (stopId: string, delta: -1 | 1) => {
    const idx = stops.findIndex(s => s.id === stopId)
    const target = idx + delta
    if (idx < 0 || target < 0 || target >= stops.length) return
    const ordered = [...stops]
    const [moved] = ordered.splice(idx, 1)
    ordered.splice(target, 0, moved)
    setStops(ordered.map((s, i) => ({ ...s, seq: i + 1 })))
    setBusy(true)
    await reorderStops(route.id, ordered.map(s => s.id))
    setBusy(false)
    load()
  }

  const captureHere = async () => {
    setCapture({ running: true, message: 'Getting a precise fix…' })
    const res = await acquirePosition({ fence: null })
    if (!res.fix) {
      setCapture({ running: false, message: 'Could not get a location fix. Check location permission and try again.' })
      return
    }
    if (res.fix.accuracy > MAX_CAPTURE_ACCURACY_M) {
      setCapture({
        running: false,
        message: `That fix is only accurate to ${Math.round(res.fix.accuracy)} m — too coarse to place a stop. Step outside and try again, or click the map instead.`,
      })
      return
    }
    setCapture({ running: false, message: null })
    await addStopAt({ lat: res.fix.lat, lng: res.fix.lng })
  }

  const buildPath = async () => {
    setBusy(true)
    await Promise.all([
      derivePathFromStops(route.id, 'inbound'),
      derivePathFromStops(route.id, 'outbound'),
    ])
    setBusy(false)
    load()
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_20rem] gap-4">
      <div className="space-y-2">
        <TransportMap
          stops={mapStops}
          selectedStopId={selectedId}
          onStopClick={setSelectedId}
          onMapClick={p => addStopAt(p)}
          onStopDragEnd={(id, p) =>
            patchStop(id, { lat: Number(p.lat.toFixed(6)), lng: Number(p.lng.toFixed(6)) })
          }
          path={inboundPath?.polyline ?? null}
          pathColor={route.color}
          height={420}
          className="rounded-xl overflow-hidden border border-[#E4E4E7]"
        />
        <p className="text-[11px] text-[#A1A1AA]">
          Click the map to add a stop. Drag a pin to move it. The shaded circle is the
          stop&apos;s geofence — Round 2 uses it to detect arrival automatically.
        </p>
        <div className="flex flex-wrap gap-2">
          <button className={ADMIN.ghostBtn} onClick={captureHere} disabled={capture.running || busy}>
            {capture.running ? <Loader2 size={14} className="animate-spin" /> : <LocateFixed size={14} />}
            Add stop at my location
          </button>
          <button className={ADMIN.ghostBtn} onClick={buildPath} disabled={busy || stops.length < 2}>
            <RouteIcon size={14} /> Draw path through stops
          </button>
        </div>
        {capture.message && <p className="text-[11px] text-amber-600">{capture.message}</p>}
        {inboundPath?.source === 'stops' && (
          <p className="text-[11px] text-[#A1A1AA]">
            The path is currently a straight line through the stops
            {inboundPath.length_m ? ` (${(inboundPath.length_m / 1000).toFixed(1)} km)` : ''} —
            good enough to show the shape, but widen the corridor before relying on it
            for route-deviation alerts.
          </p>
        )}
      </div>

      <div className="space-y-2">
        <p className={ADMIN.label}>Stops ({stops.length})</p>

        {loading ? (
          <div className="text-xs text-[#A1A1AA] py-6 text-center">Loading stops…</div>
        ) : stops.length === 0 ? (
          <div className="border border-dashed border-[#E4E4E7] rounded-xl px-4 py-8 text-center">
            <MapPin size={20} className="mx-auto text-[#A1A1AA] mb-2" />
            <p className="text-sm font-semibold text-[#52525B]">No stops yet</p>
            <p className="text-[11px] text-[#A1A1AA] mt-0.5">
              Click the map to place the first one, in the order the bus drives to school.
            </p>
          </div>
        ) : (
          <div className="space-y-1.5 max-h-[26rem] overflow-y-auto pr-0.5">
            {stops.map((s, i) => (
              <div
                key={s.id}
                className={`border rounded-lg px-2.5 py-2 cursor-pointer transition-colors ${
                  s.id === selectedId ? 'border-[#27272A] bg-[#FAFAFA]' : 'border-[#E4E4E7] hover:border-[#D4D4D8]'
                }`}
                onClick={() => setSelectedId(s.id === selectedId ? null : s.id)}
              >
                <div className="flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full bg-[#27272A] text-white text-[10px] font-bold flex items-center justify-center flex-shrink-0">
                    {s.kind === 'school' ? '🏫' : s.seq}
                  </span>
                  <span className="flex-1 min-w-0 text-sm text-[#27272A] truncate">{s.name}</span>
                  <button
                    onClick={e => { e.stopPropagation(); move(s.id, -1) }}
                    disabled={i === 0 || busy}
                    className="p-1 text-[#A1A1AA] hover:text-[#27272A] disabled:opacity-30"
                    aria-label="Move up"
                  >
                    <ArrowUp size={12} />
                  </button>
                  <button
                    onClick={e => { e.stopPropagation(); move(s.id, 1) }}
                    disabled={i === stops.length - 1 || busy}
                    className="p-1 text-[#A1A1AA] hover:text-[#27272A] disabled:opacity-30"
                    aria-label="Move down"
                  >
                    <ArrowDown size={12} />
                  </button>
                </div>

                {s.id === selectedId && (
                  <div className="mt-2.5 space-y-2.5" onClick={e => e.stopPropagation()}>
                    <Field label="Name">
                      <TextInput
                        value={s.name}
                        onChange={e => patchStop(s.id, { name: e.target.value })}
                      />
                    </Field>
                    <Field label="Landmark">
                      <TextInput
                        value={s.landmark ?? ''}
                        onChange={e => patchStop(s.id, { landmark: e.target.value })}
                        placeholder="Opposite the temple"
                      />
                    </Field>
                    <div>
                      <span className={ADMIN.label}>Geofence radius — {s.radius_m} m</span>
                      <input
                        type="range"
                        min={25}
                        max={500}
                        step={5}
                        value={s.radius_m}
                        onChange={e => patchStop(s.id, { radius_m: Number(e.target.value) })}
                        className="w-full mt-1.5 accent-[#B8983C]"
                      />
                      <p className="text-[11px] text-[#A1A1AA]">
                        Too tight and a busy road makes the bus miss its own stop; too wide
                        and it registers arrival a street early.
                      </p>
                    </div>
                    <div className="flex items-center justify-between gap-2 pt-1">
                      <button
                        className="text-[11px] font-semibold text-[#71717A] hover:text-emerald-600 flex items-center gap-1"
                        onClick={async () => {
                          await patchStop(s.id, { kind: s.kind === 'school' ? 'stop' : 'school' })
                          await updateRoute(route.id, { school_stop_id: s.kind === 'school' ? null : s.id })
                        }}
                      >
                        <School size={12} />
                        {s.kind === 'school' ? 'Not the school' : 'This is the school'}
                      </button>
                      <button
                        className="text-[11px] font-semibold text-[#A1A1AA] hover:text-rose-600 flex items-center gap-1"
                        onClick={async () => {
                          if (!confirm(`Delete “${s.name}”? Students assigned to it lose their stop.`)) return
                          await deleteStop(s.id)
                          setSelectedId(null)
                          load()
                        }}
                      >
                        <Trash2 size={12} /> Delete
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
