'use client'

import React, { useMemo, useEffect } from 'react'
import { MapContainer, TileLayer, Marker, Popup, Circle, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { Clock, Navigation, WifiOff } from 'lucide-react'
import { useBusLocation } from '@/hooks/useBusLocation'
import { useMyLocation } from '@/hooks/useMyLocation'
import { estimateEtaMinutes } from '@/lib/bus'

interface PassengerTripMapProps {
  tripId: string
  tripName: string
}

// divIcons avoid Leaflet's broken default marker-image asset paths under webpack.
function makeIcon(html: string) {
  return L.divIcon({ html, className: '', iconSize: [36, 36], iconAnchor: [18, 18] })
}

const BUS_ICON = makeIcon(
  `<div style="width:34px;height:34px;border-radius:50%;background:#f97316;border:3px solid #fff;box-shadow:0 1px 6px rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center;font-size:17px;">🚌</div>`,
)
const ME_ICON = makeIcon(
  `<div style="width:18px;height:18px;border-radius:50%;background:#2563eb;border:3px solid #fff;box-shadow:0 1px 6px rgba(0,0,0,.4);"></div>`,
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
    <div className="rounded-2xl overflow-hidden border border-slate-200">
      {/* Status strip */}
      <div className="flex items-center justify-between gap-2 px-3 py-2 bg-slate-50 border-b border-slate-200">
        <span className="text-xs font-medium text-slate-600 truncate">{tripName}</span>
        {bus ? (
          eta != null ? (
            <span className="flex items-center gap-1.5 text-xs font-semibold text-orange-600">
              <Clock size={13} /> ~{eta} min away
            </span>
          ) : (
            <span className="flex items-center gap-1.5 text-xs text-slate-500">
              <Navigation size={13} /> Bus is live
            </span>
          )
        ) : (
          <span className="flex items-center gap-1.5 text-xs text-slate-400">
            <WifiOff size={13} /> Bus offline
          </span>
        )}
      </div>

      <MapContainer center={center} zoom={14} style={{ height: 280, width: '100%' }} scrollWheelZoom={false}>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
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

      {(stale || meError) && (
        <div className="px-3 py-2 bg-amber-50 text-[11px] text-amber-700 border-t border-amber-100">
          {meError ? meError : 'Bus location may be out of date — the driver might have paused sharing.'}
        </div>
      )}
    </div>
  )
}
