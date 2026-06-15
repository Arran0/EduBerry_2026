'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { AnimatePresence } from 'framer-motion'
import { Plus, ChevronRight, CalendarRange } from 'lucide-react'
import SalaryCycleForm from '@/components/salary/SalaryCycleForm'
import { ADMIN, ADMIN_GOLD, CYCLE_CHIP } from '@/components/salary/adminUi'
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
          <Plus size={14} /> Run Cycle
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
            <Plus size={14} /> Run Cycle
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-2.5">
          {cycles.map(c => (
            <Link key={c.id} href={`/more/salary/manage/${c.id}`}
              className={`${ADMIN.card} shadow-sm hover:shadow-md transition-shadow flex items-center gap-3 p-3.5 sm:p-4`}>
              <div className="w-10 h-10 sm:w-11 sm:h-11 rounded-lg bg-[#27272A] flex items-center justify-center flex-shrink-0">
                <CalendarRange size={18} style={{ color: ADMIN_GOLD }} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-[#18181B]">{formatPeriod(c.period_month, c.period_year)}</span>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold uppercase tracking-wide ${CYCLE_CHIP[c.status]}`}>
                    {c.status[0].toUpperCase() + c.status.slice(1)}
                  </span>
                </div>
                <p className="text-[#71717A] text-xs mt-0.5">{counts[c.id] ?? 0} staff record{(counts[c.id] ?? 0) === 1 ? '' : 's'}</p>
              </div>
              <ChevronRight size={16} className="text-[#D4D4D8] flex-shrink-0" />
            </Link>
          ))}
        </div>
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
