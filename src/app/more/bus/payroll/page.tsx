'use client'

import React, { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { AnimatePresence } from 'framer-motion'
import { ArrowLeft, Banknote, Plus } from 'lucide-react'
import ProtectedLayout from '@/components/ProtectedLayout'
import Avatar from '@/components/Avatar'
import PayrollPeriodForm from '@/components/bus/PayrollPeriodForm'
import PayrollItemsEditor from '@/components/bus/PayrollItemsEditor'
import { UserProfile } from '@/lib/supabase'
import { DriverPayroll, fetchAllPayroll, fetchDrivers } from '@/lib/bus'

function fmtPeriod(start: string, end: string): string {
  const f = (d: string) => {
    const [y, m, day] = d.split('-').map(Number)
    return new Date(y, m - 1, day).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }
  return `${f(start)} – ${f(end)}`
}

export default function BusPayrollPage() {
  const [loading, setLoading] = useState(true)
  const [payrolls, setPayrolls] = useState<DriverPayroll[]>([])
  const [drivers, setDrivers] = useState<UserProfile[]>([])
  const [showNew, setShowNew] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const [p, d] = await Promise.all([fetchAllPayroll(), fetchDrivers()])
    setPayrolls(p); setDrivers(d)
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  return (
    <ProtectedLayout adminOnly>
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6">
        <Link href="/more/bus" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 mb-4">
          <ArrowLeft size={16} /> Bus Manager
        </Link>

        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-gradient-to-br from-emerald-500 to-green-600 rounded-xl shadow">
              <Banknote className="text-white" size={20} />
            </div>
            <div>
              <h1 className="font-display text-2xl font-bold text-slate-800">Driver Payroll</h1>
              <p className="text-xs text-slate-500">{payrolls.length} pay period{payrolls.length === 1 ? '' : 's'}</p>
            </div>
          </div>
          <button onClick={() => setShowNew(true)} className="btn-primary flex items-center gap-2 text-sm">
            <Plus size={16} /> New Period
          </button>
        </div>

        {loading ? (
          <div className="text-center py-12"><div className="spinner mx-auto mb-3" /><p className="text-sm text-slate-500">Loading…</p></div>
        ) : payrolls.length === 0 ? (
          <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center">
            <Banknote size={30} className="text-slate-300 mx-auto mb-3" />
            <p className="text-sm text-slate-500 mb-4">No pay periods yet.</p>
            <button onClick={() => setShowNew(true)} className="btn-primary text-sm inline-flex items-center gap-2">
              <Plus size={15} /> New Period
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {payrolls.map(p => (
              <div key={p.id} className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
                <div className="flex items-center gap-3 mb-4">
                  <Avatar avatarUrl={p.driver?.avatar_url} name={p.driver?.full_name ?? '?'} size={38} userId={p.driver_id} />
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-slate-800 truncate">{p.driver?.full_name ?? 'Driver'}</p>
                    <p className="text-xs text-slate-400">{fmtPeriod(p.period_start, p.period_end)}</p>
                  </div>
                </div>
                <PayrollItemsEditor payroll={p} onChanged={load} />
                {p.notes && <p className="text-xs text-slate-400 mt-3 italic">{p.notes}</p>}
              </div>
            ))}
          </div>
        )}

        <AnimatePresence>
          {showNew && (
            <PayrollPeriodForm
              drivers={drivers}
              onClose={() => setShowNew(false)}
              onSaved={() => { setShowNew(false); load() }}
            />
          )}
        </AnimatePresence>
      </div>
    </ProtectedLayout>
  )
}
