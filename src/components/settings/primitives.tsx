'use client'

import React, { createContext, useContext, useState, useEffect } from 'react'
import { Check, Copy, Info, Loader2, Save, ShieldCheck, Trash2, Plus } from 'lucide-react'

// Shared form primitives for the admin settings screens, in the admin palette
// (square corners, neutral greys). Extracted from the old App Settings page so the
// bank connection forms render identically wherever they are embedded —
// App Settings, Salary Payout Settings and Driver Payroll Settings all mount
// the same components rather than keeping drifting copies of a credential form.

export const inputCls =
  'border border-[#D4D4D8] bg-white px-3 py-2 text-sm focus:outline-none focus:border-[#27272A] transition-colors w-full'

// ── Skins ────────────────────────────────────────────────────────────────
//
// The same forms in two dresses. App Settings keeps the square admin palette
// above; a module drawn in the glass language (Salary's payroll settings)
// wraps them in <SettingsGlass> and gets square sheets, capsule buttons,
// rounded fields and sentence-case labels instead — without a second copy of
// any credential form.

const FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B8983C]/60'

const SKINS = {
  admin: {
    input: inputCls,
    label: 'block text-[10px] font-bold uppercase tracking-widest text-[#525252] mb-1.5',
    section: 'text-[10px] font-bold uppercase tracking-widest text-[#525252] mb-3',
    hint: 'text-[11px] text-[#A1A1AA] mt-1 leading-relaxed',
    status: 'text-[11px] text-[#71717A]',
    sideBtn: 'flex-shrink-0 px-3 py-2 text-[11px] font-medium bg-[#F5F5F5] border border-[#D4D4D8] hover:bg-[#EBEBEB] transition-colors',
    smallBtn: 'px-3 py-1.5 text-[11px] font-medium bg-[#F5F5F5] border border-[#D4D4D8] hover:bg-[#EBEBEB] transition-colors',
    iconBtn: 'flex-shrink-0 p-2 border border-[#D4D4D8] bg-white hover:bg-[#FEF2F2] hover:border-[#FCA5A5] transition-colors',
    readonly: 'font-mono bg-[#FAFAFA] text-[#52525B]',
    toggleRow: 'flex items-center justify-between gap-3 mb-4 p-3 bg-white border border-[#E4E4E7]',
    toggleLabel: 'text-sm text-[#18181B]',
    card: 'bg-[#F5F5F5] border border-[#E4E4E7] p-5',
    cardHead: 'flex items-center gap-2.5 mb-4',
    cardChip: 'w-8 h-8 bg-[#27272A] flex items-center justify-center flex-shrink-0',
    cardTitle: 'text-sm font-bold text-[#18181B]',
    save: 'mt-4 flex items-center gap-2 px-5 py-2 text-sm font-medium bg-[#27272A] hover:bg-[#18181B] text-[#F5F5F5] disabled:opacity-50 transition-colors',
    note: 'flex items-start gap-2 mt-4 p-3 bg-white border border-[#E4E4E7] text-xs text-[#71717A] leading-relaxed',
    advanced: 'text-[10px] font-bold uppercase tracking-widest text-[#525252] hover:text-[#18181B] transition-colors',
    para: 'text-xs text-[#71717A] mb-4 leading-relaxed',
    textarea: 'border border-[#D4D4D8] bg-white px-3 py-2 text-xs font-mono focus:outline-none focus:border-[#27272A] transition-colors w-full resize-y',
    error: 'p-3 bg-white border border-[#E4E4E7] text-xs text-[#71717A]',
    loading: 'py-12 text-center text-[#71717A] text-sm',
    bullet: 'mt-1.5 w-1 h-1 bg-[#B8983C] flex-shrink-0',
    stack: 'space-y-5',
  },
  glass: {
    input: 'w-full min-h-9 rounded-[10px] bg-white border border-[#DDD8CC] px-3 py-[7px] text-[13.5px] text-slate-900 placeholder:text-slate-400 shadow-[inset_0_1px_2px_rgba(15,23,42,.04)] focus:outline-none focus:border-[#B8983C] focus:ring-2 focus:ring-[#B8983C]/20 transition',
    label: 'block text-[12.5px] font-medium text-slate-600 mb-1.5',
    section: 'text-[13.5px] font-semibold text-slate-900 mb-2.5',
    hint: 'text-[12px] text-slate-500 mt-1 leading-snug',
    status: 'text-[12px] text-slate-500',
    sideBtn: `flex-shrink-0 inline-flex items-center justify-center gap-1.5 h-9 px-3.5 rounded-full text-[12.5px] font-semibold text-slate-700 bg-white border border-[#E2DDD2] hover:text-slate-900 hover:border-[#CFC8B8] active:scale-[0.97] transition ${FOCUS}`,
    smallBtn: `inline-flex items-center justify-center gap-1.5 h-8 px-3.5 rounded-full text-[12.5px] font-semibold text-slate-700 bg-white border border-[#E2DDD2] hover:text-slate-900 hover:border-[#CFC8B8] active:scale-[0.97] transition ${FOCUS}`,
    iconBtn: `flex-shrink-0 inline-flex items-center justify-center w-9 h-9 rounded-full bg-white border border-[#E2DDD2] hover:bg-[#FCEDED] hover:border-[#E8B4B4] transition ${FOCUS}`,
    readonly: 'font-mono !bg-[#FAF8F3] text-slate-600',
    toggleRow: 'flex items-center justify-between gap-3 mb-4 px-3.5 py-2.5 fx-card',
    toggleLabel: 'text-[13.5px] text-slate-900',
    card: 'fx-card p-3.5 sm:p-5',
    cardHead: 'flex items-center gap-2.5 mb-3',
    cardChip: 'icon-chip w-8 h-8 flex-shrink-0 [background:linear-gradient(135deg,#3D3B40,#8B6F47)] [&_svg]:!text-white [&_svg]:relative [&_svg]:z-10',
    cardTitle: 'text-[14.5px] font-semibold text-slate-900',
    save: `mt-4 inline-flex items-center justify-center gap-1.5 h-9 px-4 rounded-full text-[13px] font-semibold text-white bg-gradient-to-b from-[#3D3B40] to-[#27272A] shadow-[inset_0_1px_0_rgba(255,255,255,.16),0_6px_14px_-8px_rgba(15,23,42,.6)] hover:from-[#46444A] hover:to-[#2E2E31] active:scale-[0.97] transition disabled:opacity-45 ${FOCUS}`,
    note: 'flex items-start gap-2 mt-4 px-3.5 py-2.5 border-l-[3px] border-[#B9B2A2] bg-white/80 text-[12.5px] text-slate-600 leading-relaxed break-words',
    advanced: 'text-[13px] font-semibold text-[#8B6F47] hover:text-[#5E4A2F] transition-colors',
    para: 'text-[12.5px] text-slate-500 mb-3 leading-relaxed',
    textarea: 'w-full rounded-[10px] bg-white border border-[#DDD8CC] px-3 py-2 text-[12px] font-mono text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-[#B8983C] focus:ring-2 focus:ring-[#B8983C]/20 transition resize-y',
    error: 'px-3.5 py-2.5 border-l-[3px] border-[#C24141] bg-[#FCEDED] text-[12.5px] text-[#962C2C] leading-relaxed break-words',
    loading: 'py-12 text-center text-slate-500 text-[13px]',
    bullet: 'mt-[7px] w-1.5 h-1.5 rounded-full bg-[#B8983C] flex-shrink-0',
    stack: 'space-y-3',
  },
} as const

const SkinContext = createContext<keyof typeof SKINS>('admin')

/** Draws every primitive inside it in the glass language. */
export function SettingsGlass({ children }: { children: React.ReactNode }) {
  return <SkinContext.Provider value="glass">{children}</SkinContext.Provider>
}

/** The class set for whichever skin is in force — for a form's own markup. */
export function useSettingsSkin() {
  return useSkin()
}

function useSkin() {
  const key = useContext(SkinContext)
  return { ...SKINS[key], glass: key === 'glass' }
}

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className={useSkin().section}>{children}</p>
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  const k = useSkin()
  return (
    <div className="min-w-0">
      <label className={k.label}>{label}</label>
      {children}
      {hint && <p className={k.hint}>{hint}</p>}
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
      className={`${useSkin().input}${mono ? ' font-mono' : ''}`}
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
      className={`${useSkin().input} tabular-nums`}
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
  const k = useSkin()
  if (!configured) return null
  return (
    <p className={`${k.status} flex flex-wrap items-center gap-x-2`}>
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
  const k = useSkin()
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <input
          type={shown ? 'text' : 'password'} autoComplete="new-password" spellCheck={false} value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={configured && !value ? '••••••••  (saved)' : placeholder}
          className={`${k.input} min-w-0${shown ? ' font-mono' : ''}`}
        />
        <button
          type="button" onClick={() => setShown(s => !s)}
          className={k.sideBtn}
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
  const k = useSkin()
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
          <div className={`${k.input} min-w-0 !text-slate-500 flex items-center justify-between`}>
            <span className="break-words">{summary}</span>
          </div>
          <button
            type="button" onClick={() => setShown(true)}
            className={k.sideBtn}
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
        className={`${k.input} font-mono !text-[11.5px] leading-snug resize-y`}
      />
      <button
        type="button" onClick={() => setShown(false)}
        className={k.smallBtn}
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
    <select value={value} onChange={e => onChange(e.target.value as T)} className={`${useSkin().input} cursor-pointer`}>
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  )
}

export function Switch({ checked, onChange, disabled }: { checked: boolean; onChange: () => void; disabled?: boolean }) {
  if (useSkin().glass) {
    return (
      <button
        type="button" role="switch" aria-checked={checked} disabled={disabled} onClick={onChange}
        className={`relative inline-flex w-[46px] h-[28px] flex-shrink-0 rounded-full transition-colors disabled:opacity-45 ${FOCUS} ${checked ? 'bg-[#34A853]' : 'bg-slate-200'}`}
      >
        <span className={`absolute top-[2px] left-[2px] w-6 h-6 rounded-full bg-white shadow-[0_2px_5px_rgba(15,23,42,.25)] transition-transform ${checked ? 'translate-x-[18px]' : ''}`} />
      </button>
    )
  }
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
  const k = useSkin()
  return (
    <div className={k.toggleRow}>
      <span className={k.toggleLabel}>{label}</span>
      <Switch checked={checked} onChange={onChange} />
    </div>
  )
}

export function SettingsCard({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  const k = useSkin()
  return (
    <div className={`${k.card} min-w-0`}>
      <div className={k.cardHead}>
        <div className={k.cardChip}>{icon}</div>
        <h3 className={`${k.cardTitle} break-words min-w-0`}>{title}</h3>
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
      type="button" onClick={onClick} disabled={saving || disabled}
      className={useSkin().save}
    >
      {saving ? <Loader2 size={13} className="animate-spin" /> : saved ? <Check size={13} /> : <Save size={13} />}
      {saving ? 'Saving…' : saved ? 'Saved!' : label}
    </button>
  )
}

export function InfoNote({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: 'neutral' | 'info' | 'warn' }) {
  const Icon = tone === 'neutral' ? ShieldCheck : Info
  const accent = tone === 'warn' ? 'text-[#B45309]' : 'text-[#B8983C]'
  const k = useSkin()
  return (
    <div className={`${k.note}${k.glass && tone === 'warn' ? ' !border-[#B8983C] !bg-[#FBF4E2] !text-[#6E5513]' : ''}`}>
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
  const k = useSkin()
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
          className={`${k.input} min-w-0 ${k.readonly}`} />
        <button type="button" onClick={copy}
          className={`${k.sideBtn} flex items-center gap-1.5`}>
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
  const k = useSkin()
  const update = (i: number, patch: Partial<{ key: string; value: string }>) => {
    onChange(headers.map((h, idx) => idx === i ? { ...h, ...patch } : h))
  }
  return (
    <div className="space-y-2">
      {headers.map((h, i) => (
        <div key={i} className="flex items-center gap-2">
          <input
            value={h.key} onChange={e => update(i, { key: e.target.value })}
            placeholder="Header name" className={`${k.input} min-w-0 font-mono`}
          />
          <input
            value={h.value} onChange={e => update(i, { value: e.target.value })}
            placeholder="Value" className={`${k.input} min-w-0 font-mono`}
          />
          <button
            type="button" onClick={() => onChange(headers.filter((_, idx) => idx !== i))}
            className={k.iconBtn}
            aria-label="Remove header"
          >
            <Trash2 size={13} className="text-[#A1A1AA]" />
          </button>
        </div>
      ))}
      <button
        type="button" onClick={() => onChange([...headers, { key: '', value: '' }])}
        className={`${k.smallBtn} flex items-center gap-1.5`}
      >
        <Plus size={11} /> Add header
      </button>
    </div>
  )
}

/** Collapsible block for the settings most schools never need to touch. */
export function Advanced({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  const k = useSkin()
  return (
    <div className={`mt-4 border-t pt-3 ${k.glass ? 'border-[#EEEAE1]' : 'border-[#E4E4E7]'}`}>
      <button
        type="button" onClick={() => setOpen(o => !o)} aria-expanded={open}
        className={k.advanced}
      >
        {open ? '− ' : '+ '}{title}
      </button>
      {open && <div className="mt-3 space-y-3">{children}</div>}
    </div>
  )
}
