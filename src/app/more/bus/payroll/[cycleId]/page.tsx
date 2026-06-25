'use client'

import React, { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import { AnimatePresence, motion } from 'framer-motion'
import { useParams } from 'next/navigation'
import { ArrowLeft, CalendarRange, Users, Send, FileText, Landmark, Table2, Download, X } from 'lucide-react'
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
import { fetchDriverBankAccounts } from '@/lib/bus'
import { SalaryRecord, SalaryCycle, StaffBankAccount } from '@/lib/salary'
import {
  StatementSpec, buildSalaryRegister, buildBankTransferStatement,
} from '@/components/salary/statements/generate'
import { buildBankDisbursementCsv, downloadCsv } from '@/components/salary/statements/csv'

const StatementPreviewModal = dynamic(() => import('@/components/salary/statements/StatementPreviewModal'))

const ADMIN_GOLD = '#B8983C'
const CYCLE_FLOW: DriverCycleStatus[] = ['open', 'processing', 'completed']
const CYCLE_CHIP: Record<DriverCycleStatus, string> = {
  open: 'bg-[#F4F4F5] text-[#71717A] border border-[#E4E4E7]',
  processing: 'bg-[#FBF6E9] text-[#8A6D1F] border border-[#EFE3C4]',
  completed: 'bg-[#27272A] text-white border border-[#27272A]',
}

// ── Adapters: reuse the staff Salary statement/CSV builders for drivers ──────
// Driver records/banks mirror the staff shapes; mapping them lets the driver
// payroll cycle share the salary cycle's Download Centre + bank CSV.
function toSalaryRecord(r: DriverSalaryRecord): SalaryRecord {
  return {
    id: r.id, cycle_id: r.cycle_id, staff_id: r.driver_id,
    base_amount: r.base_amount, status: r.status,
    payout_status: r.payout_status, payout_reference: r.payout_reference,
    notes: r.notes, created_at: r.created_at, updated_at: r.updated_at,
    items: r.items, staff: r.driver ?? null,
  }
}

export default function DriverCycleDetailPage() {
  const params = useParams()
  const cycleId = params.cycleId as string

  const [loading, setLoading] = useState(true)
  const [cycle, setCycle] = useState<DriverCycle | null>(null)
  const [records, setRecords] = useState<DriverSalaryRecord[]>([])
  const [payoutCfg, setPayoutCfg] = useState<PayoutConfig | null>(null)
  const [bankMap, setBankMap] = useState<Record<string, StaffBankAccount>>({})
  const [busy, setBusy] = useState(false)
  const [disburseMsg, setDisburseMsg] = useState<string | null>(null)
  const [pdfBusy, setPdfBusy] = useState<string | null>(null)
  const [preview, setPreview] = useState<{ spec: StatementSpec; title: string } | null>(null)
  const [showDocs, setShowDocs] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const [c, recs, cfg, banks] = await Promise.all([
      fetchDriverCycle(cycleId), fetchDriverCycleRecords(cycleId), fetchPayoutConfig(), fetchDriverBankAccounts(),
    ])
    setCycle(c); setRecords(recs); setPayoutCfg(cfg)
    const bm: Record<string, StaffBankAccount> = {}
    for (const a of banks) bm[a.driver_id] = { ...a, staff_id: a.driver_id } as unknown as StaffBankAccount
    setBankMap(bm)
    setLoading(false)
  }, [cycleId])

  useEffect(() => { load() }, [load])

  const openPdf = async (key: string, title: string, builder: () => Promise<StatementSpec>) => {
    setPdfBusy(key)
    try { setPreview({ spec: await builder(), title }) }
    catch (e) { console.error('pdf failed:', e) }
    setPdfBusy(null)
  }

  const totalNet = records.reduce((sum, r) => sum + driverSalaryNet(r), 0)
  const paidCount = records.filter(r => r.status === 'paid').length
  const approvedCount = records.filter(r => r.status === 'approved').length
  const autoProvider = !!payoutCfg?.enabled && payoutCfg.provider !== 'manual'

  const salaryCycle = cycle ? (cycle as unknown as SalaryCycle) : null
  const salaryRecords = records.map(toSalaryRecord)

  const disburse = async () => {
    setBusy(true); setDisburseMsg(null)
    const res = await initiateDriverCyclePayouts(cycleId)
    setBusy(false)
    if (!res.success) { setDisburseMsg(res.error ?? 'Failed to start payouts'); return }
    setDisburseMsg(res.manual
      ? 'Automated payouts are off — download the bank CSV below, upload it at your bank to disburse, then mark each record as paid.'
      : `Initiated ${res.initiated ?? 0} payout(s) to the linked bank.`)
    load()
  }

  const downloadBankCsv = () => {
    if (!salaryCycle) return
    setDisburseMsg(null)
    const { fileName, rows, included, skipped } = buildBankDisbursementCsv(salaryCycle, salaryRecords, bankMap)
    if (included === 0) {
      setDisburseMsg('No approved records with bank details on file to export. Approve records and add bank accounts first.')
      return
    }
    downloadCsv(fileName, rows)
    setDisburseMsg(
      `Exported ${included} approved record(s) to ${fileName}.csv.` +
      (skipped.length ? ` Skipped (no bank details): ${skipped.join(', ')}.` : ''),
    )
  }

  const changeCycleStatus = async (status: DriverCycleStatus) => {
    setBusy(true)
    await setDriverCycleStatus(cycleId, status)
    setBusy(false)
    load()
  }

  return (
    <ProtectedLayout adminOnly>
      <div data-page-theme="bus" className="bg-[#FAFAFA]" style={{ minHeight: '100vh' }}>
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <Link href="/more/bus?tab=payroll" className="inline-flex items-center gap-1.5 text-sm text-[#71717A] hover:text-[#27272A] mb-4 transition-colors">
            <ArrowLeft size={16} /> Driver Payroll
          </Link>

          {loading ? (
            <div className="text-center py-12"><div className="spinner mx-auto mb-3" /><p className="text-sm text-[#71717A]">Loading cycle…</p></div>
          ) : !cycle ? (
            <div className={`${ADMIN.card} shadow-sm p-8 text-center text-sm text-[#71717A]`}>Cycle not found.</div>
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
                  <p className="text-xs text-[#71717A]">Driver pay cycle</p>
                </div>
                {records.length > 0 && (
                  <button onClick={() => setShowDocs(true)} className={`${ADMIN.darkBtn} flex-shrink-0`}>
                    <Download size={14} /> Download Centre
                  </button>
                )}
              </div>

              {/* Summary */}
              <div className={`${ADMIN.card} shadow-sm p-4 mb-5`}>
                <div className="grid grid-cols-3 gap-3 text-center">
                  <Stat icon={<Users size={15} />} label="Drivers" value={String(records.length)} />
                  <Stat label="Paid" value={`${paidCount}/${records.length}`} />
                  <Stat label="Total net" value={formatINR(totalNet)} />
                </div>
                <div className="flex items-center gap-1.5 mt-4 pt-3 border-t border-[#E4E4E7] flex-wrap">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-[#71717A] mr-auto">Cycle status</span>
                  {CYCLE_FLOW.map(s => (
                    <button key={s} onClick={() => changeCycleStatus(s)} disabled={busy || s === cycle.status}
                      className={`text-[11px] font-semibold px-2.5 py-1 rounded-lg border transition-colors ${
                        s === cycle.status ? 'bg-[#F4F4F5] border-[#E4E4E7] text-[#A1A1AA]' : 'bg-white border-[#E4E4E7] text-[#71717A] hover:text-[#27272A] hover:border-[#D4D4D8]'
                      }`}>
                      {s[0].toUpperCase() + s.slice(1)}
                    </button>
                  ))}
                </div>
                {approvedCount > 0 && (
                  <div className="flex flex-col sm:flex-row gap-2 mt-3">
                    <button onClick={disburse} disabled={busy}
                      className={`${ADMIN.darkBtn} flex-1 !py-2.5 !text-sm`}>
                      <Send size={15} /> {busy ? 'Disbursing…' : autoProvider
                        ? `Pay ${approvedCount} approved via ${payoutCfg?.provider}`
                        : `Disburse ${approvedCount} approved via linked bank`}
                    </button>
                    <button onClick={downloadBankCsv} disabled={busy}
                      className={`${ADMIN.ghostBtn} flex-1 !py-2.5 !text-sm`}>
                      <Table2 size={15} /> Bank CSV
                    </button>
                  </div>
                )}
                {approvedCount === 0 && (
                  <p className="text-xs text-[#A1A1AA] mt-3 text-center">Approve driver records below to enable bank disbursement.</p>
                )}
                {disburseMsg && <p className="text-xs text-[#71717A] mt-2 text-center">{disburseMsg}</p>}
              </div>

              {records.length === 0 ? (
                <div className={`${ADMIN.card} shadow-sm p-8 text-center text-sm text-[#71717A]`}>
                  No driver records in this cycle. Add base salaries for drivers, then re-run this month from Driver Payroll.
                </div>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-2.5">
                  {records.map(r => (
                    <div key={r.id} className={`${ADMIN.card} shadow-sm p-4`}>
                      <div className="flex items-center gap-2.5 mb-3">
                        <Avatar avatarUrl={r.driver?.avatar_url} name={r.driver?.full_name ?? '?'} size={32} userId={r.driver_id} />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-[#18181B] truncate leading-tight">{r.driver?.full_name ?? 'Driver'}</p>
                          <p className="text-[10px] text-[#71717A]">{r.driver ? getRoleDisplayName(r.driver.role) : ''}</p>
                        </div>
                      </div>
                      <DriverSalaryRecordItemsEditor record={r} onChanged={load} />
                      {r.notes && <p className="text-[11px] text-[#A1A1AA] mt-2.5 italic">{r.notes}</p>}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <AnimatePresence>
        {showDocs && salaryCycle && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4 bg-black/60 backdrop-blur-sm"
            onClick={() => setShowDocs(false)}
          >
            <motion.div
              initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 40, opacity: 0 }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              className="bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl w-full sm:max-w-lg overflow-hidden"
              onClick={e => e.stopPropagation()}
            >
              <div className="w-10 h-1 bg-slate-200 rounded-full mx-auto mt-3 mb-1 sm:hidden" />
              <div className="flex items-center justify-between px-5 py-4 border-b border-[#E4E4E7]">
                <div className="min-w-0">
                  <p className="font-bold text-[#18181B] text-sm">Download Centre</p>
                  <p className="text-[11px] text-[#71717A]">{formatPeriod(cycle!.period_month, cycle!.period_year)} · {records.length} record{records.length === 1 ? '' : 's'}</p>
                </div>
                <button onClick={() => setShowDocs(false)} className="p-1.5 text-[#A1A1AA] hover:text-[#27272A] hover:bg-[#F4F4F5] rounded-lg flex-shrink-0">
                  <X size={16} />
                </button>
              </div>
              <div className="p-4">
                <p className="text-[10px] font-bold uppercase tracking-widest text-[#71717A] mb-3">Cycle statements</p>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    disabled={pdfBusy === 'register'}
                    onClick={() => { setShowDocs(false); openPdf('register', 'Driver Salary Register', () => buildSalaryRegister(salaryCycle, salaryRecords)) }}
                    className="flex flex-col items-center justify-center gap-1.5 py-4 rounded-xl border border-[#E4E4E7] bg-white text-[#27272A] hover:border-[#A8896B] hover:bg-[#FBFAF7] hover:-translate-y-0.5 shadow-sm transition-all disabled:opacity-50"
                  >
                    <FileText size={18} className="text-[#A8896B]" />
                    <span className="text-xs font-semibold">{pdfBusy === 'register' ? 'Building…' : 'Salary Register'}</span>
                  </button>
                  <button
                    disabled={pdfBusy === 'bank'}
                    onClick={() => { setShowDocs(false); openPdf('bank', 'Bank Transfer Statement', () => buildBankTransferStatement(salaryCycle, salaryRecords, bankMap)) }}
                    className="flex flex-col items-center justify-center gap-1.5 py-4 rounded-xl border border-[#E4E4E7] bg-white text-[#27272A] hover:border-[#A8896B] hover:bg-[#FBFAF7] hover:-translate-y-0.5 shadow-sm transition-all disabled:opacity-50"
                  >
                    <Landmark size={18} className="text-[#A8896B]" />
                    <span className="text-xs font-semibold">{pdfBusy === 'bank' ? 'Building…' : 'Bank Transfer'}</span>
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
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
