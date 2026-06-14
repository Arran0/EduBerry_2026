'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { AnimatePresence } from 'framer-motion'
import { Plus, ChevronRight, CalendarRange } from 'lucide-react'
import SalaryCycleForm from '@/components/salary/SalaryCycleForm'
import {
  SalaryCycle, SalaryCycleStatus,
  fetchCycles, fetchCycleRecordCounts, formatPeriod,
} from '@/lib/salary'

const CYCLE_CHIP: Record<SalaryCycleStatus, string> = {
  open: 'bg-slate-100 text-slate-600',
  processing: 'bg-amber-100 text-amber-700',
  completed: 'bg-emerald-100 text-emerald-700',
}

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
        <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Pay cycles</h2>
        <button onClick={() => setShowNew(true)} className="glass-btn" style={{ color: 'var(--page-primary)' }}>
          <Plus size={14} /> Run Cycle
        </button>
      </div>

      {loading ? (
        <div className="text-center py-12"><div className="spinner mx-auto mb-3" /></div>
      ) : cycles.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center">
          <CalendarRange size={30} className="text-slate-300 mx-auto mb-3" />
          <p className="text-sm text-slate-500 mb-4">No pay cycles yet. Set base salaries first, then run a monthly cycle.</p>
          <button onClick={() => setShowNew(true)} className="glass-btn mx-auto" style={{ color: 'var(--page-primary)' }}>
            <Plus size={14} /> Run Cycle
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {cycles.map(c => (
            <Link key={c.id} href={`/more/salary/manage/${c.id}`}
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
                <p className="text-slate-500 text-sm mt-0.5">{counts[c.id] ?? 0} staff record{(counts[c.id] ?? 0) === 1 ? '' : 's'}</p>
              </div>
              <ChevronRight size={18} className="text-slate-400 flex-shrink-0" />
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
