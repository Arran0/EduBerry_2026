'use client'

// ─────────────────────────────────────────────────────────────────────────────
// Fee Settings.
//
// A component rather than page markup because it is mounted twice: as
// /admin/fee-settings, and behind the Fee Manager's own settings tab. "The
// same settings in both places" is a claim that only stays true if there is one
// copy of them — the same reasoning as PayrollSettingsPanel, whose shape this
// follows.
//
// Six panels, six tabs, and the panel on the page under them. This was six
// cards that each opened a popup, on the theory that unrelated settings screens
// should not share a tab strip. In use that costs two clicks and a modal to
// reach anything, a third to leave it, and the whole lot again to compare a
// policy with the permission that guards it — which is exactly what somebody
// setting this up is doing. A tab strip is the cheaper trade: one click in, one
// click across, and nothing covering the screen.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useState } from 'react'
import {
  Banknote, CalendarRange, Hash, MessageCircle, ShieldCheck, SlidersHorizontal,
} from 'lucide-react'
import BankCollectSettings from '@/components/settings/BankCollectSettings'
import PermissionMatrix from '@/components/settings/fees/PermissionMatrix'
import PolicySettings from '@/components/settings/fees/PolicySettings'
import NumberingSettingsPanel from '@/components/settings/fees/NumberingSettings'
import AcademicYearSettings from '@/components/settings/fees/AcademicYearSettings'
import WhatsAppSettingsPanel from '@/components/settings/fees/WhatsAppSettings'
import { useAcademicYear } from '@/contexts/AcademicYearContext'

const PANELS = [
  { key: 'permissions', label: 'Permissions', icon: ShieldCheck,
    blurb: 'Who can take a payment, who can reverse one, who never sees an amount.' },
  { key: 'policies',    label: 'Policies',    icon: SlidersHorizontal,
    blurb: 'Part payments, grace days, how a payment is split, what needs approval.' },
  { key: 'numbering',   label: 'Numbering',   icon: Hash,
    blurb: 'The receipt and invoice series, previewed before it starts printing.' },
  { key: 'years',       label: 'Sessions',    icon: CalendarRange,
    blurb: 'The academic years the school runs, and which one is active.' },
  { key: 'collection',  label: 'Collection',  icon: Banknote,
    blurb: 'How money reaches the school’s bank account.' },
  { key: 'whatsapp',    label: 'WhatsApp',    icon: MessageCircle,
    blurb: 'Bills, receipts and reminders on the channel guardians actually read.' },
] as const

type PanelKey = typeof PANELS[number]['key']

export default function FeeSettingsPanel({ initialTab }: { initialTab?: PanelKey }) {
  const [open, setOpen] = useState<PanelKey>(initialTab ?? 'permissions')
  const { year, refresh } = useAcademicYear()
  const active = PANELS.find(p => p.key === open) ?? PANELS[0]

  return (
    <div>
      {/* Six tabs on one line, scrolling sideways rather than wrapping: a strip
          that reflows to two rows moves the panel down every time the window
          is narrowed. */}
      <div className="flex border-b border-[#E3DFD3] overflow-x-auto no-scrollbar">
        {PANELS.map(p => {
          const on = p.key === open
          const Icon = p.icon
          return (
            <button
              key={p.key}
              onClick={() => setOpen(p.key)}
              aria-current={on ? 'page' : undefined}
              className={`flex-1 min-w-max flex items-center justify-center gap-1.5 px-3 pb-1.5
                          text-[11px] sm:text-[12px] font-bold uppercase tracking-[0.06em]
                          border-b-2 -mb-px transition-colors whitespace-nowrap ${
                on ? 'border-[#B8983C] text-[#18181B]'
                   : 'border-transparent text-[#A8A395] hover:text-[#6B675A]'
              }`}
            >
              <Icon size={13} />
              <span>{p.label}</span>
            </button>
          )
        })}
      </div>

      <p className="text-[11px] text-[#8C8878] leading-snug mt-2 mb-3">{active.blurb}</p>

      {open === 'permissions' && <PermissionMatrix />}
      {open === 'policies'    && <PolicySettings academicYearId={year?.id ?? null} />}
      {open === 'numbering'   && (
        <NumberingSettingsPanel academicYearId={year?.id ?? null} yearCode={year?.code ?? '2026-27'} />
      )}
      {open === 'years'       && <AcademicYearSettings onChanged={() => void refresh()} />}
      {open === 'collection'  && <BankCollectSettings ctx="fees" />}
      {open === 'whatsapp'    && <WhatsAppSettingsPanel />}
    </div>
  )
}
