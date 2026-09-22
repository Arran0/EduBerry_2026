'use client'

// ─────────────────────────────────────────────────────────────────────────────
// Late-fee settings — the rules, and nothing else.
//
// This screen used to lead with a panel called "The nightly sweep", with a
// Preview button and a Charge now button. It was answering a question nobody
// asked. A late fee is a policy: a school decides that a bill unpaid past its
// date costs more, switches the rule on, and from that night the charge appears
// on the bills it covers. Whether the job that applies it ran at two in the
// morning is the database's business, not the office's — and a Charge now
// button made it the office's, with the cheerful side effect that pressing it
// twice in a day was a real decision somebody could get wrong.
//
// So the sweep runs on its own, scheduled beside the two jobs that already
// generate bills and mark them overdue (fee_r5_latefee_cron.sql), and this
// screen is the list of rules and the builder behind it. What a rule has
// actually charged shows up where it matters: on the bill.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2, Plus, Power, Timer } from 'lucide-react'
import { useAcademicYear } from '@/contexts/AcademicYearContext'
import { useFeePermissions } from '@/hooks/useFeePermissions'
import { ADMIN, fmtDate } from '@/components/fees/ui'
import NoAccess from '@/components/fees/NoAccess'
import LateFeeRuleBuilder, { type ScopeOption } from '@/components/fees/charges/LateFeeRuleBuilder'
import { gradeLabel } from '@/lib/grades'
import { fetchFeeConfig, type FeeConfigBundle } from '@/lib/fees/config'
import { fetchUnpaidInvoices, type InvoiceRow } from '@/lib/fees/invoices'
import {
  fetchLateFeeRules, setLateFeeRuleEnabled, type LateFeeRuleRow,
} from '@/lib/fees/charges'

export default function LateFeeSettingsSection() {
  const { year } = useAcademicYear()
  const perms = useFeePermissions()

  const [config, setConfig] = useState<FeeConfigBundle | null>(null)
  const [rules, setRules] = useState<LateFeeRuleRow[]>([])
  const [invoices, setInvoices] = useState<InvoiceRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [editing, setEditing] = useState<LateFeeRuleRow | null | 'new'>(null)

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

  const toggleRule = async (rule: LateFeeRuleRow) => {
    setBusy(rule.id)
    try {
      await setLateFeeRuleEnabled(rule.id, !rule.enabled)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not change the rule.')
    } finally {
      setBusy(null)
    }
  }

  if (perms.loading) {
    return <div className="p-10 flex justify-center"><Loader2 className="animate-spin text-[#8C8878]" /></div>
  }
  if (!canManage) return <NoAccess what="manage late fees" />
  if (loading) {
    return <div className="p-10 flex justify-center"><Loader2 className="animate-spin text-[#8C8878]" /></div>
  }

  const liveCount = rules.filter(r => r.enabled).length

  return (
    <>
      {error && (
        <div className="p-3 bg-[#FCECEC] border border-[#EFCCCC] text-xs text-[#A93232]">{error}</div>
      )}

      <div className={ADMIN.card}>
        <div className="px-4 py-2.5 border-b border-[#F0ECE2] flex flex-wrap items-center gap-2">
          <h3 className={`${ADMIN.label} flex-1`}>Rules</h3>
          <span className="text-[11px] text-[#8C8878]">
            {liveCount === 0 ? 'None live' : `${liveCount} live`}
          </span>
          <button onClick={() => setEditing('new')} className={ADMIN.darkBtn}>
            <Plus size={13} /> New rule
          </button>
        </div>

        {rules.length === 0 ? (
          <p className="px-4 py-8 text-sm text-[#8C8878]">
            No late-fee rules. Bills still fall overdue and still show on the ledger — nothing is
            charged for it.
          </p>
        ) : rules.map(r => (
          <div key={r.id}
               className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-[#F0ECE2] last:border-0">
            <div className="flex-1 min-w-[200px]">
              <div className="text-sm font-semibold text-[#18181B]">{r.name}</div>
              <p className="text-[11px] text-[#8C8878] mt-0.5">
                {describeRule(r)}
                {r.enabled && r.enabled_from ? ` · charging since ${fmtDate(r.enabled_from)}` : ''}
              </p>
            </div>
            <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 ${
              r.enabled
                ? 'bg-[#EAF5EE] text-[#1F6B42] border border-[#C6E3D2]'
                : 'bg-[#F4F1E7] text-[#6B675A] border border-[#E3DFD3]'}`}>
              {r.enabled ? 'Live' : 'Off'}
            </span>
            <button onClick={() => setEditing(r)} className={ADMIN.ghostBtn}>Edit</button>
            <button onClick={() => void toggleRule(r)} disabled={busy === r.id}
                    title={r.enabled ? 'Switch off' : 'Switch on from today'}
                    className={r.enabled ? ADMIN.ghostBtn : ADMIN.darkBtn}>
              {busy === r.id ? <Loader2 size={13} className="animate-spin" /> : <Power size={13} />}
              {r.enabled ? 'Switch off' : 'Switch on'}
            </button>
          </div>
        ))}

        <p className="px-4 py-2.5 text-[11px] text-[#8C8878] border-t border-[#F0ECE2]
                      flex items-start gap-1.5 leading-relaxed">
          <Timer size={12} className="mt-0.5 flex-shrink-0" />
          <span>
            A live rule applies itself overnight, every night, to every bill it covers — there is
            nothing here to press. Switching one on always starts it from today, so turning a rule
            on in October cannot back-charge a term.
          </span>
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
