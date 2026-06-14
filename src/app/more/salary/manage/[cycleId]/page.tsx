'use client'

import React, { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { ArrowLeft, CalendarRange, Users, Send } from 'lucide-react'
import ProtectedLayout from '@/components/ProtectedLayout'
import Avatar from '@/components/Avatar'
import SalaryRecordItemsEditor from '@/components/salary/SalaryRecordItemsEditor'
import { formatINR } from '@/components/bus/FeeCollectionSummary'
import { getRoleDisplayName } from '@/lib/supabase'
import {
  SalaryCycle, SalaryRecord, SalaryCycleStatus, PayoutConfig,
  fetchCycle, fetchCycleRecords, setCycleStatus, salaryNet, formatPeriod,
  fetchPayoutConfig, initiateCyclePayouts,
} from '@/lib/salary'

const CYCLE_FLOW: SalaryCycleStatus[] = ['open', 'processing', 'completed']
const CYCLE_CHIP: Record<SalaryCycleStatus, string> = {
  open: 'bg-slate-100 text-slate-600',
  processing: 'bg-amber-100 text-amber-700',
  completed: 'bg-emerald-100 text-emerald-700',
}

export default function SalaryCycleDetailPage() {
  const params = useParams()
  const cycleId = params.cycleId as string

  const [loading, setLoading] = useState(true)
  const [cycle, setCycle] = useState<SalaryCycle | null>(null)
  const [records, setRecords] = useState<SalaryRecord[]>([])
  const [payoutCfg, setPayoutCfg] = useState<PayoutConfig | null>(null)
  const [busy, setBusy] = useState(false)
  const [disburseMsg, setDisburseMsg] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const [c, recs, cfg] = await Promise.all([
      fetchCycle(cycleId), fetchCycleRecords(cycleId), fetchPayoutConfig(),
    ])
    setCycle(c); setRecords(recs); setPayoutCfg(cfg)
    setLoading(false)
  }, [cycleId])

  useEffect(() => { load() }, [load])

  const totalNet = records.reduce((sum, r) => sum + salaryNet(r), 0)
  const paidCount = records.filter(r => r.status === 'paid').length
  const approvedCount = records.filter(r => r.status === 'approved').length
  const canDisburse = !!payoutCfg?.enabled && payoutCfg.provider !== 'manual' && approvedCount > 0

  const disburse = async () => {
    setBusy(true); setDisburseMsg(null)
    const res = await initiateCyclePayouts(cycleId)
    setBusy(false)
    if (!res.success) { setDisburseMsg(res.error ?? 'Failed to start payouts'); return }
    setDisburseMsg(res.manual
      ? 'Payouts are set to manual — mark each approved record as paid after transferring.'
      : `Initiated ${res.initiated ?? 0} payout(s).`)
    load()
  }

  const changeCycleStatus = async (status: SalaryCycleStatus) => {
    setBusy(true)
    await setCycleStatus(cycleId, status)
    setBusy(false)
    load()
  }

  return (
    <ProtectedLayout adminOnly>
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6">
        <Link href="/more/salary" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 mb-4">
          <ArrowLeft size={16} /> Salary Manager
        </Link>

        {loading ? (
          <div className="text-center py-12"><div className="spinner mx-auto mb-3" /></div>
        ) : !cycle ? (
          <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center text-sm text-slate-500">
            Cycle not found.
          </div>
        ) : (
          <>
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 bg-gradient-to-br from-emerald-500 to-green-600 rounded-xl shadow">
                <CalendarRange className="text-white" size={20} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h1 className="font-display text-2xl font-bold text-slate-800">{formatPeriod(cycle.period_month, cycle.period_year)}</h1>
                  <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${CYCLE_CHIP[cycle.status]}`}>
                    {cycle.status[0].toUpperCase() + cycle.status.slice(1)}
                  </span>
                </div>
                <p className="text-xs text-slate-500">Salary cycle</p>
              </div>
            </div>

            {/* Summary */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 mb-5">
              <div className="grid grid-cols-3 gap-3 text-center">
                <Stat icon={<Users size={15} />} label="Staff" value={String(records.length)} />
                <Stat label="Paid" value={`${paidCount}/${records.length}`} />
                <Stat label="Total net" value={formatINR(totalNet)} />
              </div>
              <div className="flex items-center gap-1.5 mt-4 pt-3 border-t border-slate-100">
                <span className="text-xs text-slate-400 mr-auto">Cycle status</span>
                {CYCLE_FLOW.map(s => (
                  <button key={s} onClick={() => changeCycleStatus(s)} disabled={busy || s === cycle.status}
                    className={`text-[11px] font-medium px-2.5 py-1 rounded-lg border transition-colors ${
                      s === cycle.status ? 'bg-slate-100 border-slate-200 text-slate-400' : 'bg-white border-slate-200 text-slate-600 hover:border-emerald-300'
                    }`}>
                    {s[0].toUpperCase() + s.slice(1)}
                  </button>
                ))}
              </div>
              {canDisburse && (
                <button onClick={disburse} disabled={busy}
                  className="btn-primary text-sm w-full mt-3 flex items-center justify-center gap-2 disabled:opacity-50">
                  <Send size={15} /> {busy ? 'Disbursing…' : `Disburse ${approvedCount} approved via ${payoutCfg?.provider}`}
                </button>
              )}
              {disburseMsg && <p className="text-xs text-slate-500 mt-2 text-center">{disburseMsg}</p>}
            </div>

            {records.length === 0 ? (
              <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center text-sm text-slate-500">
                No staff records in this cycle. Add base salaries for staff, then re-run this month from the Salary Manager.
              </div>
            ) : (
              <div className="space-y-3">
                {records.map(r => (
                  <div key={r.id} className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
                    <div className="flex items-center gap-3 mb-4">
                      <Avatar avatarUrl={r.staff?.avatar_url} name={r.staff?.full_name ?? '?'} size={38} userId={r.staff_id} />
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-slate-800 truncate">{r.staff?.full_name ?? 'Staff'}</p>
                        <p className="text-xs text-slate-400">{r.staff ? getRoleDisplayName(r.staff.role) : ''}</p>
                      </div>
                    </div>
                    <SalaryRecordItemsEditor record={r} onChanged={load} />
                    {r.notes && <p className="text-xs text-slate-400 mt-3 italic">{r.notes}</p>}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </ProtectedLayout>
  )
}

function Stat({ icon, label, value }: { icon?: React.ReactNode; label: string; value: string }) {
  return (
    <div>
      <p className="text-base font-bold text-slate-900 tabular-nums flex items-center justify-center gap-1">
        {icon && <span className="text-slate-400">{icon}</span>}{value}
      </p>
      <p className="text-[11px] text-slate-400 uppercase tracking-wide mt-0.5">{label}</p>
    </div>
  )
}
