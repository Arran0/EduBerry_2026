'use client'

import React, { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { ArrowLeft, Banknote, Landmark, Wallet } from 'lucide-react'
import DriverLayout from '@/components/DriverLayout'
import { formatINR } from '@/components/bus/FeeCollectionSummary'
import { useAuth } from '@/contexts/AuthContext'
import { DriverBankAccount, fetchMyDriverBankAccount, maskAccountNumber } from '@/lib/bus'
import {
  DriverSalaryRecord, DriverSalaryStatus,
  fetchSalaryForDriver, driverSalaryNet, formatPeriod,
} from '@/lib/driverSalary'

const STATUS_CHIP: Record<DriverSalaryStatus, string> = {
  draft: 'bg-[#F1F4F8] text-[#5B6676]',
  approved: 'bg-[#E8EEF9] text-[#1B3F8A]',
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

  const latestNet = records.length > 0 ? driverSalaryNet(records[0]) : 0

  return (
    <DriverLayout>
      <div className="lg:max-w-3xl">
        <Link
          href="/driver"
          className="inline-flex items-center gap-1.5 h-9 pl-2.5 pr-3.5 mb-4 rounded-full bg-white/70 text-sm font-semibold text-[#13306B] shadow-[inset_0_1px_0_rgba(255,255,255,.9),0_6px_14px_-10px_rgba(19,48,107,.5)] hover:bg-white transition-colors"
        >
          <ArrowLeft size={15} /> Today
        </Link>

        {/* The bus slab, as on the trip screens: navy, yellow stripe. */}
        <div className="bus-slab px-5 pt-5 pb-7 mb-4">
          <div className="absolute -bottom-6 -right-4 opacity-10 pointer-events-none select-none">
            <Wallet size={120} className="text-white" />
          </div>
          <div className="relative z-[1] flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-[#FFC72C] text-[#13306B] flex items-center justify-center shadow-[inset_0_1px_0_rgba(255,255,255,.6)] flex-shrink-0">
              <Banknote size={22} />
            </div>
            <div>
              <h1 className="text-2xl font-bold leading-tight tracking-[-0.015em]">My salary</h1>
              <p className="text-white/70 text-sm">Monthly pay, bonuses and deductions</p>
            </div>
          </div>
          {!loading && records.length > 0 && (
            <div className="relative z-[1] mt-4 pt-4 border-t border-white/15">
              <p className="text-[13px] font-semibold text-white/65">Latest net pay</p>
              <p className="text-[2rem] leading-tight font-bold tracking-[-0.02em] text-[#FFC72C] tabular-nums">{formatINR(latestNet)}</p>
            </div>
          )}
        </div>

        {/* Bank account on file (read-only; admin-managed) */}
        <div className="bus-glass p-4 mb-4">
          <div className="flex items-center gap-2 mb-2">
            <Landmark size={15} className="text-[#2E6BE6]" />
            <span className="text-[13px] font-semibold text-[#5B6676]">Bank account on file</span>
          </div>
          {bank ? (
            <div className="text-sm text-[#13306B] space-y-0.5">
              <p className="font-semibold">{bank.account_holder_name}</p>
              <p className="text-[#5B6676] tabular-nums">{maskAccountNumber(bank.account_number)} · {bank.ifsc}</p>
              {bank.bank_name && <p className="text-[#94A0B1] text-xs">{bank.bank_name}</p>}
            </div>
          ) : (
            <p className="text-sm text-[#5B6676]">
              No bank account on record yet. Contact the office to add your details for salary disbursement.
            </p>
          )}
        </div>

        {loading ? (
          <div className="text-center py-12"><div className="spinner mx-auto mb-3" /></div>
        ) : records.length === 0 ? (
          <div className="bus-glass p-8 text-center">
            <div className="w-14 h-14 mx-auto mb-3 rounded-2xl bg-[#FFC72C] text-[#13306B] flex items-center justify-center shadow-[inset_0_1px_0_rgba(255,255,255,.6)]">
              <Banknote size={26} strokeWidth={1.8} />
            </div>
            <h2 className="text-base font-bold text-[#13306B] mb-1">No payslips yet</h2>
            <p className="text-sm text-[#5B6676] max-w-sm mx-auto">
              Your monthly salary will appear here once the office runs a pay cycle.
            </p>
          </div>
        ) : (
          <div className="space-y-3 pb-6">
            {records.map(r => {
              const items = r.items ?? []
              const period = r.cycle ? formatPeriod(r.cycle.period_month, r.cycle.period_year) : 'Salary'
              return (
                <div key={r.id} className="bus-glass p-5">
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-[15px] font-bold text-[#13306B]">{period}</p>
                    <span className={`text-[11px] font-semibold px-2.5 py-1 rounded-full ${STATUS_CHIP[r.status]}`}>
                      {r.status[0].toUpperCase() + r.status.slice(1)}
                    </span>
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-[#5B6676]">Base salary</span>
                      <span className="text-[#13306B] tabular-nums">{formatINR(Number(r.base_amount))}</span>
                    </div>
                    {items.map(it => (
                      <div key={it.id} className="flex items-center justify-between text-sm">
                        <span className="text-[#5B6676] truncate">{it.label}</span>
                        <span className={`tabular-nums ${Number(it.amount) < 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                          {Number(it.amount) < 0 ? '-' : '+'}{formatINR(Math.abs(Number(it.amount)))}
                        </span>
                      </div>
                    ))}
                    <div className="flex items-center justify-between pt-2 mt-1 border-t border-[#E2E7EE]">
                      <span className="text-sm font-semibold text-[#13306B]">Net pay</span>
                      <span className="text-lg font-bold text-[#13306B] tabular-nums">{formatINR(driverSalaryNet(r))}</span>
                    </div>
                  </div>

                  {r.status === 'paid' && r.payout_reference && (
                    <p className="text-[11px] text-emerald-600 mt-3">Disbursed · ref {r.payout_reference}</p>
                  )}
                  {r.notes && <p className="text-xs text-[#5B6676] mt-3 italic">{r.notes}</p>}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </DriverLayout>
  )
}
