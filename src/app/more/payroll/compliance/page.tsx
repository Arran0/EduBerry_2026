'use client'

import React, { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { ArrowLeft, Scale, Plus, Check, Clock } from 'lucide-react'
import ProtectedLayout from '@/components/ProtectedLayout'
import { useAuth } from '@/contexts/AuthContext'
import { PUI } from '@/components/payroll/ui'
import { fetchRuleSets, publishRuleSet, createRuleSetDraft } from '@/lib/payroll/admin'
import type { RuleSetRow } from '@/lib/payroll/rows'

// Statutory compliance as versioned data.
//
// Nothing on this screen edits a published rule set: the database refuses it,
// and so does the interface. A rate change is a NEW version with a future
// effective date, which is what keeps every run already locked saying what it
// actually applied.

const DOMAIN_LABEL: Record<string, string> = {
  pf: 'Provident Fund', esi: 'ESI', pt: 'Professional Tax',
  lwf: 'Labour Welfare Fund', tds: 'Income tax (TDS)',
  gratuity: 'Gratuity', bonus: 'Statutory bonus',
}

const DOMAIN_ORDER = ['pf', 'esi', 'pt', 'lwf', 'tds', 'gratuity', 'bonus']

export default function CompliancePage() {
  return <ProtectedLayout adminOnly><Compliance /></ProtectedLayout>
}

function Compliance() {
  const { profile } = useAuth()
  const [rows, setRows] = useState<RuleSetRow[]>([])
  const [loading, setLoading] = useState(true)
  const [, setEditing] = useState<RuleSetRow | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setRows(await fetchRuleSets(true))
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const publish = async (id: string) => {
    setBusy(id); setMessage(null)
    const res = await publishRuleSet(id)
    setBusy(null)
    if (!res.success) { setMessage(res.error ?? 'Could not publish'); return }
    await load()
  }

  /** Fork the next version of a rule set, pre-filled with the current values. */
  const fork = async (r: RuleSetRow) => {
    const nextApril = `${new Date().getFullYear() + (new Date().getMonth() >= 3 ? 1 : 0)}-04-01`
    const from = prompt('Effective from (YYYY-MM-DD)', nextApril)
    if (!from) return
    const note = prompt('Which notification or circular is this from?', '') ?? ''
    const res = await createRuleSetDraft(r.domain, r.jurisdiction, from, r.rules, note, profile?.id ?? '')
    if (!res.success) { setMessage(res.error ?? 'Could not create the draft'); return }
    await load()
    const created = (await fetchRuleSets(true)).find(x => x.id === res.id)
    if (created) setEditing(created)
  }

  return (
    <div className="min-h-screen bg-[#FAFAFA]">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6">
        <Link href="/more/payroll" className="inline-flex items-center gap-1.5 text-sm text-[#71717A] hover:text-[#27272A] mb-4">
          <ArrowLeft size={16} /> Payroll
        </Link>

        <h1 className="font-display text-2xl font-bold text-[#27272A]">Compliance</h1>
        <p className="text-sm text-[#71717A] mt-0.5 mb-5 max-w-2xl">
          Every statutory rate lives here with an effective date. A run pins the versions it used, so publishing a
          new rate can never move a figure on a payslip that has already gone out.
        </p>

        {message && <div className={`${PUI.card} p-3 mb-3 text-xs text-rose-600`}>{message}</div>}

        {loading ? (
          <div className={`${PUI.card} h-40 animate-pulse`} />
        ) : (
          <div className="space-y-4">
            {DOMAIN_ORDER.map(domain => {
              const versions = rows.filter(r => r.domain === domain)
                .sort((a, b) => b.effective_from.localeCompare(a.effective_from))
              if (versions.length === 0) return null
              return (
                <div key={domain} className={`${PUI.card} p-4`}>
                  <div className="flex items-center gap-2 mb-3">
                    <Scale size={14} className="text-[#71717A]" />
                    <h2 className="text-sm font-semibold text-[#27272A] flex-1">{DOMAIN_LABEL[domain]}</h2>
                  </div>

                  <div className="space-y-1.5">
                    {versions.map(v => (
                      <div key={v.id} className="flex items-start gap-3 py-2 border-t border-[#F4F4F5] first:border-0">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-semibold text-[#27272A]">v{v.version}</span>
                            <span className="text-[10px] text-[#A1A1AA]">{v.jurisdiction}</span>
                            <span className={`text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded ${
                              v.status === 'published' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                              : v.status === 'draft' ? 'bg-[#F4F4F5] text-[#71717A] border border-[#E4E4E7]'
                              : 'bg-[#FAFAFA] text-[#A1A1AA] border border-[#F4F4F5]'
                            }`}>
                              {v.status}
                            </span>
                          </div>
                          <p className="text-[11px] text-[#71717A] mt-0.5">
                            In force from {v.effective_from}{v.effective_to ? ` to ${v.effective_to}` : ' onwards'}
                          </p>
                          {v.source_note && (
                            <p className="text-[10px] text-[#A1A1AA] mt-0.5 leading-relaxed">{v.source_note}</p>
                          )}
                          <RuleSummary domain={domain} rules={v.rules as unknown as Record<string, unknown>} />
                        </div>
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          {v.status === 'draft' && (
                            <button onClick={() => publish(v.id)} disabled={busy === v.id} className={PUI.darkBtn}>
                              <Check size={11} /> {busy === v.id ? '…' : 'Publish'}
                            </button>
                          )}
                          {v.status === 'published' && !v.effective_to && (
                            <button onClick={() => fork(v)} className={PUI.ghostBtn}>
                              <Plus size={11} /> New version
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        <div className={`${PUI.card} p-4 mt-4`}>
          <div className="flex items-start gap-2.5">
            <Clock size={14} className="text-[#A1A1AA] mt-0.5 flex-shrink-0" />
            <p className="text-[11px] text-[#71717A] leading-relaxed">
              A published version cannot be edited — the database rejects the write. To correct a rate, publish a new
              version with a later effective date. Runs already locked keep citing the version they actually used,
              which is what a PF or ESI audit will ask you to show.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

/** A one-line read of what each rule set actually says, so nobody has to open JSON. */
function RuleSummary({ domain, rules }: { domain: string; rules: Record<string, unknown> }) {
  const pct = (v: unknown) => `${((Number(v) || 0) * 100).toFixed(2).replace(/\.00$/, '')}%`
  const rupee = (v: unknown) => `₹${(Number(v) || 0).toLocaleString('en-IN')}`

  let text = ''
  switch (domain) {
    case 'pf':
      text = `Employee ${pct(rules.employeeRate)}, employer ${pct(rules.employerRate)}, EPS ${pct(rules.epsRate)} capped at ${rupee(rules.epsWageCeiling)}, EDLI ${pct(rules.edliRate)}`
      break
    case 'esi':
      text = `Employee ${pct(rules.employeeRate)}, employer ${pct(rules.employerRate)}, ceiling ${rupee(rules.wageCeiling)}`
      break
    case 'pt': {
      const slabs = (rules.slabs as { amount: number }[] | undefined) ?? []
      text = `${slabs.length} slab(s), ${(rules.frequency as string) === 'half_yearly' ? 'half-yearly' : 'monthly'}, capped at ${rupee(rules.annualMaximum)} a year`
      break
    }
    case 'lwf':
      text = `Employee ${rupee(rules.employeeAmount)}, employer ${rupee(rules.employerAmount)}, collected in month ${(rules.deductionMonths as number[] | undefined)?.join(', ')}`
      break
    case 'tds': {
      const regimes = (rules.regimes as { name: string }[] | undefined) ?? []
      text = `FY ${rules.financialYear}, ${regimes.map(r => r.name).join(' and ')} regimes, default ${rules.defaultRegime}`
      break
    }
    case 'gratuity':
      text = `${rules.daysPerYear} days' wages a year on a ${rules.monthDays}-day month, after ${rules.minimumYears} years, capped at ${rupee(rules.maximumAmount)}`
      break
    case 'bonus':
      text = `${pct(rules.minimumRate)} to ${pct(rules.maximumRate)}, eligible under ${rupee(rules.eligibilityWageCeiling)} a month, computed on ${rupee(rules.calculationWageCeiling)}`
      break
  }
  return <p className="text-[11px] text-[#52525B] mt-1 leading-relaxed">{text}</p>
}
