'use client'

// ─────────────────────────────────────────────────────────────────────────────
// The Salary module.
//
// Laid out like the transport and fee admins: the banner, one capsule switch
// overlapping its foot, and the three places under it.
//
//   Pay cycles     — the month's figures, then every cycle run.
//   Base salaries  — what each person is paid, and their PF/ESI details.
//   Bank accounts  — where each salary goes.
//
// The tab lives in the URL so a link or a bookmark lands on the right one.
// ─────────────────────────────────────────────────────────────────────────────

import React, { Suspense, useCallback, useState } from 'react'
import dynamic from 'next/dynamic'
import { useRouter, useSearchParams } from 'next/navigation'
import { Banknote, CalendarRange, Landmark, Settings, Wallet } from 'lucide-react'
import ProtectedLayout from '@/components/ProtectedLayout'
import PageBanner from '@/components/PageBanner'
import ModalShell from '@/components/ui/ModalShell'
import { GlassSegments } from '@/components/transport/glass'
import { Loading, SALARY_ICON, SHELL } from '@/components/salary/ui'
import { useAuth } from '@/contexts/AuthContext'
import { SALARY_BANNER_DEFAULT } from '@/lib/pageConfig'

const PayCyclesSection    = dynamic(() => import('@/components/salary/sections/PayCyclesSection'), { loading: () => <Loading /> })
const BaseSalariesSection = dynamic(() => import('@/components/salary/sections/BaseSalariesSection'), { loading: () => <Loading /> })
const BankAccountsSection = dynamic(() => import('@/components/salary/sections/BankAccountsSection'), { loading: () => <Loading /> })
const SalarySummary       = dynamic(() => import('@/components/salary/SalarySummary'))
const StaffSalaryView     = dynamic(() => import('@/components/salary/StaffSalaryView'), { loading: () => <Loading /> })
const PayrollSettingsPanel = dynamic(() => import('@/components/settings/PayrollSettingsPanel'), { loading: () => <Loading /> })

export default function SalaryPage() {
  return (
    <ProtectedLayout staffOnly>
      {/* useSearchParams needs a Suspense boundary to stay out of the
          static-render bailout. */}
      <Suspense fallback={<Loading />}>
        <SalaryGate />
      </Suspense>
    </ProtectedLayout>
  )
}

function SalaryGate() {
  const { profile } = useAuth()
  const isAdmin = profile?.role === 'admin'
  return (
    <div data-page-theme="salary" className="overflow-x-clip" style={{ minHeight: '100vh' }}>
      {isAdmin ? <AdminSalaryHub /> : <StaffSalaryView />}
    </div>
  )
}

type SectionKey = 'cycles' | 'base' | 'bank'

const SECTIONS = [
  { key: 'cycles' as const, label: 'Pay cycles', icon: CalendarRange },
  { key: 'base' as const,   label: 'Base salaries', icon: Wallet },
  { key: 'bank' as const,   label: 'Bank accounts', icon: Landmark },
]

/** Solid white on the banner: a translucent control over a photo cannot be read. */
const BANNER_BTN =
  'inline-flex items-center justify-center gap-1.5 h-[30px] px-3 rounded-full bg-white text-slate-900 text-[12px] font-semibold ring-1 ring-black/5 shadow-[0_6px_16px_-8px_rgba(15,23,42,.55)] hover:bg-slate-50 active:scale-[0.97] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B8983C]'

function AdminSalaryHub() {
  const router = useRouter()
  const params = useSearchParams()
  const tab = params.get('tab')
  const section: SectionKey = SECTIONS.some(s => s.key === tab) ? tab as SectionKey : 'cycles'
  const [bannerEditing, setBannerEditing] = useState(false)
  const [showSettings, setShowSettings] = useState(params.get('panel') === 'settings')

  const go = useCallback((next: SectionKey) => {
    router.replace(next === 'cycles' ? '/more/salary' : `/more/salary?tab=${next}`, { scroll: false })
  }, [router])

  return (
    <>
      <PageBanner
        settingKey="salary_banner"
        defaultBanner={SALARY_BANNER_DEFAULT}
        icon={<Banknote size={26} className="text-white" />}
        title="Salary"
        subtitle="Pay cycles, base pay and bank details"
        isAdmin
        onEditingChange={setBannerEditing}
        maxWidth="max-w-7xl 2xl:max-w-[1600px]"
        backgroundIcon={<Wallet size={150} className="text-white" />}
        actions={
          <button onClick={() => setShowSettings(true)} aria-label="Payroll settings" className={BANNER_BTN}>
            <Settings size={13} className="text-[#8B6F47]" />
            <span className="hidden sm:inline">Settings</span>
          </button>
        }
      />

      <div className={`${SHELL} px-4 sm:px-6 lg:px-8 pb-14`}>
        {/* Everything but the banner fades while the banner is being edited. */}
        <div style={{
          opacity: bannerEditing ? 0.35 : 1,
          pointerEvents: bannerEditing ? 'none' : 'auto',
          userSelect: bannerEditing ? 'none' : 'auto',
          transition: 'opacity 0.25s ease',
        }}>
          {/* The switch overlaps the banner. Solid, not glass: through a
              translucent control the banner photo shows as noise. */}
          <div className="relative z-10 -mt-6 sm:-mt-7 mb-4 sm:mb-6 flex justify-center sm:justify-start">
            <GlassSegments
              layoutId="salary-hub-tab"
              items={SECTIONS}
              value={section}
              onChange={go}
              stretch
              className="!bg-white ring-1 ring-black/[.06] shadow-[0_14px_30px_-12px_rgba(15,23,42,.55)]"
            />
          </div>

          {section === 'cycles' && (
            <div className="space-y-4 sm:space-y-5">
              <SalarySummary onSelect={go} />
              <PayCyclesSection />
            </div>
          )}
          {section === 'base' && <BaseSalariesSection />}
          {section === 'bank' && <BankAccountsSection />}
        </div>
      </div>

      {/* The same panel /admin/payroll-settings renders, opened where payroll is
          actually run. One copy of the settings, two ways in. */}
      {showSettings && (
        <ModalShell
          onClose={() => setShowSettings(false)}
          size="2xl"
          sharp
          title="Payroll settings"
          subtitle="Payout bank, hidden people and the rules a new cycle starts with"
          icon={<Settings size={16} />}
          iconClassName={SALARY_ICON}
          minHClass="sm:min-h-[34rem]"
        >
          <PayrollSettingsPanel />
        </ModalShell>
      )}
    </>
  )
}
