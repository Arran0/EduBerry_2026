'use client'

// ─────────────────────────────────────────────────────────────────────────────
// Who can do what with money.
//
// Three views of the same 28 permissions, because they answer different
// questions. The grid is the screen; the other two are each a button, because
// they are asked occasionally and a tab strip over a grid this dense is one
// row of chrome too many:
//
//   By role    the grid an administrator sets up once — this screen
//   By person  the override that makes "the accountant does everything except
//              reverse a payment" possible without inventing a new role
//   Who can…   "who can reverse a payment?" — a question a head teacher asks,
//              and one nobody can answer by reading a 28-by-7 grid
//
// The database is the authority for all of it; this screen only edits it.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Check, Loader2, Search, ShieldCheck, User, X } from 'lucide-react'
import ModalShell from '@/components/ui/ModalShell'
import { supabase } from '@/lib/supabase'
import { ADMIN, GOLD } from '@/components/fees/ui'
import { invalidateFeePermissions } from '@/hooks/useFeePermissions'
import {
  FEE_PRESETS, applyPreset, fetchFeePermissionCatalogue, fetchPermissionHolders,
  fetchRoleGrants, fetchUserGrants, setRoleGrant, setUserGrant,
  type FeePermission, type FeePermissionKey, type FeePresetKey,
  type FeeRoleGrant, type FeeUserGrant, type PermissionHolder,
} from '@/lib/fees/permissions'

/** Roles that can plausibly touch fees. Students and drivers are not offered. */
// Fees are an administrator's job and a family's own business — no other
// staff role has a part in the module. The resolver enforces this
// (fee_restrict_to_admin_and_students.sql); listing one role here is the
// interface agreeing with it, rather than offering boxes that tick to nothing.
const ROLES = ['admin'] as const

interface StaffRow { id: string; full_name: string; role: string }

/** The two occasional views, each opened as a popup over the grid. */
type Sheet = 'people' | 'coverage'

export default function PermissionMatrix() {
  const [catalogue, setCatalogue] = useState<FeePermission[]>([])
  const [roleGrants, setRoleGrants] = useState<FeeRoleGrant[]>([])
  const [loading, setLoading] = useState(true)
  const [sheet, setSheet] = useState<Sheet | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [cat, grants] = await Promise.all([
        fetchFeePermissionCatalogue(), fetchRoleGrants(),
      ])
      setCatalogue(cat)
      setRoleGrants(grants)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const byCategory = useMemo(() => {
    const map = new Map<string, FeePermission[]>()
    for (const p of catalogue) {
      const list = map.get(p.category)
      if (list) list.push(p)
      else map.set(p.category, [p])
    }
    return [...map.entries()]
  }, [catalogue])

  if (loading) {
    return (
      <div className={`${ADMIN.card} p-8 flex items-center justify-center gap-2 text-sm text-[#71717A]`}>
        <Loader2 size={16} className="animate-spin" /> Loading permissions…
      </div>
    )
  }

  if (catalogue.length === 0) {
    return (
      <div className={`${ADMIN.card} p-6`}>
        <p className="text-sm text-[#71717A]">
          The fee permission tables are not in this database yet. Apply
          <code className="mx-1 px-1.5 py-0.5 bg-[#F4F4F5] text-[#27272A] text-xs">supabase-migrations/fee_r1_permissions.sql</code>
          and reload.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className={`${ADMIN.card} p-4`}>
        <div className="flex items-start gap-3">
          <ShieldCheck size={18} className="mt-0.5 flex-shrink-0" style={{ color: GOLD }} />
          <div className="text-sm text-[#52525B] leading-relaxed">
            <p className="font-semibold text-[#27272A] mb-1">28 switches, not one</p>
            <p>
              There is no single &ldquo;Fees&rdquo; permission. A front-desk clerk can be given
              exactly &ldquo;look a student up, take the money, print the slip&rdquo; without also
              being handed the price list and the power to reverse a completed payment.
              A person&rsquo;s own setting always beats their role&rsquo;s.
            </p>
          </div>
        </div>
      </div>

      {error && (
        <div className="bg-rose-50 border border-rose-200 text-rose-700 text-sm px-4 py-3 rounded-lg flex items-start gap-2">
          <AlertTriangle size={15} className="mt-0.5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="flex flex-wrap justify-end gap-1.5">
        <button onClick={() => setSheet('people')} className={ADMIN.ghostBtn}>
          <User size={13} /> By person
        </button>
        <button onClick={() => setSheet('coverage')} className={ADMIN.ghostBtn}>
          <Search size={13} /> Who can…
        </button>
      </div>

      <RoleGrid
        byCategory={byCategory}
        roleGrants={roleGrants}
        onChanged={(role, key, granted) => {
          setRoleGrants(prev => {
            const next = prev.filter(g => !(g.role === role && g.permission_key === key))
            next.push({ role, permission_key: key, granted })
            return next
          })
        }}
        onError={setError}
      />

      {sheet && (
        <ModalShell
          onClose={() => setSheet(null)}
          sharp size="2xl"
          title={sheet === 'people' ? 'Permissions by person' : 'Who can…'}
          subtitle={sheet === 'people'
            ? 'An override on top of what the role grants'
            : 'Everybody who holds one permission, whichever way they got it'}
          icon={sheet === 'people' ? <User size={15} /> : <Search size={15} />}
          iconClassName="bg-[#27272A] text-[#B8983C]"
          bodyClassName="bg-[#FDFCF9] !px-3 sm:!px-4 !py-3"
        >
          {sheet === 'people'
            ? <PersonOverrides byCategory={byCategory} onError={setError} />
            : <CoverageCheck catalogue={catalogue} />}
        </ModalShell>
      )}
    </div>
  )
}

// ── By role ─────────────────────────────────────────────────────────────
function RoleGrid({
  byCategory, roleGrants, onChanged, onError,
}: {
  byCategory: [string, FeePermission[]][]
  roleGrants: FeeRoleGrant[]
  onChanged: (role: string, key: FeePermissionKey, granted: boolean) => void
  onError: (message: string | null) => void
}) {
  const [saving, setSaving] = useState<string | null>(null)

  const granted = useCallback((role: string, key: FeePermissionKey) =>
    roleGrants.some(g => g.role === role && g.permission_key === key && g.granted),
  [roleGrants])

  const toggle = async (role: string, key: FeePermissionKey, next: boolean) => {
    const id = `${role}:${key}`
    setSaving(id)
    onError(null)
    try {
      await setRoleGrant(role, key, next)
      onChanged(role, key, next)
      invalidateFeePermissions()
    } catch (e) {
      // The lockout guard raises when a change would leave nobody able to
      // manage permissions. Show its own words: they say exactly what happened.
      onError(e instanceof Error ? e.message : 'Could not save that change.')
    } finally {
      setSaving(null)
    }
  }

  return (
    <div className={`${ADMIN.card} overflow-hidden`}>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-[#FAFAFA] border-b border-[#E4E4E7]">
              <th className="text-left px-4 py-2.5 text-[10px] font-bold uppercase tracking-widest text-[#71717A]">
                Permission
              </th>
              {ROLES.map(role => (
                <th key={role} className="px-3 py-2.5 text-[10px] font-bold uppercase tracking-widest text-[#71717A] w-24">
                  {role}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {byCategory.map(([category, perms]) => (
              <React.Fragment key={category}>
                <tr className="bg-[#FAFAFA]">
                  <td colSpan={ROLES.length + 1}
                      className="px-4 py-1.5 text-[10px] font-bold uppercase tracking-widest text-[#A1A1AA]">
                    {category}
                  </td>
                </tr>
                {perms.map(p => (
                  <tr key={p.key} className="border-b border-[#F4F4F5] last:border-0">
                    <td className="px-4 py-2.5 align-top">
                      <div className="flex items-start gap-2">
                        {p.is_dangerous && (
                          <AlertTriangle size={13} className="text-amber-500 mt-0.5 flex-shrink-0" />
                        )}
                        <div>
                          <div className="font-medium text-[#27272A]">{p.label}</div>
                          <div className="text-xs text-[#A1A1AA] mt-0.5 max-w-xl">{p.help}</div>
                        </div>
                      </div>
                    </td>
                    {ROLES.map(role => {
                      const on = granted(role, p.key)
                      const busy = saving === `${role}:${p.key}`
                      return (
                        <td key={role} className="px-3 py-2.5 text-center align-top">
                          <button
                            disabled={busy}
                            onClick={() => void toggle(role, p.key, !on)}
                            aria-label={`${on ? 'Revoke' : 'Grant'} ${p.label} for ${role}`}
                            className={`w-7 h-7 inline-flex items-center justify-center rounded transition-colors disabled:opacity-40 ${
                              on
                                ? 'bg-[#27272A] text-white hover:bg-[#18181B]'
                                : 'bg-white border border-[#E4E4E7] text-[#D4D4D8] hover:border-[#A1A1AA]'
                            }`}
                          >
                            {busy
                              ? <Loader2 size={13} className="animate-spin" />
                              : on ? <Check size={14} /> : <X size={13} />}
                          </button>
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── By person ───────────────────────────────────────────────────────────
function PersonOverrides({
  byCategory, onError,
}: {
  byCategory: [string, FeePermission[]][]
  onError: (message: string | null) => void
}) {
  const [staff, setStaff] = useState<StaffRow[]>([])
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<StaffRow | null>(null)
  const [grants, setGrants] = useState<FeeUserGrant[]>([])
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void (async () => {
      // Only staff: a student cannot be given a fee permission, and offering
      // 1,052 of them in this picker would bury the eight people who matter.
      const { data } = await supabase
        .from('profiles')
        .select('id, full_name, role')
        .in('role', ROLES as unknown as string[])
        .eq('is_banned', false)
        .order('full_name')
      setStaff((data ?? []) as StaffRow[])
    })()
  }, [])

  const openPerson = async (person: StaffRow) => {
    setSelected(person)
    setGrants(await fetchUserGrants(person.id))
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return staff.slice(0, 40)
    return staff.filter(s => s.full_name.toLowerCase().includes(q)).slice(0, 40)
  }, [staff, query])

  const stateOf = (key: FeePermissionKey): boolean | null => {
    const row = grants.find(g => g.permission_key === key)
    return row ? row.granted : null
  }

  const cycle = async (key: FeePermissionKey) => {
    if (!selected) return
    // Three states, cycled: inherit → granted → denied → inherit. Deleting the
    // row is what "inherit" means; storing false would make a deliberate
    // revocation look identical to never having been asked.
    const current = stateOf(key)
    const next = current === null ? true : current ? false : null
    setBusy(true)
    onError(null)
    try {
      await setUserGrant(selected.id, key, next)
      setGrants(await fetchUserGrants(selected.id))
      invalidateFeePermissions()
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Could not save that change.')
    } finally {
      setBusy(false)
    }
  }

  const choosePreset = async (preset: FeePresetKey) => {
    if (!selected) return
    setBusy(true)
    onError(null)
    try {
      await applyPreset(selected.id, preset)
      setGrants(await fetchUserGrants(selected.id))
      invalidateFeePermissions()
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Could not apply that preset.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid md:grid-cols-[260px_1fr] gap-4">
      <div className={`${ADMIN.card} p-3`}>
        <div className="relative mb-2">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#A1A1AA]" />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Find a staff member"
            className={ADMIN.input}
          />
        </div>
        <div className="max-h-[420px] overflow-y-auto -mx-1">
          {filtered.map(person => (
            <button
              key={person.id}
              onClick={() => void openPerson(person)}
              className={`w-full text-left px-3 py-2 rounded-lg transition-colors ${
                selected?.id === person.id ? 'bg-[#27272A] text-white' : 'hover:bg-[#F4F4F5]'
              }`}
            >
              <div className="text-sm font-medium truncate">{person.full_name}</div>
              <div className={`text-xs ${selected?.id === person.id ? 'text-zinc-400' : 'text-[#A1A1AA]'}`}>
                {person.role}
              </div>
            </button>
          ))}
          {filtered.length === 0 && (
            <p className="px-3 py-4 text-xs text-[#A1A1AA]">No staff match that.</p>
          )}
        </div>
      </div>

      <div className={`${ADMIN.card} p-4`}>
        {!selected ? (
          <div className="py-16 text-center text-sm text-[#A1A1AA]">
            <User size={22} className="mx-auto mb-2 text-[#D4D4D8]" />
            Pick someone to give or take away a permission.
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between gap-3 mb-3">
              <div>
                <h3 className="text-sm font-bold text-[#27272A]">{selected.full_name}</h3>
                <p className="text-xs text-[#A1A1AA]">
                  Anything left on <em>Inherit</em> follows the {selected.role} role.
                </p>
              </div>
              {busy && <Loader2 size={15} className="animate-spin text-[#A1A1AA]" />}
            </div>

            <div className="flex flex-wrap gap-1.5 mb-4 pb-4 border-b border-[#F4F4F5]">
              {FEE_PRESETS.map(preset => (
                <button
                  key={preset.key}
                  disabled={busy}
                  onClick={() => void choosePreset(preset.key)}
                  title={preset.help}
                  className={ADMIN.ghostBtn}
                >
                  {preset.label}
                </button>
              ))}
            </div>

            <div className="space-y-3 max-h-[380px] overflow-y-auto">
              {byCategory.map(([category, perms]) => (
                <div key={category}>
                  <div className="text-[10px] font-bold uppercase tracking-widest text-[#A1A1AA] mb-1">
                    {category}
                  </div>
                  {perms.map(p => {
                    const state = stateOf(p.key)
                    return (
                      <button
                        key={p.key}
                        disabled={busy}
                        onClick={() => void cycle(p.key)}
                        className="w-full flex items-center justify-between gap-3 py-1.5 px-2 -mx-2 rounded hover:bg-[#FAFAFA] text-left disabled:opacity-50"
                      >
                        <span className="text-sm text-[#27272A] flex items-center gap-1.5">
                          {p.is_dangerous && <AlertTriangle size={12} className="text-amber-500" />}
                          {p.label}
                        </span>
                        <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded flex-shrink-0 ${
                          state === true  ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                          : state === false ? 'bg-rose-50 text-rose-700 border border-rose-200'
                          : 'bg-[#F4F4F5] text-[#A1A1AA] border border-[#E4E4E7]'
                        }`}>
                          {state === true ? 'Granted' : state === false ? 'Denied' : 'Inherit'}
                        </span>
                      </button>
                    )
                  })}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ── Coverage ────────────────────────────────────────────────────────────
function CoverageCheck({ catalogue }: { catalogue: FeePermission[] }) {
  const [key, setKey] = useState<FeePermissionKey>('fees.payment.reverse')
  const [holders, setHolders] = useState<PermissionHolder[] | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetchPermissionHolders(key)
      .then(rows => { if (!cancelled) setHolders(rows) })
      .catch(() => { if (!cancelled) setHolders([]) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [key])

  const permission = catalogue.find(p => p.key === key)

  return (
    <div className={`${ADMIN.card} p-4`}>
      <label className={`${ADMIN.label} block mb-1.5`}>Who can…</label>
      <select
        value={key}
        onChange={e => setKey(e.target.value as FeePermissionKey)}
        className={`${ADMIN.inputPlain} max-w-md`}
      >
        {catalogue.map(p => (
          <option key={p.key} value={p.key}>{p.category} — {p.label}</option>
        ))}
      </select>

      {permission && <p className="text-xs text-[#A1A1AA] mt-2 max-w-2xl">{permission.help}</p>}

      <div className="mt-4">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-[#A1A1AA]">
            <Loader2 size={14} className="animate-spin" /> Checking…
          </div>
        ) : holders && holders.length === 0 ? (
          <div className="bg-amber-50 border border-amber-200 text-amber-800 text-sm px-4 py-3 rounded-lg flex items-start gap-2">
            <AlertTriangle size={15} className="mt-0.5 flex-shrink-0" />
            <span>
              Nobody currently holds this. Anything that needs it will be refused —
              including, if this is a collection permission, taking money at the counter.
            </span>
          </div>
        ) : (
          <div className="space-y-1">
            <p className="text-xs text-[#71717A] mb-2">
              {holders?.length} {holders?.length === 1 ? 'person holds' : 'people hold'} this.
            </p>
            {holders?.map(h => (
              <div key={h.id} className="flex items-center justify-between py-1.5 px-3 bg-[#FAFAFA] rounded">
                <div>
                  <span className="text-sm text-[#27272A]">{h.full_name}</span>
                  <span className="text-xs text-[#A1A1AA] ml-2">{h.role}</span>
                </div>
                <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${
                  h.via === 'override'
                    ? 'bg-[#FBF6E9] text-[#8A6D1F] border border-[#EFE3C4]'
                    : 'bg-[#F4F4F5] text-[#71717A] border border-[#E4E4E7]'
                }`}>
                  {h.via === 'override' ? 'Given personally' : 'Via role'}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
