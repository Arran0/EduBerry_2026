'use client'

/**
 * The geofencing page's map: the school fence, every group's fence, and a
 * click to place the fence.
 *
 * A click sets the centre of a circle fence, or adds a corner to a campus
 * outline — the same edits the coordinate fields and "Use my current position"
 * make, so the map and the form are two views of one value. Leaflet touches
 * `window` at import time, so load this with `dynamic(..., { ssr: false })`.
 */

import React, { useEffect, useRef } from 'react'
import { MapContainer, Circle, Polygon, CircleMarker, Tooltip, useMap, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { BaseTiles, KeepSized } from '@/components/transport/TransportMap'
import { polygonCentroid, type LatLng } from '@/lib/geofence'
import type { FenceValue } from '@/components/attendance/FenceEditor'

export interface MapZone {
  id: string
  label: string
  lat: number
  lng: number
  radius_m: number
  shape: 'circle' | 'polygon'
  polygon: LatLng[] | null
}

const INK = '#27272A'
const GOLD = '#B8983C'
/** Centre of India: where an unset fence starts, zoomed out. */
const FALLBACK: [number, number] = [20.5937, 78.9629]

/** Fits the school fence and the groups on screen once, when they first arrive. */
function FitOnce({ points }: { points: [number, number][] }) {
  const map = useMap()
  const done = useRef(false)
  useEffect(() => {
    if (done.current || points.length === 0) return
    done.current = true
    if (points.length === 1) { map.setView(points[0], 17); return }
    map.fitBounds(L.latLngBounds(points), { padding: [40, 40], maxZoom: 18 })
  }, [points, map])
  return null
}

function ClickToPlace({ onPick }: { onPick: (p: LatLng) => void }) {
  useMapEvents({ click: e => onPick({ lat: e.latlng.lat, lng: e.latlng.lng }) })
  return null
}

export default function FenceMap({ value, onChange, zones }: {
  value: FenceValue
  onChange: (patch: Partial<FenceValue>) => void
  zones: MapZone[]
}) {
  const hasCentre = value.lat != null && value.lng != null
  const outline = value.polygon ?? []

  const points: [number, number][] = [
    ...(value.shape === 'polygon' && outline.length ? outline.map(p => [p.lat, p.lng] as [number, number])
      : hasCentre ? [[value.lat!, value.lng!] as [number, number]] : []),
    ...zones.map(z => [z.lat, z.lng] as [number, number]),
  ]

  const pick = (p: LatLng) => {
    if (value.shape === 'circle') { onChange({ lat: p.lat, lng: p.lng }); return }
    // Keep lat/lng on the outline's centroid, as the corner capture does.
    const next = [...outline, p]
    const c = polygonCentroid(next)
    onChange({ polygon: next, lat: c.lat, lng: c.lng })
  }

  return (
    <MapContainer
      center={hasCentre ? [value.lat!, value.lng!] : FALLBACK}
      zoom={hasCentre ? 17 : 4}
      scrollWheelZoom
      className="w-full h-full"
      style={{ minHeight: 320, background: '#F5F5F5' }}
    >
      <BaseTiles />
      <KeepSized />
      <FitOnce points={points} />
      <ClickToPlace onPick={pick} />

      {zones.map(z => z.shape === 'polygon' && z.polygon?.length ? (
        <Polygon key={z.id} positions={z.polygon.map(p => [p.lat, p.lng])}
          pathOptions={{ color: '#71717A', weight: 2, dashArray: '6 5', fillOpacity: 0.08 }}>
          <Tooltip sticky>{z.label}</Tooltip>
        </Polygon>
      ) : (
        <Circle key={z.id} center={[z.lat, z.lng]} radius={z.radius_m}
          pathOptions={{ color: '#71717A', weight: 2, dashArray: '6 5', fillOpacity: 0.08 }}>
          <Tooltip sticky>{z.label}</Tooltip>
        </Circle>
      ))}

      {value.shape === 'polygon' ? (
        <>
          {outline.length >= 3 && (
            <Polygon positions={outline.map(p => [p.lat, p.lng])}
              pathOptions={{ color: INK, weight: 2.5, fillColor: GOLD, fillOpacity: 0.18 }} />
          )}
          {outline.map((p, i) => (
            <CircleMarker key={i} center={[p.lat, p.lng]} radius={5}
              pathOptions={{ color: '#fff', weight: 2, fillColor: INK, fillOpacity: 1 }}>
              <Tooltip direction="top">Corner {i + 1}</Tooltip>
            </CircleMarker>
          ))}
        </>
      ) : hasCentre && (
        <>
          <Circle center={[value.lat!, value.lng!]} radius={value.radius_m}
            pathOptions={{ color: INK, weight: 2.5, fillColor: GOLD, fillOpacity: 0.18 }} />
          <CircleMarker center={[value.lat!, value.lng!]} radius={6}
            pathOptions={{ color: '#fff', weight: 2, fillColor: INK, fillOpacity: 1 }}>
            <Tooltip direction="top">School centre</Tooltip>
          </CircleMarker>
        </>
      )}
    </MapContainer>
  )
}
