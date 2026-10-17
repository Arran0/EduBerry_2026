'use client'

/**
 * The two school-level settings at the foot of Configuration: whose map key
 * the transport maps use, and where the school is.
 */

import React, { useEffect, useState } from 'react'
import dynamic from 'next/dynamic'
import {
  CheckCircle2, Crosshair, Eye, EyeOff, KeyRound, Loader2, Map as MapIcon, MapPin, School, AlertTriangle,
} from 'lucide-react'
import { acquirePosition } from '@/lib/gpsAcquisition'
import {
  MAP_STYLES, fetchGeofenceSchool, fetchMapSettings, fetchSchoolLocation, saveMapSettings, saveSchoolLocation,
  testMapboxToken, tilesFor, type MapSettings, type SchoolLocation,
} from '@/lib/transport/settings'
import { MAPBOX_TOKEN } from '@/lib/transport/mapTiles'
import { CardHead, Content, GBTN, GINPUT } from './glass'

const TransportMap = dynamic(() => import('./TransportMap'), {
  ssr: false,
  loading: () => <div className="h-[240px] rounded-2xl bg-slate-100/80 flex items-center justify-center"><Loader2 className="animate-spin text-slate-400" size={18} /></div>,
})

type Note = { ok: boolean; text: string } | null

// ── Map provider ────────────────────────────────────────────────────────────

export function MapProviderCard() {
  const [settings, setSettings] = useState<MapSettings | null>(null)
  const [token, setToken] = useState('')
  const [style, setStyle] = useState(MAP_STYLES[0].key)
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState<'test' | 'save' | null>(null)
  const [note, setNote] = useState<Note>(null)

  useEffect(() => {
    fetchMapSettings(true).then(s => { setSettings(s); setToken(s.mapbox_token ?? ''); setStyle(s.style) })
  }, [])

  const origin = tilesFor(settings).origin
  const status = origin === 'school'
    ? { tone: 'good', text: 'Using your school’s Mapbox key' }
    : origin === 'provided'
      ? { tone: 'good', text: 'Using the Mapbox key EduBerry provides' }
      : { tone: 'warn', text: 'Using OpenStreetMap — no Mapbox key yet' }

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
    setNote({ ok: true, text: clear ? 'Removed. Maps fall back to the provided key, then OpenStreetMap.' : 'Saved. Maps use it from the next time they open.' })
  }

  return (
    <Content className="p-4 flex flex-col">
      <CardHead icon={MapIcon} label="Map provider" right={
        <span className={`inline-flex items-center gap-1.5 text-[11px] font-semibold ${status.tone === 'good' ? 'text-emerald-700' : 'text-amber-700'}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${status.tone === 'good' ? 'bg-emerald-500' : 'bg-amber-500'}`} /> {status.text}
        </span>
      } />
      <p className="mt-2 text-[12px] leading-snug text-slate-600">
        Bring your own Mapbox key if you like — your usage, your map style.
        {MAPBOX_TOKEN ? ' Without one, maps use the key EduBerry provides.' : ''} If a key ever stops working, maps fall
        back to {MAPBOX_TOKEN ? 'the provided key and then ' : ''}OpenStreetMap on their own.
      </p>

      <div className="mt-3 grid grid-cols-1 sm:grid-cols-[1fr_9rem] gap-2">
        <label className="block">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Mapbox public token</span>
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
        </label>
        <label className="block">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Style</span>
          <select className={`${GINPUT} mt-1`} value={style} onChange={e => setStyle(e.target.value)}>
            {MAP_STYLES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        </label>
      </div>
      <p className="mt-1.5 text-[11px] text-slate-500">
        Create one at account.mapbox.com → Tokens. Use a <span className="font-semibold">public</span> token (pk.) and restrict it
        to this site’s address.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button className={GBTN.secondary} onClick={test} disabled={!token.trim() || busy !== null}>
          {busy === 'test' ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />} Test
        </button>
        <button className={GBTN.primary} onClick={() => save(false)} disabled={busy !== null || (token.trim() === (settings?.mapbox_token ?? '') && style === settings?.style)}>
          {busy === 'save' ? <Loader2 size={13} className="animate-spin" /> : null} Save
        </button>
        {settings?.mapbox_token && (
          <button className={`${GBTN.secondary} hover:!text-rose-600`} onClick={() => save(true)} disabled={busy !== null}>Remove key</button>
        )}
      </div>
      {note && (
        <p className={`mt-2 flex items-start gap-1.5 text-[12px] font-semibold ${note.ok ? 'text-emerald-700' : 'text-rose-600'}`}>
          {note.ok ? <CheckCircle2 size={13} className="mt-0.5 flex-shrink-0" /> : <AlertTriangle size={13} className="mt-0.5 flex-shrink-0" />} {note.text}
        </p>
      )}
    </Content>
  )
}

// ── School location ─────────────────────────────────────────────────────────

export function SchoolLocationCard({ onSaved }: { onSaved?: () => void }) {
  const [current, setCurrent] = useState<SchoolLocation | null | undefined>(undefined)
  const [fence, setFence] = useState<SchoolLocation | null>(null)
  const [draft, setDraft] = useState<{ lat: number; lng: number } | null>(null)
  const [label, setLabel] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<Note>(null)

  const load = async () => {
    const [c, f] = await Promise.all([fetchSchoolLocation(true), fetchGeofenceSchool()])
    setCurrent(c); setFence(f); setDraft(c ? { lat: c.lat, lng: c.lng } : null); setLabel(c?.label ?? '')
  }
  useEffect(() => { load() }, [])

  const here = async () => {
    setBusy(true); setNote(null)
    const r = await acquirePosition({ fence: null })
    setBusy(false)
    if (!r.fix) { setNote({ ok: false, text: 'Could not get a location fix. Check location permission, or click the map instead.' }); return }
    setDraft({ lat: r.fix.lat, lng: r.fix.lng })
  }

  const save = async () => {
    if (!draft) return
    setBusy(true); setNote(null)
    const res = await saveSchoolLocation({ ...draft, label: label || 'School' })
    setBusy(false)
    if (!res.success) { setNote({ ok: false, text: res.error ?? 'Could not save.' }); return }
    setNote({ ok: true, text: 'Saved. The Operations map now opens on the school.' })
    await load(); onSaved?.()
  }

  const changed = !!draft && (!current || current.source !== 'configured'
    || Math.abs(current.lat - draft.lat) > 1e-6 || Math.abs(current.lng - draft.lng) > 1e-6 || (label || 'School') !== current.label)

  return (
    <Content className="p-4 flex flex-col" id="school-location">
      <CardHead icon={School} label="School location" right={
        current === undefined ? null : current ? (
          <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-emerald-700">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            {current.source === 'geofence' ? 'From the attendance geofence' : 'Set'}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-amber-700">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500" /> Not set
          </span>
        )
      } />
      <p className="mt-2 text-[12px] leading-snug text-slate-600">
        The Operations map opens centred here. {fence ? 'It defaults to your attendance geofence; ' : 'No attendance geofence is set up, so '}
        click the map to place the school{fence ? ' somewhere else' : ''}, or use where you are standing.
      </p>

      <div className="mt-3 rounded-2xl overflow-hidden shadow-[0_1px_2px_rgba(15,23,42,.06),0_12px_24px_-18px_rgba(15,23,42,.45)]">
        <TransportMap
          school={draft ? { ...draft, label: label || 'School' } : null}
          schoolZoom={15}
          onMapClick={p => { setDraft(p); setNote(null) }}
          showFences={false}
          heightClass="h-[240px]"
        />
      </div>

      <div className="mt-3 grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2 items-end">
        <label className="block">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Name on the map</span>
          <input className={`${GINPUT} mt-1`} value={label} onChange={e => setLabel(e.target.value)} placeholder="School" />
        </label>
        <p className="text-[11px] text-slate-500 tabular-nums sm:pb-2.5">
          {draft ? <><MapPin size={11} className="inline -mt-0.5" /> {draft.lat.toFixed(5)}, {draft.lng.toFixed(5)}</> : 'No point yet'}
        </p>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button className={GBTN.secondary} onClick={here} disabled={busy}>
          {busy ? <Loader2 size={13} className="animate-spin" /> : <Crosshair size={13} />} Use my location
        </button>
        {fence && (
          <button className={GBTN.secondary} onClick={() => { setDraft({ lat: fence.lat, lng: fence.lng }); setLabel(l => l || fence.label) }} disabled={busy}>
            <School size={13} /> Use attendance geofence
          </button>
        )}
        <button className={GBTN.primary} onClick={save} disabled={busy || !changed}>Save location</button>
      </div>
      {note && (
        <p className={`mt-2 flex items-start gap-1.5 text-[12px] font-semibold ${note.ok ? 'text-emerald-700' : 'text-rose-600'}`}>
          {note.ok ? <CheckCircle2 size={13} className="mt-0.5 flex-shrink-0" /> : <AlertTriangle size={13} className="mt-0.5 flex-shrink-0" />} {note.text}
        </p>
      )}
    </Content>
  )
}
