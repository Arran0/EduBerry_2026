'use client'

import React, { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { ArrowLeft, CalendarRange, Users, Send } from 'lucide-react'
import ProtectedLayout from '@/components/ProtectedLayout'
import Avatar from '@/components/Avatar'
import SalaryRecordItemsEditor from '@/components/salary/SalaryRecordItemsEditor'
import { ADMIN, ADMIN_GOLD, CYCLE_CHIP } from '@/components/salary/adminUi'
import { formatINR } from '@/components/bus/FeeCollectionSummary'
import { getRoleDisplayName } from '@/lib/supabase'
import {
  SalaryCycle, SalaryRecord, SalaryCycleStatus, PayoutConfig,
  fetchCycle, fetchCycleRecords, setCycleStatus, salaryNet, formatPeriod,
  fetchPayoutConfig, initiateCyclePayouts,
} from '@/lib/salary'

const CYCLE_FLOW: SalaryCycleStatus[] = ['open', 'processing', 'completed']

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
      <div data-page-theme="admin" style={{ backgroundColor: '#FDFCF9', minHeight: '100vh' }}>
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6">
          <Link href="/more/salary" className="inline-flex items-center gap-1.5 text-sm text-[#71717A] hover:text-[#27272A] mb-4 transition-colors">
            <ArrowLeft size={16} /> Salary Manager
          </Link>

          {loading ? (
            <div className="text-center py-12"><div className="spinner mx-auto mb-3" /><p className="text-sm text-[#71717A]">Loading…</p></div>
          ) : !cycle ? (
            <div className={`${ADMIN.card} shadow-sm p-8 text-center text-sm text-[#71717A]`}>
              Cycle not found.
            </div>
          ) : (
            <>
              <div className="flex items-center gap-3 mb-4">
                <div className="w-11 h-11 rounded-xl bg-[#27272A] flex items-center justify-center flex-shrink-0">
                  <CalendarRange style={{ color: ADMIN_GOLD }} size={20} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h1 className="font-display text-2xl font-bold text-[#18181B]">{formatPeriod(cycle.period_month, cycle.period_year)}</h1>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold uppercase tracking-wide ${CYCLE_CHIP[cycle.status]}`}>
                      {cycle.status[0].toUpperCase() + cycle.status.slice(1)}
                    </span>
                  </div>
                  <p className="text-xs text-[#71717A]">Salary cycle</p>
                </div>
              </div>

              {/* Summary */}
              <div className={`${ADMIN.card} shadow-sm p-4 mb-5`}>
                <div className="grid grid-cols-3 gap-3 text-center">
                  <Stat icon={<Users size={15} />} label="Staff" value={String(records.length)} />
                  <Stat label="Paid" value={`${paidCount}/${records.length}`} />
                  <Stat label="Total net" value={formatINR(totalNet)} />
                </div>
                <div className="flex items-center gap-1.5 mt-4 pt-3 border-t border-[#E4E4E7]">
                  <span className={`${ADMIN.label} mr-auto`}>Cycle status</span>
                  {CYCLE_FLOW.map(s => (
                    <button key={s} onClick={() => changeCycleStatus(s)} disabled={busy || s === cycle.status}
                      className={`text-[11px] font-semibold px-2.5 py-1 rounded-lg border transition-colors ${
                        s === cycle.status ? 'bg-[#F4F4F5] border-[#E4E4E7] text-[#A1A1AA]' : 'bg-white border-[#E4E4E7] text-[#71717A] hover:text-[#27272A] hover:border-[#D4D4D8]'
                      }`}>
                      {s[0].toUpperCase() + s.slice(1)}
                    </button>
                  ))}
                </div>
                {canDisburse && (
                  <button onClick={disburse} disabled={busy}
                    className={`${ADMIN.darkBtn} w-full mt-3 !py-2.5 !text-sm`}>
                    <Send size={15} /> {busy ? 'Disbursing…' : `Disburse ${approvedCount} approved via ${payoutCfg?.provider}`}
                  </button>
                )}
                {disburseMsg && <p className="text-xs text-[#71717A] mt-2 text-center">{disburseMsg}</p>}
              </div>

              {records.length === 0 ? (
                <div className={`${ADMIN.card} shadow-sm p-8 text-center text-sm text-[#71717A]`}>
                  No staff records in this cycle. Add base salaries for staff, then re-run this month from the Salary Manager.
                </div>
              ) : (
                <div className="space-y-2.5">
                  {records.map(r => (
                    <div key={r.id} className={`${ADMIN.card} shadow-sm p-4`}>
                      <div className="flex items-center gap-2.5 mb-3">
                        <Avatar avatarUrl={r.staff?.avatar_url} name={r.staff?.full_name ?? '?'} size={32} userId={r.staff_id} />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-[#18181B] truncate leading-tight">{r.staff?.full_name ?? 'Staff'}</p>
                          <p className="text-[10px] text-[#71717A]">{r.staff ? getRoleDisplayName(r.staff.role) : ''}</p>
                        </div>
                      </div>
                      <SalaryRecordItemsEditor record={r} onChanged={load} />
                      {r.notes && <p className="text-[11px] text-[#A1A1AA] mt-2.5 italic">{r.notes}</p>}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </ProtectedLayout>
  )
}

function Stat({ icon, label, value }: { icon?: React.ReactNode; label: string; value: string }) {
  return (
    <div>
      <p className="text-base font-bold text-[#18181B] tabular-nums flex items-center justify-center gap-1">
        {icon && <span className="text-[#A1A1AA]">{icon}</span>}{value}
      </p>
      <p className="text-[10px] text-[#71717A] uppercase tracking-widest font-bold mt-0.5">{label}</p>
    </div>
  )
}
