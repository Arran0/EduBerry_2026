'use client'

import React, { useState, useEffect } from 'react'
import { Bell, BellOff, BellRing, Loader2 } from 'lucide-react'
import { getPushStatus, enablePush, disablePush, isPushSupported, PushStatus } from '@/lib/push'

/**
 * Enable/disable Web Push for announcements on this device.
 *
 * Sits in the announcements banner so the control is where the content is.
 * Renders nothing at all when the browser can't do push (or no VAPID key is
 * configured) rather than offering a button that cannot work.
 */
export default function PushToggle({ onDark }: { onDark: boolean }) {
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
            ? 'Turn off announcement notifications on this device'
            : 'Get notified on this device when a new announcement is posted'
      }
      className={`flex items-center gap-2 px-3.5 sm:px-4 py-2.5 rounded-xl text-sm font-semibold border backdrop-blur-sm transition-all flex-shrink-0 disabled:opacity-60 disabled:cursor-not-allowed ${
        onDark
          ? 'bg-white/20 hover:bg-white/30 border-white/25 text-white'
          : 'bg-white/75 hover:bg-white/95 border-white/55 text-slate-700'
      }`}
    >
      {busy   ? <Loader2 size={16} className="animate-spin" />
       : blocked ? <BellOff size={16} />
       : enabled ? <BellRing size={16} />
       : <Bell size={16} />}
      <span className="hidden sm:inline">{error ?? label}</span>
    </button>
  )
}
