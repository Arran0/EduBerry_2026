'use client'

import React, { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, Loader2, Save, Search } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import PageBanner from '@/components/PageBanner'
import type { AnnouncementBannerConfig } from '@/lib/pageConfig'

// ──────────────────────────────────────────────────────────────
// The Admin Space design system.
//
// Two layers, the way Liquid Glass splits an interface:
//
//   Functional layer — the banner, the section switch, the capsule buttons.
//   Rounded, light, floating over the page; glass only where nothing is read
//   off it.
//
//   Content layer — the panels a setting is read and changed on. Solid white
//   sheets with a hairline and a soft drop, corners concentric with what sits
//   inside them (panel 22 → row 14 → control 10).
//
// Labels are sentence case. One primary action per panel carries the dark
// fill; everything else is a white capsule.
// ──────────────────────────────────────────────────────────────

const FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B8983C]/60'

/** Class names for the places that cannot use a component. */
export const AX = {
  /** A form field: rounded, hairlined, 38px. */
  field: 'w-full h-[38px] rounded-[10px] bg-white border border-[#DDD8CC] px-3 text-[13.5px] text-slate-900 placeholder:text-slate-400 shadow-[inset_0_1px_2px_rgba(15,23,42,.04)] focus:outline-none focus:border-[#B8983C] focus:ring-2 focus:ring-[#B8983C]/20 transition disabled:bg-slate-50 disabled:text-slate-400',
  primary: `inline-flex items-center justify-center gap-1.5 h-9 px-4 rounded-full text-[13px] font-semibold text-white whitespace-nowrap bg-gradient-to-b from-[#3D3B40] to-[#27272A] shadow-[inset_0_1px_0_rgba(255,255,255,.16),0_6px_14px_-8px_rgba(15,23,42,.6)] hover:from-[#46444A] hover:to-[#2E2E31] active:scale-[0.97] transition disabled:opacity-45 disabled:pointer-events-none ${FOCUS}`,
  ghost: `inline-flex items-center justify-center gap-1.5 h-8 px-3.5 rounded-full text-[12.5px] font-semibold text-slate-700 whitespace-nowrap bg-white border border-[#E2DDD2] shadow-[0_1px_2px_rgba(15,23,42,.05)] hover:text-slate-900 hover:border-[#CFC8B8] active:scale-[0.97] transition disabled:opacity-45 disabled:pointer-events-none ${FOCUS}`,
  /** An icon-only round button. */
  icon: `inline-flex items-center justify-center w-8 h-8 rounded-full flex-shrink-0 text-slate-400 hover:text-slate-900 hover:bg-slate-100 active:scale-95 transition disabled:opacity-35 disabled:pointer-events-none ${FOCUS}`,
  /** The same, for a destructive action. */
  iconDanger: `inline-flex items-center justify-center w-8 h-8 rounded-full flex-shrink-0 text-slate-400 hover:text-[#B83A3A] hover:bg-[#FCEDED] active:scale-95 transition disabled:opacity-35 disabled:pointer-events-none ${FOCUS}`,
  /** Solid white on the banner: a translucent control over a photo cannot be read. */
  bannerBtn: 'inline-flex items-center justify-center gap-1.5 h-[30px] px-3 rounded-full bg-white text-slate-900 text-[12px] font-semibold ring-1 ring-black/5 shadow-[0_6px_16px_-8px_rgba(15,23,42,.55)] hover:bg-slate-50 active:scale-[0.97] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B8983C]',
  label: 'block text-[12.5px] font-medium text-slate-600 mb-1.5',
  hint: 'text-[12.5px] text-slate-500 leading-relaxed',
  /** The white sheet every panel is drawn on. */
  sheet: 'bg-white rounded-[22px] border border-black/[.06] shadow-[0_1px_2px_rgba(15,23,42,.04),0_18px_36px_-26px_rgba(15,23,42,.45)]',
  /** A row inside a panel's list: a tinted inset tile, concentric with the panel. */
  row: 'flex items-center gap-3 px-3.5 py-2.5 rounded-[14px] bg-[#F7F5F1] border border-black/[.04]',
} as const

/**
 * An Admin Space page: the editable banner (the same one every module page
 * carries), and the body under it, faded while the banner is being edited.
 */
export function AdminPage({
  settingKey, defaultBanner, icon: Icon, title, subtitle, actions, backgroundIcon: BgIcon, maxWidth = 'max-w-5xl', children,
}: {
  settingKey: string
  defaultBanner: AnnouncementBannerConfig
  icon: LucideIcon
  title: string
  subtitle?: string
  actions?: React.ReactNode
  backgroundIcon?: LucideIcon
  maxWidth?: string
  children: React.ReactNode
}) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  return (
    <div data-page-theme="admin" className="overflow-x-clip" style={{ minHeight: '100vh' }}>
      <PageBanner
        settingKey={settingKey}
        defaultBanner={defaultBanner}
        icon={<Icon size={26} className="text-white" />}
        title={title}
        subtitle={subtitle}
        isAdmin
        onBack={() => router.push('/more/admin-space')}
        onEditingChange={setEditing}
        maxWidth={maxWidth}
        actions={actions}
        backgroundIcon={BgIcon ? <BgIcon size={150} className="text-white" /> : undefined}
      />
      <div
        className={`relative z-10 w-full ${maxWidth} mx-auto px-4 sm:px-6 lg:px-8 pt-4 sm:pt-6 pb-14`}
        style={{
          opacity: editing ? 0.35 : 1,
          pointerEvents: editing ? 'none' : 'auto',
          userSelect: editing ? 'none' : 'auto',
          transition: 'opacity 0.25s ease',
        }}
      >
        {children}
      </div>
    </div>
  )
}

/** One panel of settings: a heading with its icon, a line of explanation, the body. */
export function Panel({
  icon: Icon, title, description, action, children, className = '',
}: {
  icon?: LucideIcon
  title: string
  description?: React.ReactNode
  action?: React.ReactNode
  children?: React.ReactNode
  className?: string
}) {
  return (
    <section className={`${AX.sheet} p-4 sm:p-5 ${className}`}>
      <div className="flex items-start gap-3">
        {Icon && <IconTile icon={Icon} />}
        <div className="flex-1 min-w-0">
          <h2 className="text-[15px] font-semibold text-slate-900 leading-snug">{title}</h2>
          {description && <p className={`${AX.hint} mt-0.5`}>{description}</p>}
        </div>
        {action && <div className="flex-shrink-0">{action}</div>}
      </div>
      {children && <div className="mt-4">{children}</div>}
    </section>
  )
}

/** The squircle a panel or a list row leads with: charcoal into bronze, white mark. */
export function IconTile({ icon: Icon, size = 'md', gradient }: { icon: LucideIcon; size?: 'sm' | 'md'; gradient?: string }) {
  const box = size === 'sm' ? 'w-7 h-7 rounded-[8px]' : 'w-9 h-9 rounded-[11px]'
  return (
    <span
      className={`${box} flex-shrink-0 inline-flex items-center justify-center text-white shadow-[inset_0_1px_0_rgba(255,255,255,.22),0_4px_10px_-6px_rgba(15,23,42,.6)]`}
      style={{ background: gradient ?? 'linear-gradient(135deg,#3D3B40,#8B6F47)' }}
    >
      <Icon size={size === 'sm' ? 14 : 17} strokeWidth={2} />
    </span>
  )
}

export function Field({ label, children, className = '' }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <label className={AX.label}>{label}</label>
      {children}
    </div>
  )
}

/** An iOS switch: a capsule track, a white knob. */
export function Switch({ on, onChange, disabled, label }: { on: boolean; onChange: () => void; disabled?: boolean; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={onChange}
      className={`relative inline-flex h-[26px] w-[44px] flex-shrink-0 items-center rounded-full transition-colors duration-200 disabled:opacity-50 ${FOCUS} ${on ? 'bg-[#3D3B40]' : 'bg-[#D9D5CC]'}`}
    >
      <span
        className={`inline-block h-[22px] w-[22px] rounded-full bg-white shadow-[0_2px_4px_rgba(15,23,42,.2),0_0_0_0.5px_rgba(15,23,42,.06)] transition-transform duration-200 ${on ? 'translate-x-[20px]' : 'translate-x-[2px]'}`}
      />
    </button>
  )
}

/** A save button that says what it is doing. */
export function SaveButton({ saving, saved, label, onClick, className = '' }: {
  saving: boolean; saved: boolean; label: string; onClick: () => void; className?: string
}) {
  return (
    <button onClick={onClick} disabled={saving} className={`${AX.primary} ${className}`}>
      {saving ? <Loader2 size={14} className="animate-spin" /> : saved ? <Check size={14} /> : <Save size={14} />}
      {saving ? 'Saving…' : saved ? 'Saved' : label}
    </button>
  )
}

/** A quiet line for an empty list or a list still loading. */
export function EmptyLine({ icon: Icon, children, loading }: { icon: LucideIcon; children: React.ReactNode; loading?: boolean }) {
  return (
    <div className="flex items-center gap-2 px-3.5 py-3 rounded-[14px] border border-dashed border-[#DDD8CC] text-[12.5px] text-slate-500">
      {loading ? <Loader2 size={13} className="animate-spin text-slate-400" /> : <Icon size={13} className="text-slate-400" />}
      {children}
    </div>
  )
}

export function SearchField({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div className="relative">
      <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
      <input
        type="search" value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        className={`${AX.field} !pl-9 !rounded-full`}
      />
    </div>
  )
}

/** The page-level loading state. */
export function PageLoading({ children = 'Loading…' }: { children?: React.ReactNode }) {
  return (
    <div className={`${AX.sheet} py-14 flex items-center justify-center gap-2 text-[13px] text-slate-500`}>
      <Loader2 size={16} className="animate-spin text-slate-400" /> {children}
    </div>
  )
}
