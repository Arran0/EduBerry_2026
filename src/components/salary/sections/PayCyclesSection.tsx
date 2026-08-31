'use client'

import React, { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { AnimatePresence } from 'framer-motion'
import { Plus, ChevronRight, CalendarRange, Users, Bus, BadgeCheck, Clock3, Trash2 } from 'lucide-react'
import NewCycleForm from '@/components/salary/NewCycleForm'
import ModalShell from '@/components/ui/ModalShell'
import {
  ADMIN, ADMIN_GOLD, BLEED, BLEED_EDGES, CYCLE_CHIP, CYCLE_STATUS_LABEL, PAID_CHIP, INCOMPLETE_CHIP,
} from '@/components/salary/adminUi'
import { Sheet, SHEET, SheetRowSkeleton } from '@/components/bus/adminUI'
import {
  SalaryCycle, SalaryCycleStatus, CycleTally,
  fetchCycles, fetchCycleTallies, formatPeriod, deleteCycle,
} from '@/lib/salary'
import {
  DriverCycle,
  fetchDriverCycles, fetchDriverCycleTallies, deleteDriverCycle,
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
  const [pendingDelete, setPendingDelete] = useState<UnifiedCycle | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

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

  const confirmDelete = async () => {
    if (!pendingDelete || deleting) return
    setDeleting(true); setError(null)
    const res = pendingDelete.kind === 'staff'
      ? await deleteCycle(pendingDelete.id)
      : await deleteDriverCycle(pendingDelete.id)
    setDeleting(false)
    if (!res.success) { setError(res.error ?? 'Could not delete the cycle'); return }
    setPendingDelete(null)
    load()
  }

  return (
    <>
      <div className="flex items-center justify-between mb-3">
        <h2 className={ADMIN.label}>Pay cycles</h2>
        <button onClick={() => setShowNew(true)} className={ADMIN.darkBtn}>
          <Plus size={14} /> New Cycle
        </button>
      </div>

      {loading ? (
        <div className={BLEED}>
          <Sheet className={BLEED_EDGES}>
            {Array.from({ length: 4 }, (_, i) => <SheetRowSkeleton key={i} />)}
          </Sheet>
        </div>
      ) : cycles.length === 0 ? (
        <div className={`${BLEED} ${ADMIN.card} ${BLEED_EDGES} shadow-sm p-8 text-center`}>
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
          className={`${BLEED} ${BLEED_EDGES}`}
          columns={
            <>
              <span className={`${SHEET.headCell} flex-1 ml-10`}>Period</span>
              <span className={`${SHEET.headCell} w-52 flex-shrink-0`}>Status</span>
              <span className={`${SHEET.headCell} w-28 flex-shrink-0`}>Records</span>
              <span className="w-16 flex-shrink-0" />
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
                  <div className="w-auto sm:w-52 flex-shrink-0 flex items-center gap-1.5">
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold uppercase tracking-wide ${CYCLE_CHIP[c.status]}`}>
                      {CYCLE_STATUS_LABEL[c.status]}
                    </span>
                    {allPaid ? (
                      <span className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full font-semibold uppercase tracking-wide ${PAID_CHIP}`}>
                        <BadgeCheck size={11} /> Paid
                      </span>
                    ) : (
                      <span className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full font-semibold uppercase tracking-wide ${INCOMPLETE_CHIP}`}>
                        <Clock3 size={11} /> Incomplete
                      </span>
                    )}
                  </div>
                  <span className="hidden sm:block w-28 text-sm text-[#71717A] flex-shrink-0 tabular-nums">
                    {tally?.total ?? 0} record{(tally?.total ?? 0) === 1 ? '' : 's'}
                  </span>
                  <button
                    type="button"
                    onClick={e => { e.preventDefault(); e.stopPropagation(); setPendingDelete(c) }}
                    title="Delete cycle"
                    aria-label="Delete cycle"
                    className="p-1 text-[#D4D4D8] hover:text-rose-600 transition-colors flex-shrink-0"
                  >
                    <Trash2 size={15} />
                  </button>
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
        {pendingDelete && (
          <ModalShell onClose={() => { setPendingDelete(null); setError(null) }} size="sm">
            <h3 className="font-bold text-slate-800 mb-1.5">
              Delete {formatPeriod(pendingDelete.period_month, pendingDelete.period_year)}
              {pendingDelete.kind === 'staff' ? ' (Staff)' : ' (Drivers)'}?
            </h3>
            <p className="text-sm text-slate-500 mb-4 leading-relaxed">
              This permanently removes the cycle and every record in it, including any bonuses, deductions and
              payout references. It cannot be undone. Payments already made at the bank are not affected — only
              this app&apos;s copy of the payroll is deleted.
            </p>
            {error && <p className="text-xs text-rose-600 mb-3">{error}</p>}
            <div className="flex gap-2 justify-end">
              <button onClick={() => { setPendingDelete(null); setError(null) }}
                className="px-3 py-2 text-sm font-semibold text-slate-500 hover:text-slate-700">Cancel</button>
              <button onClick={confirmDelete} disabled={deleting}
                className="text-sm font-semibold px-4 py-2 rounded-xl bg-rose-600 text-white hover:bg-rose-700 transition-colors disabled:opacity-50">
                {deleting ? 'Deleting…' : 'Delete cycle'}
              </button>
            </div>
          </ModalShell>
        )}
      </AnimatePresence>
    </>
  )
}
