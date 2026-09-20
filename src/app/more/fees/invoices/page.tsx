'use client'

// Every bill, and where new ones are generated.
//
// The generation panel shows each installment, whether auto-generation is on,
// and — before anything is written — how many bills a run would create and who
// it would skip and why. That preview calls the same function the commit does.

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  AlertTriangle, Check, FileText, Loader2, Play, Search, Ban,
} from 'lucide-react'
import ProtectedLayout from '@/components/ProtectedLayout'
import ModalShell from '@/components/ui/ModalShell'
import { AcademicYearProvider, useAcademicYear } from '@/contexts/AcademicYearContext'
import { useFeePermissions } from '@/hooks/useFeePermissions'
import { ADMIN, INVOICE_CHIP, INVOICE_LABEL, fmtDate, inr } from '@/components/fees/ui'
import YearScope from '@/components/fees/config/YearScope'
import { FeeScreen } from '@/components/fees/shell'
import NoAccess from '@/components/fees/NoAccess'
import { supabase } from '@/lib/supabase'
import { fetchFeeConfig, setAutogen, type FeeConfigBundle } from '@/lib/fees/config'
import {
  cancelInvoice, fetchInvoices, generateInvoices,
  type GenerateResult, type InvoiceRow, type InvoiceStatus,
} from '@/lib/fees/invoices'

const FILTERS: { key: InvoiceStatus | 'all'; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'pending', label: 'Pending' },
  { key: 'overdue', label: 'Overdue' },
  { key: 'partly_paid', label: 'Partly paid' },
  { key: 'paid', label: 'Paid' },
  { key: 'cancelled', label: 'Cancelled' },
]

function InvoicesInner() {
  const { year } = useAcademicYear()
  const perms = useFeePermissions()
  const [invoices, setInvoices] = useState<InvoiceRow[]>([])
  const [names, setNames] = useState<Map<string, string>>(new Map())
  const [config, setConfig] = useState<FeeConfigBundle | null>(null)
  const [filter, setFilter] = useState<InvoiceStatus | 'all'>('all')
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState<string | null>(null)
  const [cancelling, setCancelling] = useState<InvoiceRow | null>(null)
  const [error, setError] = useState<string | null>(null)

  const showAmounts = !perms.amountsHidden

  const load = useCallback(async () => {
    if (!year) return
    setLoading(true)
    try {
      const [inv, cfg] = await Promise.all([
        fetchInvoices({ academicYearId: year.id }),
        fetchFeeConfig(year.id),
      ])
      setInvoices(inv)
      setConfig(cfg)

      const ids = [...new Set(inv.map(i => i.student_id))]
      const map = new Map<string, string>()
      for (let i = 0; i < ids.length; i += 300) {
        const { data } = await supabase.from('profiles')
          .select('id, full_name').in('id', ids.slice(i, i + 300))
        for (const r of data ?? []) map.set(r.id as string, r.full_name as string)
      }
      setNames(map)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load bills.')
    } finally {
      setLoading(false)
    }
  }, [year])

  useEffect(() => { void load() }, [load])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return invoices.filter(i =>
      (filter === 'all' || i.status === filter) &&
      (!q || i.number.toLowerCase().includes(q) ||
        (names.get(i.student_id) ?? '').toLowerCase().includes(q)))
  }, [invoices, filter, query, names])

  if (perms.loading) {
    return <div className="p-10 flex justify-center"><Loader2 className="animate-spin text-[#8C8878]" /></div>
  }
  if (!perms.can('fees.profile.view')) return <NoAccess what="see bills" />

  return (
    <FeeScreen
      title="Bills"
      subtitle={<>{invoices.length} issued for {year?.code}</>}
      icon={<FileText size={17} style={{ color: '#B8983C' }} />}
      back={{ href: '/more/fees', label: 'Fees' }}
      actions={<YearScope />}
    >
      {error && (
        <div className="bg-[#FCECEC] border border-[#EFCCCC] text-[#A93232] text-sm px-4 py-3 ">{error}</div>
      )}

      {perms.can('fees.invoice.generate') && config && (
        <GenerationPanel
          config={config}
          canAutogen={perms.can('fees.invoice.autogen')}
          showAmounts={showAmounts}
          generating={generating}
          setGenerating={setGenerating}
          onDone={() => void load()}
          onError={setError}
        />
      )}

      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-[220px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8C8878]" />
          <input value={query} onChange={e => setQuery(e.target.value)}
                 placeholder="Bill number or student" className={ADMIN.input} />
        </div>
        <div className="flex gap-1 flex-wrap">
          {FILTERS.map(f => (
            <button key={f.key} onClick={() => setFilter(f.key)}
                    className={filter === f.key
                      ? 'px-2.5 py-1.5 text-xs font-semibold bg-[#27272A] text-white'
                      : 'px-2.5 py-1.5 text-xs font-semibold bg-white border border-[#E3DFD3] text-[#6B675A] hover:text-[#18181B]'}>
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className={`${ADMIN.card} py-16 flex justify-center`}><Loader2 className="animate-spin text-[#8C8878]" /></div>
      ) : filtered.length === 0 ? (
        <div className={`${ADMIN.card} py-16 text-center`}>
          <p className="text-sm text-[#8C8878]">
            {invoices.length === 0 ? 'No bills issued yet this session.' : 'No bills match that.'}
          </p>
        </div>
      ) : (
        <div className={`${ADMIN.card} overflow-hidden`}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[#FAF8F2] border-b border-[#E3DFD3]">
                  <th className="text-left px-4 py-2.5 text-[10px] font-bold uppercase tracking-widest text-[#6B675A]">Bill</th>
                  <th className="text-left px-4 py-2.5 text-[10px] font-bold uppercase tracking-widest text-[#6B675A]">Student</th>
                  <th className="text-left px-4 py-2.5 text-[10px] font-bold uppercase tracking-widest text-[#6B675A]">Due</th>
                  <th className="text-left px-4 py-2.5 text-[10px] font-bold uppercase tracking-widest text-[#6B675A]">Status</th>
                  <th className="text-right px-4 py-2.5 text-[10px] font-bold uppercase tracking-widest text-[#6B675A]">Total</th>
                  <th className="text-right px-4 py-2.5 text-[10px] font-bold uppercase tracking-widest text-[#6B675A]">Due</th>
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0, 300).map(i => (
                  <tr key={i.id} className="border-b border-[#F0ECE2] last:border-0 hover:bg-[#FAF8F2]">
                    <td className="px-4 py-2.5 font-mono text-xs text-[#6B675A]">{i.number}</td>
                    <td className="px-4 py-2.5">
                      <Link href={`/more/fees/students/${i.student_id}`}
                            className="text-[#18181B] hover:underline">
                        {names.get(i.student_id) ?? '—'}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 text-[#6B675A]">{fmtDate(i.due_date)}</td>
                    <td className="px-4 py-2.5">
                      <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${INVOICE_CHIP[i.status]}`}>
                        {INVOICE_LABEL[i.status]}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right text-[#6B675A]">{inr(i.net, showAmounts)}</td>
                    <td className={`px-4 py-2.5 text-right font-semibold ${
                      (i.balance ?? 0) > 0 ? 'text-[#7A6220]' : 'text-[#8C8878]'}`}>
                      {inr(i.balance, showAmounts)}
                    </td>
                    <td className="px-2">
                      {perms.can('fees.invoice.cancel') && i.status !== 'cancelled' && (i.paid ?? 0) === 0 && (
                        <button onClick={() => setCancelling(i)} title="Cancel this bill"
                                className="p-1.5 text-[#C9C4B4] hover:text-[#A93232]">
                          <Ban size={13} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {filtered.length > 300 && (
            <p className="px-4 py-3 text-xs text-[#8C8878] border-t border-[#F0ECE2]">
              Showing the first 300 of {filtered.length}. Narrow the search to see the rest.
            </p>
          )}
        </div>
      )}


      {cancelling && (
        <CancelDialog
          invoice={cancelling}
          showAmounts={showAmounts}
          onClose={() => setCancelling(null)}
          onDone={() => { setCancelling(null); void load() }}
        />
      )}
    </FeeScreen>
  )
}

function GenerationPanel({
  config, canAutogen, showAmounts, generating, setGenerating, onDone, onError,
}: {
  config: FeeConfigBundle
  canAutogen: boolean
  showAmounts: boolean
  generating: string | null
  setGenerating: (id: string | null) => void
  onDone: () => void
  onError: (m: string | null) => void
}) {
  const [preview, setPreview] = useState<Record<string, GenerateResult>>({})

  const published = config.structures.filter(s => s.status === 'published')
  const rows = config.installments
    .filter(i => published.some(s => s.id === i.structure_id))
    .sort((a, b) => a.due_date.localeCompare(b.due_date))

  const structureName = (id: string) => config.structures.find(s => s.id === id)?.name ?? '—'

  const run = async (installmentId: string, commit: boolean) => {
    setGenerating(installmentId); onError(null)
    try {
      const result = await generateInvoices(installmentId, commit)
      if (commit) {
        setPreview(p => { const next = { ...p }; delete next[installmentId]; return next })
        onDone()
      } else {
        setPreview(p => ({ ...p, [installmentId]: result }))
      }
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Could not generate those bills.')
    } finally {
      setGenerating(null)
    }
  }

  if (rows.length === 0) {
    return (
      <div className={`${ADMIN.card} p-5`}>
        <p className="text-sm text-[#6B675A]">
          No published structure has an installment to bill. Build the price list in{' '}
          <Link href="/more/fees/config" className="underline">Fee Configuration</Link>, then publish it.
        </p>
      </div>
    )
  }

  return (
    <div className={`${ADMIN.card} p-4`}>
      <h3 className="text-sm font-bold text-[#18181B] mb-1">Generate bills</h3>
      <p className="text-xs text-[#8C8878] mb-3">
        Preview first — it counts exactly what a run would do without writing anything. Running
        twice never bills a family twice.
      </p>

      <div className="space-y-2">
        {rows.map(i => {
          const p = preview[i.id]
          const busy = generating === i.id
          return (
            <div key={i.id} className="border border-[#E3DFD3] p-3">
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex-1 min-w-[200px]">
                  <div className="text-sm font-medium text-[#18181B]">
                    {i.name} <span className="text-[#8C8878] font-normal">· {structureName(i.structure_id)}</span>
                  </div>
                  <div className="text-xs text-[#8C8878]">
                    due {fmtDate(i.due_date)}
                    {i.percent !== null ? ` · ${Number(i.percent)}% of the year` : ''}
                    {i.amount !== null ? ` · ${inr(i.amount, showAmounts)}` : ''}
                  </div>
                </div>

                {canAutogen && (
                  <button
                    onClick={() => void setAutogen(i.id, !i.autogen_enabled, i.autogen_days_before).then(onDone)}
                    title={i.autogen_enabled
                      ? `Generates itself ${i.autogen_days_before} days before the due date`
                      : 'Generated by hand'}
                    className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded ${
                      i.autogen_enabled
                        ? 'bg-[#EAF5EE] text-[#1F6B42] border border-[#C6E3D2]'
                        : 'bg-white text-[#8C8878] border border-[#E3DFD3] hover:border-[#C9C4B4]'
                    }`}
                  >
                    {i.autogen_enabled ? `Auto −${i.autogen_days_before}d` : 'Manual'}
                  </button>
                )}

                {p ? (
                  <button onClick={() => void run(i.id, true)} disabled={busy || p.will_create === 0}
                          className={ADMIN.darkBtn}>
                    {busy ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                    Generate {p.will_create}
                  </button>
                ) : (
                  <button onClick={() => void run(i.id, false)} disabled={busy} className={ADMIN.ghostBtn}>
                    {busy ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
                    Preview
                  </button>
                )}
              </div>

              {p && (
                <div className="mt-2.5 pt-2.5 border-t border-[#F0ECE2] text-xs text-[#6B675A] space-y-1">
                  <p>
                    <strong className="text-[#18181B]">{p.will_create}</strong> new bill
                    {p.will_create === 1 ? '' : 's'} at {inr(p.per_student, showAmounts)} each
                    {showAmounts && p.total_amount > 0 ? ` — ${inr(p.total_amount)} in total` : ''}.
                  </p>
                  {Object.keys(p.by_group).length > 0 && (
                    <p>
                      By group: {Object.entries(p.by_group).map(([g, n]) => `${g} ${n}`).join(' · ')}
                    </p>
                  )}
                  {p.already_billed > 0 && <p>Skipping {p.already_billed} already billed.</p>}
                  {p.skipped_rte > 0 && <p>Skipping {p.skipped_rte} RTE.</p>}
                  {p.skipped_joined_late > 0 && (
                    <p>Skipping {p.skipped_joined_late} who joined after this term ended.</p>
                  )}
                  {p.will_create === 0 && (
                    <p className="text-[#8C8878]">Nothing to do — everyone eligible already has this bill.</p>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function CancelDialog({
  invoice, showAmounts, onClose, onDone,
}: { invoice: InvoiceRow; showAmounts: boolean; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    setBusy(true); setError(null)
    try { await cancelInvoice(invoice.id, reason); onDone() }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not cancel that bill.') }
    finally { setBusy(false) }
  }

  return (
    <ModalShell onClose={onClose} sharp size="sm" title={`Cancel ${invoice.number}`}>
      <div className="space-y-4">
        <div className="bg-[#FAF3DF] border border-[#E7D9AE] text-[#7A6220] text-sm px-4 py-3 flex items-start gap-2">
          <AlertTriangle size={15} className="mt-0.5 flex-shrink-0" />
          <span>
            This bill for {inr(invoice.net, showAmounts)} will be marked cancelled and stop counting
            towards what the family owes. It is kept, not deleted, and its QR will say so.
          </span>
        </div>
        <div>
          <label className={`${ADMIN.label} block mb-1.5`}>Why?</label>
          <textarea value={reason} onChange={e => setReason(e.target.value)} rows={3}
                    placeholder="Issued in error — the student had already withdrawn"
                    className={`${ADMIN.inputPlain} resize-none`} autoFocus />
        </div>
        {error && (
          <div className="bg-[#FCECEC] border border-[#EFCCCC] text-[#A93232] text-sm px-4 py-3 ">{error}</div>
        )}
        <div className="flex gap-2">
          <button onClick={() => void submit()} disabled={busy || reason.trim().length < 3}
                  className={`${ADMIN.darkBtn} flex-1 py-2.5`}>
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Ban size={13} />} Cancel the bill
          </button>
          <button onClick={onClose} className={ADMIN.ghostBtn}>Keep it</button>
        </div>
      </div>
    </ModalShell>
  )
}

export default function FeeInvoicesPage() {
  return (
    <ProtectedLayout staffOnly>
      <AcademicYearProvider>
        <InvoicesInner />
      </AcademicYearProvider>
    </ProtectedLayout>
  )
}
