'use client'

import React, { useState, useEffect, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { ArrowLeft, Plus, Users, CalendarDays, AlertTriangle, Check, Trash2, Search } from 'lucide-react'
import ProtectedLayout from '@/components/ProtectedLayout'
import { useAuth } from '@/contexts/AuthContext'
import { supabase } from '@/lib/supabase'
import { PUI } from '@/components/payroll/ui'
import {
  fetchPolicyGroups, savePolicyGroup, setPolicyGroupMembers, deletePolicyGroup,
  fetchCalendars, saveCalendar, setCalendarMembers,
} from '@/lib/payroll/admin'
import { resolvePolicyFor, resolveCalendarFor, explainCoverage, hasAmbiguousCoverage, BUILTIN_POLICY } from '@/lib/payroll/engine/resolvePolicy'
import type { PolicyGroup, WorkingCalendar, EngineEmployee, PayrollPolicy, LopRule } from '@/lib/payroll/engine/types'

// Policy groups and working calendars — the answer to "different LOP rules for
// different groups of teachers".
//
// The resolution order is exactly the one the attendance module already uses for
// cutoff overrides: an explicit member list beats a rule match, which beats the
// school-wide default. The coverage check below runs that same resolver over
// every employee so an admin can see who lands where before a run does.

type Tab = 'groups' | 'calendars' | 'coverage'

export default function PayrollPoliciesPage() {
  return <ProtectedLayout adminOnly><Policies /></ProtectedLayout>
}

interface StaffLite { id: string; full_name: string; role: string; category: string | null; department: string | null; designation: string | null }

function Policies() {
  const { profile } = useAuth()
  const [tab, setTab] = useState<Tab>('groups')
  const [groups, setGroups] = useState<PolicyGroup[]>([])
  const [calendars, setCalendars] = useState<WorkingCalendar[]>([])
  const [staff, setStaff] = useState<StaffLite[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<PolicyGroup | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const [g, c, people] = await Promise.all([
      fetchPolicyGroups(),
      fetchCalendars(),
      supabase.from('profiles')
        .select('id, full_name, role, details:staff_details(employee_category, department, designation)')
        .in('role', ['teacher', 'coordinator', 'principal', 'driver']).eq('is_banned', false)
        .order('full_name'),
    ])
    setGroups(g); setCalendars(c)
    setStaff(((people.data ?? []) as unknown as {
      id: string; full_name: string; role: string
      details: { employee_category: string | null; department: string | null; designation: string | null }[] | null
    }[]).map(p => ({
      id: p.id, full_name: p.full_name, role: p.role,
      category: p.details?.[0]?.employee_category ?? null,
      department: p.details?.[0]?.department ?? null,
      designation: p.details?.[0]?.designation ?? null,
    })))
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const asEmployee = (s: StaffLite): EngineEmployee => ({
    id: s.id, name: s.full_name,
    category: (s.category as EngineEmployee['category']) ?? (s.role === 'driver' ? 'transport' : 'teaching'),
    dateOfJoining: null, dateOfExit: null, department: s.department, designation: s.designation,
    pan: null, uan: null, esiIpNumber: null, pfApplicable: false, epsApplicable: true,
    esiOverride: null, esiCoveredAtPeriodStart: null, pfWageOverride: null, jurisdictionOverride: null,
  })

  const today = new Date().toISOString().slice(0, 10)

  return (
    <div className="min-h-screen bg-[#FAFAFA]">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6">
        <Link href="/more/payroll" className="inline-flex items-center gap-1.5 text-sm text-[#71717A] hover:text-[#27272A] mb-4">
          <ArrowLeft size={16} /> Payroll
        </Link>

        <h1 className="font-display text-2xl font-bold text-[#27272A]">Policies &amp; calendars</h1>
        <p className="text-sm text-[#71717A] mt-0.5 mb-5">
          Loss-of-pay rules, leave treatment and working calendars, set per cohort rather than school-wide.
        </p>

        <div className="flex items-center gap-1 mb-4 border-b border-[#E4E4E7]">
          {([['groups', 'Policy groups'], ['calendars', 'Calendars'], ['coverage', 'Coverage check']] as [Tab, string][]).map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)}
              className={`px-3 py-2 text-xs font-semibold border-b-2 -mb-px transition-colors ${
                tab === k ? 'border-[#27272A] text-[#27272A]' : 'border-transparent text-[#A1A1AA] hover:text-[#71717A]'}`}>
              {l}
            </button>
          ))}
        </div>

        {loading ? (
          <div className={`${PUI.card} h-40 animate-pulse`} />
        ) : tab === 'groups' ? (
          <GroupsTab groups={groups} staff={staff} onEdit={setEditing} onReload={load} createdBy={profile?.id ?? ''} />
        ) : tab === 'calendars' ? (
          <CalendarsTab calendars={calendars} staff={staff} onReload={load} />
        ) : (
          <CoverageTab groups={groups} calendars={calendars} staff={staff} asEmployee={asEmployee} today={today} />
        )}

        {editing && (
          <PolicyEditor
            group={editing} staff={staff}
            onClose={() => setEditing(null)}
            onSaved={async () => { setEditing(null); await load() }}
          />
        )}
      </div>
    </div>
  )
}

// ── Groups ────────────────────────────────────────────────────────────────

function GroupsTab({ groups, staff, onEdit, onReload, createdBy }: {
  groups: PolicyGroup[]; staff: StaffLite[]; onEdit: (g: PolicyGroup) => void
  onReload: () => Promise<void>; createdBy: string
}) {
  const create = async () => {
    const res = await savePolicyGroup({
      name: 'New policy group', is_default: false, priority: 10,
      effective_from: '2000-01-01', policy: BUILTIN_POLICY,
    } as never)
    if (res.success) await onReload()
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between mb-1">
        <p className="text-[11px] text-[#A1A1AA] leading-relaxed max-w-lg">
          Higher priority wins. A group that lists people explicitly always beats one that matches on
          attributes, and both beat the school-wide default.
        </p>
        <button onClick={create} className={PUI.darkBtn}><Plus size={13} /> New group</button>
      </div>

      {groups.map(g => (
        <button key={g.id} onClick={() => onEdit(g)} className={`${PUI.card} p-3.5 w-full text-left hover:border-[#D4D4D8] transition-colors`}>
          <div className="flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <p className="text-sm font-semibold text-[#27272A]">{g.name}</p>
                {g.isDefault && (
                  <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-[#27272A] text-white">
                    Everyone
                  </span>
                )}
              </div>
              <p className="text-[11px] text-[#A1A1AA] mt-0.5">
                {g.isDefault
                  ? 'Applies to anyone no other group claims'
                  : g.memberIds.length > 0
                    ? `${g.memberIds.length} member${g.memberIds.length === 1 ? '' : 's'}`
                    : g.match
                      ? `Matches ${[g.match.categories?.join(', '), g.match.departments?.join(', ')].filter(Boolean).join(' · ')}`
                      : 'Selects nobody yet'}
                {' · '}priority {g.priority}
              </p>
              <p className="text-[11px] text-[#71717A] mt-1">
                {g.policy.lop.leave.freeCount} free leave, then {g.policy.lop.leave.tiers[0]?.lopDaysEach ?? 0} day(s) LOP each ·{' '}
                {g.policy.lop.late.freeCount} free lates
              </p>
            </div>
          </div>
        </button>
      ))}
    </div>
  )
}

// ── Policy editor ─────────────────────────────────────────────────────────

function PolicyEditor({ group, staff, onClose, onSaved }: {
  group: PolicyGroup; staff: StaffLite[]; onClose: () => void; onSaved: () => Promise<void>
}) {
  const [name, setName] = useState(group.name)
  const [priority, setPriority] = useState(group.priority)
  const [policy, setPolicy] = useState<PayrollPolicy>(group.policy)
  const [members, setMembers] = useState<string[]>(group.memberIds)
  const [q, setQ] = useState('')
  const [saving, setSaving] = useState(false)

  const filtered = staff.filter(s => s.full_name.toLowerCase().includes(q.toLowerCase()))

  const save = async () => {
    setSaving(true)
    const res = await savePolicyGroup({
      id: group.id, name, priority, is_default: group.isDefault,
      effective_from: group.effectiveFrom, effective_to: group.effectiveTo,
      match: group.match, policy,
    } as never)
    if (res.success && !group.isDefault) await setPolicyGroupMembers(group.id, members)
    setSaving(false)
    await onSaved()
  }

  const remove = async () => {
    if (!confirm(`Delete "${group.name}"? Anyone in it falls back to the default policy.`)) return
    await deletePolicyGroup(group.id)
    await onSaved()
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-6" onClick={onClose}>
      <div className="bg-white w-full sm:max-w-2xl rounded-t-2xl sm:rounded-2xl max-h-[92dvh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="p-5 space-y-5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1">
              <label className={PUI.label}>Name</label>
              <input value={name} onChange={e => setName(e.target.value)} className={`${PUI.input} mt-1`} disabled={group.isDefault} />
            </div>
            {!group.isDefault && (
              <div className="w-24">
                <label className={PUI.label}>Priority</label>
                <input type="number" value={priority} onChange={e => setPriority(Number(e.target.value))} className={`${PUI.input} mt-1`} />
              </div>
            )}
          </div>

          <div>
            <h3 className={`${PUI.label} mb-2`}>Loss of pay</h3>
            <LopEditor label="Leave and absence" rule={policy.lop.leave}
              onChange={r => setPolicy(p => ({ ...p, lop: { ...p.lop, leave: r } }))} />
            <LopEditor label="Late arrivals" rule={policy.lop.late}
              onChange={r => setPolicy(p => ({ ...p, lop: { ...p.lop, late: r } }))} />
          </div>

          <div>
            <h3 className={`${PUI.label} mb-2`}>How each kind of leave is paid</h3>
            <div className="space-y-1.5">
              {['casual', 'medical', 'on_duty', 'half_day', 'unapproved'].map(kind => (
                <div key={kind} className="flex items-center gap-3">
                  <span className="text-xs text-[#52525B] w-28 capitalize">{kind.replace('_', ' ')}</span>
                  <select
                    value={policy.leaveTreatment[kind] ?? 'lop'}
                    onChange={e => setPolicy(p => ({ ...p, leaveTreatment: { ...p.leaveTreatment, [kind]: e.target.value as never } }))}
                    className={`${PUI.input} flex-1`}
                  >
                    <option value="paid">Paid — no deduction</option>
                    <option value="half">Half day</option>
                    <option value="lop">Counts toward loss of pay</option>
                    <option value="unpaid">Unpaid</option>
                  </select>
                </div>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={PUI.label}>Late grace (minutes)</label>
              <input type="number" value={policy.lateGraceMinutes}
                onChange={e => setPolicy(p => ({ ...p, lateGraceMinutes: Number(e.target.value) }))} className={`${PUI.input} mt-1`} />
            </div>
            <div>
              <label className={PUI.label}>Notice period (days)</label>
              <input type="number" value={policy.noticePeriodDays}
                onChange={e => setPolicy(p => ({ ...p, noticePeriodDays: Number(e.target.value) }))} className={`${PUI.input} mt-1`} />
            </div>
          </div>

          <div>
            <h3 className={`${PUI.label} mb-2`}>Leave encashment on exit</h3>
            <label className="flex items-center gap-2 text-xs text-[#52525B] mb-2">
              <input type="checkbox" checked={policy.encashment.enabled}
                onChange={e => setPolicy(p => ({ ...p, encashment: { ...p.encashment, enabled: e.target.checked } }))} />
              Unused leave is encashed at full &amp; final settlement
            </label>
            {policy.encashment.enabled && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-[#71717A]">Priced on</label>
                  <select value={policy.encashment.rateBasis}
                    onChange={e => setPolicy(p => ({ ...p, encashment: { ...p.encashment, rateBasis: e.target.value as 'basic' | 'gross' } }))}
                    className={`${PUI.input} mt-1`}>
                    <option value="basic">Basic pay</option>
                    <option value="gross">Gross pay</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-[#71717A]">Maximum days</label>
                  <input type="number" value={policy.encashment.maxDays}
                    onChange={e => setPolicy(p => ({ ...p, encashment: { ...p.encashment, maxDays: Number(e.target.value) } }))}
                    className={`${PUI.input} mt-1`} />
                </div>
              </div>
            )}
          </div>

          {!group.isDefault && (
            <div>
              <h3 className={`${PUI.label} mb-2`}>Members ({members.length})</h3>
              <div className="relative mb-2">
                <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#A1A1AA]" />
                <input value={q} onChange={e => setQ(e.target.value)} placeholder="Find staff" className={`${PUI.input} pl-9`} />
              </div>
              <div className="max-h-56 overflow-y-auto border border-[#E4E4E7] rounded-lg divide-y divide-[#F4F4F5]">
                {filtered.map(s => (
                  <label key={s.id} className="flex items-center gap-2.5 px-3 py-2 cursor-pointer hover:bg-[#FAFAFA]">
                    <input type="checkbox" checked={members.includes(s.id)}
                      onChange={e => setMembers(m => e.target.checked ? [...m, s.id] : m.filter(x => x !== s.id))} />
                    <span className="text-xs text-[#3F3F46] flex-1">{s.full_name}</span>
                    <span className="text-[10px] text-[#A1A1AA]">{s.designation ?? s.role}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          <div className="flex items-center gap-2 pt-2">
            <button onClick={save} disabled={saving} className={PUI.darkBtn}>{saving ? 'Saving…' : 'Save'}</button>
            <button onClick={onClose} className={PUI.ghostBtn}>Cancel</button>
            {!group.isDefault && (
              <button onClick={remove} className={`${PUI.dangerBtn} ml-auto`}><Trash2 size={12} /> Delete</button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function LopEditor({ label, rule, onChange }: { label: string; rule: LopRule; onChange: (r: LopRule) => void }) {
  return (
    <div className="mb-3 p-3 rounded-lg bg-[#FAFAFA] border border-[#F4F4F5]">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xs font-semibold text-[#3F3F46] flex-1">{label}</span>
        <span className="text-[11px] text-[#71717A]">Free per month</span>
        <input type="number" min={0} value={rule.freeCount}
          onChange={e => onChange({ ...rule, freeCount: Number(e.target.value) })}
          className="w-14 border border-[#E4E4E7] rounded px-2 py-1 text-xs text-center tabular-nums" />
      </div>
      <div className="space-y-1.5">
        {rule.tiers.map((t, i) => (
          <div key={i} className="flex items-center gap-1.5 text-[11px] text-[#71717A]">
            <span>Next</span>
            <input type="number" value={t.count ?? ''} placeholder="rest"
              onChange={e => onChange({ ...rule, tiers: rule.tiers.map((x, xi) => xi === i ? { ...x, count: e.target.value === '' ? null : Number(e.target.value) } : x) })}
              className="w-14 border border-[#E4E4E7] rounded px-2 py-1 text-center tabular-nums" />
            <span>→</span>
            <input type="number" step={0.5} value={t.lopDaysEach}
              onChange={e => onChange({ ...rule, tiers: rule.tiers.map((x, xi) => xi === i ? { ...x, lopDaysEach: Number(e.target.value) } : x) })}
              className="w-14 border border-[#E4E4E7] rounded px-2 py-1 text-center tabular-nums" />
            <span>day(s) LOP each</span>
            {rule.tiers.length > 1 && (
              <button onClick={() => onChange({ ...rule, tiers: rule.tiers.filter((_, xi) => xi !== i) })}
                className="ml-auto text-[#D4D4D8] hover:text-rose-500"><Trash2 size={11} /></button>
            )}
          </div>
        ))}
        <button onClick={() => onChange({ ...rule, tiers: [...rule.tiers, { count: null, lopDaysEach: 1 }] })}
          className="text-[11px] font-semibold text-[#71717A] hover:text-[#27272A]">+ Add tier</button>
      </div>
      <p className="text-[10px] text-[#A1A1AA] mt-2 leading-relaxed">
        Past the last tier the same rate keeps applying, so an escalating schedule never caps out.
      </p>
    </div>
  )
}

// ── Calendars ─────────────────────────────────────────────────────────────

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

function CalendarsTab({ calendars, staff, onReload }: { calendars: WorkingCalendar[]; staff: StaffLite[]; onReload: () => Promise<void> }) {
  const [editing, setEditing] = useState<WorkingCalendar | null>(null)

  const create = async () => {
    const res = await saveCalendar({
      name: 'New calendar', is_default: false, priority: 10, effective_from: '2000-01-01',
      basis: 'calendar_days', fixed_days: 30,
      week_pattern: ['off', 'full', 'full', 'full', 'full', 'full', 'full'], nth_weekday_rules: [],
    } as never)
    if (res.success) await onReload()
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between mb-1">
        <p className="text-[11px] text-[#A1A1AA] max-w-lg leading-relaxed">
          What a day of pay is divided by, and which days are working days. Holidays come from the existing
          attendance holiday list, which is already scoped per group.
        </p>
        <button onClick={create} className={PUI.darkBtn}><Plus size={13} /> New calendar</button>
      </div>

      {calendars.map(c => (
        <div key={c.id} className={`${PUI.card} p-3.5`}>
          <div className="flex items-center gap-2 mb-1">
            <p className="text-sm font-semibold text-[#27272A]">{c.name}</p>
            {c.isDefault && <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-[#27272A] text-white">Everyone</span>}
          </div>
          <p className="text-[11px] text-[#71717A]">
            {c.basis === 'calendar_days' ? 'Salary ÷ every day in the month'
              : c.basis === 'fixed_days' ? `Salary ÷ a fixed ${c.fixedDays} days`
              : c.basis === 'calendar_minus_holidays' ? 'Salary ÷ (days in month − holidays)'
              : 'Salary ÷ scheduled working days'}
            {' · '}
            {c.weekPattern.map((m, i) => m === 'off' ? WEEKDAYS[i].slice(0, 3) : null).filter(Boolean).join(', ') || 'no weekly off'} off
            {c.nthWeekdayRules.length > 0 && ` · ${c.nthWeekdayRules.map(r => `${r.nth.join(' & ')}${r.nth.includes(-1) ? '' : ''} ${WEEKDAYS[r.weekday]}`).join(', ')} ${c.nthWeekdayRules[0].mode}`}
          </p>
          <p className="text-[11px] text-[#A1A1AA] mt-0.5">
            {c.isDefault ? 'Applies to anyone no other calendar claims' : `${c.memberIds.length} member(s) · priority ${c.priority}`}
          </p>
        </div>
      ))}
    </div>
  )
}

// ── Coverage check ────────────────────────────────────────────────────────

function CoverageTab({ groups, calendars, staff, asEmployee, today }: {
  groups: PolicyGroup[]; calendars: WorkingCalendar[]; staff: StaffLite[]
  asEmployee: (s: StaffLite) => EngineEmployee; today: string
}) {
  const rows = useMemo(() => staff.map(s => {
    const emp = asEmployee(s)
    const p = resolvePolicyFor(groups, emp, today)
    const c = resolveCalendarFor(calendars, emp, today)
    return {
      staff: s,
      policyName: p.source.groupName,
      policyWhy: p.source.why,
      policyRank: p.source.rank,
      calendarName: c.source.groupName,
      ambiguous: hasAmbiguousCoverage(groups, emp, today),
      contenders: explainCoverage(groups, emp, today).length,
    }
  }), [staff, groups, calendars, asEmployee, today])

  const ambiguous = rows.filter(r => r.ambiguous)

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-[#A1A1AA] leading-relaxed">
        This runs the same resolver the payroll engine uses, so what you see here is exactly what a run will do.
      </p>

      {ambiguous.length > 0 && (
        <div className="flex items-start gap-2.5 p-3 rounded-xl bg-amber-50 border border-amber-200">
          <AlertTriangle size={15} className="text-amber-600 mt-0.5 flex-shrink-0" />
          <p className="text-xs text-amber-900 leading-relaxed">
            <strong>{ambiguous.length} employee{ambiguous.length === 1 ? ' is' : 's are'} claimed by two groups at the same priority.</strong>{' '}
            The resolver will pick one, but which one is not something you should have to guess — give one of the
            competing groups a higher priority.
          </p>
        </div>
      )}

      <div className={`${PUI.card} divide-y divide-[#F4F4F5]`}>
        {rows.map(r => (
          <div key={r.staff.id} className="p-3 flex items-start gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-sm text-[#27272A]">{r.staff.full_name}</p>
              <p className="text-[11px] text-[#71717A] mt-0.5 leading-relaxed">{r.policyWhy}</p>
            </div>
            <div className="text-right flex-shrink-0">
              <p className="text-[11px] font-semibold text-[#27272A]">{r.policyName}</p>
              <p className="text-[10px] text-[#A1A1AA]">{r.calendarName}</p>
              {r.ambiguous && (
                <span className="text-[10px] font-bold text-amber-600">Ambiguous</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
