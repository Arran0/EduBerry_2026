'use client'

import React, { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { AnimatePresence } from 'framer-motion'
import { Plus, Wallet, Landmark, ChevronRight, CalendarRange } from 'lucide-react'
import DriverSalaryCycleForm from '@/components/bus/DriverSalaryCycleForm'
import DriverBaseSalariesSection from '@/components/bus/sections/DriverBaseSalariesSection'
import DriverBankAccountsSection from '@/components/bus/sections/DriverBankAccountsSection'
import { ADMIN, SegTabs } from '@/components/bus/adminUI'
import {
  DriverCycle, DriverCycleStatus,
  fetchDriverCycles, fetchDriverCycleRecordCounts, formatPeriod,
} from '@/lib/driverSalary'

type SectionKey = 'cycles' | 'base' | 'bank'

const SECTIONS = [
  { key: 'cycles' as const, label: 'Pay Cycles', icon: <CalendarRange size={15} /> },
  { key: 'base' as const, label: 'Base Salaries', icon: <Wallet size={15} /> },
  { key: 'bank' as const, label: 'Bank Accounts', icon: <Landmark size={15} /> },
]

const CYCLE_CHIP: Record<DriverCycleStatus, string> = {
  open: 'bg-[#F4F4F5] text-[#71717A]',
  processing: 'bg-[#FBF3DE] text-[#8A6D1F]',
  completed: 'bg-[#27272A] text-white',
}

export default function DriverPayrollSection() {
  const [section, setSection] = useState<SectionKey>('cycles')

  return (
    <>
      {/* Sub-section toggler — segmented control (Style B) */}
      <SegTabs tabs={SECTIONS} value={section} onChange={setSection} className="mb-5" />

      {section === 'cycles' && <PayCyclesPanel />}
      {section === 'base' && <DriverBaseSalariesSection />}
      {section === 'bank' && <DriverBankAccountsSection />}
    </>
  )
}

// ──────────────────────────────────────────────────────────────
// Pay Cycles — list + Run Cycle action (lives inside this tab)
// ──────────────────────────────────────────────────────────────

function PayCyclesPanel() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [cycles, setCycles] = useState<DriverCycle[]>([])
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [showNew, setShowNew] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const [cs, cnt] = await Promise.all([fetchDriverCycles(), fetchDriverCycleRecordCounts()])
    setCycles(cs); setCounts(cnt)
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  return (
    <>
      <div className="flex items-center justify-between mb-3">
        <h2 className={ADMIN.label}>
          {cycles.length} pay cycle{cycles.length === 1 ? '' : 's'}
        </h2>
        <button onClick={() => setShowNew(true)} className={ADMIN.darkBtn}>
          <Plus size={14} /> Run Cycle
        </button>
      </div>

      {loading ? (
        <div className="text-center py-12"><div className="spinner mx-auto mb-3" /></div>
      ) : cycles.length === 0 ? (
        <div className={`${ADMIN.card} shadow-sm p-8 text-center`}>
          <div className="w-16 h-16 mx-auto mb-4 rounded-xl bg-[#27272A] flex items-center justify-center">
            <CalendarRange size={28} className="text-[#B8983C]" strokeWidth={1.6} />
          </div>
          <p className="text-sm text-[#71717A] mb-4 max-w-sm mx-auto">No pay cycles yet. Set base salaries first, then run a monthly cycle.</p>
          <button onClick={() => setShowNew(true)} className={`${ADMIN.darkBtn} mx-auto`}>
            <Plus size={14} /> Run Cycle
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-2.5">
          {cycles.map(c => (
            <Link key={c.id} href={`/more/bus/payroll/${c.id}`}
              className={`${ADMIN.card} shadow-sm hover:shadow-md transition-shadow flex items-center gap-4 p-4`}>
              <div className="w-11 h-11 rounded-lg bg-[#27272A] flex items-center justify-center flex-shrink-0">
                <CalendarRange size={20} className="text-[#B8983C]" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-[#18181B]">{formatPeriod(c.period_month, c.period_year)}</span>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold uppercase tracking-wide ${CYCLE_CHIP[c.status]}`}>
                    {c.status[0].toUpperCase() + c.status.slice(1)}
                  </span>
                </div>
                <p className="text-[#71717A] text-sm mt-0.5">{counts[c.id] ?? 0} driver record{(counts[c.id] ?? 0) === 1 ? '' : 's'}</p>
              </div>
              <ChevronRight size={18} className="text-[#D4D4D8] flex-shrink-0" />
            </Link>
          ))}
        </div>
      )}

      <AnimatePresence>
        {showNew && (
          <DriverSalaryCycleForm
            onClose={() => setShowNew(false)}
            onSaved={(cycleId) => { setShowNew(false); router.push(`/more/bus/payroll/${cycleId}`) }}
          />
        )}
      </AnimatePresence>
    </>
  )
}
