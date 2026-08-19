'use client'

import React, { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { CheckCircle2, XCircle, Inbox, X } from 'lucide-react'
import type { NotifTone } from '@/lib/leaveNotifications'

/** One live notification, as shown in the stack. */
export interface ToastItem {
  id: string
  tone: NotifTone
  title: string
  text: string
}

const TONE_STYLE: Record<NotifTone, { icon: React.ReactNode; chip: string }> = {
  approved: { icon: <CheckCircle2 size={16} />, chip: 'bg-emerald-100 text-emerald-600' },
  rejected: { icon: <XCircle size={16} />,      chip: 'bg-rose-100 text-rose-600' },
  incoming: { icon: <Inbox size={16} />,        chip: 'bg-violet-100 text-violet-600' },
}

/** How long a toast stays up before retiring itself. */
const DISMISS_MS = 8000

function Toast({ item, onOpen, onDismiss }: {
  item: ToastItem
  onOpen: (item: ToastItem) => void
  onDismiss: (id: string) => void
}) {
  useEffect(() => {
    const t = setTimeout(() => onDismiss(item.id), DISMISS_MS)
    return () => clearTimeout(t)
  }, [item.id, onDismiss])

  const tone = TONE_STYLE[item.tone]

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -16, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -12, scale: 0.97 }}
      transition={{ type: 'spring', stiffness: 380, damping: 30 }}
      className="pointer-events-auto w-full sm:w-[22rem] flex items-start gap-3 p-3.5 rounded-2xl bg-white/95 backdrop-blur-xl ring-1 ring-slate-900/[0.06] shadow-[0_18px_48px_-14px_rgba(15,23,42,0.35)]"
    >
      <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${tone.chip}`}>
        {tone.icon}
      </div>
      <button
        type="button"
        onClick={() => onOpen(item)}
        className="flex-1 min-w-0 text-left"
      >
        <p className="text-[13px] font-bold text-slate-900 leading-tight">{item.title}</p>
        <p className="text-[12.5px] text-slate-500 leading-snug mt-0.5 line-clamp-3">{item.text}</p>
      </button>
      <button
        type="button"
        onClick={() => onDismiss(item.id)}
        aria-label="Dismiss"
        className="w-7 h-7 flex-shrink-0 flex items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors"
      >
        <X size={14} />
      </button>
    </motion.div>
  )
}

/**
 * The in-app half of a notification: a small stack that slides in wherever the
 * user happens to be, for things that arrive while the app is open.
 *
 * Deliberately not a replacement for the notification box — a toast is
 * transient and clears itself, the box is the record. Tapping one opens the
 * application it is about; ignoring one costs nothing, because it is still
 * sitting unread in the box afterwards.
 */
export default function NotificationToastStack({ items, onOpen, onDismiss }: {
  items: ToastItem[]
  onOpen: (item: ToastItem) => void
  onDismiss: (id: string) => void
}) {
  if (typeof document === 'undefined') return null

  return createPortal(
    <div className="pointer-events-none fixed z-[400] left-3 right-3 sm:left-auto sm:right-5 flex flex-col gap-2 items-stretch sm:items-end"
         style={{ top: 'max(0.75rem, env(safe-area-inset-top))' }}>
      <AnimatePresence initial={false}>
        {items.map(item => (
          <Toast key={item.id} item={item} onOpen={onOpen} onDismiss={onDismiss} />
        ))}
      </AnimatePresence>
    </div>,
    document.body,
  )
}
