'use client'

import React, { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  ArrowLeft, Plus, Layers, SlidersHorizontal, Scale, Wallet, ChevronRight, Lock, FlaskConical, MapPin,
} from 'lucide-react'
import ProtectedLayout from '@/components/ProtectedLayout'
import { useAuth } from '@/contexts/AuthContext'
import { fetchRuns, createRun, runPeriodLabel } from '@/lib/payroll/runs'
import type { RunRow } from '@/lib/payroll/rows'
import { RUN_STATUS_LABEL } from '@/lib/payroll/engine/workflow'
import { PUI, STATUS_CHIP, inr } from '@/components/payroll/ui'

// The payroll hub: every run, and the way in to the five things that shape one
// — structures, policies, work locations, compliance rules and the money owed
// ledger.

const SECTIONS = [
  { href: '/more/payroll/structures', icon: Layers, label: 'Salary structures', hint: 'Heads, templates, assignments and revisions' },
  { href: '/more/payroll/locations', icon: MapPin, label: 'Work locations', hint: 'Offices, states and statutory registrations' },
  { href: '/more/payroll/policies', icon: SlidersHorizontal, label: 'Policies & calendars', hint: 'LOP rules and working calendars, per cohort' },
  { href: '/more/payroll/compliance', icon: Scale, label: 'Compliance', hint: 'Versioned PF, ESI, PT, LWF and TDS rules' },
  { href: '/more/payroll/money', icon: Wallet, label: 'Loans & advances', hint: 'Advances, loans, EMIs and outstanding balances' },
]

export default function PayrollHubPage() {
  return (
    <ProtectedLayout adminOnly>
      <PayrollHub />
    </ProtectedLayout>
  )
}

function PayrollHub() {
  const router = useRouter()
  const { profile } = useAuth()
  const [runs, setRuns] = useState<RunRow[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showNew, setShowNew] = useState(false)

  const now = new Date()
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [year, setYear] = useState(now.getFullYear())

  const load = useCallback(async () => {
    setLoading(true)
    setRuns(await fetchRuns())
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const create = async () => {
    setCreating(true); setError(null)
    const res = await createRun({ periodMonth: month, periodYear: year })
    setCreating(false)
    if (!res.success) { setError(res.error ?? 'Could not create the run'); return }
    router.push(`/more/payroll/runs/${res.runId}`)
  }

  return (
    <div className="min-h-screen bg-[#FAFAFA]">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6">
        <Link href="/more" className="inline-flex items-center gap-1.5 text-sm text-[#71717A] hover:text-[#27272A] mb-4">
          <ArrowLeft size={16} /> More
        </Link>

        <div className="flex items-start justify-between gap-4 mb-6">
          <div>
            <h1 className="font-display text-2xl font-bold text-[#27272A]">Payroll</h1>
            <p className="text-sm text-[#71717A] mt-0.5">
              Every figure here can be traced back to the rule and the day that produced it.
            </p>
          </div>
          <button onClick={() => setShowNew(s => !s)} className={PUI.darkBtn}>
            <Plus size={14} /> New run
          </button>
        </div>

        {showNew && (
          <div className={`${PUI.card} p-4 mb-4`}>
            <h2 className={`${PUI.label} mb-3`}>Start a payroll run</h2>
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="text-xs text-[#71717A] block mb-1">Month</label>
                <select value={month} onChange={e => setMonth(Number(e.target.value))} className={`${PUI.input} w-36`}>
                  {Array.from({ length: 12 }, (_, i) => i + 1).map(m => (
                    <option key={m} value={m}>
                      {new Date(2000, m - 1, 1).toLocaleString('en-IN', { month: 'long' })}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-[#71717A] block mb-1">Year</label>
                <input type="number" value={year} onChange={e => setYear(Number(e.target.value))} className={`${PUI.input} w-28`} />
              </div>
              <button onClick={create} disabled={creating} className={PUI.darkBtn}>
                {creating ? 'Creating…' : 'Create run'}
              </button>
            </div>
            <p className="text-[11px] text-[#A1A1AA] mt-3 leading-relaxed">
              Everyone on the roll for that period is added, including anyone without a salary structure yet —
              they surface as a blocking exception rather than quietly going unpaid.
            </p>
            {error && <p className="text-xs text-rose-600 mt-2">{error}</p>}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-6">
          {SECTIONS.map(s => (
            <Link key={s.href} href={s.href} className={`${PUI.card} p-3.5 flex items-center gap-3 hover:border-[#D4D4D8] transition-colors`}>
              <div className="p-2 rounded-lg bg-[#F4F4F5]"><s.icon size={15} className="text-[#52525B]" /></div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-[#27272A]">{s.label}</p>
                <p className="text-[11px] text-[#A1A1AA] truncate">{s.hint}</p>
              </div>
              <ChevronRight size={14} className="text-[#D4D4D8] flex-shrink-0" />
            </Link>
          ))}
        </div>

        <div className="flex items-center justify-between mb-2">
          <h2 className={PUI.label}>Runs</h2>
          <Link href="/more/payroll/simulate" className="text-xs font-semibold text-[#71717A] hover:text-[#27272A] inline-flex items-center gap-1">
            <FlaskConical size={12} /> Simulate a change
          </Link>
        </div>

        {loading ? (
          <div className="space-y-2">
            {[0, 1, 2].map(i => <div key={i} className={`${PUI.card} h-16 animate-pulse`} />)}
          </div>
        ) : runs.length === 0 ? (
          <div className={`${PUI.card} p-8 text-center`}>
            <p className="text-sm text-[#71717A]">No payroll runs yet.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {runs.map(r => (
              <Link key={r.id} href={`/more/payroll/runs/${r.id}`} className={`${PUI.card} p-3.5 flex items-center gap-3 hover:border-[#D4D4D8] transition-colors`}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-[#27272A]">{runPeriodLabel(r)}</p>
                    {r.run_type !== 'regular' && (
                      <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-[#F4F4F5] text-[#71717A]">
                        {r.run_type}
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-[#A1A1AA]">
                    {r.locked_at
                      ? `Locked ${new Date(r.locked_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`
                      : r.calculated_at
                        ? `Calculated ${new Date(r.calculated_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`
                        : `Created ${new Date(r.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`}
                  </p>
                </div>
                <span className={`text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded-md flex items-center gap-1 ${STATUS_CHIP[r.status]}`}>
                  {['locked', 'paid', 'reconciled'].includes(r.status) && <Lock size={9} />}
                  {RUN_STATUS_LABEL[r.status]}
                </span>
                <ChevronRight size={14} className="text-[#D4D4D8] flex-shrink-0" />
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
