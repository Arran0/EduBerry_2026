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
// Sharp and quiet, in three colours only: dark grey (#27272A) for ink and the
// one primary action, gold (#B8983C) for accents and focus, off-white
// (#F5F5F5 / #FDFCF9) for grounds. Large surfaces (panels, containers, the
// section sidebar) have square corners; the small things a finger presses or
// types into (buttons, fields, switches, list rows, icon tiles) are rounded.
//
// Two layers: the banner and the controls on top, and the white panels a
// setting is read and changed on. One primary action per panel carries the
// dark fill; everything else is an off-white button with a hairline.
// ──────────────────────────────────────────────────────────────

const FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B8983C]/70'

/** Class names for the places that cannot use a component. */
export const AX = {
  /** A form field: square, hairlined, 38px. */
  field: 'w-full h-[38px] rounded-lg bg-white border border-[#D4D4D8] px-3 text-[13.5px] text-[#18181B] placeholder:text-[#A1A1AA] focus:outline-none focus:border-[#27272A] focus:ring-1 focus:ring-[#B8983C]/40 transition-colors disabled:bg-[#F5F5F5] disabled:text-[#A1A1AA]',
  primary: `inline-flex items-center justify-center gap-1.5 h-9 px-4 rounded-lg text-[13px] font-semibold text-[#F5F5F5] whitespace-nowrap bg-[#27272A] hover:bg-[#18181B] border-b-2 border-[#B8983C] transition-colors disabled:opacity-45 disabled:pointer-events-none ${FOCUS}`,
  ghost: `inline-flex items-center justify-center gap-1.5 h-8 px-3 rounded-lg text-[12.5px] font-semibold text-[#27272A] whitespace-nowrap bg-[#F5F5F5] border border-[#D4D4D8] hover:bg-[#EBEBEB] hover:border-[#A1A1AA] transition-colors disabled:opacity-45 disabled:pointer-events-none ${FOCUS}`,
  /** An icon-only square button. */
  icon: `inline-flex items-center justify-center w-8 h-8 rounded-lg flex-shrink-0 text-[#A1A1AA] hover:text-[#27272A] hover:bg-[#EBEBEB] transition-colors disabled:opacity-35 disabled:pointer-events-none ${FOCUS}`,
  /** The same, for a destructive action. */
  iconDanger: `inline-flex items-center justify-center w-8 h-8 rounded-lg flex-shrink-0 text-[#A1A1AA] hover:text-[#F5F5F5] hover:bg-[#27272A] transition-colors disabled:opacity-35 disabled:pointer-events-none ${FOCUS}`,
  label: 'block text-[12.5px] font-medium text-[#52525B] mb-1.5',
  hint: 'text-[12.5px] text-[#71717A] leading-relaxed',
  /** The white panel every group of settings is drawn on. */
  sheet: 'bg-white border border-[#E4E4E7] shadow-[0_1px_2px_rgba(24,24,27,.04),0_14px_30px_-24px_rgba(24,24,27,.35)]',
  /** A row inside a panel's list: an off-white strip with a hairline. */
  row: 'flex items-center gap-3 px-3.5 py-2.5 rounded-lg bg-[#F5F5F5] border border-[#E4E4E7]',
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
    <div data-page-theme="admin" className="overflow-x-clip" style={{ minHeight: '100vh', backgroundColor: '#FDFCF9' }}>
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
    <section className={`${AX.sheet} p-4 sm:p-5 flex flex-col ${className}`}>
      <div className="flex items-start gap-3">
        {Icon && <IconTile icon={Icon} />}
        <div className="flex-1 min-w-0">
          <h2 className="text-[15px] font-semibold text-[#18181B] leading-snug">{title}</h2>
          {description && <p className={`${AX.hint} mt-0.5`}>{description}</p>}
        </div>
        {action && <div className="flex-shrink-0">{action}</div>}
      </div>
      {/* The body takes whatever height the panel has, so a panel stretched to
          match its neighbour gives the room to its content, not to a gap. */}
      {children && <div className="mt-4 flex-1 min-h-0 flex flex-col">{children}</div>}
    </section>
  )
}

/** The square a panel or a list row leads with: dark grey, gold mark. */
export function IconTile({ icon: Icon, size = 'md' }: { icon: LucideIcon; size?: 'sm' | 'md' }) {
  const box = size === 'sm' ? 'w-7 h-7' : 'w-9 h-9'
  return (
    <span className={`${box} rounded-lg flex-shrink-0 inline-flex items-center justify-center bg-[#27272A]`}>
      <Icon size={size === 'sm' ? 14 : 16} strokeWidth={2} className="text-[#B8983C]" />
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

/** A switch: a capsule track, a white knob. */
export function Switch({ on, onChange, disabled, label }: { on: boolean; onChange: () => void; disabled?: boolean; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={onChange}
      className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full border-2 border-transparent transition-colors duration-200 disabled:opacity-50 ${FOCUS} ${on ? 'bg-[#27272A]' : 'bg-[#D4D4D8]'}`}
    >
      <span className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform duration-200 ${on ? 'translate-x-5 border-l-2 border-[#B8983C]' : 'translate-x-0'}`} />
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
export function EmptyLine({ icon: Icon, children, loading, fill }: { icon: LucideIcon; children: React.ReactNode; loading?: boolean; fill?: boolean }) {
  return (
    <div className={`flex items-center gap-2 px-3.5 py-3 rounded-lg border border-dashed border-[#D4D4D8] bg-[#FDFCF9] text-[12.5px] text-[#71717A] ${fill ? 'flex-1 justify-center text-center min-h-[4.5rem]' : ''}`}>
      {loading ? <Loader2 size={13} className="animate-spin text-[#A1A1AA]" /> : <Icon size={13} className="text-[#B8983C]" />}
      {children}
    </div>
  )
}

export function SearchField({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div className="relative">
      <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#A1A1AA] pointer-events-none" />
      <input
        type="search" value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        className={`${AX.field} !pl-9`}
      />
    </div>
  )
}

/** The page-level loading state. */
export function PageLoading({ children = 'Loading…' }: { children?: React.ReactNode }) {
  return (
    <div className={`${AX.sheet} py-14 flex items-center justify-center gap-2 text-[13px] text-[#71717A]`}>
      <Loader2 size={16} className="animate-spin text-[#A1A1AA]" /> {children}
    </div>
  )
}
