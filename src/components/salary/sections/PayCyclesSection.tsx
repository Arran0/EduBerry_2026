'use client'

import React, { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { AnimatePresence } from 'framer-motion'
import { Plus, ChevronRight, CalendarRange, Users, Bus, BadgeCheck } from 'lucide-react'
import NewCycleForm from '@/components/salary/NewCycleForm'
import { ADMIN, ADMIN_GOLD, CYCLE_CHIP, CYCLE_STATUS_LABEL, PAID_CHIP } from '@/components/salary/adminUi'
import { Sheet, SHEET } from '@/components/bus/adminUI'
import {
  SalaryCycle, SalaryCycleStatus, CycleTally,
  fetchCycles, fetchCycleTallies, formatPeriod,
} from '@/lib/salary'
import {
  DriverCycle,
  fetchDriverCycles, fetchDriverCycleTallies,
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
  const [loading, setLoading] = useState(true)
  const [cycles, setCycles] = useState<UnifiedCycle[]>([])
  const [tallies, setTallies] = useState<Record<string, CycleTally>>({})
  const [showNew, setShowNew] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const [staffCycles, staffTallies, driverCycles, driverTallies] = await Promise.all([
      fetchCycles(), fetchCycleTallies(), fetchDriverCycles(), fetchDriverCycleTallies(),
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
    setTallies({ ...staffTallies, ...driverTallies })
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  return (
    <>
      <div className="flex items-center justify-between mb-3">
        <h2 className={ADMIN.label}>Pay cycles</h2>
        <button onClick={() => setShowNew(true)} className={ADMIN.darkBtn}>
          <Plus size={14} /> New Cycle
        </button>
      </div>

      {loading ? (
        <div className="text-center py-12"><div className="spinner mx-auto mb-3" /><p className="text-sm text-[#71717A]">Loading…</p></div>
      ) : cycles.length === 0 ? (
        <div className={`${ADMIN.card} shadow-sm p-8 text-center`}>
          <div className="w-16 h-16 mx-auto mb-4 rounded-xl bg-[#27272A] flex items-center justify-center">
            <CalendarRange size={28} style={{ color: ADMIN_GOLD }} strokeWidth={1.6} />
          </div>
          <p className="text-sm text-[#71717A] mb-4 max-w-sm mx-auto">No pay cycles yet. Set base salaries first, then run a monthly cycle.</p>
          <button onClick={() => setShowNew(true)} className={`${ADMIN.darkBtn} mx-auto`}>
            <Plus size={14} /> New Cycle
          </button>
        </div>
      ) : (
        <Sheet
          columns={
            <>
              <span className={`${SHEET.headCell} flex-1 ml-10`}>Period</span>
              <span className={`${SHEET.headCell} w-40 flex-shrink-0`}>Status</span>
              <span className={`${SHEET.headCell} w-28 flex-shrink-0`}>Records</span>
              <span className="w-8 flex-shrink-0" />
            </>
          }
        >
          {cycles.map(c => {
            const bar = c.status === 'closed' ? 'bg-[#27272A]' : 'bg-[#D4D4D8]'
            const tally = tallies[c.id]
            const allPaid = !!tally && tally.total > 0 && tally.paid === tally.total
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
                  <div className="w-auto sm:w-40 flex-shrink-0 flex items-center gap-1.5">
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold uppercase tracking-wide ${CYCLE_CHIP[c.status]}`}>
                      {CYCLE_STATUS_LABEL[c.status]}
                    </span>
                    {allPaid && (
                      <span className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full font-semibold uppercase tracking-wide ${PAID_CHIP}`}>
                        <BadgeCheck size={11} /> Paid
                      </span>
                    )}
                  </div>
                  <span className="hidden sm:block w-28 text-sm text-[#71717A] flex-shrink-0 tabular-nums">
                    {tally?.total ?? 0} record{(tally?.total ?? 0) === 1 ? '' : 's'}
                  </span>
                  <ChevronRight size={18} className="text-[#D4D4D8] flex-shrink-0 w-8" />
                </div>
              </Link>
            )
          })}
        </Sheet>
      )}

      <AnimatePresence>
        {showNew && (
          <NewCycleForm onClose={() => setShowNew(false)} onCreated={() => { setShowNew(false); load() }} />
        )}
      </AnimatePresence>
    </>
  )
}
