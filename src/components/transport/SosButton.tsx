'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { AlertOctagon, Loader2, X } from 'lucide-react'
import ModalShell from '@/components/ui/ModalShell'
import { INCIDENT_LABELS, raiseIncident, type TransportIncidentType } from '@/lib/transport/runs'

/** How long the button must be held. Long enough that a pocket cannot do it,
 *  short enough that a frightened person can. */
const HOLD_MS = 1500

const KINDS: TransportIncidentType[] = [
  'accident', 'breakdown', 'medical', 'security', 'route_blocked', 'other',
]

/**
 * The emergency control.
 *
 * Hold-to-confirm rather than tap-then-dialog: in a real emergency a driver
 * should not have to read anything, and a single tap is too easy to do by
 * accident on a phone clipped to a dashboard. Choosing the kind of emergency
 * comes *after* the alarm is already raised — telling the school something is
 * wrong must never wait on classifying what.
 */
export default function SosButton({ runId }: { runId: string }) {
  const [holding, setHolding] = useState(false)
  const [progress, setProgress] = useState(0)
  const [sending, setSending] = useState(false)
  const [raisedId, setRaisedId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const timer = useRef<number | null>(null)
  const startedAt = useRef<number>(0)

  const fire = useCallback(async () => {
    setSending(true)
    // Best-effort precise position; never block the alarm waiting for one.
    const coords = await new Promise<GeolocationPosition | null>(resolve => {
      if (typeof navigator === 'undefined' || !navigator.geolocation) { resolve(null); return }
      navigator.geolocation.getCurrentPosition(
        p => resolve(p),
        () => resolve(null),
        { enableHighAccuracy: true, timeout: 4000, maximumAge: 10_000 },
      )
    })

    const res = await raiseIncident(runId, 'sos', {
      lat: coords?.coords.latitude,
      lng: coords?.coords.longitude,
      accuracyM: coords?.coords.accuracy,
    })
    setSending(false)
    if (!res.success) { setError(res.error ?? 'Could not raise the alarm'); return }
    setRaisedId(res.incidentId ?? null)
  }, [runId])

  const stopHold = useCallback(() => {
    if (timer.current) { window.clearInterval(timer.current); timer.current = null }
    setHolding(false)
    setProgress(0)
  }, [])

  const startHold = useCallback(() => {
    if (sending || raisedId) return
    setError(null)
    setHolding(true)
    startedAt.current = Date.now()
    timer.current = window.setInterval(() => {
      const pct = Math.min(1, (Date.now() - startedAt.current) / HOLD_MS)
      setProgress(pct)
      if (pct >= 1) { stopHold(); fire() }
    }, 40)
  }, [sending, raisedId, stopHold, fire])

  useEffect(() => () => { if (timer.current) window.clearInterval(timer.current) }, [])

  return (
    <>
      <button
        onPointerDown={startHold}
        onPointerUp={stopHold}
        onPointerLeave={stopHold}
        onContextMenu={e => e.preventDefault()}
        disabled={sending || !!raisedId}
        className="relative w-full overflow-hidden flex items-center justify-center gap-2 bg-rose-600 hover:bg-rose-700 text-white text-base font-bold py-4 rounded-2xl transition-colors disabled:opacity-70 select-none touch-none"
      >
        <span
          className="absolute inset-y-0 left-0 bg-rose-900/50 transition-none"
          style={{ width: `${progress * 100}%` }}
        />
        <span className="relative flex items-center gap-2">
          {sending ? <Loader2 size={18} className="animate-spin" /> : <AlertOctagon size={18} />}
          {raisedId ? 'Alarm raised' : holding ? 'Keep holding…' : 'Hold for emergency'}
        </span>
      </button>

      {error && <p className="text-xs text-rose-600 mt-1.5">{error}</p>}

      {raisedId && (
        <IncidentKindPrompt incidentId={raisedId} onDone={() => setRaisedId(null)} />
      )}
    </>
  )
}

/**
 * Asked after the fact.
 *
 * The school already knows something is wrong; this only sharpens what. It can
 * be dismissed, because a driver dealing with an actual emergency has better
 * things to do than fill in a form.
 */
function IncidentKindPrompt({ incidentId, onDone }: { incidentId: string; onDone: () => void }) {
  const [saving, setSaving] = useState(false)

  const classify = async (kind: TransportIncidentType) => {
    setSaving(true)
    const { supabase } = await import('@/lib/supabase')
    await supabase.from('transport_incidents').update({ type: kind }).eq('id', incidentId)
    await supabase.from('transport_incident_updates').insert({
      incident_id: incidentId, kind: 'note', body: `Crew classified this as: ${INCIDENT_LABELS[kind]}`,
    })
    setSaving(false)
    onDone()
  }

  return (
    <ModalShell
      onClose={onDone}
      size="sm"
      title="Help is on the way"
      subtitle="The school has your location and who is on board."
      icon={<AlertOctagon size={18} />}
      iconClassName="bg-rose-100 text-rose-700"
    >
      <p className="text-sm text-slate-600 mb-3">
        If you can, tap what happened. If you can&apos;t, close this — the alarm is
        already raised.
      </p>
      <div className="grid grid-cols-2 gap-2">
        {KINDS.map(k => (
          <button
            key={k}
            onClick={() => classify(k)}
            disabled={saving}
            className="px-3 py-3 rounded-xl border border-slate-200 text-sm font-semibold text-slate-700 hover:border-slate-400 hover:bg-slate-50 transition-colors disabled:opacity-50"
          >
            {INCIDENT_LABELS[k]}
          </button>
        ))}
      </div>
      <button
        onClick={onDone}
        className="w-full mt-3 py-2.5 text-sm font-semibold text-slate-500 hover:text-slate-800 flex items-center justify-center gap-1.5"
      >
        <X size={14} /> Not now
      </button>
    </ModalShell>
  )
}
