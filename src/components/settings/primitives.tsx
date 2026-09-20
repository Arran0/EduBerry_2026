'use client'

import React, { useState, useEffect } from 'react'
import { Check, Copy, Info, Loader2, Save, ShieldCheck, Trash2, Plus } from 'lucide-react'

// Shared form primitives for the admin settings screens, in the admin palette
// (square corners, neutral greys). Extracted from src/app/admin/settings so the
// bank connection forms render identically wherever they are embedded —
// App Settings, Salary Payout Settings and Driver Payroll Settings all mount
// the same components rather than keeping drifting copies of a credential form.

export const inputCls =
  'border border-[#D4D4D8] bg-white px-3 py-2 text-sm focus:outline-none focus:border-[#27272A] transition-colors w-full'

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-[10px] font-bold uppercase tracking-widest text-[#525252] mb-3">{children}</p>
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[10px] font-bold uppercase tracking-widest text-[#525252] mb-1.5">{label}</label>
      {children}
      {hint && <p className="text-[11px] text-[#A1A1AA] mt-1 leading-relaxed">{hint}</p>}
    </div>
  )
}

export function TextInput({ value, onChange, placeholder, list, mono }: {
  value: string; onChange: (v: string) => void; placeholder?: string; list?: string; mono?: boolean
}) {
  return (
    <input
      type="text" value={value} onChange={e => onChange(e.target.value)}
      placeholder={placeholder} list={list}
      className={`${inputCls}${mono ? ' font-mono' : ''}`}
    />
  )
}

export function NumberInput({ value, onChange, min, step, placeholder }: {
  value: number; onChange: (v: number) => void; min?: number; step?: number; placeholder?: string
}) {
  return (
    <input
      type="number" value={value} min={min} step={step} placeholder={placeholder}
      onChange={e => onChange(Number(e.target.value) || 0)}
      className={`${inputCls} tabular-nums`}
    />
  )
}

/**
 * Status line under a write-only credential.
 *
 * The form never receives a stored secret's value (see
 * src/lib/paymentSecrets.ts), so an empty box does not mean "not set". This
 * says which it is, and offers the only way to actually erase one.
 */
function SecretStatus({ configured, dirty, onClear }: {
  configured?: boolean; dirty: boolean; onClear?: () => void
}) {
  if (!configured) return null
  return (
    <p className="text-[11px] text-[#71717A] flex items-center gap-2">
      <span>
        {dirty
          ? 'Will be replaced when you save.'
          : 'Saved. Leave blank to keep it, or type a new value to replace it.'}
      </span>
      {onClear && !dirty && (
        <button
          type="button" onClick={onClear}
          className="font-medium text-[#B91C1C] hover:underline"
        >
          Clear
        </button>
      )}
    </p>
  )
}

/** Secret input. Reveal is deliberate and per-field so an admin can check a
 *  pasted key without exposing every credential on the screen at once.
 *
 *  `configured` marks a value that exists server-side but was deliberately not
 *  sent to the browser; the box stays empty and blank means "unchanged". */
export function PwInput({ value, onChange, placeholder, configured, onClear }: {
  value: string; onChange: (v: string) => void; placeholder?: string
  configured?: boolean; onClear?: () => void
}) {
  const [shown, setShown] = useState(false)
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <input
          type={shown ? 'text' : 'password'} autoComplete="off" value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={configured && !value ? '••••••••  (saved)' : placeholder}
          className={`${inputCls}${shown ? ' font-mono' : ''}`}
        />
        <button
          type="button" onClick={() => setShown(s => !s)}
          className="flex-shrink-0 px-3 py-2 text-[11px] font-medium bg-[#F5F5F5] border border-[#D4D4D8] hover:bg-[#EBEBEB] transition-colors"
        >
          {shown ? 'Hide' : 'Show'}
        </button>
      </div>
      <SecretStatus configured={configured} dirty={value !== ''} onClear={onClear} />
    </div>
  )
}

/** Multi-line secret — PEM certificates and keys are pasted whole. */
export function PemInput({ value, onChange, placeholder, configured, onClear }: {
  value: string; onChange: (v: string) => void; placeholder?: string
  configured?: boolean; onClear?: () => void
}) {
  const [shown, setShown] = useState(false)
  const lines = value ? value.split('\n').length : 0
  if (!shown) {
    // `configured` without a local value is a write-only PEM (the private key):
    // stored, but never sent here, so there are no lines to count.
    const summary = value
      ? `Pasted — ${lines} lines, not yet saved`
      : configured
        ? 'Saved — not shown here'
        : 'Nothing saved'
    return (
      <div className="space-y-1.5">
        <div className="flex items-center gap-2">
          <div className={`${inputCls} text-[#71717A] flex items-center justify-between`}>
            <span>{summary}</span>
          </div>
          <button
            type="button" onClick={() => setShown(true)}
            className="flex-shrink-0 px-3 py-2 text-[11px] font-medium bg-[#F5F5F5] border border-[#D4D4D8] hover:bg-[#EBEBEB] transition-colors"
          >
            {value || configured ? 'Replace' : 'Paste'}
          </button>
        </div>
        <SecretStatus configured={configured} dirty={value !== ''} onClear={onClear} />
      </div>
    )
  }
  return (
    <div className="space-y-1.5">
      <textarea
        value={value} onChange={e => onChange(e.target.value)} rows={6} spellCheck={false}
        placeholder={placeholder ?? '-----BEGIN CERTIFICATE-----'}
        className={`${inputCls} font-mono text-[11px] leading-snug resize-y`}
      />
      <button
        type="button" onClick={() => setShown(false)}
        className="px-3 py-1.5 text-[11px] font-medium bg-[#F5F5F5] border border-[#D4D4D8] hover:bg-[#EBEBEB] transition-colors"
      >
        Done
      </button>
    </div>
  )
}

export function SelectInput<T extends string>({ value, onChange, options }: {
  value: T; onChange: (v: T) => void; options: { value: T; label: string }[]
}) {
  return (
    <select value={value} onChange={e => onChange(e.target.value as T)} className={inputCls}>
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  )
}

export function Switch({ checked, onChange, disabled }: { checked: boolean; onChange: () => void; disabled?: boolean }) {
  return (
    <button
      role="switch" aria-checked={checked} disabled={disabled} onClick={onChange}
      className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer border-2 border-transparent transition-colors focus:outline-none disabled:opacity-50 ${checked ? 'bg-[#27272A]' : 'bg-[#D4D4D8]'}`}
    >
      <span className={`pointer-events-none inline-block h-5 w-5 transform bg-white shadow transition duration-200 ${checked ? 'translate-x-5' : 'translate-x-0'}`} />
    </button>
  )
}

export function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3 mb-4 p-3 bg-white border border-[#E4E4E7]">
      <span className="text-sm text-[#18181B]">{label}</span>
      <Switch checked={checked} onChange={onChange} />
    </div>
  )
}

export function SettingsCard({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="bg-[#F5F5F5] border border-[#E4E4E7] p-5">
      <div className="flex items-center gap-2.5 mb-4">
        <div className="w-8 h-8 bg-[#27272A] flex items-center justify-center flex-shrink-0">{icon}</div>
        <h3 className="text-sm font-bold text-[#18181B]">{title}</h3>
      </div>
      {children}
    </div>
  )
}

export function SaveButton({ saving, saved, label, onClick, disabled }: {
  saving: boolean; saved: boolean; label: string; onClick: () => void; disabled?: boolean
}) {
  return (
    <button
      onClick={onClick} disabled={saving || disabled}
      className="mt-4 flex items-center gap-2 px-5 py-2 text-sm font-medium bg-[#27272A] hover:bg-[#18181B] text-[#F5F5F5] disabled:opacity-50 transition-colors"
    >
      {saving ? <Loader2 size={13} className="animate-spin" /> : saved ? <Check size={13} /> : <Save size={13} />}
      {saving ? 'Saving…' : saved ? 'Saved!' : label}
    </button>
  )
}

export function InfoNote({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: 'neutral' | 'info' | 'warn' }) {
  const Icon = tone === 'neutral' ? ShieldCheck : Info
  const accent = tone === 'warn' ? 'text-[#B45309]' : 'text-[#B8983C]'
  return (
    <div className="flex items-start gap-2 mt-4 p-3 bg-white border border-[#E4E4E7] text-xs text-[#71717A] leading-relaxed">
      <Icon size={14} className={`flex-shrink-0 mt-0.5 ${accent}`} />
      <span>{children}</span>
    </div>
  )
}

/**
 * Read-only display of the app's full webhook endpoint that the school admin
 * pastes into their bank's callback configuration, with one-click copy. The
 * origin is resolved client-side so the URL always matches wherever the app is
 * deployed — no hardcoded domain to keep in sync.
 */
export function WebhookUrlField({ path, label }: { path: string; label?: string }) {
  const [origin, setOrigin] = useState('')
  const [copied, setCopied] = useState(false)
  useEffect(() => { setOrigin(window.location.origin) }, [])
  const url = origin ? `${origin}${path}` : path
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      /* clipboard unavailable — admin can still select the text manually */
    }
  }
  return (
    <Field label={label ?? 'Callback URL (give this to your bank)'}>
      <div className="flex items-center gap-2">
        <input readOnly value={url} onFocus={e => e.target.select()}
          className={`${inputCls} font-mono bg-[#FAFAFA] text-[#52525B]`} />
        <button type="button" onClick={copy}
          className="flex-shrink-0 flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-[#F5F5F5] border border-[#D4D4D8] hover:bg-[#EBEBEB] transition-colors">
          {copied ? <><Check size={12} /> Copied</> : <><Copy size={12} /> Copy</>}
        </button>
      </div>
    </Field>
  )
}

/** Editable key/value list — for the non-secret headers a bank requires. */
export function HeaderListField({ headers, onChange }: {
  headers: { key: string; value: string }[]
  onChange: (next: { key: string; value: string }[]) => void
}) {
  const update = (i: number, patch: Partial<{ key: string; value: string }>) => {
    onChange(headers.map((h, idx) => idx === i ? { ...h, ...patch } : h))
  }
  return (
    <div className="space-y-2">
      {headers.map((h, i) => (
        <div key={i} className="flex items-center gap-2">
          <input
            value={h.key} onChange={e => update(i, { key: e.target.value })}
            placeholder="Header name" className={`${inputCls} font-mono`}
          />
          <input
            value={h.value} onChange={e => update(i, { value: e.target.value })}
            placeholder="Value" className={`${inputCls} font-mono`}
          />
          <button
            type="button" onClick={() => onChange(headers.filter((_, idx) => idx !== i))}
            className="flex-shrink-0 p-2 border border-[#D4D4D8] bg-white hover:bg-[#FEF2F2] hover:border-[#FCA5A5] transition-colors"
            aria-label="Remove header"
          >
            <Trash2 size={13} className="text-[#A1A1AA]" />
          </button>
        </div>
      ))}
      <button
        type="button" onClick={() => onChange([...headers, { key: '', value: '' }])}
        className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium bg-[#F5F5F5] border border-[#D4D4D8] hover:bg-[#EBEBEB] transition-colors"
      >
        <Plus size={11} /> Add header
      </button>
    </div>
  )
}

/** Collapsible block for the settings most schools never need to touch. */
export function Advanced({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="mt-4 border-t border-[#E4E4E7] pt-3">
      <button
        type="button" onClick={() => setOpen(o => !o)}
        className="text-[10px] font-bold uppercase tracking-widest text-[#525252] hover:text-[#18181B] transition-colors"
      >
        {open ? '− ' : '+ '}{title}
      </button>
      {open && <div className="mt-3 space-y-3">{children}</div>}
    </div>
  )
}
