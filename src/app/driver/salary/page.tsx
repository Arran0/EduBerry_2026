'use client'

import React, { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { ArrowLeft, Banknote } from 'lucide-react'
import DriverLayout from '@/components/DriverLayout'
import { formatINR } from '@/components/bus/FeeCollectionSummary'
import { useAuth } from '@/contexts/AuthContext'
import { DriverPayroll, PayrollStatus, fetchPayrollForDriver, payrollNet } from '@/lib/bus'

const STATUS_CHIP: Record<PayrollStatus, string> = {
  draft: 'bg-slate-100 text-slate-500',
  approved: 'bg-blue-100 text-blue-700',
  paid: 'bg-emerald-100 text-emerald-700',
}

function fmtPeriod(start: string, end: string): string {
  const f = (d: string) => {
    const [y, m, day] = d.split('-').map(Number)
    return new Date(y, m - 1, day).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }
  return `${f(start)} – ${f(end)}`
}

export default function DriverSalaryPage() {
  const { profile, dataRefreshKey } = useAuth()
  const [loading, setLoading] = useState(true)
  const [payrolls, setPayrolls] = useState<DriverPayroll[]>([])

  const load = useCallback(async () => {
    if (!profile) return
    setLoading(true)
    setPayrolls(await fetchPayrollForDriver(profile.id))
    setLoading(false)
  }, [profile])

  useEffect(() => { load() }, [load, dataRefreshKey])

  return (
    <DriverLayout>
      <Link href="/driver" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 mb-4">
        <ArrowLeft size={16} /> Dashboard
      </Link>

      <div className="flex items-center gap-3 mb-5">
        <div className="p-2 bg-gradient-to-br from-emerald-500 to-green-600 rounded-xl shadow">
          <Banknote className="text-white" size={20} />
        </div>
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-800">My Salary</h1>
          <p className="text-xs text-slate-500">Your pay periods</p>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-12"><div className="spinner mx-auto mb-3" /></div>
      ) : payrolls.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-8 text-center">
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-emerald-50 flex items-center justify-center">
            <Banknote size={30} className="text-emerald-500" strokeWidth={1.5} />
          </div>
          <h2 className="text-lg font-semibold text-slate-800 mb-1">No payslips yet</h2>
          <p className="text-sm text-slate-500 max-w-sm mx-auto">Your pay periods will appear here once the office sets them up.</p>
        </div>
      ) : (
        <div className="space-y-3 pb-6">
          {payrolls.map(p => {
            const items = p.items ?? []
            return (
              <div key={p.id} className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-sm font-semibold text-slate-700">{fmtPeriod(p.period_start, p.period_end)}</p>
                  <span className={`text-[11px] font-semibold px-2.5 py-1 rounded-full ${STATUS_CHIP[p.status]}`}>
                    {p.status[0].toUpperCase() + p.status.slice(1)}
                  </span>
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-slate-600">Base</span>
                    <span className="text-slate-700 tabular-nums">{formatINR(Number(p.base_amount))}</span>
                  </div>
                  {items.map(it => (
                    <div key={it.id} className="flex items-center justify-between text-sm">
                      <span className="text-slate-600 truncate">{it.label}</span>
                      <span className={`tabular-nums ${Number(it.amount) < 0 ? 'text-rose-600' : 'text-slate-700'}`}>
                        {Number(it.amount) < 0 ? '-' : '+'}{formatINR(Math.abs(Number(it.amount)))}
                      </span>
                    </div>
                  ))}
                  <div className="flex items-center justify-between pt-2 mt-1 border-t border-slate-100">
                    <span className="text-sm font-semibold text-slate-700">Net pay</span>
                    <span className="text-lg font-bold text-slate-900 tabular-nums">{formatINR(payrollNet(p))}</span>
                  </div>
                </div>

                {p.notes && <p className="text-xs text-slate-400 mt-3 italic">{p.notes}</p>}
              </div>
            )
          })}
        </div>
      )}
    </DriverLayout>
  )
}
