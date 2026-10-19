'use client'

// ─────────────────────────────────────────────────────────────────────────────
// Fee Settings.
//
// A component rather than page markup because it is mounted twice: as
// /admin/fee-settings, and as the Fee module's Settings tab. "The same settings
// in both places" only stays true if there is one copy of them.
//
// Six settings screens as six tiles, each opening as a popup: one thing at a
// time, and the way back is the same gesture every time.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useState } from 'react'
import {
  Banknote, CalendarRange, ChevronRight, Hash, MessageCircle, ShieldCheck, SlidersHorizontal,
} from 'lucide-react'
import ModalShell from '@/components/ui/ModalShell'
import BankCollectSettings from '@/components/settings/BankCollectSettings'
import PermissionMatrix from '@/components/settings/fees/PermissionMatrix'
import PolicySettings from '@/components/settings/fees/PolicySettings'
import NumberingSettingsPanel from '@/components/settings/fees/NumberingSettings'
import AcademicYearSettings from '@/components/settings/fees/AcademicYearSettings'
import WhatsAppSettingsPanel from '@/components/settings/fees/WhatsAppSettings'
import { FEE_ICON } from '@/components/fees/ui'
import { useAcademicYear } from '@/contexts/AcademicYearContext'

const PANELS = [
  { key: 'permissions', label: 'Permissions', icon: ShieldCheck,
    blurb: 'Who can take a payment, who can reverse one, who never sees an amount.' },
  { key: 'policies',    label: 'Policies',    icon: SlidersHorizontal,
    blurb: 'Part payments, grace days, how a payment is split, what needs approval.' },
  { key: 'numbering',   label: 'Numbering',   icon: Hash,
    blurb: 'How bill and receipt numbers are written, previewed before they print.' },
  { key: 'years',       label: 'Sessions',    icon: CalendarRange,
    blurb: 'The academic years, which one is active, and carrying dues forward.' },
  { key: 'collection',  label: 'Collection',  icon: Banknote,
    blurb: 'How online payments reach the school’s bank account.' },
  { key: 'whatsapp',    label: 'WhatsApp',    icon: MessageCircle,
    blurb: 'Bills, receipts and reminders on the channel guardians read.' },
] as const

type PanelKey = typeof PANELS[number]['key']

export default function FeeSettingsPanel({ initialTab }: { initialTab?: PanelKey }) {
  const [open, setOpen] = useState<PanelKey | null>(initialTab ?? null)
  const { year, refresh } = useAcademicYear()
  const active = PANELS.find(p => p.key === open)

  return (
    <div>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2 sm:gap-3">
        {PANELS.map(p => {
          const Icon = p.icon
          return (
            <button
              key={p.key}
              onClick={() => setOpen(p.key)}
              className="group fx-tile text-left p-3.5 sm:p-4 flex items-start gap-3 min-w-0 transition
                         hover:-translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B8983C]/60"
            >
              <span className="icon-chip w-10 h-10 flex-shrink-0" style={{ background: 'linear-gradient(135deg, #3D3B40, #8B6F47)' }}>
                <Icon size={17} className="relative z-10 text-white" />
              </span>
              <span className="flex-1 min-w-0">
                <span className="flex items-center justify-between gap-2">
                  <span className="text-[15px] font-bold text-slate-900 leading-snug">{p.label}</span>
                  <ChevronRight size={16} className="flex-shrink-0 text-slate-300 group-hover:text-[#8B6F47] transition-colors" />
                </span>
                <span className="block text-[12.5px] text-slate-500 leading-snug mt-0.5">{p.blurb}</span>
              </span>
            </button>
          )
        })}
      </div>

      {active && (
        <ModalShell
          onClose={() => setOpen(null)}
          sharp
          size={open === 'permissions' ? '2xl' : 'xl'}
          title={active.label}
          subtitle={active.blurb}
          icon={<active.icon size={16} />}
          iconClassName={FEE_ICON}
        >
          {open === 'permissions' && <PermissionMatrix />}
          {open === 'policies'    && <PolicySettings academicYearId={year?.id ?? null} />}
          {open === 'numbering'   && (
            <NumberingSettingsPanel academicYearId={year?.id ?? null} yearCode={year?.code ?? '2026-27'} />
          )}
          {open === 'years'       && <AcademicYearSettings onChanged={() => void refresh()} />}
          {open === 'collection'  && <BankCollectSettings ctx="fees" />}
          {open === 'whatsapp'    && <WhatsAppSettingsPanel />}
        </ModalShell>
      )}
    </div>
  )
}
