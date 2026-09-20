'use client'

/**
 * The transport module's one map.
 *
 * Extracted from PassengerTripMap so stops, route paths, the school and a live
 * bus all render from a single component with one set of icons and one tile
 * provider. Leaflet touches `window` at import time and builds `L.divIcon`s at
 * module scope, so every consumer must load this via
 * `dynamic(..., { ssr: false })`.
 *
 * divIcons are used throughout rather than image markers because Leaflet's
 * default marker asset paths break under webpack.
 */

import React, { useEffect, useMemo, useRef } from 'react'
import { MapContainer, TileLayer, Marker, Popup, Circle, Polyline, Polygon, useMap, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { LatLng } from '@/lib/transport/types'

function makeIcon(html: string, size: number) {
  return L.divIcon({ html, className: '', iconSize: [size, size], iconAnchor: [size / 2, size / 2] })
}

const BUS_ICON = makeIcon(
  `<div style="position:relative;width:44px;height:44px;display:flex;align-items:center;justify-content:center;">
     <span style="position:absolute;width:44px;height:44px;border-radius:50%;background:rgba(249,115,22,.25);animation:busPulse 1.8s ease-out infinite;"></span>
     <span style="position:relative;width:34px;height:34px;border-radius:50%;background:linear-gradient(135deg,#fb923c,#ea580c);border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;font-size:17px;">🚌</span>
   </div>
   <style>@keyframes busPulse{0%{transform:scale(.6);opacity:.9}100%{transform:scale(1.5);opacity:0}}</style>`,
  44,
)

const ME_ICON = makeIcon(
  `<div style="width:18px;height:18px;border-radius:50%;background:#2563eb;border:3px solid #fff;box-shadow:0 1px 6px rgba(0,0,0,.45);"></div>`,
  18,
)

/** Numbered pin. Selected stops invert so the one being edited is obvious. */
function stopIcon(seq: number, opts: { selected?: boolean; school?: boolean } = {}) {
  const bg = opts.school
    ? 'linear-gradient(135deg,#34d399,#059669)'
    : opts.selected
      ? 'linear-gradient(135deg,#27272A,#18181B)'
      : 'linear-gradient(135deg,#fbbf24,#B8983C)'
  const label = opts.school ? '🏫' : String(seq)
  const size = opts.selected ? 32 : 28
  return makeIcon(
    `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${bg};border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.3);display:flex;align-items:center;justify-content:center;color:#fff;font-size:${opts.school ? 13 : 12}px;font-weight:700;font-family:system-ui,sans-serif;">${label}</div>`,
    size,
  )
}

export interface MapStop {
  id: string
  seq: number
  name: string
  lat: number
  lng: number
  radius_m: number
  shape?: 'circle' | 'polygon'
  polygon?: LatLng[] | null
  isSchool?: boolean
}

export interface TransportMapProps {
  stops?: MapStop[]
  /** Highlighted stop; the map also pans to it when it changes. */
  selectedStopId?: string | null
  onStopClick?: (stopId: string) => void
  /** Click anywhere to drop a new stop. Enables a crosshair cursor. */
  onMapClick?: (point: LatLng) => void
  /** Drag a stop pin to move it. */
  onStopDragEnd?: (stopId: string, point: LatLng) => void
  path?: LatLng[] | null
  pathColor?: string
  bus?: { lat: number; lng: number; label?: string } | null
  me?: { lat: number; lng: number; accuracy?: number } | null
  /** Draw each stop's geofence. Off in read-only contexts where it is clutter. */
  showFences?: boolean
  height?: number
  /**
   * Tailwind height classes, for a map that should be one size on a phone and
   * another on a desktop. Supersedes `height` entirely when given — an inline
   * height and a responsive class fight, and the inline one wins at every
   * breakpoint, which is the wrong answer above `lg`.
   */
  heightClass?: string
  className?: string
}

/** Pans to a point when it changes, without fighting the user's own panning. */
function PanTo({ point }: { point: LatLng | null }) {
  const map = useMap()
  const last = useRef<string>('')
  useEffect(() => {
    if (!point) return
    const key = `${point.lat},${point.lng}`
    if (key === last.current) return
    last.current = key
    map.setView([point.lat, point.lng], Math.max(map.getZoom(), 15), { animate: true })
  }, [point, map])
  return null
}

function ClickCatcher({ onMapClick }: { onMapClick: (p: LatLng) => void }) {
  useMapEvents({ click: e => onMapClick({ lat: e.latlng.lat, lng: e.latlng.lng }) })
  return null
}

/**
 * Fits every stop on screen once, when the set first arrives.
 *
 * Deliberately not on every render: re-fitting as the admin edits would yank
 * the viewport away from whatever they are working on.
 */
function FitStops({ stops }: { stops: MapStop[] }) {
  const map = useMap()
  const done = useRef(false)
  useEffect(() => {
    if (done.current || stops.length === 0) return
    done.current = true
    if (stops.length === 1) {
      map.setView([stops[0].lat, stops[0].lng], 15)
      return
    }
    map.fitBounds(L.latLngBounds(stops.map(s => [s.lat, s.lng] as [number, number])), { padding: [40, 40] })
  }, [stops, map])
  return null
}

export default function TransportMap({
  stops = [],
  selectedStopId = null,
  onStopClick,
  onMapClick,
  onStopDragEnd,
  path,
  pathColor = '#B8983C',
  bus = null,
  me = null,
  showFences = true,
  height = 380,
  heightClass,
  className = '',
}: TransportMapProps) {
  const selected = useMemo(
    () => stops.find(s => s.id === selectedStopId) ?? null,
    [stops, selectedStopId],
  )

  // Centre priority: the bus, then the selected stop, then the first stop, then
  // the viewer, then a neutral default (India centroid) so an empty route still
  // renders a usable map instead of the middle of the Atlantic.
  const center: [number, number] = bus
    ? [bus.lat, bus.lng]
    : selected
      ? [selected.lat, selected.lng]
      : stops.length > 0
        ? [stops[0].lat, stops[0].lng]
        : me
          ? [me.lat, me.lng]
          : [20.5937, 78.9629]

  return (
    <div
      className={`${className} ${heightClass ?? ''}`}
      style={heightClass ? undefined : { height }}
    >
      <MapContainer
        center={center}
        zoom={14}
        scrollWheelZoom
        zoomControl
        style={{ height: '100%', width: '100%', cursor: onMapClick ? 'crosshair' : undefined }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
          url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
          subdomains="abcd"
          maxZoom={20}
        />

        <FitStops stops={stops} />
        {selected && <PanTo point={{ lat: selected.lat, lng: selected.lng }} />}
        {onMapClick && <ClickCatcher onMapClick={onMapClick} />}

        {path && path.length > 1 && (
          <Polyline
            positions={path.map(p => [p.lat, p.lng] as [number, number])}
            pathOptions={{ color: pathColor, weight: 4, opacity: 0.75 }}
          />
        )}

        {stops.map(s => (
          <React.Fragment key={s.id}>
            {showFences && s.shape === 'polygon' && s.polygon?.length ? (
              <Polygon
                positions={s.polygon.map(p => [p.lat, p.lng] as [number, number])}
                pathOptions={{ color: '#B8983C', weight: 1, fillOpacity: 0.1 }}
              />
            ) : showFences ? (
              <Circle
                center={[s.lat, s.lng]}
                radius={s.radius_m}
                pathOptions={{ color: '#B8983C', weight: 1, fillOpacity: 0.08 }}
              />
            ) : null}
            <Marker
              position={[s.lat, s.lng]}
              icon={stopIcon(s.seq, { selected: s.id === selectedStopId, school: s.isSchool })}
              draggable={!!onStopDragEnd}
              eventHandlers={{
                click: () => onStopClick?.(s.id),
                dragend: e => {
                  const { lat, lng } = (e.target as L.Marker).getLatLng()
                  onStopDragEnd?.(s.id, { lat, lng })
                },
              }}
            >
              <Popup>
                <span className="font-semibold">{s.seq}. {s.name}</span>
                <br />
                <span className="text-xs">{s.radius_m} m geofence</span>
              </Popup>
            </Marker>
          </React.Fragment>
        ))}

        {bus && (
          <Marker position={[bus.lat, bus.lng]} icon={BUS_ICON}>
            <Popup>{bus.label ?? 'Bus'}</Popup>
          </Marker>
        )}

        {me && (
          <>
            <Marker position={[me.lat, me.lng]} icon={ME_ICON}>
              <Popup>You</Popup>
            </Marker>
            {me.accuracy != null && (
              <Circle
                center={[me.lat, me.lng]}
                radius={me.accuracy}
                pathOptions={{ color: '#2563eb', weight: 1, fillOpacity: 0.08 }}
              />
            )}
          </>
        )}
      </MapContainer>
    </div>
  )
}
