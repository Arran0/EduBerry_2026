'use client'

import React, { useState, useEffect } from 'react'
import { Bell, BellOff, BellRing, Loader2 } from 'lucide-react'
import { getPushStatus, enablePush, disablePush, isPushSupported, PushStatus } from '@/lib/push'

/**
 * Enable/disable notifications for this device — one switch for everything the
 * app pushes: announcements and OD / Leave alike.
 *
 * Offered in two places for that reason: the announcements banner, where the
 * content is, and above the Home notification box, which is the record of the
 * same notifications. Both drive the same per-device subscription, so turning
 * it on in either place turns it on for both.
 *
 * Renders nothing at all when the browser can't do push (or no VAPID key is
 * configured) rather than offering a button that cannot work.
 */
export default function PushToggle({ onDark, compact = false }: { onDark: boolean; compact?: boolean }) {
  const [status, setStatus] = useState<PushStatus | null>(null)
  const [busy, setBusy]     = useState(false)
  const [error, setError]   = useState<string | null>(null)

  useEffect(() => {
    if (!isPushSupported()) { setStatus('unsupported'); return }
    getPushStatus().then(setStatus)
  }, [])

  if (status === null || status === 'unsupported') return null

  const enabled = status === 'enabled'
  const blocked = status === 'denied'

  const handleClick = async () => {
    if (busy || blocked) return
    setBusy(true)
    setError(null)
    try {
      setStatus(enabled ? await disablePush() : await enablePush())
    } catch {
      setError('Could not update notifications')
      setTimeout(() => setError(null), 4000)
    }
    setBusy(false)
  }

  const label = blocked ? 'Notifications blocked'
    : enabled ? 'Notifications on'
    : 'Notify me'

  return (
    <button
      onClick={handleClick}
      disabled={busy || blocked}
      title={
        blocked
          ? 'Notifications are blocked for this site in your browser settings'
          : enabled
            ? 'Turn off notifications on this device'
            : 'Get notified on this device — announcements, and updates on your OD / Leave applications'
      }
      className={compact
        ? `flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-[11px] font-bold border transition-all flex-shrink-0 disabled:opacity-60 disabled:cursor-not-allowed ${
            enabled
              ? 'bg-sky-50 border-sky-200 text-sky-600 hover:bg-sky-100'
              : 'bg-white/70 border-white/60 text-slate-500 hover:bg-white'
          }`
        : `flex items-center gap-2 px-3.5 sm:px-4 py-2.5 rounded-xl text-sm font-semibold border backdrop-blur-sm transition-all flex-shrink-0 disabled:opacity-60 disabled:cursor-not-allowed ${
            onDark
              ? 'bg-white/20 hover:bg-white/30 border-white/25 text-white'
              : 'bg-white/75 hover:bg-white/95 border-white/55 text-slate-700'
          }`}
    >
      {busy   ? <Loader2 size={compact ? 13 : 16} className="animate-spin" />
       : blocked ? <BellOff size={compact ? 13 : 16} />
       : enabled ? <BellRing size={compact ? 13 : 16} />
       : <Bell size={compact ? 13 : 16} />}
      <span className={compact ? '' : 'hidden sm:inline'}>{error ?? label}</span>
    </button>
  )
}
