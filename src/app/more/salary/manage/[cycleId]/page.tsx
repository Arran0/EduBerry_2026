'use client'

import React, { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import { AnimatePresence } from 'framer-motion'
import { useParams } from 'next/navigation'
import { ArrowLeft, CalendarRange, Users, Send, FileText, Landmark, Receipt } from 'lucide-react'
import ProtectedLayout from '@/components/ProtectedLayout'
import Avatar from '@/components/Avatar'
import SalaryRecordItemsEditor from '@/components/salary/SalaryRecordItemsEditor'
import { ADMIN, ADMIN_GOLD, CYCLE_CHIP } from '@/components/salary/adminUi'
import { formatINR } from '@/components/bus/FeeCollectionSummary'
import { getRoleDisplayName } from '@/lib/supabase'
import {
  SalaryCycle, SalaryRecord, SalaryCycleStatus, PayoutConfig, StaffBankAccount,
  fetchCycle, fetchCycleRecords, setCycleStatus, salaryNet, formatPeriod,
  fetchPayoutConfig, initiateCyclePayouts, fetchBankAccountsMap,
} from '@/lib/salary'
import {
  StatementSpec, buildSalaryRegister, buildBankTransferStatement, buildPayslip,
} from '@/components/salary/statements/generate'

const StatementPreviewModal = dynamic(() => import('@/components/salary/statements/StatementPreviewModal'))

const CYCLE_FLOW: SalaryCycleStatus[] = ['open', 'processing', 'completed']

export default function SalaryCycleDetailPage() {
  const params = useParams()
  const cycleId = params.cycleId as string

  const [loading, setLoading] = useState(true)
  const [cycle, setCycle] = useState<SalaryCycle | null>(null)
  const [records, setRecords] = useState<SalaryRecord[]>([])
  const [payoutCfg, setPayoutCfg] = useState<PayoutConfig | null>(null)
  const [bankMap, setBankMap] = useState<Record<string, StaffBankAccount>>({})
  const [busy, setBusy] = useState(false)
  const [disburseMsg, setDisburseMsg] = useState<string | null>(null)
  const [pdfBusy, setPdfBusy] = useState<string | null>(null)
  const [preview, setPreview] = useState<{ spec: StatementSpec; title: string } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const [c, recs, cfg, bm] = await Promise.all([
      fetchCycle(cycleId), fetchCycleRecords(cycleId), fetchPayoutConfig(), fetchBankAccountsMap(),
    ])
    setCycle(c); setRecords(recs); setPayoutCfg(cfg); setBankMap(bm)
    setLoading(false)
  }, [cycleId])

  const openPdf = async (key: string, title: string, builder: () => Promise<StatementSpec>) => {
    setPdfBusy(key)
    try { setPreview({ spec: await builder(), title }) }
    catch (e) { console.error('pdf failed:', e) }
    setPdfBusy(null)
  }

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
      <div data-page-theme="salary" style={{ minHeight: '100vh' }}>
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

              {/* Download statements for this cycle */}
              {records.length > 0 && (
                <div className={`${ADMIN.card} shadow-sm p-4 mb-5`}>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-[#71717A] mb-3">Statements</p>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      disabled={pdfBusy === 'register'}
                      onClick={() => openPdf('register', 'Salary Register', () => buildSalaryRegister(cycle!, records))}
                      className="flex items-center justify-center gap-1.5 bg-[#27272A] hover:bg-[#18181B] text-white text-xs font-semibold px-3 py-2.5 rounded-lg transition-colors disabled:opacity-50"
                    >
                      <FileText size={13} /> {pdfBusy === 'register' ? 'Building…' : 'Salary Register'}
                    </button>
                    <button
                      disabled={pdfBusy === 'bank'}
                      onClick={() => openPdf('bank', 'Bank Transfer Statement', () => buildBankTransferStatement(cycle!, records, bankMap))}
                      className="flex items-center justify-center gap-1.5 bg-white border border-[#E4E4E7] text-[#27272A] hover:border-[#D4D4D8] text-xs font-semibold px-3 py-2.5 rounded-lg transition-colors disabled:opacity-50"
                    >
                      <Landmark size={13} /> {pdfBusy === 'bank' ? 'Building…' : 'Bank Transfer'}
                    </button>
                  </div>
                </div>
              )}

              {records.length === 0 ? (
                <div className={`${ADMIN.card} shadow-sm p-8 text-center text-sm text-[#71717A]`}>
                  No staff records in this cycle. Add base salaries for staff, then re-run this month from the Salary Manager.
                </div>
              ) : (
                <div className="space-y-2.5">
                  {records.map(r => {
                    const staffLike = r.staff ? { full_name: r.staff.full_name, email: r.staff.email, role: r.staff.role } : undefined
                    const key = `payslip-${r.id}`
                    return (
                      <div key={r.id} className={`${ADMIN.card} shadow-sm p-4`}>
                        <div className="flex items-center gap-2.5 mb-3">
                          <Avatar avatarUrl={r.staff?.avatar_url} name={r.staff?.full_name ?? '?'} size={32} userId={r.staff_id} />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-[#18181B] truncate leading-tight">{r.staff?.full_name ?? 'Staff'}</p>
                            <p className="text-[10px] text-[#71717A]">{r.staff ? getRoleDisplayName(r.staff.role) : ''}</p>
                          </div>
                          <button
                            disabled={pdfBusy === key}
                            onClick={() => openPdf(key, `Payslip — ${r.staff?.full_name ?? 'Staff'}`, () => buildPayslip(r, staffLike, bankMap[r.staff_id]))}
                            className="flex items-center gap-1 text-[11px] font-semibold text-[#71717A] hover:text-[#27272A] border border-[#E4E4E7] hover:border-[#D4D4D8] px-2.5 py-1.5 rounded-lg transition-colors disabled:opacity-50 flex-shrink-0"
                          >
                            <Receipt size={12} /> {pdfBusy === key ? '…' : 'Payslip'}
                          </button>
                        </div>
                        <SalaryRecordItemsEditor record={r} onChanged={load} />
                        {r.notes && <p className="text-[11px] text-[#A1A1AA] mt-2.5 italic">{r.notes}</p>}
                      </div>
                    )
                  })}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <AnimatePresence>
        {preview && (
          <StatementPreviewModal spec={preview.spec} title={preview.title} onClose={() => setPreview(null)} />
        )}
      </AnimatePresence>
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
