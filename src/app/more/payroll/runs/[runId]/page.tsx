'use client'

import React, { useState, useEffect, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import {
  ArrowLeft, Calculator, Lock, LockOpen, CheckCheck, Search, CalendarDays,
  ChevronRight, AlertTriangle, ShieldCheck, History,
} from 'lucide-react'
import ProtectedLayout from '@/components/ProtectedLayout'
import Avatar from '@/components/Avatar'
import { useAuth } from '@/contexts/AuthContext'
import WorkflowRail from '@/components/payroll/WorkflowRail'
import ExceptionsBoard from '@/components/payroll/ExceptionsBoard'
import PreApprovalSummary from '@/components/payroll/PreApprovalSummary'
import DayGrid from '@/components/payroll/DayGrid'
import WhyPanel, { Explain } from '@/components/payroll/WhyPanel'
import StatutoryReturns from '@/components/payroll/StatutoryReturns'
import { PUI, STATUS_CHIP, inr } from '@/components/payroll/ui'
import {
  fetchRun, fetchRunLines, fetchExceptions, fetchRunEvents, fetchVariance,
  calculateRun, transitionRun, resolveException, acknowledgeVariance,
  runTotals, runPeriodLabel, splitComponents,
} from '@/lib/payroll/runs'
import type { RunRow, RunLineRow, ExceptionRow, RunEventRow } from '@/lib/payroll/rows'
import { RUN_STATUS_LABEL, isImmutable, nextStatuses, type RunStatus } from '@/lib/payroll/engine/workflow'
import type { VarianceResult } from '@/lib/payroll/engine/variance'
import type { ExplainNode, DayVerdict } from '@/lib/payroll/engine/types'

// The run screen. Four tabs over one shared header: the register, the
// exceptions that gate approval, the pre-approval summary an approver has to
// read, and the audit trail.
//
// Every amount in the register is wrapped in <Explain>, so any figure opens the
// workings the engine stored when it computed it.

type Tab = 'register' | 'exceptions' | 'approval' | 'returns' | 'audit'

export default function PayrollRunPage() {
  return (
    <ProtectedLayout adminOnly>
      <RunDetail />
    </ProtectedLayout>
  )
}

function RunDetail() {
  const { runId } = useParams() as { runId: string }
  const { profile } = useAuth()
  const viewerId = profile?.id ?? ''

  const [run, setRun] = useState<RunRow | null>(null)
  const [lines, setLines] = useState<RunLineRow[]>([])
  const [exceptions, setExceptions] = useState<ExceptionRow[]>([])
  const [events, setEvents] = useState<RunEventRow[]>([])
  const [variance, setVariance] = useState<VarianceResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('register')
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [whyTrace, setWhyTrace] = useState<{ trace: ExplainNode; title: string } | null>(null)
  const [dayGrid, setDayGrid] = useState<{ days: DayVerdict[]; name: string; rate: number } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const r = await fetchRun(runId)
    if (!r) { setLoading(false); return }
    const [l, e, ev] = await Promise.all([fetchRunLines(runId), fetchExceptions(runId), fetchRunEvents(runId)])
    setRun(r); setLines(l); setExceptions(e); setEvents(ev)
    setVariance(await fetchVariance(r, l))
    setLoading(false)
  }, [runId])

  useEffect(() => { load() }, [load])

  const totals = useMemo(() => runTotals(lines), [lines])
  const locked = run ? isImmutable(run.status) : false
  const blocking = exceptions.filter(e => e.severity === 'block' && !e.resolved_at).length

  const missing = useMemo(() => ({
    bank: exceptions.filter(e => e.code === 'MISSING_BANK' && !e.resolved_at).length,
    pan: exceptions.filter(e => e.code === 'MISSING_PAN' && !e.resolved_at).length,
    uan: exceptions.filter(e => e.code === 'MISSING_UAN' && !e.resolved_at).length,
    ip: exceptions.filter(e => e.code === 'MISSING_IP_NUMBER' && !e.resolved_at).length,
  }), [exceptions])

  const newJoiners = exceptions.filter(e => e.code === 'NEW_JOINER').length
  const exits = exceptions.filter(e => e.code === 'EXIT').length

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return lines
    return lines.filter(l => (l.employee?.full_name ?? '').toLowerCase().includes(q))
  }, [lines, search])

  const act = async (label: string, fn: () => Promise<{ success: boolean; error?: string }>) => {
    setBusy(label); setMessage(null)
    const res = await fn()
    setBusy(null)
    if (!res.success) { setMessage(res.error ?? 'That did not work'); return }
    await load()
  }

  const calculate = () => act('calculate', async () => {
    const res = await calculateRun(runId)
    if (res.success) {
      setMessage(
        `Calculated ${res.lineCount} line(s). ${res.exceptions ?? 0} exception(s)` +
        `${res.blocking ? `, ${res.blocking} blocking` : ''}.`,
      )
    }
    return res
  })

  const move = (to: RunStatus) => act(to, () => transitionRun(runId, to))

  if (loading) {
    return <div className="min-h-screen bg-[#FAFAFA] p-6"><div className={`${PUI.card} h-40 animate-pulse max-w-5xl mx-auto`} /></div>
  }
  if (!run) {
    return <div className="min-h-screen bg-[#FAFAFA] p-6 text-center text-sm text-[#71717A]">Run not found.</div>
  }

  const canMoveTo = nextStatuses(run.status)

  return (
    <div className="min-h-screen bg-[#FAFAFA]">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6">
        <Link href="/more/payroll" className="inline-flex items-center gap-1.5 text-sm text-[#71717A] hover:text-[#27272A] mb-4">
          <ArrowLeft size={16} /> Payroll
        </Link>

        {/* ── Header ─────────────────────────────────────────────── */}
        <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-display text-2xl font-bold text-[#27272A]">{runPeriodLabel(run)}</h1>
              <span className={`text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded-md ${STATUS_CHIP[run.status]}`}>
                {RUN_STATUS_LABEL[run.status]}
              </span>
            </div>
            <p className="text-sm text-[#71717A] mt-0.5">
              {totals.lineCount} employee{totals.lineCount === 1 ? '' : 's'} · {inr(totals.net)} net
              {run.locked_hash && (
                <span className="text-[#A1A1AA]"> · lock {run.locked_hash.slice(0, 8)}</span>
              )}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {!locked && (
              <button onClick={calculate} disabled={!!busy} className={PUI.darkBtn}>
                <Calculator size={13} /> {busy === 'calculate' ? 'Calculating…' : run.calculated_at ? 'Recalculate' : 'Calculate'}
              </button>
            )}
            {canMoveTo.filter(s => s !== 'locked').map(s => (
              <button key={s} onClick={() => move(s)} disabled={!!busy} className={PUI.ghostBtn}>
                {busy === s ? '…' : `Move to ${RUN_STATUS_LABEL[s]}`}
              </button>
            ))}
            {canMoveTo.includes('locked') && (
              <button onClick={() => move('locked')} disabled={!!busy} className={PUI.darkBtn}>
                <Lock size={13} /> {busy === 'locked' ? 'Locking…' : 'Lock run'}
              </button>
            )}
          </div>
        </div>

        {message && (
          <div className={`${PUI.card} p-3 mb-4 text-xs text-[#52525B]`}>{message}</div>
        )}

        {locked && (
          <div className="flex items-start gap-2.5 p-3 rounded-xl bg-[#27272A] mb-4">
            <ShieldCheck size={15} className="text-[#B8983C] mt-0.5 flex-shrink-0" />
            <p className="text-xs text-white/80 leading-relaxed">
              <strong className="text-white">This run is locked.</strong> Its lines cannot be edited — the database
              itself refuses the write, not just this screen. A correction goes on a supplementary run, which leaves
              both the original and the correction on the record.
            </p>
          </div>
        )}

        <div className={`${PUI.card} p-3 mb-4`}>
          <WorkflowRail status={run.status} events={events} />
        </div>

        {/* ── Tabs ───────────────────────────────────────────────── */}
        <div className="flex items-center gap-1 mb-4 border-b border-[#E4E4E7]">
          {([
            ['register', 'Register', lines.length],
            ['exceptions', 'Exceptions', exceptions.filter(e => !e.resolved_at).length],
            ['approval', 'Approval', null],
            ['returns', 'Returns', null],
            ['audit', 'Audit', events.length],
          ] as [Tab, string, number | null][]).map(([key, label, count]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`px-3 py-2 text-xs font-semibold border-b-2 -mb-px transition-colors ${
                tab === key ? 'border-[#27272A] text-[#27272A]' : 'border-transparent text-[#A1A1AA] hover:text-[#71717A]'
              }`}
            >
              {label}
              {count !== null && count > 0 && (
                <span className={`ml-1.5 tabular-nums ${key === 'exceptions' && blocking > 0 ? 'text-rose-600' : 'text-[#A1A1AA]'}`}>
                  {count}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* ── Register ───────────────────────────────────────────── */}
        {tab === 'register' && (
          <>
            <div className="relative mb-3">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#A1A1AA]" />
              <input
                value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Find an employee"
                className={`${PUI.input} pl-9`}
              />
            </div>

            {visible.length === 0 ? (
              <div className={`${PUI.card} p-8 text-center text-sm text-[#71717A]`}>
                {lines.length === 0 ? 'No employees on this run yet.' : 'Nobody matches that search.'}
              </div>
            ) : (
              <div className="space-y-1.5">
                {visible.map(l => {
                  const open = expanded.has(l.id)
                  const trace = l.trace as unknown as ExplainNode | null
                  const days = (l.inputs?.attendanceDays ?? []) as DayVerdict[]
                  const perDay = Number(l.payable_days) > 0
                    ? Number(l.gross_earnings) / Number(l.payable_days) : 0
                  const { earnings, deductions, employer, informational } = splitComponents(l.components ?? [])

                  return (
                    <div key={l.id} className={PUI.card}>
                      <div className="flex items-center gap-3 p-3">
                        <button
                          onClick={() => setExpanded(prev => {
                            const next = new Set(prev)
                            if (next.has(l.id)) next.delete(l.id); else next.add(l.id)
                            return next
                          })}
                          className="flex items-center gap-2.5 flex-1 min-w-0 text-left"
                        >
                          <ChevronRight size={13} className={`text-[#A1A1AA] transition-transform flex-shrink-0 ${open ? 'rotate-90' : ''}`} />
                          <Avatar name={l.employee?.full_name} avatarUrl={l.employee?.avatar_url ?? null} size={28} userId={l.employee_id} />
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-[#27272A] truncate">{l.employee?.full_name}</p>
                            <p className="text-[11px] text-[#A1A1AA]">
                              {Number(l.paid_days)} of {Number(l.payable_days)} days paid
                              {Number(l.lop_days) > 0 && <span className="text-rose-600"> · {Number(l.lop_days)} LOP</span>}
                            </p>
                          </div>
                        </button>

                        {Number(l.lop_days) > 0 && days.length > 0 && (
                          <button
                            onClick={() => setDayGrid({ days, name: l.employee?.full_name ?? '', rate: perDay })}
                            className="p-1.5 rounded-lg hover:bg-[#F4F4F5] text-[#A1A1AA] hover:text-orange-600 transition-colors"
                            title="Show the days behind this deduction"
                          >
                            <CalendarDays size={14} />
                          </button>
                        )}

                        <div className="text-right flex-shrink-0">
                          <p className="text-sm font-bold text-[#27272A] tabular-nums">
                            <Explain trace={trace} title={`Net pay — ${l.employee?.full_name}`} subtitle={runPeriodLabel(run)}>
                              {inr(Number(l.net_pay))}
                            </Explain>
                          </p>
                          <p className="text-[10px] text-[#A1A1AA] tabular-nums">
                            {inr(Number(l.gross_earnings))} − {inr(Number(l.total_deductions))}
                          </p>
                        </div>
                      </div>

                      {open && (
                        <div className="border-t border-[#F4F4F5] p-3 grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <ComponentList title="Earnings" rows={earnings} name={l.employee?.full_name ?? ''} />
                          <ComponentList title="Deductions" rows={deductions} name={l.employee?.full_name ?? ''} negative />
                          {employer.length > 0 && (
                            <ComponentList title="Employer contributions" rows={employer} name={l.employee?.full_name ?? ''} muted />
                          )}
                          {informational.length > 0 && (
                            <ComponentList title="For information" rows={informational} name={l.employee?.full_name ?? ''} muted />
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </>
        )}

        {tab === 'exceptions' && (
          <ExceptionsBoard
            exceptions={exceptions}
            readOnly={locked}
            onResolve={async (id, note) => {
              await resolveException(id, note, viewerId)
              setExceptions(await fetchExceptions(runId))
            }}
          />
        )}

        {tab === 'approval' && (
          <PreApprovalSummary
            totals={totals}
            variance={variance}
            missing={missing}
            newJoiners={newJoiners}
            exits={exits}
            acknowledged={!!run.variance_acknowledged_at}
            readOnly={locked}
            onAcknowledge={async () => {
              await acknowledgeVariance(runId, viewerId)
              await load()
            }}
          />
        )}

        {tab === 'returns' && <StatutoryReturns run={run} lines={lines} />}

        {tab === 'audit' && (
          <div className={`${PUI.card} p-4`}>
            <h3 className={`${PUI.label} mb-3`}>Every state change on this run</h3>
            {events.length === 0 ? (
              <p className="text-xs text-[#71717A]">Nothing recorded yet.</p>
            ) : (
              <div className="space-y-3">
                {events.map(e => (
                  <div key={e.id} className="flex items-start gap-3">
                    <History size={13} className="text-[#A1A1AA] mt-0.5 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-[#27272A]">
                        {e.from_status ? `${RUN_STATUS_LABEL[e.from_status as RunStatus]} → ` : ''}
                        <strong>{RUN_STATUS_LABEL[e.to_status as RunStatus]}</strong>
                        {e.actor?.full_name && <span className="text-[#71717A]"> by {e.actor.full_name}</span>}
                      </p>
                      {e.note && <p className="text-[11px] text-[#71717A] mt-0.5 leading-relaxed">{e.note}</p>}
                    </div>
                    <span className="text-[10px] text-[#A1A1AA] flex-shrink-0 tabular-nums">
                      {new Date(e.created_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                ))}
              </div>
            )}
            <p className="text-[10px] text-[#A1A1AA] mt-4 pt-3 border-t border-[#F4F4F5] leading-relaxed">
              This log is append-only at the database level — entries cannot be edited or deleted by anyone,
              including an administrator.
            </p>
          </div>
        )}
      </div>

      {whyTrace && <WhyPanel trace={whyTrace.trace} title={whyTrace.title} onClose={() => setWhyTrace(null)} />}
      {dayGrid && (
        <DayGrid
          days={dayGrid.days} employeeName={dayGrid.name} perDayRate={dayGrid.rate}
          onClose={() => setDayGrid(null)}
        />
      )}
    </div>
  )
}

function ComponentList({ title, rows, name, negative, muted }: {
  title: string
  rows: { id: string; name: string; amount: number; computed_from: Record<string, unknown> | null }[]
  name: string
  negative?: boolean
  muted?: boolean
}) {
  if (rows.length === 0) return null
  const total = rows.reduce((s, r) => s + Number(r.amount), 0)
  return (
    <div>
      <h4 className={`${PUI.label} mb-1.5`}>{title}</h4>
      <div className="space-y-0.5">
        {rows.map(r => (
          <div key={r.id} className="flex items-baseline justify-between gap-2 text-xs">
            <span className={muted ? 'text-[#A1A1AA]' : 'text-[#52525B]'}>{r.name}</span>
            <span className={`tabular-nums font-medium ${muted ? 'text-[#A1A1AA]' : negative ? 'text-rose-600' : 'text-[#27272A]'}`}>
              <Explain
                trace={r.computed_from as unknown as ExplainNode | null}
                title={`${r.name} — ${name}`}
              >
                {negative ? '−' : ''}{inr(Number(r.amount))}
              </Explain>
            </span>
          </div>
        ))}
        <div className="flex items-baseline justify-between gap-2 text-xs pt-1 mt-1 border-t border-[#F4F4F5]">
          <span className="font-semibold text-[#27272A]">Total</span>
          <span className={`tabular-nums font-bold ${muted ? 'text-[#71717A]' : negative ? 'text-rose-600' : 'text-[#27272A]'}`}>
            {negative ? '−' : ''}{inr(total)}
          </span>
        </div>
      </div>
    </div>
  )
}
