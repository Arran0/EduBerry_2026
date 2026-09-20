'use client'

import React, { useState, useEffect, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { ArrowLeft, Check, TrendingUp } from 'lucide-react'
import ProtectedLayout from '@/components/ProtectedLayout'
import { useAuth } from '@/contexts/AuthContext'
import { supabase } from '@/lib/supabase'
import { PUI, inr, inrDelta, deltaColor } from '@/components/payroll/ui'
import {
  fetchComponents, fetchStructures, activateStructure, fetchAllAssignments,
  assignStructure, previewIncrement, applyRevision, createRevision, upsertStatutory, fetchStatutoryRows,
} from '@/lib/payroll/admin'
import type { StructureRow, AssignmentRow, StatutoryRow } from '@/lib/payroll/rows'
import type { ComponentDef } from '@/lib/payroll/engine/types'
import { buildStructure, StructureError } from '@/lib/payroll/engine/structure'
import { toEngineStructure } from '@/lib/payroll/rows'

// Salary heads, structure versions, assignments and bulk revisions.
//
// The preview beside the structure editor runs the real `buildStructure`, so
// what it shows is what a run will compute — including refusing a dependency
// loop rather than quietly resolving one side to zero.

type Tab = 'heads' | 'structures' | 'assignments' | 'revisions' | 'statutory'

export default function StructuresPage() {
  return <ProtectedLayout adminOnly><Structures /></ProtectedLayout>
}

interface StaffLite { id: string; full_name: string; role: string }

function Structures() {
  const { profile } = useAuth()
  const [tab, setTab] = useState<Tab>('structures')
  const [components, setComponents] = useState<ComponentDef[]>([])
  const [structures, setStructures] = useState<StructureRow[]>([])
  const [assignments, setAssignments] = useState<AssignmentRow[]>([])
  const [staff, setStaff] = useState<StaffLite[]>([])
  const [statutory, setStatutory] = useState<Record<string, StatutoryRow>>({})
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const [c, s, a, st, people] = await Promise.all([
      fetchComponents(), fetchStructures(), fetchAllAssignments(), fetchStatutoryRows(),
      supabase.from('profiles').select('id, full_name, role')
        .in('role', ['teacher', 'coordinator', 'principal', 'driver']).eq('is_banned', false).order('full_name'),
    ])
    setComponents(c); setStructures(s); setAssignments(a); setStatutory(st)
    setStaff((people.data ?? []) as StaffLite[])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const names = useMemo(() => Object.fromEntries(staff.map(s => [s.id, s.full_name])), [staff])

  return (
    <div className="min-h-screen bg-[#FAFAFA]">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6">
        <Link href="/more/payroll" className="inline-flex items-center gap-1.5 text-sm text-[#71717A] hover:text-[#27272A] mb-4">
          <ArrowLeft size={16} /> Payroll
        </Link>

        <h1 className="font-display text-2xl font-bold text-[#27272A]">Salary structures</h1>
        <p className="text-sm text-[#71717A] mt-0.5 mb-5 max-w-2xl">
          Heads, versioned templates, and who is on what. An assignment is never edited — a change closes the old
          one and opens a new one, so the salary history stays complete.
        </p>

        {message && <div className={`${PUI.card} p-3 mb-3 text-xs text-[#52525B]`}>{message}</div>}

        <div className="flex items-center gap-1 mb-4 border-b border-[#E4E4E7] overflow-x-auto">
          {([['structures', 'Structures'], ['heads', 'Salary heads'], ['assignments', 'Assignments'],
             ['revisions', 'Revisions'], ['statutory', 'PF & ESI details']] as [Tab, string][]).map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)}
              className={`px-3 py-2 text-xs font-semibold border-b-2 -mb-px whitespace-nowrap transition-colors ${
                tab === k ? 'border-[#27272A] text-[#27272A]' : 'border-transparent text-[#A1A1AA] hover:text-[#71717A]'}`}>
              {l}
            </button>
          ))}
        </div>

        {loading ? <div className={`${PUI.card} h-40 animate-pulse`} />
          : tab === 'structures' ? <StructuresTab structures={structures} components={components} onReload={load} setMessage={setMessage} />
          : tab === 'heads' ? <HeadsTab components={components} />
          : tab === 'assignments' ? <AssignmentsTab assignments={assignments} structures={structures} staff={staff} onReload={load} createdBy={profile?.id ?? ''} />
          : tab === 'revisions' ? <RevisionsTab assignments={assignments} names={names} onReload={load} createdBy={profile?.id ?? ''} setMessage={setMessage} />
          : <StatutoryTab staff={staff} statutory={statutory} onReload={load} />}
      </div>
    </div>
  )
}

function StructuresTab({ structures, components, onReload, setMessage }: {
  structures: StructureRow[]; components: ComponentDef[]
  onReload: () => Promise<void>; setMessage: (m: string) => void
}) {
  const [preview, setPreview] = useState<{ id: string; anchor: number } | null>(null)

  const previewResult = useMemo(() => {
    if (!preview) return null
    const s = structures.find(x => x.id === preview.id)
    if (!s) return null
    try {
      return buildStructure({
        assignment: { id: 'preview', structureId: s.id, effectiveFrom: s.effective_from, effectiveTo: null, anchorAmount: preview.anchor, revisionId: null, reason: null },
        structure: toEngineStructure(s, new Map()),
        overrides: [], components, onDate: new Date().toISOString().slice(0, 10), payableDays: 30,
      })
    } catch (e) {
      return { error: e instanceof StructureError ? e.message : (e as Error).message }
    }
  }, [preview, structures, components])

  return (
    <div className="space-y-2">
      {structures.map(s => (
        <div key={s.id} className={`${PUI.card} p-3.5`}>
          <div className="flex items-start gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <p className="text-sm font-semibold text-[#27272A]">{s.name}</p>
                <span className="text-[10px] text-[#A1A1AA]">v{s.version}</span>
                <span className={`text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded ${
                  s.status === 'active' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                  : s.status === 'draft' ? 'bg-[#F4F4F5] text-[#71717A] border border-[#E4E4E7]'
                  : 'bg-[#FAFAFA] text-[#A1A1AA] border border-[#F4F4F5]'}`}>{s.status}</span>
              </div>
              <p className="text-[11px] text-[#71717A] mt-0.5">
                {(s.components ?? []).length} head(s) · from {s.effective_from}
                {s.effective_to ? ` to ${s.effective_to}` : ''}
                {s.employee_category ? ` · ${s.employee_category.replace('_', ' ')}` : ''}
              </p>
              <p className="text-[11px] text-[#A1A1AA] mt-1">
                {(s.components ?? []).map(c => c.component?.code).filter(Boolean).join(' · ')}
              </p>
            </div>
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <button onClick={() => setPreview(preview?.id === s.id ? null : { id: s.id, anchor: 40000 })} className={PUI.ghostBtn}>
                Preview
              </button>
              {s.status === 'draft' && (
                <button onClick={async () => {
                  const res = await activateStructure(s.id)
                  setMessage(res.success ? `${s.name} v${s.version} is now active.` : res.error ?? 'Could not activate')
                  await onReload()
                }} className={PUI.darkBtn}><Check size={11} /> Activate</button>
              )}
            </div>
          </div>

          {preview?.id === s.id && (
            <div className="mt-3 pt-3 border-t border-[#F4F4F5]">
              <div className="flex items-center gap-2 mb-2">
                <label className="text-[11px] text-[#71717A]">Anchor (CTC)</label>
                <input type="number" value={preview.anchor}
                  onChange={e => setPreview({ id: s.id, anchor: Number(e.target.value) })}
                  className="w-28 border border-[#E4E4E7] rounded px-2 py-1 text-xs tabular-nums" />
              </div>
              {previewResult && 'error' in previewResult ? (
                <p className="text-xs text-rose-600">{previewResult.error}</p>
              ) : previewResult ? (
                <div className="space-y-0.5">
                  {previewResult.components.map(c => (
                    <div key={c.def.code} className="flex items-baseline justify-between text-xs">
                      <span className="text-[#52525B]">{c.def.name}</span>
                      <span className="tabular-nums font-medium text-[#27272A]">{inr(c.amount)}</span>
                    </div>
                  ))}
                  <div className="flex items-baseline justify-between text-xs pt-1 mt-1 border-t border-[#F4F4F5]">
                    <span className="font-semibold text-[#27272A]">Gross</span>
                    <span className="tabular-nums font-bold text-[#27272A]">{inr(previewResult.gross)}</span>
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

function HeadsTab({ components }: { components: ComponentDef[] }) {
  const flags = (c: ComponentDef) => [
    c.countsForPf && 'PF wage', c.countsForEsi && 'ESI wage', c.isTaxable && 'taxable',
    c.lopApplicable && 'reduced by LOP', c.prorateOnJoinExit && 'prorated',
  ].filter(Boolean).join(' · ')

  return (
    <div className="space-y-1.5">
      {components.map(c => (
        <div key={c.id} className={`${PUI.card} p-3 flex items-start gap-3`}>
          <span className="text-[10px] font-mono font-bold text-[#A1A1AA] w-32 flex-shrink-0 pt-0.5">{c.code}</span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-sm text-[#27272A]">{c.name}</p>
              {c.isSystem && <span className="text-[10px] text-[#A1A1AA]">system</span>}
            </div>
            <p className="text-[11px] text-[#A1A1AA] mt-0.5">{flags(c) || 'no wage-base flags'}</p>
          </div>
          <span className="text-[10px] text-[#71717A] flex-shrink-0">{c.kind.replace('_', ' ')}</span>
        </div>
      ))}
    </div>
  )
}

function AssignmentsTab({ assignments, structures, staff, onReload, createdBy }: {
  assignments: AssignmentRow[]; structures: StructureRow[]; staff: StaffLite[]
  onReload: () => Promise<void>; createdBy: string
}) {
  const [selected, setSelected] = useState<string | null>(null)
  const byEmployee = useMemo(() => {
    const m = new Map<string, AssignmentRow[]>()
    for (const a of assignments) {
      if (!m.has(a.employee_id)) m.set(a.employee_id, [])
      m.get(a.employee_id)!.push(a)
    }
    return m
  }, [assignments])

  return (
    <div className="space-y-1.5">
      {staff.map(s => {
        const rows = byEmployee.get(s.id) ?? []
        const current = rows.find(r => r.effective_to === null)
        const open = selected === s.id
        return (
          <div key={s.id} className={PUI.card}>
            <button onClick={() => setSelected(open ? null : s.id)} className="w-full flex items-center gap-3 p-3 text-left">
              <div className="flex-1 min-w-0">
                <p className="text-sm text-[#27272A]">{s.full_name}</p>
                <p className="text-[11px] text-[#A1A1AA]">
                  {current
                    ? `${current.structure?.name} v${current.structure?.version} · ${inr(Number(current.anchor_amount))} · from ${current.effective_from}`
                    : 'No structure assigned'}
                </p>
              </div>
              <span className="text-[10px] text-[#A1A1AA]">{rows.length} in history</span>
            </button>
            {open && (
              <div className="border-t border-[#F4F4F5] p-3">
                {rows.length === 0 ? (
                  <p className="text-[11px] text-[#A1A1AA] mb-3">Nothing on record yet.</p>
                ) : (
                  <div className="space-y-1 mb-3">
                    {rows.map(r => (
                      <div key={r.id} className="flex items-baseline gap-3 text-[11px]">
                        <span className="text-[#A1A1AA] tabular-nums w-40 flex-shrink-0">
                          {r.effective_from} → {r.effective_to ?? 'now'}
                        </span>
                        <span className="text-[#52525B] flex-1">
                          {r.structure?.name} v{r.structure?.version}
                          {r.reason && <span className="text-[#A1A1AA]"> — {r.reason}</span>}
                        </span>
                        <span className="tabular-nums font-medium text-[#27272A]">{inr(Number(r.anchor_amount))}</span>
                      </div>
                    ))}
                  </div>
                )}
                <AssignForm employeeId={s.id} structures={structures} createdBy={createdBy} onDone={onReload} />
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function AssignForm({ employeeId, structures, createdBy, onDone }: {
  employeeId: string; structures: StructureRow[]; createdBy: string; onDone: () => Promise<void>
}) {
  const active = structures.filter(s => s.status === 'active')
  const [structureId, setStructureId] = useState(active[0]?.id ?? '')
  const [anchor, setAnchor] = useState(0)
  const [from, setFrom] = useState(new Date().toISOString().slice(0, 8) + '01')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const submit = async () => {
    setBusy(true); setErr(null)
    const res = await assignStructure({ employeeId, structureId, effectiveFrom: from, anchorAmount: anchor, reason: reason || null, createdBy })
    setBusy(false)
    if (!res.success) { setErr(res.error ?? 'Could not assign'); return }
    await onDone()
  }

  if (active.length === 0) return <p className="text-[11px] text-[#A1A1AA]">Activate a structure first.</p>

  return (
    <div className="flex flex-wrap items-end gap-2">
      <select value={structureId} onChange={e => setStructureId(e.target.value)} className={`${PUI.input} w-48`}>
        {active.map(s => <option key={s.id} value={s.id}>{s.name} v{s.version}</option>)}
      </select>
      <input type="number" value={anchor} onChange={e => setAnchor(Number(e.target.value))} placeholder="Anchor" className={`${PUI.input} w-28`} />
      <input type="date" value={from} onChange={e => setFrom(e.target.value)} className={`${PUI.input} w-36`} />
      <input value={reason} onChange={e => setReason(e.target.value)} placeholder="Reason" className={`${PUI.input} w-40`} />
      <button onClick={submit} disabled={busy || !structureId} className={PUI.darkBtn}>{busy ? '…' : 'Assign'}</button>
      {err && <p className="text-[11px] text-rose-600 w-full">{err}</p>}
    </div>
  )
}

function RevisionsTab({ assignments, names, onReload, createdBy, setMessage }: {
  assignments: AssignmentRow[]; names: Record<string, string>
  onReload: () => Promise<void>; createdBy: string; setMessage: (m: string) => void
}) {
  const [basis, setBasis] = useState<'percent' | 'amount'>('percent')
  const [value, setValue] = useState(5)
  const [from, setFrom] = useState(new Date().toISOString().slice(0, 8) + '01')
  const [label, setLabel] = useState('Annual increment')
  const [busy, setBusy] = useState(false)

  const rows = useMemo(() => previewIncrement(assignments, names, basis, value), [assignments, names, basis, value])
  const totalDelta = rows.reduce((s, r) => s + r.delta, 0)

  const apply = async () => {
    if (!confirm(`Apply "${label}" to ${rows.length} employee(s) from ${from}? Their current assignments are closed, not edited.`)) return
    setBusy(true)
    const rev = await createRevision({
      label, kind: 'bulk_increment', basis, value, targetStructureId: null,
      effectiveFrom: from, arrearsFrom: null, scope: {}, reason: null,
    }, createdBy)
    if (!rev.success || !rev.id) { setBusy(false); setMessage(rev.error ?? 'Could not create the revision'); return }

    const structureByEmployee: Record<string, string> = {}
    for (const a of assignments) if (a.effective_to === null) structureByEmployee[a.employee_id] = a.structure_id

    const res = await applyRevision(rev.id, rows, from, structureByEmployee, createdBy)
    setBusy(false)
    setMessage(res.success ? `Applied to ${rows.length} employee(s).` : res.error ?? 'Could not apply')
    await onReload()
  }

  return (
    <div className="space-y-3">
      <div className={`${PUI.card} p-4`}>
        <h3 className={`${PUI.label} mb-3`}>Bulk increment</h3>
        <div className="flex flex-wrap items-end gap-2">
          <input value={label} onChange={e => setLabel(e.target.value)} className={`${PUI.input} w-44`} placeholder="Label" />
          <select value={basis} onChange={e => setBasis(e.target.value as 'percent' | 'amount')} className={`${PUI.input} w-32`}>
            <option value="percent">Percentage</option>
            <option value="amount">Fixed amount</option>
          </select>
          <input type="number" value={value} onChange={e => setValue(Number(e.target.value))} className={`${PUI.input} w-24`} />
          <input type="date" value={from} onChange={e => setFrom(e.target.value)} className={`${PUI.input} w-36`} />
          <button onClick={apply} disabled={busy || rows.length === 0} className={PUI.darkBtn}>
            <TrendingUp size={12} /> {busy ? 'Applying…' : 'Apply'}
          </button>
        </div>
        <p className="text-xs text-[#52525B] mt-3">
          {rows.length} employee{rows.length === 1 ? '' : 's'} · <strong>{inrDelta(totalDelta)}</strong> a month ·{' '}
          {inrDelta(totalDelta * 12)} a year
        </p>
      </div>

      <div className={`${PUI.card} divide-y divide-[#F4F4F5]`}>
        {rows.map(r => (
          <div key={r.employeeId} className="p-3 flex items-center gap-3 text-xs">
            <span className="flex-1 text-[#3F3F46] truncate">{r.employeeName}</span>
            <span className="text-[#A1A1AA] tabular-nums">{inr(r.currentAnchor)} → {inr(r.newAnchor)}</span>
            <span className={`font-semibold tabular-nums w-20 text-right ${deltaColor(r.delta)}`}>{inrDelta(r.delta)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function StatutoryTab({ staff, statutory, onReload }: {
  staff: StaffLite[]; statutory: Record<string, StatutoryRow>; onReload: () => Promise<void>
}) {
  const [busy, setBusy] = useState<string | null>(null)

  const patch = async (id: string, p: Partial<StatutoryRow>) => {
    setBusy(id)
    await upsertStatutory({ ...statutory[id], ...p, employee_id: id })
    setBusy(null)
    await onReload()
  }

  return (
    <div className="space-y-1.5">
      <p className="text-[11px] text-[#A1A1AA] mb-2 leading-relaxed">
        PF and ESI enrolment, UAN and IP number. A PF deduction with no UAN blocks the run — the ECR could not be
        filed for it.
      </p>
      {staff.map(s => {
        const st = statutory[s.id]
        return (
          <div key={s.id} className={`${PUI.card} p-3 flex flex-wrap items-center gap-3`}>
            <span className="text-sm text-[#27272A] flex-1 min-w-[10rem]">{s.full_name}</span>
            <label className="flex items-center gap-1.5 text-[11px] text-[#52525B]">
              <input type="checkbox" checked={st?.pf_applicable ?? false} disabled={busy === s.id}
                onChange={e => patch(s.id, { pf_applicable: e.target.checked })} />
              PF
            </label>
            <input defaultValue={st?.uan ?? ''} placeholder="UAN" onBlur={e => e.target.value !== (st?.uan ?? '') && patch(s.id, { uan: e.target.value || null })}
              className="w-36 border border-[#E4E4E7] rounded px-2 py-1 text-xs tabular-nums" />
            <input defaultValue={st?.esi_ip_number ?? ''} placeholder="ESI IP no." onBlur={e => e.target.value !== (st?.esi_ip_number ?? '') && patch(s.id, { esi_ip_number: e.target.value || null })}
              className="w-32 border border-[#E4E4E7] rounded px-2 py-1 text-xs tabular-nums" />
            <input type="number" defaultValue={st?.pf_wage_override ?? ''} placeholder="PF wage"
              onBlur={e => patch(s.id, { pf_wage_override: e.target.value === '' ? null : Number(e.target.value) })}
              className="w-24 border border-[#E4E4E7] rounded px-2 py-1 text-xs tabular-nums" />
          </div>
        )
      })}
    </div>
  )
}
