'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { AnimatePresence } from 'framer-motion'
import { Plus, ChevronRight, CalendarRange } from 'lucide-react'
import SalaryCycleForm from '@/components/salary/SalaryCycleForm'
import { ADMIN, ADMIN_GOLD, CYCLE_CHIP } from '@/components/salary/adminUi'
import { Sheet, SHEET } from '@/components/bus/adminUI'
import {
  SalaryCycle,
  fetchCycles, fetchCycleRecordCounts, formatPeriod,
} from '@/lib/salary'

export default function PayCyclesSection() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [cycles, setCycles] = useState<SalaryCycle[]>([])
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [showNew, setShowNew] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const [cs, cnt] = await Promise.all([fetchCycles(), fetchCycleRecordCounts()])
    setCycles(cs); setCounts(cnt)
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
              <span className={`${SHEET.headCell} flex-1 ml-12`}>Period</span>
              <span className={`${SHEET.headCell} w-28 flex-shrink-0`}>Status</span>
              <span className={`${SHEET.headCell} w-28 flex-shrink-0`}>Records</span>
              <span className="w-8 flex-shrink-0" />
            </>
          }
        >
          {cycles.map(c => {
            const bar = c.status === 'completed' ? 'bg-[#27272A]' : c.status === 'processing' ? 'bg-[#B8983C]' : 'bg-[#D4D4D8]'
            return (
              <Link key={c.id} href={`/more/salary/manage/${c.id}`} className={SHEET.row}>
                <div className={`${SHEET.bar} ${bar}`} />
                <div className="flex items-center gap-3 flex-1 min-w-0 px-3 py-3">
                  <div className="w-9 h-9 rounded-lg bg-[#27272A] flex items-center justify-center flex-shrink-0">
                    <CalendarRange size={17} style={{ color: ADMIN_GOLD }} />
                  </div>
                  <span className="flex-1 min-w-0 font-semibold text-[#18181B] truncate">{formatPeriod(c.period_month, c.period_year)}</span>
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
        {showNew && (
          <SalaryCycleForm
            onClose={() => setShowNew(false)}
            onSaved={(cycleId) => { setShowNew(false); router.push(`/more/salary/manage/${cycleId}`) }}
          />
        )}
      </AnimatePresence>
    </>
  )
}
