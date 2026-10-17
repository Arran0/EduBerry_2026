'use client'

/**
 * The two school-level transport settings, as small forms for their popups:
 * where the school is, and whose map key the maps use. Each sits behind a tile
 * at the foot of Configuration, beside WhatsApp, GPS and Scan.
 */

import React, { useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, Crosshair, Eye, EyeOff, KeyRound, Loader2, School } from 'lucide-react'
import { acquirePosition } from '@/lib/gpsAcquisition'
import {
  MAP_STYLES, fetchGeofenceSchool, fetchMapSettings, fetchSchoolLocation, saveMapSettings, saveSchoolLocation,
  testMapboxToken, tilesFor, type MapSettings, type SchoolLocation,
} from '@/lib/transport/settings'
import { MAPBOX_TOKEN } from '@/lib/transport/mapTiles'
import { GBTN, GINPUT } from './glass'

type Note = { ok: boolean; text: string } | null

const LABEL = 'text-[10px] font-bold uppercase tracking-wider text-slate-500'

function NoteLine({ note }: { note: Note }) {
  if (!note) return null
  return (
    <p className={`flex items-start gap-1.5 text-[12px] font-semibold ${note.ok ? 'text-emerald-700' : 'text-rose-600'}`}>
      {note.ok ? <CheckCircle2 size={13} className="mt-0.5 flex-shrink-0" /> : <AlertTriangle size={13} className="mt-0.5 flex-shrink-0" />} {note.text}
    </p>
  )
}

// ── Status lines for the tiles ──────────────────────────────────────────────

export function schoolStatus(s: SchoolLocation | null | undefined): { tone: 'good' | 'warn' | 'idle'; text: string } {
  if (s === undefined) return { tone: 'idle', text: 'Checking…' }
  if (!s) return { tone: 'warn', text: 'Not set' }
  return { tone: 'good', text: s.source === 'geofence' ? 'From the attendance geofence' : `${s.lat.toFixed(4)}, ${s.lng.toFixed(4)}` }
}

export function mapStatus(s: MapSettings | null | undefined): { tone: 'good' | 'warn' | 'idle'; text: string } {
  if (s === undefined) return { tone: 'idle', text: 'Checking…' }
  const origin = tilesFor(s).origin
  if (origin === 'school') return { tone: 'good', text: 'Your Mapbox key' }
  if (origin === 'provided') return { tone: 'good', text: 'Provided Mapbox key' }
  return { tone: 'warn', text: 'OpenStreetMap — no key' }
}

// ── School location ─────────────────────────────────────────────────────────

const parseCoord = (v: string, max: number): number | null => {
  const n = Number(v.trim())
  return v.trim() !== '' && Number.isFinite(n) && Math.abs(n) <= max ? n : null
}

/**
 * Coordinates, typed or taken from this device. Pasting "12.97, 77.59" into
 * either box fills both, since that is how a map app hands them over.
 */
export function SchoolLocationForm({ onSaved }: { onSaved?: () => void }) {
  const [current, setCurrent] = useState<SchoolLocation | null | undefined>(undefined)
  const [fence, setFence] = useState<SchoolLocation | null>(null)
  const [lat, setLat] = useState('')
  const [lng, setLng] = useState('')
  const [label, setLabel] = useState('')
  const [busy, setBusy] = useState<'locate' | 'save' | null>(null)
  const [note, setNote] = useState<Note>(null)

  useEffect(() => {
    Promise.all([fetchSchoolLocation(true), fetchGeofenceSchool()]).then(([c, f]) => {
      setCurrent(c); setFence(f)
      if (c) { setLat(String(c.lat)); setLng(String(c.lng)); setLabel(c.label) }
    })
  }, [])

  const paste = (v: string, set: (s: string) => void) => {
    const m = v.match(/(-?\d+(?:\.\d+)?)\s*[,\s]\s*(-?\d+(?:\.\d+)?)/)
    if (m) { setLat(m[1]); setLng(m[2]) } else set(v)
    setNote(null)
  }

  const locate = async () => {
    setBusy('locate'); setNote(null)
    const r = await acquirePosition({ fence: null })
    setBusy(null)
    if (!r.fix) { setNote({ ok: false, text: 'Could not get a location. Check location permission, or type the coordinates.' }); return }
    setLat(r.fix.lat.toFixed(6)); setLng(r.fix.lng.toFixed(6))
    setNote({ ok: true, text: `Got it — accurate to about ${Math.round(r.fix.accuracy)} m. Save to keep it.` })
  }

  const la = parseCoord(lat, 90)
  const ln = parseCoord(lng, 180)

  const save = async () => {
    if (la == null || ln == null) { setNote({ ok: false, text: 'Latitude is between −90 and 90, longitude between −180 and 180.' }); return }
    setBusy('save'); setNote(null)
    const res = await saveSchoolLocation({ lat: la, lng: ln, label: label || 'School' })
    setBusy(null)
    if (!res.success) { setNote({ ok: false, text: res.error ?? 'Could not save.' }); return }
    setNote({ ok: true, text: 'Saved. The Operations map opens on the school.' })
    onSaved?.()
  }

  return (
    <div className="space-y-3">
      <p className="text-[12px] leading-snug text-slate-600">
        The Operations map opens centred here.
        {current?.source === 'geofence' && ' It is using your attendance geofence until you set one.'}
      </p>

      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className={LABEL}>Latitude</span>
          <input className={`${GINPUT} mt-1 tabular-nums`} inputMode="decimal" value={lat} placeholder="12.971599"
            onChange={e => paste(e.target.value, setLat)} />
        </label>
        <label className="block">
          <span className={LABEL}>Longitude</span>
          <input className={`${GINPUT} mt-1 tabular-nums`} inputMode="decimal" value={lng} placeholder="77.594566"
            onChange={e => paste(e.target.value, setLng)} />
        </label>
      </div>
      <label className="block">
        <span className={LABEL}>Name</span>
        <input className={`${GINPUT} mt-1`} value={label} placeholder="School" onChange={e => setLabel(e.target.value)} />
      </label>

      <div className="flex flex-wrap items-center gap-2">
        <button className={GBTN.secondary} onClick={locate} disabled={busy !== null}>
          {busy === 'locate' ? <Loader2 size={13} className="animate-spin" /> : <Crosshair size={13} />} Use my location
        </button>
        {fence && (
          <button className={GBTN.secondary} disabled={busy !== null}
            onClick={() => { setLat(String(fence.lat)); setLng(String(fence.lng)); setLabel(l => l || fence.label); setNote(null) }}>
            <School size={13} /> Attendance geofence
          </button>
        )}
        <button className={`${GBTN.primary} ml-auto`} onClick={save} disabled={busy !== null || la == null || ln == null}>
          {busy === 'save' && <Loader2 size={13} className="animate-spin" />} Save
        </button>
      </div>
      <NoteLine note={note} />
    </div>
  )
}

// ── Map provider ────────────────────────────────────────────────────────────

export function MapProviderForm({ onSaved }: { onSaved?: () => void }) {
  const [settings, setSettings] = useState<MapSettings | null>(null)
  const [token, setToken] = useState('')
  const [style, setStyle] = useState(MAP_STYLES[0].key)
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState<'test' | 'save' | null>(null)
  const [note, setNote] = useState<Note>(null)

  useEffect(() => {
    fetchMapSettings(true).then(s => { setSettings(s); setToken(s.mapbox_token ?? ''); setStyle(s.style) })
  }, [])

  const test = async () => {
    setBusy('test'); setNote(null)
    const r = await testMapboxToken(token, style)
    setNote({ ok: r.ok, text: r.message }); setBusy(null)
  }

  const save = async (clear = false) => {
    setBusy('save'); setNote(null)
    const next = { mapbox_token: clear ? null : token.trim() || null, style }
    if (next.mapbox_token) {
      const r = await testMapboxToken(next.mapbox_token, style)
      if (!r.ok) { setNote({ ok: false, text: r.message }); setBusy(null); return }
    }
    const res = await saveMapSettings(next)
    setBusy(null)
    if (!res.success) { setNote({ ok: false, text: res.error ?? 'Could not save.' }); return }
    setSettings(next); if (clear) setToken('')
    setNote({ ok: true, text: clear ? 'Removed. Maps use the fallback now.' : 'Saved. Maps use it the next time they open.' })
    onSaved?.()
  }

  const unchanged = token.trim() === (settings?.mapbox_token ?? '') && style === settings?.style

  return (
    <div className="space-y-3">
      <p className="text-[12px] leading-snug text-slate-600">
        Optional. Without your own key, maps use {MAPBOX_TOKEN ? 'the Mapbox key EduBerry provides, then ' : ''}OpenStreetMap —
        and fall back to them by themselves if your key ever stops working.
      </p>

      <label className="block">
        <span className={LABEL}>Mapbox public token</span>
        <div className="relative mt-1">
          <KeyRound size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          <input
            type={show ? 'text' : 'password'}
            className={`${GINPUT} pl-8 pr-9 font-mono text-[12.5px]`}
            value={token}
            onChange={e => { setToken(e.target.value); setNote(null) }}
            placeholder="pk.eyJ1Ijoi…"
            autoComplete="off"
            spellCheck={false}
          />
          <button onClick={() => setShow(v => !v)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-800" aria-label={show ? 'Hide token' : 'Show token'}>
            {show ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        </div>
        <span className="mt-1 block text-[11px] text-slate-500">A public token (pk.), restricted to this site’s address.</span>
      </label>

      <label className="block">
        <span className={LABEL}>Style</span>
        <select className={`${GINPUT} mt-1`} value={style} onChange={e => setStyle(e.target.value)}>
          {MAP_STYLES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
      </label>

      <div className="flex flex-wrap items-center gap-2">
        <button className={GBTN.secondary} onClick={test} disabled={!token.trim() || busy !== null}>
          {busy === 'test' ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />} Test
        </button>
        {settings?.mapbox_token && (
          <button className={`${GBTN.secondary} hover:!text-rose-600`} onClick={() => save(true)} disabled={busy !== null}>Remove</button>
        )}
        <button className={`${GBTN.primary} ml-auto`} onClick={() => save(false)} disabled={busy !== null || unchanged}>
          {busy === 'save' && <Loader2 size={13} className="animate-spin" />} Save
        </button>
      </div>
      <NoteLine note={note} />
    </div>
  )
}
