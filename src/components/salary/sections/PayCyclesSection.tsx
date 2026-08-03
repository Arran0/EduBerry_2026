'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { AnimatePresence } from 'framer-motion'
import { Plus, ChevronRight, CalendarRange, Users, Bus } from 'lucide-react'
import SalaryCycleForm from '@/components/salary/SalaryCycleForm'
import DriverSalaryCycleForm from '@/components/bus/DriverSalaryCycleForm'
import { ADMIN, ADMIN_GOLD, CYCLE_CHIP } from '@/components/salary/adminUi'
import { Sheet, SHEET } from '@/components/bus/adminUI'
import {
  SalaryCycle, SalaryCycleStatus,
  fetchCycles, fetchCycleRecordCounts, formatPeriod,
} from '@/lib/salary'
import {
  DriverCycle,
  fetchDriverCycles, fetchDriverCycleRecordCounts,
} from '@/lib/driverSalary'

type Kind = 'staff' | 'driver'

interface UnifiedCycle {
  id: string
  kind: Kind
  period_month: number
  period_year: number
  status: SalaryCycleStatus
  href: string
}

function toUnified(cycles: (SalaryCycle | DriverCycle)[], kind: Kind, hrefBase: string): UnifiedCycle[] {
  return cycles.map(c => ({
    id: c.id, kind, period_month: c.period_month, period_year: c.period_year,
    status: c.status, href: `${hrefBase}/${c.id}`,
  }))
}

export default function PayCyclesSection() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [cycles, setCycles] = useState<UnifiedCycle[]>([])
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [showNewStaff, setShowNewStaff] = useState(false)
  const [showNewDriver, setShowNewDriver] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const [staffCycles, staffCounts, driverCycles, driverCounts] = await Promise.all([
      fetchCycles(), fetchCycleRecordCounts(), fetchDriverCycles(), fetchDriverCycleRecordCounts(),
    ])
    const merged = [
      ...toUnified(staffCycles, 'staff', '/more/salary/manage'),
      ...toUnified(driverCycles, 'driver', '/more/bus/payroll'),
    ].sort((a, b) =>
      b.period_year - a.period_year ||
      b.period_month - a.period_month ||
      (a.kind === b.kind ? 0 : a.kind === 'staff' ? -1 : 1)
    )
    setCycles(merged)
    setCounts({ ...staffCounts, ...driverCounts })
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  return (
    <>
      <div className="flex items-center justify-between mb-3">
        <h2 className={ADMIN.label}>Pay cycles</h2>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowNewStaff(true)} className={ADMIN.darkBtn}>
            <Plus size={14} /> Staff Cycle
          </button>
          <button onClick={() => setShowNewDriver(true)} className={ADMIN.ghostBtn}>
            <Plus size={14} /> Driver Cycle
          </button>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-12"><div className="spinner mx-auto mb-3" /><p className="text-sm text-[#71717A]">Loading…</p></div>
      ) : cycles.length === 0 ? (
        <div className={`${ADMIN.card} shadow-sm p-8 text-center`}>
          <div className="w-16 h-16 mx-auto mb-4 rounded-xl bg-[#27272A] flex items-center justify-center">
            <CalendarRange size={28} style={{ color: ADMIN_GOLD }} strokeWidth={1.6} />
          </div>
          <p className="text-sm text-[#71717A] mb-4 max-w-sm mx-auto">No pay cycles yet. Set base salaries first, then run a monthly cycle.</p>
          <div className="flex items-center justify-center gap-2">
            <button onClick={() => setShowNewStaff(true)} className={ADMIN.darkBtn}>
              <Plus size={14} /> Staff Cycle
            </button>
            <button onClick={() => setShowNewDriver(true)} className={ADMIN.ghostBtn}>
              <Plus size={14} /> Driver Cycle
            </button>
          </div>
        </div>
      ) : (
        <Sheet
          columns={
            <>
              <span className={`${SHEET.headCell} flex-1 ml-10`}>Period</span>
              <span className={`${SHEET.headCell} w-28 flex-shrink-0`}>Status</span>
              <span className={`${SHEET.headCell} w-28 flex-shrink-0`}>Records</span>
              <span className="w-8 flex-shrink-0" />
            </>
          }
        >
          {cycles.map(c => {
            const bar = c.status === 'completed' ? 'bg-[#27272A]' : c.status === 'processing' ? 'bg-[#B8983C]' : 'bg-[#D4D4D8]'
            return (
              <Link key={`${c.kind}-${c.id}`} href={c.href} className={SHEET.row}>
                <div className={`${SHEET.bar} ${bar}`} />
                <div className="flex items-center gap-2.5 flex-1 min-w-0 px-3 py-2">
                  <div className="w-7 h-7 rounded-md bg-[#27272A] flex items-center justify-center flex-shrink-0">
                    {c.kind === 'staff'
                      ? <Users size={14} style={{ color: ADMIN_GOLD }} />
                      : <Bus size={14} style={{ color: ADMIN_GOLD }} />}
                  </div>
                  <span className="flex-1 min-w-0 font-semibold text-[#18181B] text-sm truncate">
                    {formatPeriod(c.period_month, c.period_year)}
                    <span className="text-[#A1A1AA] font-normal"> · {c.kind === 'staff' ? 'Staff' : 'Drivers'}</span>
                  </span>
                  <div className="w-auto sm:w-28 flex-shrink-0">
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold uppercase tracking-wide ${CYCLE_CHIP[c.status]}`}>
                      {c.status[0].toUpperCase() + c.status.slice(1)}
                    </span>
                  </div>
                  <span className="hidden sm:block w-28 text-sm text-[#71717A] flex-shrink-0 tabular-nums">{counts[c.id] ?? 0} record{(counts[c.id] ?? 0) === 1 ? '' : 's'}</span>
                  <ChevronRight size={18} className="text-[#D4D4D8] flex-shrink-0 w-8" />
                </div>
              </Link>
            )
          })}
        </Sheet>
      )}

      <AnimatePresence>
        {showNewStaff && (
          <SalaryCycleForm
            onClose={() => setShowNewStaff(false)}
            onSaved={(cycleId) => { setShowNewStaff(false); router.push(`/more/salary/manage/${cycleId}`) }}
          />
        )}
        {showNewDriver && (
          <DriverSalaryCycleForm
            onClose={() => setShowNewDriver(false)}
            onSaved={(cycleId) => { setShowNewDriver(false); router.push(`/more/bus/payroll/${cycleId}`) }}
          />
        )}
      </AnimatePresence>
    </>
  )
}
