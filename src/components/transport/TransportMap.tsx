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

import React, { useEffect, useMemo, useRef, useState } from 'react'
import { MapContainer, TileLayer, Marker, Popup, Circle, Polyline, Polygon, useMap, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { LatLng } from '@/lib/transport/types'
import { MAPBOX_TOKEN, OSM_TILES, defaultTiles, mapboxTiles, type TileSource } from '@/lib/transport/mapTiles'
import { fetchMapSettings } from '@/lib/transport/settings'

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

/**
 * A live bus on the fleet map: a route-coloured disc with the bus glyph, a
 * soft pulse while it is reporting, and a dark ring when it is the selected
 * one. Built per render because the colour and state vary per bus; Leaflet
 * only swaps the DOM when the HTML actually changes.
 */
function fleetBusIcon(color: string, opts: { selected?: boolean; live?: boolean; late?: boolean }) {
  const ring = opts.selected ? '#18181B' : '#fff'
  const size = opts.selected ? 46 : 40
  const pulse = opts.live
    ? `<span style="position:absolute;inset:0;border-radius:50%;background:${color};opacity:.28;animation:busPulse 1.8s ease-out infinite;"></span>`
    : ''
  const badge = opts.late
    ? '<span style="position:absolute;top:-2px;right:-2px;width:12px;height:12px;border-radius:50%;background:#f59e0b;border:2px solid #fff;"></span>'
    : ''
  return makeIcon(
    `<div style="position:relative;width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center;">
       ${pulse}
       <span style="position:relative;width:${size - 10}px;height:${size - 10}px;border-radius:50%;background:linear-gradient(150deg,${color},color-mix(in srgb, ${color} 70%, black));border:3px solid ${ring};box-shadow:0 4px 12px rgba(0,0,0,.32);display:flex;align-items:center;justify-content:center;font-size:${opts.selected ? 17 : 15}px;${opts.live ? '' : 'filter:grayscale(.65);opacity:.85;'}">🚌</span>
       ${badge}
     </div>
     <style>@keyframes busPulse{0%{transform:scale(.6);opacity:.9}100%{transform:scale(1.5);opacity:0}}</style>`,
    size,
  )
}

export interface MapBus {
  id: string
  lat: number
  lng: number
  label: string
  detail?: string
  color?: string
  live?: boolean
  late?: boolean
}

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
  /** The fleet view: several buses, each clickable. */
  buses?: MapBus[]
  selectedBusId?: string | null
  onBusClick?: (busId: string) => void
  /**
   * The school. Drawn as a marker, and when given the map opens centred on
   * it rather than fitting itself around the buses.
   */
  school?: { lat: number; lng: number; label?: string } | null
  /** Starting zoom when centred on the school. */
  schoolZoom?: number
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

/** Moves to the school once it is known (it usually arrives after the map mounts). */
function RecentreOn({ point }: { point: LatLng }) {
  const map = useMap()
  const done = useRef<string>('')
  useEffect(() => {
    const key = `${point.lat},${point.lng}`
    if (done.current === key) return
    done.current = key
    map.setView([point.lat, point.lng], Math.max(map.getZoom(), 13), { animate: false })
  }, [point, map])
  return null
}

function ClickCatcher({ onMapClick }: { onMapClick: (p: LatLng) => void }) {
  useMapEvents({ click: e => onMapClick({ lat: e.latlng.lat, lng: e.latlng.lng }) })
  return null
}

/**
 * Keeps Leaflet's idea of the container size honest.
 *
 * Leaflet measures its container once, on mount, and then trusts that number
 * until something tells it otherwise. That is fine for a map that mounts at its
 * final size and wrong everywhere else: inside the Manage popup the panel
 * animates in, so the map mounts mid-transition, measures a box that is still
 * scaling, and renders a half-width grid of grey tiles that only corrects
 * itself if the window happens to be resized.
 *
 * A ResizeObserver on the container is the general fix — it covers the popup,
 * a phone rotating, and the desktop split pane being dragged, without any of
 * them having to know a map is inside them.
 */
export function KeepSized() {
  const map = useMap()
  useEffect(() => {
    const el = map.getContainer()
    // Leaflet throws if invalidateSize lands after the map is torn down, which
    // is reachable here: the observer can fire on the frame the popup closes.
    const ro = new ResizeObserver(() => {
      try { map.invalidateSize({ animate: false }) } catch { /* map already gone */ }
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [map])
  return null
}

/**
 * Fits every stop on screen once, when the set first arrives.
 *
 * Deliberately not on every render: re-fitting as the admin edits would yank
 * the viewport away from whatever they are working on.
 */
function FitStops({ stops }: { stops: { lat: number; lng: number }[] }) {
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

/**
 * The base map, with fallbacks.
 *
 * The school's own Mapbox key first (set in Configuration), then the key this
 * deployment provides, then OpenStreetMap. A provider that starts refusing
 * tiles — a revoked key, a URL restriction that leaves this site out — is
 * dropped after a handful of errors in a row, so a bad key degrades to the
 * next map rather than a grey box.
 */
export function BaseTiles() {
  const [chain, setChain] = useState<TileSource[]>(() => [defaultTiles(), OSM_TILES])
  const [at, setAt] = useState(0)
  const errors = useRef(0)

  useEffect(() => {
    let alive = true
    fetchMapSettings().then(s => {
      if (!alive) return
      const list: TileSource[] = []
      if (s.mapbox_token) list.push(mapboxTiles(s.mapbox_token, s.style))
      if (MAPBOX_TOKEN) list.push(mapboxTiles(MAPBOX_TOKEN, s.style))
      list.push(OSM_TILES)
      setChain(list); setAt(0); errors.current = 0
    })
    return () => { alive = false }
  }, [])

  const tiles = chain[Math.min(at, chain.length - 1)]
  return (
    <TileLayer
      key={tiles.url}
      attribution={tiles.attribution}
      url={tiles.url}
      tileSize={tiles.tileSize}
      zoomOffset={tiles.zoomOffset}
      maxZoom={tiles.maxZoom}
      {...(tiles.subdomains ? { subdomains: tiles.subdomains } : {})}
      eventHandlers={{
        tileerror: () => {
          if (at >= chain.length - 1) return
          errors.current += 1
          if (errors.current >= 4) {
            console.warn(`Map tiles from ${tiles.provider} are being refused — falling back to the next provider.`)
            errors.current = 0
            setAt(a => a + 1)
          }
        },
        tileload: () => { errors.current = 0 },
      }}
    />
  )
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
  buses,
  selectedBusId = null,
  onBusClick,
  school = null,
  schoolZoom = 13,
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
  const selectedBus = useMemo(
    () => buses?.find(b => b.id === selectedBusId) ?? null,
    [buses, selectedBusId],
  )
  const firstBus = buses && buses.length > 0 ? buses[0] : null

  const center: [number, number] = bus
    ? [bus.lat, bus.lng]
    : school
      ? [school.lat, school.lng]
      : firstBus
      ? [firstBus.lat, firstBus.lng]
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
        zoom={school && !bus && stops.length === 0 ? schoolZoom : 14}
        scrollWheelZoom
        zoomControl
        style={{ height: '100%', width: '100%', cursor: onMapClick ? 'crosshair' : undefined }}
      >
        <KeepSized />
        <BaseTiles />

        <FitStops stops={stops.length > 0 ? stops : school ? [] : (buses ?? [])} />
        {school && <RecentreOn point={school} />}
        {selected && <PanTo point={{ lat: selected.lat, lng: selected.lng }} />}
        {selectedBus && <PanTo point={{ lat: selectedBus.lat, lng: selectedBus.lng }} />}
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

        {school && (
          <Marker position={[school.lat, school.lng]} icon={stopIcon(0, { school: true })} zIndexOffset={500}>
            <Popup><span className="font-semibold">{school.label ?? 'School'}</span></Popup>
          </Marker>
        )}

        {buses?.map(b => (
          <Marker
            key={b.id}
            position={[b.lat, b.lng]}
            icon={fleetBusIcon(b.color ?? '#B8983C', { selected: b.id === selectedBusId, live: b.live, late: b.late })}
            zIndexOffset={b.id === selectedBusId ? 1000 : 0}
            eventHandlers={{ click: () => onBusClick?.(b.id) }}
          >
            <Popup>
              <span className="font-semibold">{b.label}</span>
              {b.detail && <><br /><span className="text-xs">{b.detail}</span></>}
            </Popup>
          </Marker>
        ))}

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
