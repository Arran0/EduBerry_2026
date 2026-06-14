'use client'

import React, { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { AnimatePresence } from 'framer-motion'
import { Plus, Wallet, Landmark, ChevronRight, CalendarRange } from 'lucide-react'
import DriverSalaryCycleForm from '@/components/bus/DriverSalaryCycleForm'
import {
  DriverCycle, DriverCycleStatus,
  fetchDriverCycles, fetchDriverCycleRecordCounts, formatPeriod,
} from '@/lib/driverSalary'

const CYCLE_CHIP: Record<DriverCycleStatus, string> = {
  open: 'bg-slate-100 text-slate-600',
  processing: 'bg-amber-100 text-amber-700',
  completed: 'bg-emerald-100 text-emerald-700',
}

export default function DriverPayrollSection() {
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
        <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wide">
          {cycles.length} pay cycle{cycles.length === 1 ? '' : 's'}
        </h2>
        <button onClick={() => setShowNew(true)} className="glass-btn glass-btn-accent">
          <Plus size={14} /> Run Cycle
        </button>
      </div>

      {/* Config shortcuts */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
        <NavCard href="/more/bus/payroll/base" icon={<Wallet size={18} />} title="Base Salaries" desc="Standing monthly pay" />
        <NavCard href="/more/bus/payroll/bank" icon={<Landmark size={18} />} title="Bank Accounts" desc="Disbursement details" />
      </div>

      {loading ? (
        <div className="text-center py-12"><div className="spinner mx-auto mb-3" /></div>
      ) : cycles.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center">
          <CalendarRange size={30} className="text-slate-300 mx-auto mb-3" />
          <p className="text-sm text-slate-500 mb-4">No pay cycles yet. Set base salaries first, then run a monthly cycle.</p>
          <button onClick={() => setShowNew(true)} className="btn-primary text-sm inline-flex items-center gap-2">
            <Plus size={15} /> Run Cycle
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {cycles.map(c => (
            <Link key={c.id} href={`/more/bus/payroll/${c.id}`}
              className="flex items-center gap-4 bg-white rounded-2xl p-4 border border-slate-200 shadow-sm hover:shadow-md transition-shadow">
              <div className="w-11 h-11 rounded-xl bg-emerald-50 flex items-center justify-center flex-shrink-0">
                <CalendarRange size={20} className="text-emerald-600" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-slate-800">{formatPeriod(c.period_month, c.period_year)}</span>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${CYCLE_CHIP[c.status]}`}>
                    {c.status[0].toUpperCase() + c.status.slice(1)}
                  </span>
                </div>
                <p className="text-slate-500 text-sm mt-0.5">{counts[c.id] ?? 0} driver record{(counts[c.id] ?? 0) === 1 ? '' : 's'}</p>
              </div>
              <ChevronRight size={18} className="text-slate-400 flex-shrink-0" />
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

function NavCard({ href, icon, title, desc }: { href: string; icon: React.ReactNode; title: string; desc: string }) {
  return (
    <Link href={href}
      className="flex items-center gap-3 bg-white rounded-2xl p-4 border border-slate-200 shadow-sm hover:shadow-md transition-shadow">
      <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center text-slate-600 flex-shrink-0">
        {icon}
      </div>
      <div className="min-w-0">
        <p className="font-semibold text-slate-800 text-sm truncate">{title}</p>
        <p className="text-xs text-slate-400 truncate">{desc}</p>
      </div>
    </Link>
  )
}
