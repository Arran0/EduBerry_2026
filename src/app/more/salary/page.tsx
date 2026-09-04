'use client'

import React, { useState } from 'react'
import { Banknote, Landmark, Wallet, CalendarRange, Settings } from 'lucide-react'
import ProtectedLayout from '@/components/ProtectedLayout'
import PageBanner from '@/components/PageBanner'
import dynamic from 'next/dynamic'
const PayCyclesSection    = dynamic(() => import('@/components/salary/sections/PayCyclesSection'))
const BaseSalariesSection = dynamic(() => import('@/components/salary/sections/BaseSalariesSection'))
const BankAccountsSection = dynamic(() => import('@/components/salary/sections/BankAccountsSection'))
const SalarySummary       = dynamic(() => import('@/components/salary/SalarySummary'))
const StaffSalaryView     = dynamic(() => import('@/components/salary/StaffSalaryView'))
const PayrollSettingsPanel = dynamic(() => import('@/components/settings/PayrollSettingsPanel'))
import ModalShell from '@/components/ui/ModalShell'
import { useAuth } from '@/contexts/AuthContext'
import { SALARY_BANNER_DEFAULT } from '@/lib/pageConfig'

export default function SalaryPage() {
  const { profile } = useAuth()
  const isAdmin = profile?.role === 'admin'

  return (
    <ProtectedLayout staffOnly>
      <div data-page-theme="salary">
        {isAdmin ? <AdminSalaryHub /> : <StaffSalaryView />}
      </div>
    </ProtectedLayout>
  )
}

// ──────────────────────────────────────────────────────────────
// Admin hub — inline sections: Pay Cycles / Base Salaries / Bank Accounts
// ──────────────────────────────────────────────────────────────

type SectionKey = 'cycles' | 'base' | 'bank'

const SECTIONS: { key: SectionKey; label: string; icon: React.ReactNode }[] = [
  { key: 'cycles', label: 'Pay Cycles', icon: <CalendarRange size={14} /> },
  { key: 'base', label: 'Base Salaries', icon: <Wallet size={14} /> },
  { key: 'bank', label: 'Bank Accounts', icon: <Landmark size={14} /> },
]

function AdminSalaryHub() {
  const [section, setSection] = useState<SectionKey>('cycles')
  const [bannerEditing, setBannerEditing] = useState(false)
  const [showSettings, setShowSettings] = useState(false)

  return (
    <div style={{ minHeight: '100vh' }}>
      <PageBanner
        settingKey="salary_banner"
        defaultBanner={SALARY_BANNER_DEFAULT}
        icon={<Banknote size={26} className="text-white" />}
        title="Salary Manager"
        subtitle="Pay cycles, base salaries & bank details for staff and bus drivers"
        isAdmin
        onEditingChange={setBannerEditing}
        maxWidth="max-w-5xl"
        backgroundIcon={<Wallet size={150} className="text-white" />}
        actions={
          <button
            onClick={() => setShowSettings(true)}
            title="Payroll settings"
            className="flex items-center gap-2 px-3 sm:px-4 py-2.5 bg-white/15 hover:bg-white/25 text-white text-sm font-medium border border-white/25 rounded-lg backdrop-blur-sm transition-colors"
          >
            <Settings size={15} />
            <span className="hidden sm:inline">Settings</span>
          </button>
        }
      />

      {/* A narrow gutter on phones: the stat tiles float inside it, and the
          dense sheets below cancel it themselves so a payroll table gets the
          whole screen.

          The month stepper starts below the banner rather than tucked up into
          it: a control that straddles the banner's bottom edge reads as having
          slipped out of place, and half of it loses contrast against the
          banner image behind it. */}
      <div className="relative z-10 max-w-5xl mx-auto px-3 sm:px-6 lg:px-8 pt-4 pb-10">
        {/* Everything but the banner fades while the banner is being edited */}
        <div style={{ opacity: bannerEditing ? 0.35 : 1, filter: bannerEditing ? 'blur(1.5px)' : 'none', pointerEvents: bannerEditing ? 'none' : 'auto', userSelect: bannerEditing ? 'none' : 'auto', transition: 'opacity 0.25s ease, filter 0.25s ease' }}>

          {/* Month-scoped payroll figures. Clicking a tile jumps to its section. */}
          <SalarySummary onSelect={setSection} />

          {/* Section toggler. Staff and bus drivers are shown together within
              each section, not split by tabs. */}
          <div className="flex border-b border-[#E3DFD3] mt-4 mb-3">
            {SECTIONS.map(t => {
              const active = section === t.key
              return (
                <button
                  key={t.key}
                  onClick={() => setSection(t.key)}
                  className={`flex-1 flex items-center justify-center gap-1.5 pb-1.5 text-[11px] sm:text-[12px] font-bold uppercase tracking-[0.06em] border-b-2 -mb-px transition-colors ${
                    active ? 'border-[#B8983C] text-[#18181B]' : 'border-transparent text-[#A8A395] hover:text-[#6B675A]'
                  }`}
                >
                  {t.icon}
                  <span className="truncate">{t.label}</span>
                </button>
              )
            })}
          </div>

          {section === 'cycles' && <PayCyclesSection />}
          {section === 'base' && <BaseSalariesSection />}
          {section === 'bank' && <BankAccountsSection />}
        </div>
      </div>

      {/* The same panel /admin/payroll-settings renders, opened where payroll is
          actually being run. One copy of the settings, two ways in — a second
          copy would be two things to keep in step and eventually two answers. */}
      {showSettings && (
        <ModalShell
          onClose={() => setShowSettings(false)}
          size="2xl"
          title="Payroll settings"
          subtitle="Salary payout and the default rules every new cycle starts from"
          icon={<Settings size={16} />}
          iconClassName="bg-[#27272A] text-white"
          bodyClassName="bg-[#F5F5F5]"
          minHClass="sm:min-h-[36rem]"
        >
          <PayrollSettingsPanel />
        </ModalShell>
      )}
    </div>
  )
}
