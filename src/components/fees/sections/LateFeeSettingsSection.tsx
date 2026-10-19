'use client'

// ─────────────────────────────────────────────────────────────────────────────
// Late-fee settings — the rules, and the sweep that applies them.
//
// This is policy, so it lives with the price list: a popup off Fee
// Configuration rather than a tab of its own. What the rules have actually
// charged is a different question, asked by different people on a different
// day, and it is answered in the Collection Center's Late fees popup.
//
// The sweep always previews first — the same function with commit off — so the
// number on screen is the number that will be charged, not an estimate of it.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { CheckCircle2, Loader2, Play, Plus, Power } from 'lucide-react'
import { useAcademicYear } from '@/contexts/AcademicYearContext'
import { useFeePermissions } from '@/hooks/useFeePermissions'
import { ADMIN, fmtDate, inr } from '@/components/fees/ui'
import { CELL, Row, StatStrip } from '@/components/fees/shell'
import NoAccess from '@/components/fees/NoAccess'
import LateFeeRuleBuilder, { type ScopeOption } from '@/components/fees/charges/LateFeeRuleBuilder'
import { gradeLabel } from '@/lib/grades'
import { fetchFeeConfig, type FeeConfigBundle } from '@/lib/fees/config'
import { fetchUnpaidInvoices, type InvoiceRow } from '@/lib/fees/invoices'
import {
  fetchLateFeeRules, runLateFeeSweep, setLateFeeRuleEnabled,
  type LateFeeRuleRow, type SweepResult,
} from '@/lib/fees/charges'

/** The rule list's columns on a laptop; a phone folds each row into a card. */
const RULE_COLS = 'sm:grid-cols-[minmax(0,240px)_minmax(0,1fr)_72px_184px]'

export default function LateFeeSettingsSection({ onChanged }: { onChanged?: () => void }) {
  const { year } = useAcademicYear()
  const perms = useFeePermissions()

  const [config, setConfig] = useState<FeeConfigBundle | null>(null)
  const [rules, setRules] = useState<LateFeeRuleRow[]>([])
  const [invoices, setInvoices] = useState<InvoiceRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [editing, setEditing] = useState<LateFeeRuleRow | null | 'new'>(null)
  const [sweep, setSweep] = useState<SweepResult | null>(null)
  const [sweeping, setSweeping] = useState(false)

  const showAmounts = !perms.amountsHidden
  const canManage = perms.can('fees.latefee.manage')

  const load = useCallback(async () => {
    if (!year) return
    setLoading(true)
    try {
      const [cfg, rs, inv] = await Promise.all([
        fetchFeeConfig(year.id),
        fetchLateFeeRules(year.id),
        fetchUnpaidInvoices(year.id),
      ])
      setConfig(cfg); setRules(rs); setInvoices(inv)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the late-fee rules.')
    } finally {
      setLoading(false)
    }
  }, [year])

  useEffect(() => { void load() }, [load])

  const scopes: ScopeOption[] = useMemo(() => {
    if (!config) return []
    const structureName = (id: string) => {
      const s = config.structures.find(x => x.id === id)
      return s ? `${s.name}${s.grade !== null ? ` · ${gradeLabel(s.grade)}` : ''}` : 'Structure'
    }
    return [
      ...config.groups.map(g => ({ id: g.id, label: g.name, kind: 'group' as const })),
      ...config.structures.map(s => ({ id: s.id, label: structureName(s.id), kind: 'structure' as const })),
      ...config.installments.map(i => ({
        id: i.id, label: `${structureName(i.structure_id)} — ${i.name}`, kind: 'installment' as const,
      })),
    ]
  }, [config])

  // A real bill, so the builder's sample is this school's own number rather
  // than a round figure that flatters the rule.
  const sampleBill = useMemo(() => {
    const nets = invoices.map(i => Number(i.net ?? 0)).filter(n => n > 0).sort((a, b) => a - b)
    if (nets.length === 0) return 10000
    return Math.round(nets[Math.floor(nets.length / 2)])
  }, [invoices])

  const runSweep = async (commit: boolean) => {
    if (!year) return
    setSweeping(true)
    setError(null)
    try {
      const result = await runLateFeeSweep(year.id, commit)
      setSweep(result)
      if (commit) { await load(); onChanged?.() }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The sweep could not run.')
    } finally {
      setSweeping(false)
    }
  }

  const toggleRule = async (rule: LateFeeRuleRow) => {
    try {
      await setLateFeeRuleEnabled(rule.id, !rule.enabled)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not change the rule.')
    }
  }

  if (perms.loading) {
    return <div className="p-10 flex justify-center"><Loader2 className="animate-spin text-slate-500" /></div>
  }
  if (!canManage) return <NoAccess what="manage late fees" />

  if (loading) {
    return <div className="p-10 flex justify-center"><Loader2 className="animate-spin text-slate-500" /></div>
  }

  return (
    <>
      {error && (
        <div className="p-3 bg-[#FCECEC] border border-[#EFCCCC] text-[11px] text-[#A93232]">{error}</div>
      )}

      <div className={`${ADMIN.card} p-4 flex flex-wrap items-start gap-3`}>
        <div className="flex-1 min-w-[240px]">
          <h2 className="text-[13px] font-bold text-slate-900">The nightly sweep</h2>
          <p className="text-[12px] text-slate-500 mt-1 leading-relaxed">
            Runs on its own every night. Preview it here first — the preview is the same
            calculation with committing switched off, so what it shows is what it will charge.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => void runSweep(false)} disabled={sweeping} className={ADMIN.ghostBtn}>
            {sweeping ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
            Preview
          </button>
          <button onClick={() => void runSweep(true)}
                  disabled={sweeping || !sweep || sweep.bills === 0}
                  title={!sweep ? 'Preview it first' : undefined}
                  className={ADMIN.darkBtn}>
            Charge now
          </button>
        </div>
      </div>

      {sweep && (
        <div className={`${ADMIN.card} p-4`}>
          <div className="flex items-center gap-2">
            {sweep.committed
              ? <CheckCircle2 size={14} className="text-[#1F6B42]" />
              : <Play size={14} className="text-slate-500" />}
            <span className="text-[13px] font-semibold text-slate-900">
              {sweep.committed ? 'Charged' : 'Preview'} as at {fmtDate(sweep.as_of)}
            </span>
          </div>
          <div className="mt-3">
            <StatStrip stats={[
              { label: 'Bills', value: String(sweep.bills) },
              { label: 'Total', value: inr(sweep.total, showAmounts), tone: '#7A6220', strong: true },
              { label: 'Exempt', value: String(sweep.exempt) },
            ]} />
          </div>
          {Object.keys(sweep.by_class ?? {}).length > 0 && (
            <div className="mt-3 pt-3 border-t border-[#F0ECE2]">
              <span className={ADMIN.label}>By class</span>
              <div className="flex flex-wrap gap-1.5 mt-1.5">
                {Object.entries(sweep.by_class).map(([klass, amount]) => (
                  <span key={klass}
                        className="text-[11px] px-2 py-1 bg-[#F4F1E7] border border-[#E3DFD3] text-slate-600">
                    {klass} · {inr(amount, showAmounts)}
                  </span>
                ))}
              </div>
            </div>
          )}
          {!sweep.committed && sweep.bills > 0 && (
            <p className="mt-3 text-[11px] text-[#7A6220]">
              Nothing has been charged yet. Press Charge now to write these to the bills.
            </p>
          )}
        </div>
      )}

      <div className={ADMIN.card}>
        <div className="px-4 py-2.5 border-b border-[#F0ECE2] flex items-center justify-between">
          <h3 className={ADMIN.label}>Rules</h3>
          <button onClick={() => setEditing('new')} className={ADMIN.ghostBtn}>
            <Plus size={13} /> New rule
          </button>
        </div>
        {rules.length === 0 ? (
          <p className="px-4 py-8 text-[13px] text-slate-500">
            No late-fee rules. Bills fall overdue but nothing is charged.
          </p>
        ) : rules.map(r => (
          <Row key={r.id} cols={RULE_COLS}>
            <span className={`${CELL.A1} block text-[13px] font-semibold text-slate-900 break-words`}>
              {r.name}
            </span>
            <span className={`${CELL.A2} block text-[12px] text-slate-500`}>
              {describeRule(r)}
              {r.enabled && r.enabled_from ? ` · on since ${fmtDate(r.enabled_from)}` : ''}
            </span>
            <span className={CELL.B1}>
              <span className={`inline-flex items-center h-5 px-2 rounded-full text-[10.5px] font-semibold leading-none whitespace-nowrap ${
                r.enabled
                  ? 'bg-[#EAF5EE] text-[#1F6B42] border border-[#C6E3D2]'
                  : 'bg-[#F4F1E7] text-slate-600 border border-[#E3DFD3]'}`}>
                {r.enabled ? 'Live' : 'Off'}
              </span>
            </span>
            <span className={`${CELL.A3} max-sm:col-span-2 max-sm:mt-1.5 flex items-center justify-end gap-1.5`}>
              <button onClick={() => setEditing(r)}
                      className={ADMIN.ghostBtn}>Edit</button>
              <button onClick={() => void toggleRule(r)}
                      title={r.enabled ? 'Switch off' : 'Switch on from today'}
                      className={`${r.enabled ? ADMIN.ghostBtn : ADMIN.darkBtn}`}>
                <Power size={13} /> {r.enabled ? 'Switch off' : 'Switch on'}
              </button>
            </span>
          </Row>
        ))}
        <p className="px-4 py-2.5 text-[12px] text-slate-500 border-t border-[#F0ECE2]">
          Switching a rule on always starts it from today. Days before that are never charged,
          so turning one on in October cannot back-charge a term.
        </p>
      </div>

      {editing && year && (
        <LateFeeRuleBuilder
          yearId={year.id}
          rule={editing === 'new' ? null : editing}
          scopes={scopes}
          sampleBillRupees={sampleBill}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); void load() }}
        />
      )}
    </>
  )
}

function describeRule(r: LateFeeRuleRow): string {
  const amount = r.charge_type === 'flat' ? `₹${r.rate}` : `${r.rate}%`
  const when = r.frequency === 'once' ? 'once' : `every ${r.frequency.replace('ly', '')}`
  const cap = r.cap_amount !== null ? `, capped at ₹${r.cap_amount}`
    : r.cap_percent !== null ? `, capped at ${r.cap_percent}% of the bill` : ''
  const scope = r.scope === 'all' ? 'every bill' : `one ${r.scope}`
  return `${amount} ${when} after ${r.grace_days} grace day${r.grace_days === 1 ? '' : 's'}, on ${scope}${cap}`
}
