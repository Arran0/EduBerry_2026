'use client'

import React, { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Banknote, Landmark, Wallet, CalendarRange } from 'lucide-react'
import ProtectedLayout from '@/components/ProtectedLayout'
import PageBanner from '@/components/PageBanner'
import { SegTabs } from '@/components/bus/adminUI'
import dynamic from 'next/dynamic'
const PayCyclesSection    = dynamic(() => import('@/components/salary/sections/PayCyclesSection'))
const BaseSalariesSection = dynamic(() => import('@/components/salary/sections/BaseSalariesSection'))
const BankAccountsSection = dynamic(() => import('@/components/salary/sections/BankAccountsSection'))
const SalarySummary       = dynamic(() => import('@/components/salary/SalarySummary'))
const StaffSalaryView     = dynamic(() => import('@/components/salary/StaffSalaryView'))
import { useAuth } from '@/contexts/AuthContext'
import { SALARY_BANNER_DEFAULT } from '@/lib/pageConfig'

export default function SalaryPage() {
  const { profile } = useAuth()
  const router = useRouter()
  const isAdmin = profile?.role === 'admin'

  return (
    <ProtectedLayout staffOnly>
      <div data-page-theme="salary">
        {isAdmin
          ? <AdminSalaryHub onBack={() => router.back()} />
          : <StaffSalaryView onBack={() => router.back()} />}
      </div>
    </ProtectedLayout>
  )
}

// ──────────────────────────────────────────────────────────────
// Admin hub — inline sections: Pay Cycles / Base Salaries / Bank Accounts
// ──────────────────────────────────────────────────────────────

type SectionKey = 'cycles' | 'base' | 'bank'

const SECTIONS: { key: SectionKey; label: string; icon: React.ReactNode }[] = [
  { key: 'cycles', label: 'Pay Cycles', icon: <CalendarRange size={15} /> },
  { key: 'base', label: 'Base Salaries', icon: <Wallet size={15} /> },
  { key: 'bank', label: 'Bank Accounts', icon: <Landmark size={15} /> },
]

function AdminSalaryHub({ onBack }: { onBack: () => void }) {
  const [section, setSection] = useState<SectionKey>('cycles')
  const [bannerEditing, setBannerEditing] = useState(false)

  return (
    <div style={{ minHeight: '100vh' }}>
      <PageBanner
        settingKey="salary_banner"
        defaultBanner={SALARY_BANNER_DEFAULT}
        icon={<Banknote size={26} className="text-white" />}
        title="Salary Manager"
        subtitle="Pay cycles, base salaries & bank details for staff and bus drivers"
        isAdmin
        onBack={onBack}
        onEditingChange={setBannerEditing}
        maxWidth="max-w-5xl"
        backgroundIcon={<Wallet size={150} className="text-white" />}
      />

      {/* The gutter stays on the page so headings and controls keep their inset;
          the dense panels below cancel it themselves (see BLEED) and run to
          both screen edges on phones, where 32px of gutter is width nobody has. */}
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 pb-10">
        {/* Everything but the banner fades while the banner is being edited */}
        <div style={{ opacity: bannerEditing ? 0.35 : 1, filter: bannerEditing ? 'blur(1.5px)' : 'none', pointerEvents: bannerEditing ? 'none' : 'auto', userSelect: bannerEditing ? 'none' : 'auto', transition: 'opacity 0.25s ease, filter 0.25s ease' }}>

          {/* Month-scoped payroll figures. Clicking a card jumps to its section. */}
          <div className="relative z-10 -mt-6 sm:-mt-8 mb-4">
            <SalarySummary onSelect={setSection} />
          </div>

          {/* Section toggler — underline tabs (Pay Cycles / Base Salaries / Bank Accounts).
              Staff and bus drivers are shown together within each section, not split by tabs. */}
          <SegTabs tabs={SECTIONS} value={section} onChange={setSection} className="mb-5 -mx-4 px-4 sm:mx-0 sm:px-0" />

          {section === 'cycles' && <PayCyclesSection />}
          {section === 'base' && <BaseSalariesSection />}
          {section === 'bank' && <BankAccountsSection />}
        </div>
      </div>
    </div>
  )
}
