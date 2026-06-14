'use client'

import React, { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { ArrowLeft, Banknote, Landmark } from 'lucide-react'
import DriverLayout from '@/components/DriverLayout'
import { formatINR } from '@/components/bus/FeeCollectionSummary'
import { useAuth } from '@/contexts/AuthContext'
import { DriverBankAccount, fetchMyDriverBankAccount, maskAccountNumber } from '@/lib/bus'
import {
  DriverSalaryRecord, DriverSalaryStatus,
  fetchSalaryForDriver, driverSalaryNet, formatPeriod,
} from '@/lib/driverSalary'

const STATUS_CHIP: Record<DriverSalaryStatus, string> = {
  draft: 'bg-slate-100 text-slate-500',
  approved: 'bg-blue-100 text-blue-700',
  paid: 'bg-emerald-100 text-emerald-700',
}

export default function DriverSalaryPage() {
  const { profile, dataRefreshKey } = useAuth()
  const [loading, setLoading] = useState(true)
  const [records, setRecords] = useState<DriverSalaryRecord[]>([])
  const [bank, setBank] = useState<DriverBankAccount | null>(null)

  const load = useCallback(async () => {
    if (!profile) return
    setLoading(true)
    const [recs, acc] = await Promise.all([
      fetchSalaryForDriver(profile.id),
      fetchMyDriverBankAccount(profile.id),
    ])
    setRecords(recs)
    setBank(acc)
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
          <p className="text-xs text-slate-500">Monthly pay, bonuses &amp; deductions</p>
        </div>
      </div>

      {/* Bank account on file (read-only; admin-managed) */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 mb-4">
        <div className="flex items-center gap-2 mb-2">
          <Landmark size={15} className="text-slate-400" />
          <span className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Bank account on file</span>
        </div>
        {bank ? (
          <div className="text-sm text-slate-700 space-y-0.5">
            <p className="font-medium">{bank.account_holder_name}</p>
            <p className="text-slate-500 tabular-nums">{maskAccountNumber(bank.account_number)} · {bank.ifsc}</p>
            {bank.bank_name && <p className="text-slate-400 text-xs">{bank.bank_name}</p>}
          </div>
        ) : (
          <p className="text-sm text-slate-400">
            No bank account on record yet. Contact the office to add your details for salary disbursement.
          </p>
        )}
      </div>

      {loading ? (
        <div className="text-center py-12"><div className="spinner mx-auto mb-3" /></div>
      ) : records.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-8 text-center">
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-emerald-50 flex items-center justify-center">
            <Banknote size={30} className="text-emerald-500" strokeWidth={1.5} />
          </div>
          <h2 className="text-lg font-semibold text-slate-800 mb-1">No payslips yet</h2>
          <p className="text-sm text-slate-500 max-w-sm mx-auto">
            Your monthly salary will appear here once the office runs a pay cycle.
          </p>
        </div>
      ) : (
        <div className="space-y-3 pb-6">
          {records.map(r => {
            const items = r.items ?? []
            const period = r.cycle ? formatPeriod(r.cycle.period_month, r.cycle.period_year) : 'Salary'
            return (
              <div key={r.id} className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-sm font-semibold text-slate-700">{period}</p>
                  <span className={`text-[11px] font-semibold px-2.5 py-1 rounded-full ${STATUS_CHIP[r.status]}`}>
                    {r.status[0].toUpperCase() + r.status.slice(1)}
                  </span>
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-slate-600">Base salary</span>
                    <span className="text-slate-700 tabular-nums">{formatINR(Number(r.base_amount))}</span>
                  </div>
                  {items.map(it => (
                    <div key={it.id} className="flex items-center justify-between text-sm">
                      <span className="text-slate-600 truncate">{it.label}</span>
                      <span className={`tabular-nums ${Number(it.amount) < 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                        {Number(it.amount) < 0 ? '-' : '+'}{formatINR(Math.abs(Number(it.amount)))}
                      </span>
                    </div>
                  ))}
                  <div className="flex items-center justify-between pt-2 mt-1 border-t border-slate-100">
                    <span className="text-sm font-semibold text-slate-700">Net pay</span>
                    <span className="text-lg font-bold text-slate-900 tabular-nums">{formatINR(driverSalaryNet(r))}</span>
                  </div>
                </div>

                {r.status === 'paid' && r.payout_reference && (
                  <p className="text-[11px] text-emerald-600 mt-3">Disbursed · ref {r.payout_reference}</p>
                )}
                {r.notes && <p className="text-xs text-slate-400 mt-3 italic">{r.notes}</p>}
              </div>
            )
          })}
        </div>
      )}
    </DriverLayout>
  )
}
