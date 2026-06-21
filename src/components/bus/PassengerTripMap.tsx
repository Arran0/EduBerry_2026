'use client'

import React, { useMemo, useEffect } from 'react'
import { MapContainer, TileLayer, Marker, Popup, Circle, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { Clock, Navigation, WifiOff, LocateFixed } from 'lucide-react'
import { useBusLocation } from '@/hooks/useBusLocation'
import { useMyLocation } from '@/hooks/useMyLocation'
import { estimateEtaMinutes } from '@/lib/bus'

interface PassengerTripMapProps {
  tripId: string
  tripName: string
}

// divIcons avoid Leaflet's broken default marker-image asset paths under webpack.
function makeIcon(html: string, size: number) {
  return L.divIcon({ html, className: '', iconSize: [size, size], iconAnchor: [size / 2, size / 2] })
}

// Animated bus marker with a soft pulsing halo so it reads as "live".
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

/** Keeps the map centred on the most relevant point as data arrives. */
function Recenter({ lat, lng }: { lat: number | null; lng: number | null }) {
  const map = useMap()
  useEffect(() => {
    if (lat != null && lng != null) map.setView([lat, lng], map.getZoom(), { animate: true })
  }, [lat, lng, map])
  return null
}

export default function PassengerTripMap({ tripId, tripName }: PassengerTripMapProps) {
  const bus = useBusLocation(tripId)
  const { coords: me, error: meError } = useMyLocation(true)

  const eta = useMemo(() => {
    if (!bus || !me) return null
    return estimateEtaMinutes({ lat: bus.lat, lng: bus.lng }, { lat: me.lat, lng: me.lng })
  }, [bus, me])

  // Centre priority: bus, then me, then a neutral default (India centroid).
  const center: [number, number] = bus
    ? [bus.lat, bus.lng]
    : me
      ? [me.lat, me.lng]
      : [20.5937, 78.9629]

  const busAgeSec = bus ? Math.round((Date.now() - new Date(bus.recorded_at).getTime()) / 1000) : null
  const stale = busAgeSec != null && busAgeSec > 120

  return (
    <div className="rounded-2xl overflow-hidden border border-slate-200 shadow-sm bg-white">
      {/* Status strip */}
      <div className="flex items-center justify-between gap-2 px-3.5 py-2.5 bg-white border-b border-slate-100">
        <div className="flex items-center gap-2 min-w-0">
          <span className={`relative flex h-2.5 w-2.5 flex-shrink-0`}>
            {bus && !stale && <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60 animate-ping" />}
            <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${bus ? (stale ? 'bg-amber-400' : 'bg-emerald-500') : 'bg-slate-300'}`} />
          </span>
          <span className="text-sm font-semibold text-slate-700 truncate">{tripName}</span>
        </div>
        {bus ? (
          eta != null ? (
            <span className="flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-full bg-orange-50 text-orange-600 flex-shrink-0">
              <Clock size={13} /> ~{eta} min
            </span>
          ) : (
            <span className="flex items-center gap-1.5 text-xs font-semibold text-emerald-600 flex-shrink-0">
              <Navigation size={13} /> Live
            </span>
          )
        ) : (
          <span className="flex items-center gap-1.5 text-xs font-medium text-slate-400 flex-shrink-0">
            <WifiOff size={13} /> Offline
          </span>
        )}
      </div>

      <div className="relative">
        <MapContainer center={center} zoom={15} style={{ height: 320, width: '100%' }} scrollWheelZoom={false} zoomControl={false}>
          {/* CartoDB Voyager — far cleaner, higher-contrast tiles than raw OSM */}
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
            url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
            subdomains="abcd"
            maxZoom={20}
          />
          <Recenter lat={bus?.lat ?? me?.lat ?? null} lng={bus?.lng ?? me?.lng ?? null} />

          {bus && (
            <Marker position={[bus.lat, bus.lng]} icon={BUS_ICON}>
              <Popup>
                {tripName}<br />
                Updated {busAgeSec != null ? `${busAgeSec}s ago` : 'just now'}
              </Popup>
            </Marker>
          )}

          {me && (
            <>
              <Marker position={[me.lat, me.lng]} icon={ME_ICON}>
                <Popup>You are here</Popup>
              </Marker>
              {me.accuracy != null && me.accuracy < 1000 && (
                <Circle center={[me.lat, me.lng]} radius={me.accuracy} pathOptions={{ color: '#2563eb', opacity: 0.25, fillOpacity: 0.08 }} />
              )}
            </>
          )}
        </MapContainer>

        {/* Legend overlay */}
        <div className="absolute bottom-2.5 left-2.5 z-[400] flex flex-col gap-1 bg-white/90 backdrop-blur-sm rounded-lg px-2.5 py-1.5 shadow-sm border border-slate-100 pointer-events-none">
          <span className="flex items-center gap-1.5 text-[10px] font-medium text-slate-600"><span className="w-2.5 h-2.5 rounded-full bg-orange-500 border border-white shadow-sm" /> Bus</span>
          <span className="flex items-center gap-1.5 text-[10px] font-medium text-slate-600"><span className="w-2.5 h-2.5 rounded-full bg-blue-600 border border-white shadow-sm" /> You</span>
        </div>
        {!me && !meError && (
          <div className="absolute bottom-2.5 right-2.5 z-[400] flex items-center gap-1.5 text-[10px] font-medium text-slate-500 bg-white/90 backdrop-blur-sm rounded-lg px-2.5 py-1.5 shadow-sm border border-slate-100">
            <LocateFixed size={11} className="animate-pulse" /> Locating you…
          </div>
        )}
      </div>

      {(stale || meError) && (
        <div className="px-3.5 py-2 bg-amber-50 text-[11px] text-amber-700 border-t border-amber-100">
          {meError ? meError : 'Bus location may be out of date — the driver might have paused sharing.'}
        </div>
      )}
    </div>
  )
}
