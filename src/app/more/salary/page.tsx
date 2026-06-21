'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Banknote, Landmark, ShieldCheck, Wallet, CalendarRange } from 'lucide-react'
import ProtectedLayout from '@/components/ProtectedLayout'
import PageBanner from '@/components/PageBanner'
import dynamic from 'next/dynamic'
const PayCyclesSection    = dynamic(() => import('@/components/salary/sections/PayCyclesSection'))
const BaseSalariesSection = dynamic(() => import('@/components/salary/sections/BaseSalariesSection'))
const BankAccountsSection = dynamic(() => import('@/components/salary/sections/BankAccountsSection'))
const SalarySummary       = dynamic(() => import('@/components/salary/SalarySummary'))
import { useAuth } from '@/contexts/AuthContext'
import { formatINR } from '@/components/bus/FeeCollectionSummary'
import { SALARY_BANNER_DEFAULT } from '@/lib/pageConfig'
import {
  SalaryRecord, SalaryStatus, StaffBankAccount,
  fetchSalaryForStaff, fetchMyBankAccount, salaryNet, formatPeriod, maskAccountNumber,
} from '@/lib/salary'

const STATUS_CHIP: Record<SalaryStatus, string> = {
  draft: 'bg-slate-100 text-slate-500',
  approved: 'bg-blue-100 text-blue-700',
  paid: 'bg-emerald-100 text-emerald-700',
}

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
        subtitle="Run pay cycles, set base salaries & bank details"
        isAdmin
        onBack={onBack}
        onEditingChange={setBannerEditing}
        maxWidth="max-w-5xl"
        backgroundIcon={<Wallet size={150} className="text-white" />}
      />

      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 pb-10">
        {/* Everything but the banner fades while the banner is being edited */}
        <div style={{ opacity: bannerEditing ? 0.35 : 1, filter: bannerEditing ? 'blur(1.5px)' : 'none', pointerEvents: bannerEditing ? 'none' : 'auto', userSelect: bannerEditing ? 'none' : 'auto', transition: 'opacity 0.25s ease, filter 0.25s ease' }}>

          {/* Summary cards — overlap the banner; clicking one jumps to its section */}
          <div className="relative z-10 -mt-6 sm:-mt-8 mb-4">
            <SalarySummary activeKey={section} onSelect={setSection} />
          </div>

          {/* Section toggler — inline tabs, full width, below the cards */}
          <div className="flex gap-1 mb-5 p-1 rounded-xl bg-white border border-[#E4E4E7] shadow-sm">
            {SECTIONS.map(s => {
              const active = section === s.key
              return (
                <button key={s.key} onClick={() => setSection(s.key)}
                  className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-2.5 rounded-lg text-xs font-semibold transition-all ${
                    active ? 'bg-[#27272A] text-white shadow-sm' : 'text-[#71717A] hover:text-[#27272A] hover:bg-[#F4F4F5]'
                  }`}>
                  {s.icon}
                  <span className="hidden sm:inline truncate">{s.label}</span>
                </button>
              )
            })}
          </div>

          {section === 'cycles' && <PayCyclesSection />}
          {section === 'base' && <BaseSalariesSection />}
          {section === 'bank' && <BankAccountsSection />}
        </div>
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────
// Staff view — personal payslips
// ──────────────────────────────────────────────────────────────

function StaffSalaryView({ onBack }: { onBack: () => void }) {
  const { profile, dataRefreshKey } = useAuth()
  const [loading, setLoading] = useState(true)
  const [records, setRecords] = useState<SalaryRecord[]>([])
  const [bank, setBank] = useState<StaffBankAccount | null>(null)

  const load = useCallback(async () => {
    if (!profile) return
    setLoading(true)
    const [recs, acc] = await Promise.all([
      fetchSalaryForStaff(profile.id),
      fetchMyBankAccount(profile.id),
    ])
    setRecords(recs)
    setBank(acc)
    setLoading(false)
  }, [profile])

  useEffect(() => { load() }, [load, dataRefreshKey])

  const latestNet = records.length > 0 ? salaryNet(records[0]) : 0

  return (
    <>
      <PageBanner
        settingKey="salary_banner"
        defaultBanner={SALARY_BANNER_DEFAULT}
        icon={<Banknote size={26} className="text-white" />}
        title="My Salary"
        subtitle="Monthly pay, bonuses & deductions"
        onBack={onBack}
        maxWidth="max-w-2xl"
        backgroundIcon={<Wallet size={150} className="text-white" />}
      />

      <div className="relative z-0 max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 -mt-8 pb-10">

        {/* Latest net pay highlight */}
        {!loading && records.length > 0 && (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 mb-4 flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl page-icon-bg flex items-center justify-center flex-shrink-0 shadow-sm">
              <Wallet size={22} className="text-white" />
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Latest net pay</p>
              <p className="text-2xl font-bold text-slate-800 tabular-nums">{formatINR(latestNet)}</p>
            </div>
          </div>
        )}

        {/* Bank account on file (read-only; admin-managed) */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 mb-4">
          <div className="flex items-center gap-2 mb-2">
            <Landmark size={15} className="page-accent-text" />
            <span className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Bank account on file</span>
          </div>
          {bank ? (
            <div className="text-sm text-slate-700 space-y-0.5">
              <p className="font-medium">{bank.account_holder_name}</p>
              <p className="text-slate-500 tabular-nums">{maskAccountNumber(bank.account_number)} · {bank.ifsc}</p>
              {bank.bank_name && <p className="text-slate-400 text-xs">{bank.bank_name}</p>}
            </div>
          ) : (
            <p className="text-sm text-slate-400">
              No bank account on record yet. Contact the office to add your details for salary disbursement.
            </p>
          )}
        </div>

        {loading ? (
          <div className="text-center py-12"><div className="spinner mx-auto mb-3" /></div>
        ) : records.length === 0 ? (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-8 text-center">
            <div className="w-16 h-16 mx-auto mb-4 rounded-2xl page-accent-bg flex items-center justify-center">
              <Banknote size={30} className="page-accent-text" strokeWidth={1.5} />
            </div>
            <h2 className="text-lg font-semibold text-slate-800 mb-1">No payslips yet</h2>
            <p className="text-sm text-slate-500 max-w-sm mx-auto">
              Your monthly salary will appear here once the office runs a pay cycle.
            </p>
          </div>
        ) : (
          <div className="space-y-3 pb-2">
            {records.map(r => {
              const items = r.items ?? []
              const period = r.cycle ? formatPeriod(r.cycle.period_month, r.cycle.period_year) : 'Salary'
              return (
                <div key={r.id} className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 hover:shadow-md transition-shadow">
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-sm font-semibold text-slate-700">{period}</p>
                    <span className={`text-[11px] font-semibold px-2.5 py-1 rounded-full ${STATUS_CHIP[r.status]}`}>
                      {r.status[0].toUpperCase() + r.status.slice(1)}
                    </span>
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-slate-600">Base salary</span>
                      <span className="text-slate-700 tabular-nums">{formatINR(Number(r.base_amount))}</span>
                    </div>
                    {items.map(it => (
                      <div key={it.id} className="flex items-center justify-between text-sm">
                        <span className="text-slate-600 truncate">{it.label}</span>
                        <span className={`tabular-nums ${Number(it.amount) < 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                          {Number(it.amount) < 0 ? '-' : '+'}{formatINR(Math.abs(Number(it.amount)))}
                        </span>
                      </div>
                    ))}
                    <div className="flex items-center justify-between pt-2 mt-1 border-t border-slate-100">
                      <span className="text-sm font-semibold text-slate-700">Net pay</span>
                      <span className="text-lg font-bold text-slate-900 tabular-nums">{formatINR(salaryNet(r))}</span>
                    </div>
                  </div>

                  {r.status === 'paid' && r.payout_reference && (
                    <p className="text-[11px] text-emerald-600 mt-3 flex items-center gap-1">
                      <ShieldCheck size={12} /> Disbursed · ref {r.payout_reference}
                    </p>
                  )}
                  {r.notes && <p className="text-xs text-slate-400 mt-3 italic">{r.notes}</p>}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </>
  )
}
