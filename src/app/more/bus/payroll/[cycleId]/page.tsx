'use client'

import React, { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { ArrowLeft, CalendarRange, Users, Send, Wallet, CheckCircle2 } from 'lucide-react'
import ProtectedLayout from '@/components/ProtectedLayout'
import Avatar from '@/components/Avatar'
import DriverSalaryRecordItemsEditor from '@/components/bus/DriverSalaryRecordItemsEditor'
import { formatINR } from '@/components/bus/FeeCollectionSummary'
import { ADMIN } from '@/components/bus/adminUI'
import { getRoleDisplayName } from '@/lib/supabase'
import {
  DriverCycle, DriverSalaryRecord, DriverCycleStatus, PayoutConfig,
  fetchDriverCycle, fetchDriverCycleRecords, setDriverCycleStatus, driverSalaryNet, formatPeriod,
  fetchPayoutConfig, initiateDriverCyclePayouts,
} from '@/lib/driverSalary'

const CYCLE_FLOW: DriverCycleStatus[] = ['open', 'processing', 'completed']
const CYCLE_CHIP: Record<DriverCycleStatus, string> = {
  open: 'bg-[#F4F4F5] text-[#71717A]',
  processing: 'bg-[#FBF3DE] text-[#8A6D1F]',
  completed: 'bg-[#27272A] text-white',
}

export default function DriverCycleDetailPage() {
  const params = useParams()
  const cycleId = params.cycleId as string

  const [loading, setLoading] = useState(true)
  const [cycle, setCycle] = useState<DriverCycle | null>(null)
  const [records, setRecords] = useState<DriverSalaryRecord[]>([])
  const [payoutCfg, setPayoutCfg] = useState<PayoutConfig | null>(null)
  const [busy, setBusy] = useState(false)
  const [disburseMsg, setDisburseMsg] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const [c, recs, cfg] = await Promise.all([
      fetchDriverCycle(cycleId), fetchDriverCycleRecords(cycleId), fetchPayoutConfig(),
    ])
    setCycle(c); setRecords(recs); setPayoutCfg(cfg)
    setLoading(false)
  }, [cycleId])

  useEffect(() => { load() }, [load])

  const totalNet = records.reduce((sum, r) => sum + driverSalaryNet(r), 0)
  const paidCount = records.filter(r => r.status === 'paid').length
  const approvedCount = records.filter(r => r.status === 'approved').length
  const canDisburse = !!payoutCfg?.enabled && payoutCfg.provider !== 'manual' && approvedCount > 0

  const disburse = async () => {
    setBusy(true); setDisburseMsg(null)
    const res = await initiateDriverCyclePayouts(cycleId)
    setBusy(false)
    if (!res.success) { setDisburseMsg(res.error ?? 'Failed to start payouts'); return }
    setDisburseMsg(res.manual
      ? 'Payouts are set to manual — mark each approved record as paid after transferring.'
      : `Initiated ${res.initiated ?? 0} payout(s).`)
    load()
  }

  const changeCycleStatus = async (status: DriverCycleStatus) => {
    setBusy(true)
    await setDriverCycleStatus(cycleId, status)
    setBusy(false)
    load()
  }

  return (
    <ProtectedLayout adminOnly>
      <div data-page-theme="bus" style={{ minHeight: '100vh' }}>
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <Link href="/more/bus?tab=payroll" className="inline-flex items-center gap-1.5 text-sm text-[#71717A] hover:text-[#27272A] mb-5">
            <ArrowLeft size={16} /> Driver Payroll
          </Link>

          {loading ? (
            <div className="text-center py-16"><div className="spinner mx-auto mb-3" /><p className="text-sm text-[#71717A]">Loading cycle…</p></div>
          ) : !cycle ? (
            <div className={`${ADMIN.card} p-8 text-center text-sm text-[#71717A]`}>Cycle not found.</div>
          ) : (
            <div className="space-y-4">
              {/* Hero header */}
              <div className="relative overflow-hidden rounded-2xl bg-[#27272A] p-5 sm:p-6">
                <div className="absolute -bottom-8 -right-6 opacity-[0.07] pointer-events-none">
                  <CalendarRange size={150} className="text-white" />
                </div>
                <div className="relative flex items-start gap-4">
                  <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-xl bg-white/10 border border-white/15 flex items-center justify-center flex-shrink-0">
                    <CalendarRange size={24} className="text-[#D8B967]" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h1 className="font-display text-xl sm:text-2xl font-bold text-white truncate">{formatPeriod(cycle.period_month, cycle.period_year)}</h1>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold uppercase tracking-wide ${CYCLE_CHIP[cycle.status]}`}>
                        {cycle.status[0].toUpperCase() + cycle.status.slice(1)}
                      </span>
                    </div>
                    <p className="text-sm text-white/60 mt-0.5">Driver pay cycle</p>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3 text-xs text-white/70">
                      <span className="flex items-center gap-1"><Users size={12} /> {records.length} driver{records.length === 1 ? '' : 's'}</span>
                      <span className="flex items-center gap-1"><CheckCircle2 size={12} /> {paidCount}/{records.length} paid</span>
                      <span>Net total: <strong className="text-white/90 font-semibold tabular-nums">{formatINR(totalNet)}</strong></span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Stat tiles + status flow */}
              <div className="grid grid-cols-3 gap-2.5">
                <StatTile icon={<Users size={15} />} label="Drivers" value={String(records.length)} />
                <StatTile icon={<CheckCircle2 size={15} />} label="Paid" value={`${paidCount}/${records.length}`} />
                <StatTile icon={<Wallet size={15} />} label="Total net" value={formatINR(totalNet)} accent />
              </div>

              <div className={`${ADMIN.card} shadow-sm p-4`}>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-[#71717A] mr-auto">Cycle status</span>
                  {CYCLE_FLOW.map(s => (
                    <button key={s} onClick={() => changeCycleStatus(s)} disabled={busy || s === cycle.status}
                      className={`text-[11px] font-semibold px-2.5 py-1 rounded-lg border transition-colors ${
                        s === cycle.status ? 'bg-[#27272A] border-[#27272A] text-white' : 'bg-white border-[#E4E4E7] text-[#71717A] hover:border-[#27272A] hover:text-[#27272A]'
                      }`}>
                      {s[0].toUpperCase() + s.slice(1)}
                    </button>
                  ))}
                </div>
                {canDisburse && (
                  <button onClick={disburse} disabled={busy}
                    className={`${ADMIN.darkBtn} w-full mt-3 !py-2.5 disabled:opacity-50`}>
                    <Send size={15} /> {busy ? 'Disbursing…' : `Disburse ${approvedCount} approved via ${payoutCfg?.provider}`}
                  </button>
                )}
                {disburseMsg && <p className="text-xs text-[#71717A] mt-2 text-center">{disburseMsg}</p>}
              </div>

              {records.length === 0 ? (
                <div className={`${ADMIN.card} p-8 text-center text-sm text-[#71717A]`}>
                  No driver records in this cycle. Add base salaries for drivers, then re-run this month from Driver Payroll.
                </div>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                  {records.map(r => (
                    <div key={r.id} className={`${ADMIN.card} shadow-sm p-4 sm:p-5`}>
                      <div className="flex items-center gap-3 mb-4 pb-3 border-b border-[#F4F4F5]">
                        <Avatar avatarUrl={r.driver?.avatar_url} name={r.driver?.full_name ?? '?'} size={38} userId={r.driver_id} />
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-[#18181B] truncate">{r.driver?.full_name ?? 'Driver'}</p>
                          <p className="text-xs text-[#A1A1AA]">{r.driver ? getRoleDisplayName(r.driver.role) : ''}</p>
                        </div>
                      </div>
                      <DriverSalaryRecordItemsEditor record={r} onChanged={load} />
                      {r.notes && <p className="text-xs text-[#A1A1AA] mt-3 italic">{r.notes}</p>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </ProtectedLayout>
  )
}

function StatTile({ icon, label, value, accent }: { icon?: React.ReactNode; label: string; value: string; accent?: boolean }) {
  return (
    <div className={`rounded-xl border p-3.5 ${accent ? 'bg-[#27272A] border-[#27272A]' : 'bg-white border-[#E4E4E7]'}`}>
      <p className={`text-lg sm:text-xl font-bold tabular-nums flex items-center gap-1.5 ${accent ? 'text-white' : 'text-[#18181B]'}`}>
        {icon && <span className={accent ? 'text-[#B8983C]' : 'text-[#A1A1AA]'}>{icon}</span>}{value}
      </p>
      <p className={`text-[10px] uppercase tracking-widest font-bold mt-0.5 ${accent ? 'text-[#A1A1AA]' : 'text-[#71717A]'}`}>{label}</p>
    </div>
  )
}
