'use client'

// ─────────────────────────────────────────────────────────────────────────────
// Fee Settings.
//
// A component rather than page markup because it is mounted twice: as
// /admin/fee-settings, and behind the Fee Manager's own settings button. "The
// same settings in both places" is a claim that only stays true if there is one
// copy of them — the same reasoning as PayrollSettingsPanel, whose shape this
// follows.
//
// Before Round 1 this page held only the bank collection credentials. That is
// now one tab of six: the permission matrix, the policies that govern what the
// counter may accept, receipt numbering, the school's sessions, collection, and
// WhatsApp.
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

const TABS = [
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

type TabKey = typeof TABS[number]['key']

export default function FeeSettingsPanel({ initialTab }: { initialTab?: TabKey }) {
  const [tab, setTab] = useState<TabKey>(initialTab ?? 'permissions')
  const { year, refresh } = useAcademicYear()
  const active = TABS.find(t => t.key === tab)!

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-1.5">
        {TABS.map(t => {
          const Icon = t.icon
          const on = t.key === tab
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg transition-colors ${
                on
                  ? 'bg-[#27272A] text-white'
                  : 'bg-white border border-[#E4E4E7] text-[#71717A] hover:text-[#27272A] hover:border-[#D4D4D8]'
              }`}
            >
              <Icon size={13} />
              {t.label}
            </button>
          )
        })}
      </div>

      <p className="text-xs text-[#A1A1AA] -mt-1">{active.blurb}</p>

      {tab === 'permissions' && <PermissionMatrix />}
      {tab === 'policies'    && <PolicySettings academicYearId={year?.id ?? null} />}
      {tab === 'numbering'   && (
        <NumberingSettingsPanel academicYearId={year?.id ?? null} yearCode={year?.code ?? '2026-27'} />
      )}
      {tab === 'years'       && <AcademicYearSettings onChanged={() => void refresh()} />}
      {tab === 'collection'  && <BankCollectSettings ctx="fees" />}
      {tab === 'whatsapp'    && <WhatsAppSettingsPanel />}
    </div>
  )
}
