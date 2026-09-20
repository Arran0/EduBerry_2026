'use client'

import React, { useState, useEffect, useCallback, useMemo } from 'react'
import Link from 'next/link'
import {
  ArrowLeft, Plus, MapPin, Building2, AlertTriangle, Search, X, Check, Archive,
} from 'lucide-react'
import ProtectedLayout from '@/components/ProtectedLayout'
import { useAuth } from '@/contexts/AuthContext'
import { supabase } from '@/lib/supabase'
import { PUI } from '@/components/payroll/ui'
import {
  fetchLocations, saveLocation, archiveLocation, assignToLocation,
  fetchEntities, saveEntity, fetchDefaultJurisdiction, saveDefaultJurisdiction,
  INDIAN_STATES, stateName, type LegalEntity, type LocationInput,
} from '@/lib/payroll/locations'
import { fetchRuleSets } from '@/lib/payroll/admin'
import { resolveJurisdiction, locationCoverage, hasAmbiguousLocation } from '@/lib/payroll/engine/resolveLocation'
import type { WorkLocation, EngineEmployee } from '@/lib/payroll/engine/types'
import type { RuleSetRow } from '@/lib/payroll/rows'

// Work locations — the dimension multi-state payroll hangs off.
//
// A location carries the state, and the state selects the Professional Tax and
// LWF rule sets; it carries the EPFO establishment id and ESIC employer code,
// and the monthly returns are filed per establishment. Assigning somebody to an
// office is therefore a tax decision, which is why the coverage tab runs the
// engine's own resolver rather than describing what it thinks the engine does.

type Tab = 'locations' | 'entities' | 'coverage'

export default function PayrollLocationsPage() {
  return <ProtectedLayout adminOnly><Locations /></ProtectedLayout>
}

interface StaffLite {
  id: string; full_name: string; role: string
  category: string | null; department: string | null; designation: string | null
  ptOverride: string | null
}

function Locations() {
  const { profile } = useAuth()
  const [tab, setTab] = useState<Tab>('locations')
  const [locations, setLocations] = useState<WorkLocation[]>([])
  const [entities, setEntities] = useState<LegalEntity[]>([])
  const [staff, setStaff] = useState<StaffLite[]>([])
  const [defaultState, setDefaultState] = useState('IN-TN')
  // Published only: a draft rule set is one nobody has verified against the
  // state's notification yet, and the engine will not price with it either.
  const [ruleSets, setRuleSets] = useState<RuleSetRow[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<WorkLocation | 'new' | null>(null)
  const [assigning, setAssigning] = useState<WorkLocation | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const [locs, ents, people, def, rules] = await Promise.all([
      fetchLocations(),
      fetchEntities(),
      supabase.from('profiles')
        .select('id, full_name, role, details:staff_details(employee_category, department, designation, pt_jurisdiction)')
        .in('role', ['teacher', 'coordinator', 'principal', 'driver']).eq('is_banned', false)
        .order('full_name'),
      fetchDefaultJurisdiction(),
      fetchRuleSets(false),
    ])
    setLocations(locs); setEntities(ents); setDefaultState(def); setRuleSets(rules)
    setStaff(((people.data ?? []) as unknown as {
      id: string; full_name: string; role: string
      details: { employee_category: string | null; department: string | null; designation: string | null; pt_jurisdiction: string | null }[] | null
    }[]).map(p => ({
      id: p.id, full_name: p.full_name, role: p.role,
      category: p.details?.[0]?.employee_category ?? null,
      department: p.details?.[0]?.department ?? null,
      designation: p.details?.[0]?.designation ?? null,
      ptOverride: p.details?.[0]?.pt_jurisdiction ?? null,
    })))
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const asEmployee = (s: StaffLite): EngineEmployee => ({
    id: s.id, name: s.full_name,
    category: (s.category as EngineEmployee['category']) ?? (s.role === 'driver' ? 'transport' : 'teaching'),
    dateOfJoining: null, dateOfExit: null, department: s.department, designation: s.designation,
    pan: null, uan: null, esiIpNumber: null, pfApplicable: false, epsApplicable: true,
    esiOverride: null, esiCoveredAtPeriodStart: null, pfWageOverride: null,
    jurisdictionOverride: s.ptOverride,
  })

  const today = new Date().toISOString().slice(0, 10)

  return (
    <div className="min-h-screen bg-[#FAFAFA]">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6">
        <Link href="/more/payroll" className="inline-flex items-center gap-1.5 text-sm text-[#71717A] hover:text-[#27272A] mb-4">
          <ArrowLeft size={16} /> Payroll
        </Link>

        <h1 className="font-display text-2xl font-bold text-[#27272A]">Work locations</h1>
        <p className="text-sm text-[#71717A] mt-0.5 mb-5">
          Offices, the state each sits in, and the statutory registrations their returns are filed under.
        </p>

        <div className="flex items-center gap-1 mb-4 border-b border-[#E4E4E7]">
          {([['locations', 'Locations'], ['entities', 'Legal entities'], ['coverage', 'Coverage check']] as [Tab, string][]).map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)}
              className={`px-3 py-2 text-xs font-semibold border-b-2 -mb-px transition-colors ${
                tab === k ? 'border-[#27272A] text-[#27272A]' : 'border-transparent text-[#A1A1AA] hover:text-[#71717A]'}`}>
              {l}
            </button>
          ))}
        </div>

        {loading ? (
          <div className={`${PUI.card} h-40 animate-pulse`} />
        ) : tab === 'locations' ? (
          <LocationsTab
            locations={locations} staff={staff} ruleSets={ruleSets}
            defaultState={defaultState}
            onDefaultState={async (s) => { setDefaultState(s); await saveDefaultJurisdiction(s) }}
            onEdit={setEditing} onAssign={setAssigning} onReload={load}
          />
        ) : tab === 'entities' ? (
          <EntitiesTab entities={entities} locations={locations} onReload={load} />
        ) : (
          <CoverageTab locations={locations} staff={staff} asEmployee={asEmployee} today={today} defaultState={defaultState} />
        )}

        {editing && (
          <LocationEditor
            location={editing === 'new' ? null : editing}
            entities={entities} ruleSets={ruleSets}
            onClose={() => setEditing(null)}
            onSaved={async () => { setEditing(null); await load() }}
          />
        )}

        {assigning && (
          <AssignDrawer
            location={assigning} staff={staff} locations={locations}
            actorId={profile?.id ?? ''}
            onClose={() => setAssigning(null)}
            onSaved={async () => { setAssigning(null); await load() }}
          />
        )}
      </div>
    </div>
  )
}

// ── Locations ─────────────────────────────────────────────────────────────

/** Whether this state has published PT and LWF rules. A location without them files nothing. */
function statutoryReadiness(loc: WorkLocation, ruleSets: RuleSetRow[]) {
  const has = (domain: string) => ruleSets.some(r => r.domain === domain && r.jurisdiction === loc.stateCode)
  return {
    pt: has('pt'),
    lwf: has('lwf'),
    epf: !!loc.epfEstablishmentId,
    esi: !!loc.esiEmployerCode,
  }
}

function LocationsTab({ locations, staff: _staff, ruleSets, defaultState, onDefaultState, onEdit, onAssign, onReload }: {
  locations: WorkLocation[]; staff: StaffLite[]; ruleSets: RuleSetRow[]
  defaultState: string; onDefaultState: (s: string) => Promise<void>
  onEdit: (l: WorkLocation | 'new') => void; onAssign: (l: WorkLocation) => void
  onReload: () => Promise<void>
}) {
  const today = new Date().toISOString().slice(0, 10)
  const liveCount = (l: WorkLocation) =>
    l.members.filter(m => m.effectiveFrom <= today && (m.effectiveTo === null || m.effectiveTo >= today)).length

  const states = [...new Set(locations.map(l => l.stateCode))]

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[11px] text-[#A1A1AA] leading-relaxed max-w-lg">
          Higher priority wins. A location that lists people explicitly beats one that matches on attributes,
          and both beat the default. Membership is dated: a transfer leaves the earlier months where they were.
        </p>
        <button onClick={() => onEdit('new')} className={PUI.darkBtn}><Plus size={13} /> New location</button>
      </div>

      {states.length > 1 && (
        <div className="flex items-start gap-2.5 p-3 rounded-xl bg-sky-50 border border-sky-200">
          <MapPin size={15} className="text-sky-600 mt-0.5 flex-shrink-0" />
          <p className="text-xs text-sky-900 leading-relaxed">
            <strong>This is a {states.length}-state payroll.</strong> Each run pins the Professional Tax and LWF
            rule set for every state present, and each location&apos;s EPF and ESI returns are generated separately.
          </p>
        </div>
      )}

      {locations.map(l => {
        const ready = statutoryReadiness(l, ruleSets)
        const gaps = [
          !ready.epf && 'EPFO establishment id',
          !ready.esi && 'ESIC employer code',
          !ready.pt && `no published Professional Tax rules for ${stateName(l.stateCode)}`,
        ].filter(Boolean) as string[]

        return (
          <div key={l.id} className={`${PUI.card} p-3.5`}>
            <div className="flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-sm font-semibold text-[#27272A]">{l.name}</p>
                  {l.isDefault && (
                    <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-[#27272A] text-white">
                      Default
                    </span>
                  )}
                  <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-[#F4F4F5] text-[#52525B] border border-[#E4E4E7]">
                    {stateName(l.stateCode)}
                  </span>
                </div>
                <p className="text-[11px] text-[#A1A1AA] mt-0.5">
                  {l.entityName || 'No entity'} · {liveCount(l)} staff today · priority {l.priority}
                </p>
                <p className="text-[11px] text-[#71717A] mt-1">
                  EPF {l.epfEstablishmentId || '—'} · ESI {l.esiEmployerCode || '—'}
                </p>
                {gaps.length > 0 && (
                  <p className="text-[11px] text-amber-700 mt-1.5 leading-relaxed">
                    <AlertTriangle size={11} className="inline mb-0.5 mr-1" />
                    Cannot file yet: {gaps.join(', ')}.
                  </p>
                )}
              </div>
              <div className="flex flex-col gap-1.5 flex-shrink-0">
                <button onClick={() => onEdit(l)} className={PUI.ghostBtn}>Edit</button>
                <button onClick={() => onAssign(l)} className={PUI.ghostBtn}>Assign staff</button>
              </div>
            </div>
          </div>
        )
      })}

      <div className={`${PUI.card} p-3.5`}>
        <p className={PUI.label}>Fallback state</p>
        <p className="text-[11px] text-[#A1A1AA] mt-1 mb-2 leading-relaxed">
          Used only for somebody with no work location at all — which is itself a blocking exception on a run,
          so this is a safety net rather than a setting that should ever matter.
        </p>
        <select value={defaultState} onChange={e => onDefaultState(e.target.value)} className={PUI.input}>
          {INDIAN_STATES.map(s => <option key={s.code} value={s.code}>{s.name}</option>)}
        </select>
      </div>

      {locations.length > 1 && (
        <p className="text-[11px] text-[#A1A1AA]">
          Archiving a location keeps its history: past runs still name it, and its returns still reconcile.
        </p>
      )}
      {/* Archiving lives in the editor, not here — it is not a one-click action. */}
      <ArchiveHint locations={locations} onReload={onReload} />
    </div>
  )
}

function ArchiveHint({ locations, onReload }: { locations: WorkLocation[]; onReload: () => Promise<void> }) {
  const [busy, setBusy] = useState<string | null>(null)
  const empty = locations.filter(l => !l.isDefault && l.members.length === 0)
  if (empty.length === 0) return null
  return (
    <div className={`${PUI.card} p-3.5`}>
      <p className={PUI.label}>Unused locations</p>
      <div className="mt-2 space-y-1.5">
        {empty.map(l => (
          <div key={l.id} className="flex items-center justify-between gap-2">
            <p className="text-xs text-[#71717A]">{l.name} — nobody has ever been assigned here</p>
            <button
              disabled={busy === l.id}
              onClick={async () => { setBusy(l.id); await archiveLocation(l.id); await onReload(); setBusy(null) }}
              className={PUI.ghostBtn}>
              <Archive size={12} /> Archive
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Location editor ───────────────────────────────────────────────────────

function LocationEditor({ location, entities, ruleSets, onClose, onSaved }: {
  location: WorkLocation | null; entities: LegalEntity[]; ruleSets: RuleSetRow[]
  onClose: () => void; onSaved: () => Promise<void>
}) {
  const [form, setForm] = useState<LocationInput>({
    entityId: location?.entityId ?? entities[0]?.id ?? '',
    name: location?.name ?? '',
    code: null,
    address: null,
    stateCode: location?.stateCode ?? 'IN-TN',
    isDefault: location?.isDefault ?? false,
    priority: location?.priority ?? 10,
    match: location?.match ?? null,
    epfEstablishmentId: location?.epfEstablishmentId ?? null,
    esiEmployerCode: location?.esiEmployerCode ?? null,
    ptRegistrationNo: location?.ptRegistrationNo ?? null,
    ptEnrolmentNo: null,
    lwfRegistrationNo: location?.lwfRegistrationNo ?? null,
    effectiveFrom: location?.effectiveFrom ?? '2000-01-01',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const set = <K extends keyof LocationInput>(k: K, v: LocationInput[K]) => setForm(f => ({ ...f, [k]: v }))

  // What this state will actually deduct, read from the same published rule sets
  // the engine reads. A state with nothing published says so here rather than at
  // the end of a pay run.
  const stateRules = useMemo(() => ({
    pt: ruleSets.find(r => r.domain === 'pt' && r.jurisdiction === form.stateCode) ?? null,
    lwf: ruleSets.find(r => r.domain === 'lwf' && r.jurisdiction === form.stateCode) ?? null,
  }), [ruleSets, form.stateCode])

  const save = async () => {
    if (!form.name.trim()) { setError('Give the location a name.'); return }
    if (!form.entityId) { setError('Every location belongs to a legal entity. Create one first.'); return }
    setSaving(true); setError(null)
    const res = await saveLocation(form, location?.id)
    setSaving(false)
    if (!res.success) { setError(res.error ?? 'Could not save'); return }
    await onSaved()
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/30 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div className="bg-white w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl max-h-[92vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="sticky top-0 bg-white border-b border-[#E4E4E7] px-4 py-3 flex items-center justify-between">
          <p className="text-sm font-bold text-[#27272A]">{location ? 'Edit location' : 'New location'}</p>
          <button onClick={onClose} className="text-[#A1A1AA] hover:text-[#27272A]"><X size={18} /></button>
        </div>

        <div className="p-4 space-y-3.5">
          <div>
            <label className={PUI.label}>Name</label>
            <input className={`${PUI.input} mt-1`} value={form.name} onChange={e => set('name', e.target.value)} placeholder="Bengaluru campus" />
          </div>

          <div>
            <label className={PUI.label}>Legal entity</label>
            <select className={`${PUI.input} mt-1`} value={form.entityId} onChange={e => set('entityId', e.target.value)}>
              {entities.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </div>

          <div>
            <label className={PUI.label}>State</label>
            <select className={`${PUI.input} mt-1`} value={form.stateCode} onChange={e => set('stateCode', e.target.value)}>
              {INDIAN_STATES.map(s => <option key={s.code} value={s.code}>{s.name}</option>)}
            </select>
            <div className="mt-2 p-2.5 rounded-lg bg-[#FAFAFA] border border-[#E4E4E7]">
              <p className="text-[11px] text-[#52525B] leading-relaxed">
                {stateRules.pt
                  ? <>Professional Tax: <strong>{stateRules.pt.jurisdiction} v{stateRules.pt.version}</strong>, in force from {stateRules.pt.effective_from}.</>
                  : <span className="text-amber-700">No published Professional Tax rules for {stateName(form.stateCode)}. Publish a rule set on the Compliance screen, or a run covering this office will be blocked.</span>}
              </p>
              <p className="text-[11px] text-[#52525B] leading-relaxed mt-1">
                {stateRules.lwf
                  ? <>Labour Welfare Fund: <strong>v{stateRules.lwf.version}</strong>, deducted in month(s) {(stateRules.lwf.rules as { deductionMonths?: number[] }).deductionMonths?.join(', ') ?? '—'}.</>
                  : <>No Labour Welfare Fund rules published for {stateName(form.stateCode)} — nothing will be deducted.</>}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={PUI.label}>EPFO establishment id</label>
              <input className={`${PUI.input} mt-1`} value={form.epfEstablishmentId ?? ''} onChange={e => set('epfEstablishmentId', e.target.value)} placeholder="TNMAS0012345000" />
            </div>
            <div>
              <label className={PUI.label}>ESIC employer code</label>
              <input className={`${PUI.input} mt-1`} value={form.esiEmployerCode ?? ''} onChange={e => set('esiEmployerCode', e.target.value)} placeholder="51000123450001000" />
            </div>
            <div>
              <label className={PUI.label}>PT registration no.</label>
              <input className={`${PUI.input} mt-1`} value={form.ptRegistrationNo ?? ''} onChange={e => set('ptRegistrationNo', e.target.value)} />
            </div>
            <div>
              <label className={PUI.label}>LWF registration no.</label>
              <input className={`${PUI.input} mt-1`} value={form.lwfRegistrationNo ?? ''} onChange={e => set('lwfRegistrationNo', e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={PUI.label}>Priority</label>
              <input type="number" className={`${PUI.input} mt-1`} value={form.priority} onChange={e => set('priority', Number(e.target.value))} />
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-2 text-xs text-[#52525B] pb-2">
                <input type="checkbox" checked={form.isDefault} onChange={e => set('isDefault', e.target.checked)} />
                Default location
              </label>
            </div>
          </div>

          {error && <p className="text-xs text-rose-600">{error}</p>}

          <div className="flex items-center gap-2 pt-1">
            <button onClick={save} disabled={saving} className={PUI.darkBtn}>
              <Check size={13} /> {saving ? 'Saving…' : 'Save location'}
            </button>
            <button onClick={onClose} className={PUI.ghostBtn}>Cancel</button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Assignment ────────────────────────────────────────────────────────────

function AssignDrawer({ location, staff, locations, actorId, onClose, onSaved }: {
  location: WorkLocation; staff: StaffLite[]; locations: WorkLocation[]
  actorId: string; onClose: () => void; onSaved: () => Promise<void>
}) {
  const today = new Date().toISOString().slice(0, 10)
  const firstOfNextMonth = (() => {
    const d = new Date()
    return new Date(Date.UTC(d.getFullYear(), d.getMonth() + 1, 1)).toISOString().slice(0, 10)
  })()

  const [picked, setPicked] = useState<string[]>([])
  const [from, setFrom] = useState(firstOfNextMonth)
  const [reason, setReason] = useState('')
  const [q, setQ] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const currentOf = (employeeId: string) =>
    locations.find(l => l.members.some(m =>
      m.employeeId === employeeId && m.effectiveFrom <= today && (m.effectiveTo === null || m.effectiveTo >= today)))

  const filtered = staff.filter(s => s.full_name.toLowerCase().includes(q.toLowerCase()))

  // Moving somebody to a different state mid-year is the case worth naming out
  // loud, because it changes which state's PT they pay from that month.
  const crossState = picked
    .map(id => ({ id, from: currentOf(id) }))
    .filter(p => p.from && p.from.stateCode !== location.stateCode)

  const save = async () => {
    setSaving(true); setError(null)
    const res = await assignToLocation(location.id, picked, from, reason || null, actorId)
    setSaving(false)
    if (!res.success) { setError(res.error ?? 'Could not assign'); return }
    await onSaved()
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/30 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div className="bg-white w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl max-h-[92vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="sticky top-0 bg-white border-b border-[#E4E4E7] px-4 py-3 flex items-center justify-between">
          <div>
            <p className="text-sm font-bold text-[#27272A]">Assign to {location.name}</p>
            <p className="text-[11px] text-[#A1A1AA]">{stateName(location.stateCode)}</p>
          </div>
          <button onClick={onClose} className="text-[#A1A1AA] hover:text-[#27272A]"><X size={18} /></button>
        </div>

        <div className="p-4 space-y-3.5">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={PUI.label}>Effective from</label>
              <input type="date" className={`${PUI.input} mt-1`} value={from} onChange={e => setFrom(e.target.value)} />
            </div>
            <div>
              <label className={PUI.label}>Reason</label>
              <input className={`${PUI.input} mt-1`} value={reason} onChange={e => setReason(e.target.value)} placeholder="Transfer" />
            </div>
          </div>

          <p className="text-[11px] text-[#A1A1AA] leading-relaxed">
            The previous assignment is closed the day before this date and kept. Months already run in the old
            state stay in the old state — that is what was filed.
          </p>

          {crossState.length > 0 && (
            <div className="flex items-start gap-2.5 p-3 rounded-xl bg-amber-50 border border-amber-200">
              <AlertTriangle size={15} className="text-amber-600 mt-0.5 flex-shrink-0" />
              <p className="text-xs text-amber-900 leading-relaxed">
                <strong>{crossState.length} of these move between states.</strong> Their Professional Tax and
                LWF change from {from}. Where a state deducts PT half-yearly, the instalment falls wherever they
                are in the month it is taken.
              </p>
            </div>
          )}

          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-2.5 text-[#A1A1AA]" />
            <input className={`${PUI.input} pl-8`} placeholder="Search staff" value={q} onChange={e => setQ(e.target.value)} />
          </div>

          <div className="max-h-64 overflow-y-auto border border-[#E4E4E7] rounded-lg divide-y divide-[#F4F4F5]">
            {filtered.map(s => {
              const cur = currentOf(s.id)
              const on = picked.includes(s.id)
              return (
                <button key={s.id}
                  onClick={() => setPicked(p => on ? p.filter(x => x !== s.id) : [...p, s.id])}
                  className={`w-full text-left px-3 py-2 flex items-center gap-2 ${on ? 'bg-[#FBF6E9]' : 'hover:bg-[#FAFAFA]'}`}>
                  <span className={`w-3.5 h-3.5 rounded border flex items-center justify-center flex-shrink-0 ${on ? 'bg-[#27272A] border-[#27272A]' : 'border-[#D4D4D8]'}`}>
                    {on && <Check size={10} className="text-white" />}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-xs text-[#27272A] truncate">{s.full_name}</span>
                    <span className="block text-[10px] text-[#A1A1AA]">
                      {cur ? `${cur.name} · ${stateName(cur.stateCode)}` : 'Unassigned'}
                      {s.ptOverride ? ` · taxed in ${stateName(s.ptOverride)} by override` : ''}
                    </span>
                  </span>
                </button>
              )
            })}
          </div>

          {error && <p className="text-xs text-rose-600">{error}</p>}

          <div className="flex items-center gap-2">
            <button onClick={save} disabled={saving || picked.length === 0} className={PUI.darkBtn}>
              <Check size={13} /> {saving ? 'Assigning…' : `Assign ${picked.length || ''}`.trim()}
            </button>
            <button onClick={onClose} className={PUI.ghostBtn}>Cancel</button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Entities ──────────────────────────────────────────────────────────────

function EntitiesTab({ entities, locations, onReload }: {
  entities: LegalEntity[]; locations: WorkLocation[]; onReload: () => Promise<void>
}) {
  const [editing, setEditing] = useState<LegalEntity | 'new' | null>(null)

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[11px] text-[#A1A1AA] leading-relaxed max-w-lg">
          The deductor on a TDS return. Most schools have one; a trust running two registered societies has two,
          with two TANs, and their Form 24Q returns are filed separately.
        </p>
        <button onClick={() => setEditing('new')} className={PUI.darkBtn}><Plus size={13} /> New entity</button>
      </div>

      {entities.map(e => (
        <div key={e.id} className={`${PUI.card} p-3.5 flex items-start gap-3`}>
          <Building2 size={16} className="text-[#A1A1AA] mt-0.5" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-sm font-semibold text-[#27272A]">{e.name}</p>
              {e.isDefault && <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-[#27272A] text-white">Default</span>}
            </div>
            <p className="text-[11px] text-[#71717A] mt-0.5">
              PAN {e.pan || '—'} · TAN {e.tan || '—'} ·{' '}
              {locations.filter(l => l.entityId === e.id).length} location(s)
            </p>
            {!e.tan && (
              <p className="text-[11px] text-amber-700 mt-1">
                <AlertTriangle size={11} className="inline mb-0.5 mr-1" />
                No TAN — a TDS return cannot be filed for this entity.
              </p>
            )}
          </div>
          <button onClick={() => setEditing(e)} className={PUI.ghostBtn}>Edit</button>
        </div>
      ))}

      {editing && (
        <EntityEditor
          entity={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={async () => { setEditing(null); await onReload() }}
        />
      )}
    </div>
  )
}

function EntityEditor({ entity, onClose, onSaved }: {
  entity: LegalEntity | null; onClose: () => void; onSaved: () => Promise<void>
}) {
  const [form, setForm] = useState({
    name: entity?.name ?? '', pan: entity?.pan ?? '', tan: entity?.tan ?? '',
    registeredAddress: entity?.registeredAddress ?? '',
    deductorName: entity?.deductorName ?? '', deductorDesignation: entity?.deductorDesignation ?? '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async () => {
    if (!form.name.trim()) { setError('Give the entity a name.'); return }
    setSaving(true); setError(null)
    const res = await saveEntity({ ...form, name: form.name.trim() }, entity?.id)
    setSaving(false)
    if (!res.success) { setError(res.error ?? 'Could not save'); return }
    await onSaved()
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/30 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div className="bg-white w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl" onClick={e => e.stopPropagation()}>
        <div className="border-b border-[#E4E4E7] px-4 py-3 flex items-center justify-between">
          <p className="text-sm font-bold text-[#27272A]">{entity ? 'Edit entity' : 'New legal entity'}</p>
          <button onClick={onClose} className="text-[#A1A1AA] hover:text-[#27272A]"><X size={18} /></button>
        </div>
        <div className="p-4 space-y-3">
          {([
            ['name', 'Name', 'Springfield Educational Trust'],
            ['pan', 'PAN', 'AAAAA0000A'],
            ['tan', 'TAN', 'CHEA00000B'],
            ['deductorName', 'Deductor name', 'For Form 24Q'],
            ['deductorDesignation', 'Deductor designation', 'Correspondent'],
          ] as [keyof typeof form, string, string][]).map(([k, label, ph]) => (
            <div key={k}>
              <label className={PUI.label}>{label}</label>
              <input className={`${PUI.input} mt-1`} value={form[k]} placeholder={ph}
                onChange={e => setForm(f => ({ ...f, [k]: e.target.value }))} />
            </div>
          ))}
          {error && <p className="text-xs text-rose-600">{error}</p>}
          <div className="flex items-center gap-2 pt-1">
            <button onClick={save} disabled={saving} className={PUI.darkBtn}><Check size={13} /> {saving ? 'Saving…' : 'Save'}</button>
            <button onClick={onClose} className={PUI.ghostBtn}>Cancel</button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Coverage ──────────────────────────────────────────────────────────────

function CoverageTab({ locations, staff, asEmployee, today, defaultState }: {
  locations: WorkLocation[]; staff: StaffLite[]
  asEmployee: (s: StaffLite) => EngineEmployee; today: string; defaultState: string
}) {
  const rows = useMemo(() => staff.map(s => {
    const emp = asEmployee(s)
    const r = resolveJurisdiction(locations, emp, today, defaultState)
    return {
      staff: s,
      jurisdiction: r.jurisdiction,
      locationName: r.location?.name ?? null,
      why: r.why,
      unlocated: r.unlocated,
      ambiguous: hasAmbiguousLocation(locations, emp, today),
      contenders: locationCoverage(locations, emp, today).length,
    }
  }), [staff, locations, asEmployee, today, defaultState])

  const unlocated = rows.filter(r => r.unlocated)
  const ambiguous = rows.filter(r => r.ambiguous)
  const byState = rows.reduce<Record<string, number>>((acc, r) => {
    acc[r.jurisdiction] = (acc[r.jurisdiction] ?? 0) + 1
    return acc
  }, {})

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-[#A1A1AA] leading-relaxed">
        This runs the same resolver the payroll engine uses, so what you see here is exactly what a run will do.
      </p>

      <div className={`${PUI.card} p-3.5`}>
        <p className={PUI.label}>Headcount by state</p>
        <div className="flex flex-wrap gap-2 mt-2">
          {Object.entries(byState).sort((a, b) => b[1] - a[1]).map(([code, n]) => (
            <span key={code} className="text-[11px] px-2 py-1 rounded-lg bg-[#F4F4F5] border border-[#E4E4E7] text-[#52525B]">
              {stateName(code)} · <strong className="text-[#27272A]">{n}</strong>
            </span>
          ))}
        </div>
      </div>

      {unlocated.length > 0 && (
        <div className="flex items-start gap-2.5 p-3 rounded-xl bg-rose-50 border border-rose-200">
          <AlertTriangle size={15} className="text-rose-600 mt-0.5 flex-shrink-0" />
          <p className="text-xs text-rose-900 leading-relaxed">
            <strong>{unlocated.length} {unlocated.length === 1 ? 'person has' : 'people have'} no work location.</strong>{' '}
            A run including them is blocked at approval: without an office there is no state, and without a state
            there is no Professional Tax rule that can honestly be applied.
          </p>
        </div>
      )}

      {ambiguous.length > 0 && (
        <div className="flex items-start gap-2.5 p-3 rounded-xl bg-amber-50 border border-amber-200">
          <AlertTriangle size={15} className="text-amber-600 mt-0.5 flex-shrink-0" />
          <p className="text-xs text-amber-900 leading-relaxed">
            <strong>{ambiguous.length} claimed by two locations at the same priority.</strong>{' '}
            Give one of them a higher priority rather than leaving the resolver to break the tie.
          </p>
        </div>
      )}

      <div className={`${PUI.card} divide-y divide-[#F4F4F5]`}>
        {rows.map(r => (
          <div key={r.staff.id} className="p-3 flex items-start gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-sm text-[#27272A]">{r.staff.full_name}</p>
              <p className="text-[11px] text-[#71717A] mt-0.5 leading-relaxed">{r.why}</p>
            </div>
            <div className="text-right flex-shrink-0">
              <p className="text-[11px] font-semibold text-[#27272A]">{r.locationName ?? '—'}</p>
              <p className="text-[10px] text-[#A1A1AA]">{stateName(r.jurisdiction)}</p>
              {r.unlocated && <span className="text-[10px] font-bold text-rose-600">Unassigned</span>}
              {r.ambiguous && <span className="text-[10px] font-bold text-amber-600">Ambiguous</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
