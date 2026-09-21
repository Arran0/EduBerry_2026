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
// Six tabs became six cards. A tab strip says "these are views of one thing,
// and you are in one of them"; that is true of a ledger filtered six ways, and
// false of six unrelated settings screens, where it costs a permanent row of
// chrome and hides five names behind the sixth. Each card says what it governs
// and opens it as a popup: one thing at a time, and the way back is the same
// gesture every time.
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
  const [open, setOpen] = useState<PanelKey | null>(initialTab ?? null)
  const { year, refresh } = useAcademicYear()
  const active = PANELS.find(p => p.key === open)

  return (
    <div>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
        {PANELS.map(p => {
          const Icon = p.icon
          return (
            <button
              key={p.key}
              onClick={() => setOpen(p.key)}
              className="group text-left bg-white border border-[#E3DFD3] hover:border-[#B8983C]
                         p-3.5 transition-colors flex items-start gap-3"
            >
              <div className="w-9 h-9 bg-[#27272A] flex items-center justify-center flex-shrink-0">
                <Icon size={16} className="text-[#B8983C]" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1">
                  <span className="text-sm font-bold text-[#18181B]">{p.label}</span>
                  <ChevronRight size={14}
                                className="text-[#C9C4B4] group-hover:text-[#B8983C] transition-colors" />
                </div>
                <p className="text-[11px] text-[#8C8878] leading-snug mt-0.5">{p.blurb}</p>
              </div>
            </button>
          )
        })}
      </div>

      {active && (
        <ModalShell
          onClose={() => setOpen(null)}
          sharp
          size="2xl"
          title={active.label}
          subtitle={active.blurb}
          icon={<active.icon size={15} />}
          iconClassName="bg-[#27272A] text-[#B8983C]"
          bodyClassName="bg-[#FDFCF9] !px-3 sm:!px-4 !py-3"
          minHClass="sm:min-h-[32rem]"
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
