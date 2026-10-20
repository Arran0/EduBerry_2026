'use client'

import React, { useEffect, useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import { AlertTriangle, Info, Trash2 } from 'lucide-react'
import ModalShell from '@/components/ui/ModalShell'

// ──────────────────────────────────────────────────────────────
// The popup language for Academics and Classrooms.
//
// Every popup is ModalShell's glass sheet: header on the glass, what is read
// on a solid card, actions in a footer on the glass, right-aligned, the
// primary action last. Buttons are capsules filled from the page palette.
// Staff pages square every corner through .pro-chrome; nothing here has to
// know which.
// ──────────────────────────────────────────────────────────────

const BTN =
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-full font-semibold ' +
  'min-h-[2.5rem] px-4 text-[13px] sm:min-h-[2.125rem] sm:px-3.5 ' +
  'transition-[background-color,color,box-shadow,transform,filter] duration-150 active:scale-[0.97] ' +
  'disabled:opacity-50 disabled:pointer-events-none ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--page-primary,#0ea5e9)]/50 ' +
  '[&_svg]:w-[14px] [&_svg]:h-[14px] [&_svg]:flex-shrink-0'

/** The one filled action in a popup, in the page's own colour. */
export const SHEET_BTN_PRIMARY =
  `${BTN} text-white bg-[color:var(--page-primary-dark,#0f172a)] hover:brightness-110 shadow-[inset_0_1px_0_rgba(255,255,255,.18),0_4px_12px_-6px_rgba(15,23,42,.5)]`
export const SHEET_BTN_GHOST =
  `${BTN} text-slate-700 bg-white/80 hover:bg-white ring-1 ring-inset ring-slate-900/10`
export const SHEET_BTN_DANGER =
  `${BTN} text-white bg-rose-600 hover:bg-rose-700`

/** A field on a sheet's card. */
export const SHEET_INPUT =
  'themed-input w-full min-w-0 bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-800 ' +
  'placeholder:text-slate-400 focus:outline-none transition-[border-color,box-shadow]'

export function SheetLabel({ children, hint, htmlFor }: { children: React.ReactNode; hint?: string; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className="block text-[12px] font-semibold text-slate-600 mb-1">
      {children}
      {hint && <span className="font-normal text-slate-400"> · {hint}</span>}
    </label>
  )
}

/** Cancel + primary, right-aligned; wraps instead of squeezing on a phone. */
export function SheetFooter({ onCancel, cancelLabel = 'Cancel', children }: {
  onCancel?: () => void
  cancelLabel?: string
  children?: React.ReactNode
}) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {onCancel && <button type="button" onClick={onCancel} className={SHEET_BTN_GHOST}>{cancelLabel}</button>}
      {children}
    </div>
  )
}

// ── Confirmations and notices ─────────────────────────────────
// In place of the browser's confirm() and alert(): the same glass sheet as
// every other popup. Both are promises, so a handler reads the way it did with
// the browser's boxes. The host is mounted once by the app layouts.

interface Request {
  title: string
  body?: React.ReactNode
  confirmLabel: string
  tone: 'primary' | 'danger' | 'notice'
  resolve: (ok: boolean) => void
}

let raise: ((r: Request) => void) | null = null

const SHARP_THEMES = new Set(['fees', 'salary', 'classrooms'])

function ask(r: Omit<Request, 'resolve'>): Promise<boolean> {
  if (!raise) {
    if (typeof window === 'undefined') return Promise.resolve(false)
    const text = typeof r.body === 'string' ? `${r.title}\n\n${r.body}` : r.title
    if (r.tone === 'notice') { window.alert(text); return Promise.resolve(true) }
    return Promise.resolve(window.confirm(text))
  }
  return new Promise(resolve => raise!({ ...r, resolve }))
}

export function askConfirm(opts: {
  title: string
  body?: React.ReactNode
  confirmLabel?: string
  danger?: boolean
}): Promise<boolean> {
  return ask({
    title: opts.title,
    body: opts.body,
    confirmLabel: opts.confirmLabel ?? (opts.danger ? 'Delete' : 'Continue'),
    tone: opts.danger ? 'danger' : 'primary',
  })
}

/** A one-button notice — for an error the person has to read. */
export function tellUser(title: string, body?: React.ReactNode): Promise<void> {
  return ask({ title, body, confirmLabel: 'OK', tone: 'notice' }).then(() => undefined)
}

export function SheetConfirmHost() {
  const [req, setReq] = useState<Request | null>(null)
  useEffect(() => {
    raise = r => setReq(prev => {
      // A second question while one is open answers the first with "no".
      prev?.resolve(false)
      return r
    })
    return () => { raise = null }
  }, [])

  const answer = (ok: boolean) => {
    req?.resolve(ok)
    setReq(null)
  }

  // Square on the pages whose own popups are square (the admin sheets), so a
  // confirmation never looks like it came from another product.
  const theme = typeof document === 'undefined' ? null : document.querySelector('[data-page-theme]')?.getAttribute('data-page-theme')
  const sharp = !!theme && SHARP_THEMES.has(theme)

  const icon = req?.tone === 'danger' ? <Trash2 size={17} /> : req?.tone === 'notice' ? <Info size={17} /> : <AlertTriangle size={17} />
  const chip = req?.tone === 'danger' ? 'bg-rose-100 text-rose-600' : 'bg-slate-100 text-slate-600'

  return (
    <AnimatePresence>
      {req && (
        <ModalShell
          key="sheet-confirm"
          glass
          sharp={sharp}
          size="sm"
          zClass="z-[80]"
          onClose={() => answer(false)}
          title={req.title}
          icon={icon}
          iconClassName={chip}
          cardless={!req.body}
          footer={
            <SheetFooter onCancel={req.tone === 'notice' ? undefined : () => answer(false)}>
              <button
                type="button"
                autoFocus
                onClick={() => answer(true)}
                className={req.tone === 'danger' ? SHEET_BTN_DANGER : SHEET_BTN_PRIMARY}
              >
                {req.confirmLabel}
              </button>
            </SheetFooter>
          }
        >
          {req.body != null && (
            <div className="text-[13.5px] leading-relaxed text-slate-600 break-words">
              {typeof req.body === 'string' ? <p>{req.body}</p> : req.body}
            </div>
          )}
        </ModalShell>
      )}
    </AnimatePresence>
  )
}
