'use client'

/**
 * Board a child by card or QR.
 *
 * Two input paths, one handler. An RFID or NFC reader behaves as a USB or
 * Bluetooth keyboard: it types the card number and presses Enter, so a focused
 * text field is the whole integration and no app or driver is needed. A printed
 * QR uses the camera through BarcodeDetector, which exists on the Android
 * Chrome a bus attendant is holding and nowhere else that matters — where it is
 * missing the field still works, because a QR can be typed.
 *
 * The result is deliberately loud and slow to clear. An attendant is looking at
 * a queue of children, not at this screen; the confirmation has to survive being
 * glanced at two seconds late, and a wrong-bus card has to be impossible to miss.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, Camera, CameraOff, CheckCircle2, Loader2, ScanLine } from 'lucide-react'
import { hasCameraScanner, scanBoarding, type CredentialMethod, type ScanResult } from '@/lib/transport/credentials'

/** How long a result stays on screen before the field is ready again. */
const RESULT_MS = 4000
/** The same card read twice inside this window is the reader repeating itself. */
const REPEAT_MS = 2500

interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>
}

export default function ScanField({
  runId, stopId, onScanned, disabled,
}: {
  runId: string
  stopId?: string | null
  onScanned?: () => void
  disabled?: boolean
}) {
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<ScanResult | null>(null)
  const [camera, setCamera] = useState(false)
  const [cameraError, setCameraError] = useState<string | null>(null)

  const inputRef = useRef<HTMLInputElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const lastToken = useRef<{ token: string; at: number }>({ token: '', at: 0 })
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const submit = useCallback(async (token: string, method: CredentialMethod) => {
    const clean = token.trim()
    if (!clean || busy) return

    // A keyboard-wedge reader fires the same card twice on a long tap, and a
    // camera sees the same QR thirty times a second. Both are one scan.
    const now = Date.now()
    if (clean === lastToken.current.token && now - lastToken.current.at < REPEAT_MS) return
    lastToken.current = { token: clean, at: now }

    setBusy(true)
    const res = await scanBoarding(runId, clean, method, stopId ?? null)
    setBusy(false)
    setResult(res)
    setValue('')
    if (res.ok) onScanned?.()

    if (clearTimer.current) clearTimeout(clearTimer.current)
    clearTimer.current = setTimeout(() => setResult(null), RESULT_MS)
    inputRef.current?.focus()
  }, [runId, stopId, busy, onScanned])

  useEffect(() => () => { if (clearTimer.current) clearTimeout(clearTimer.current) }, [])

  // Camera loop. Stopped on unmount and whenever the camera is turned off, so
  // the light does not stay on behind a closed screen.
  useEffect(() => {
    if (!camera) return
    let alive = true
    let stream: MediaStream | null = null
    let frame: number | null = null

    const run = async () => {
      try {
        const Detector = (window as unknown as { BarcodeDetector: new (o: { formats: string[] }) => BarcodeDetectorLike })
          .BarcodeDetector
        const detector = new Detector({ formats: ['qr_code'] })
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
        })
        if (!alive) { stream.getTracks().forEach(t => t.stop()); return }
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play()
        }

        const tick = async () => {
          if (!alive || !videoRef.current) return
          try {
            const codes = await detector.detect(videoRef.current)
            if (codes.length > 0) await submit(codes[0].rawValue, 'qr')
          } catch {
            // A dropped frame is not an error worth showing anyone.
          }
          if (alive) frame = requestAnimationFrame(() => { void tick() })
        }
        void tick()
      } catch {
        if (alive) {
          setCameraError('Could not open the camera. Scan by typing the code, or use a card reader.')
          setCamera(false)
        }
      }
    }
    void run()

    return () => {
      alive = false
      if (frame) cancelAnimationFrame(frame)
      stream?.getTracks().forEach(t => t.stop())
    }
  }, [camera, submit])

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-3 space-y-2.5">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <ScanLine size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            ref={inputRef}
            value={value}
            disabled={disabled || busy}
            onChange={e => setValue(e.target.value)}
            onKeyDown={e => {
              // A reader ends its transmission with Enter. So does a person.
              if (e.key === 'Enter') { e.preventDefault(); void submit(value, 'rfid') }
            }}
            placeholder="Tap a card or scan a code"
            aria-label="Card number or QR code"
            className="w-full bg-white border border-slate-200 rounded-xl pl-9 pr-3 py-3 text-base text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-slate-900 transition-colors disabled:opacity-60"
            autoComplete="off"
            // Keeps a hardware reader's keystrokes landing here without the
            // on-screen keyboard covering half the roster.
            inputMode="none"
          />
        </div>
        {hasCameraScanner() && (
          <button
            onClick={() => { setCameraError(null); setCamera(c => !c) }}
            disabled={disabled}
            className={`w-12 h-12 rounded-xl flex items-center justify-center transition-colors flex-shrink-0 ${
              camera ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
            aria-label={camera ? 'Stop the camera' : 'Scan with the camera'}
          >
            {camera ? <CameraOff size={18} /> : <Camera size={18} />}
          </button>
        )}
        <button
          onClick={() => void submit(value, 'rfid')}
          disabled={disabled || busy || !value.trim()}
          className="px-4 h-12 rounded-xl bg-slate-900 text-white text-sm font-bold disabled:opacity-40 flex-shrink-0"
        >
          {busy ? <Loader2 size={16} className="animate-spin" /> : 'Board'}
        </button>
      </div>

      {camera && (
        <video
          ref={videoRef}
          muted
          playsInline
          className="w-full rounded-xl bg-black aspect-video object-cover"
        />
      )}

      {cameraError && <p className="text-xs text-amber-600">{cameraError}</p>}

      {result && (
        <div
          role="status"
          aria-live="assertive"
          className={`rounded-xl px-3 py-2.5 flex items-start gap-2 ${
            result.ok
              ? 'bg-emerald-50 border border-emerald-200'
              : result.wrongBus
                ? 'bg-rose-50 border border-rose-300'
                : 'bg-amber-50 border border-amber-200'
          }`}
        >
          {result.ok
            ? <CheckCircle2 size={18} className="text-emerald-600 flex-shrink-0 mt-0.5" />
            : <AlertTriangle size={18} className={`flex-shrink-0 mt-0.5 ${result.wrongBus ? 'text-rose-600' : 'text-amber-600'}`} />}
          <div className="min-w-0">
            <p className={`text-sm font-bold ${
              result.ok ? 'text-emerald-900' : result.wrongBus ? 'text-rose-900' : 'text-amber-900'
            }`}>
              {result.ok
                ? `${result.studentName ?? 'Student'} — ${result.event === 'alight' ? 'got off' : 'on board'}`
                : result.wrongBus
                  ? `${result.studentName ?? 'This child'} is not on this bus`
                  : result.error ?? 'Could not read that card'}
            </p>
            {result.wrongBus && (
              <p className="text-xs text-rose-800 mt-0.5">
                Do not let them travel on this route. Call the office.
              </p>
            )}
            {result.ok && (
              <p className="text-xs text-emerald-800 mt-0.5">
                Check the name matches the child in front of you.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
