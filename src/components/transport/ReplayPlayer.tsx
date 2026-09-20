'use client'

/**
 * Scrub a finished trip.
 *
 * The map is the same TransportMap the live screen uses, driven from an
 * interpolated position rather than a subscription — which is the whole trick:
 * nothing here knows it is showing history, so the stop pins, the geofences and
 * the bus marker all mean exactly what they mean live.
 *
 * The timeline underneath is the part an admin actually came for. A complaint
 * is never "where was the bus at 07:41", it is "you said you came at 07:35",
 * and the answer is a row saying arrived 07:41, six minutes late, four of six
 * children boarded.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import {
  Clock, Loader2, MapPin, Pause, Play, RotateCcw, SkipBack, SkipForward, Users,
} from 'lucide-react'
import { ADMIN } from '@/components/bus/adminUI'
import { formatDelay } from '@/lib/transport/reports'
import { positionAt, replayWindow, type RunReplay } from '@/lib/transport/replay'

const TransportMap = dynamic(() => import('./TransportMap'), {
  ssr: false,
  loading: () => (
    <div className="h-[420px] rounded-xl border border-[#E4E4E7] bg-[#FAFAFA] flex items-center justify-center">
      <Loader2 className="animate-spin text-[#A1A1AA]" size={20} />
    </div>
  ),
})

/** Wall-clock seconds advanced per real second. 60× replays an hour a minute. */
const SPEEDS = [15, 60, 240] as const

function clock(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })
}

export default function ReplayPlayer({ replay }: { replay: RunReplay }) {
  const { startMs, endMs } = useMemo(() => replayWindow(replay), [replay])
  const [atMs, setAtMs] = useState(startMs)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(60)

  // Reset when a different trip is opened, not on every render of the same one.
  useEffect(() => { setAtMs(startMs); setPlaying(false) }, [startMs])

  const frame = useRef<number | null>(null)
  const lastTick = useRef<number>(0)

  useEffect(() => {
    if (!playing) return
    lastTick.current = performance.now()

    const step = (now: number) => {
      const dt = now - lastTick.current
      lastTick.current = now
      setAtMs(prev => {
        const next = prev + dt * speed
        if (next >= endMs) { setPlaying(false); return endMs }
        return next
      })
      frame.current = requestAnimationFrame(step)
    }
    frame.current = requestAnimationFrame(step)
    return () => { if (frame.current) cancelAnimationFrame(frame.current) }
  }, [playing, speed, endMs])

  const bus = useMemo(() => positionAt(replay.track, atMs), [replay.track, atMs])

  const mapStops = useMemo(() => replay.stops.map(s => ({
    id: s.stop_id,
    seq: s.seq,
    name: s.name,
    lat: s.lat,
    lng: s.lng,
    radius_m: s.radius_m,
  })), [replay.stops])

  // Only the path travelled so far, so the line grows behind the bus rather
  // than the whole route being drawn from the start — which would give away
  // where it ends up and make the scrubber pointless.
  const travelled = useMemo(() => {
    const out: { lat: number; lng: number }[] = []
    for (const p of replay.track) {
      if (new Date(p.at).getTime() > atMs) break
      out.push({ lat: p.lat, lng: p.lng })
    }
    if (bus) out.push({ lat: bus.lat, lng: bus.lng })
    return out
  }, [replay.track, atMs, bus])

  const jump = useCallback((deltaMs: number) => {
    setAtMs(v => Math.min(endMs, Math.max(startMs, v + deltaMs)))
  }, [startMs, endMs])

  /** Stops and boardings, merged into the one list an admin reads top to bottom. */
  const timeline = useMemo(() => {
    const rows: { at: number; kind: 'stop' | 'board'; label: string; detail: string; passed: boolean }[] = []
    for (const s of replay.stops) {
      if (!s.arrived_at) continue
      const at = new Date(s.arrived_at).getTime()
      rows.push({
        at,
        kind: 'stop',
        label: `${s.seq}. ${s.name}`,
        detail: [
          clock(at),
          s.delay_seconds != null ? formatDelay(s.delay_seconds) : null,
          `${s.actual_boardings}/${s.expected_boardings} aboard`,
        ].filter(Boolean).join(' · '),
        passed: at <= atMs,
      })
    }
    for (const b of replay.boardings) {
      const at = new Date(b.at).getTime()
      rows.push({
        at,
        kind: 'board',
        label: b.event === 'board' ? 'Boarded' : b.event === 'alight' ? 'Got off' : b.event.replace('_', ' '),
        detail: `${clock(at)} · ${b.method}`,
        passed: at <= atMs,
      })
    }
    return rows.sort((a, b) => a.at - b.at)
  }, [replay.stops, replay.boardings, atMs])

  const hasTrack = replay.track.length > 0
  const coarse = replay.track.some(p => p.res === 'archive')

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_18rem] xl:grid-cols-[1fr_20rem] gap-4 lg:gap-5">
      <div className="space-y-3">
        <TransportMap
          stops={mapStops}
          path={travelled.length > 1 ? travelled : null}
          bus={bus ? { lat: bus.lat, lng: bus.lng, label: clock(atMs) } : null}
          showFences
          heightClass="h-[380px] md:h-[460px] lg:h-[min(60vh,42rem)]"
          className="rounded-xl overflow-hidden border border-[#E4E4E7]"
        />

        {!hasTrack ? (
          <div className="border border-dashed border-[#E4E4E7] rounded-xl px-4 py-6 text-center">
            <MapPin size={20} className="mx-auto text-[#A1A1AA] mb-1.5" />
            <p className="text-sm font-semibold text-[#52525B]">No track recorded</p>
            <p className="text-[11px] text-[#A1A1AA] mt-0.5">
              The bus reported no position on this trip, so there is nothing to replay.
              The stop times below are still what was recorded.
            </p>
          </div>
        ) : (
          <div className={`${ADMIN.card} px-3 py-3 space-y-2.5`}>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPlaying(p => !p)}
                className="w-9 h-9 rounded-lg bg-[#27272A] hover:bg-[#18181B] text-white flex items-center justify-center transition-colors flex-shrink-0"
                aria-label={playing ? 'Pause' : 'Play'}
              >
                {playing ? <Pause size={15} /> : <Play size={15} className="ml-0.5" />}
              </button>
              <button onClick={() => jump(-60_000)} className={ADMIN.ghostBtn} aria-label="Back one minute">
                <SkipBack size={13} /> 1 min
              </button>
              <button onClick={() => jump(60_000)} className={ADMIN.ghostBtn} aria-label="Forward one minute">
                1 min <SkipForward size={13} />
              </button>
              <button onClick={() => { setAtMs(startMs); setPlaying(false) }} className={ADMIN.ghostBtn}>
                <RotateCcw size={13} /> Start
              </button>

              <div className="flex-1" />

              <div className="flex items-center rounded-lg border border-[#E4E4E7] overflow-hidden">
                {SPEEDS.map(s => (
                  <button
                    key={s}
                    onClick={() => setSpeed(s)}
                    className={`px-2.5 py-1.5 text-[11px] font-semibold transition-colors ${
                      speed === s ? 'bg-[#27272A] text-white' : 'text-[#71717A] hover:bg-[#FAFAFA]'
                    }`}
                  >
                    {s}×
                  </button>
                ))}
              </div>
            </div>

            <input
              type="range"
              min={startMs}
              max={endMs}
              value={atMs}
              step={1000}
              onChange={e => { setPlaying(false); setAtMs(Number(e.target.value)) }}
              className="w-full accent-[#B8983C]"
              aria-label="Trip timeline"
            />

            <div className="flex items-center justify-between text-[11px] text-[#71717A]">
              <span>{clock(startMs)}</span>
              <span className="font-bold text-[#27272A] tabular-nums inline-flex items-center gap-1.5">
                <Clock size={11} className="text-[#A1A1AA]" />
                {clock(atMs)}
                {coarse && (
                  <span
                    className="text-[10px] font-semibold text-[#A1A1AA]"
                    title="Older trips are stored at one position every 30 seconds"
                  >
                    · 30s archive
                  </span>
                )}
              </span>
              <span>{clock(endMs)}</span>
            </div>
          </div>
        )}
      </div>

      {/* Timeline rail. Rows dim ahead of the playhead, so scrubbing reads as
          moving through the trip rather than as a static list beside a map. */}
      <div className="space-y-2">
        <p className={ADMIN.label}>What happened</p>
        <div className={`${ADMIN.card} divide-y divide-[#F4F4F5] overflow-hidden max-h-[30rem] overflow-y-auto`}>
          {timeline.length === 0 ? (
            <p className="px-4 py-8 text-center text-xs text-[#A1A1AA]">
              No stop arrivals or boardings were recorded.
            </p>
          ) : timeline.map((row, i) => (
            <button
              key={`${row.kind}-${row.at}-${i}`}
              onClick={() => { setPlaying(false); setAtMs(row.at) }}
              className={`w-full flex items-start gap-2.5 px-3 py-2.5 text-left transition-opacity hover:bg-[#FAFAFA] ${
                row.passed ? 'opacity-100' : 'opacity-40'
              }`}
            >
              <span className={`mt-0.5 flex-shrink-0 ${row.kind === 'stop' ? 'text-[#B8983C]' : 'text-emerald-600'}`}>
                {row.kind === 'stop' ? <MapPin size={13} /> : <Users size={13} />}
              </span>
              <span className="flex-1 min-w-0">
                <span className="block text-xs font-semibold text-[#27272A] truncate">{row.label}</span>
                <span className="block text-[11px] text-[#71717A] truncate">{row.detail}</span>
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
