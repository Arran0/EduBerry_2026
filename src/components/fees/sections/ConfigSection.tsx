'use client'

// ─────────────────────────────────────────────────────────────────────────────
// Fee Configuration — the price list.
//
// Round 1 of docs/fee-upgrade-plan.md. Before this, a fee head had one
// `default_amount` for the whole school, so Grade 1 and Grade 12 tuition were
// the same number and there was no way to say "three terms, due 10 April,
// 10 August, 10 December". This is where that gets set up once a year and then
// cloned forward rather than rebuilt.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle, Check, Copy, FolderTree, Loader2, Plus,
  Settings2, Trash2, Users,
} from 'lucide-react'
import { useAcademicYear } from '@/contexts/AcademicYearContext'
import { useFeePermissions } from '@/hooks/useFeePermissions'
import { ADMIN, STRUCTURE_CHIP, fmtDate, inr } from '@/components/fees/ui'
import GroupRoster from '@/components/fees/config/GroupRoster'
import ModalShell from '@/components/ui/ModalShell'
import { gradeLabel } from '@/lib/grades'
import {
  cloneFeeYear, createStructure, deleteHead, deleteInstallment, deleteStructure,
  fetchFeeConfig, removeStructureItem, saveGroup, saveHead, saveInstallment,
  setAutogen, setStructureItem, setStructureStatus,
  type CloneResult, type FeeConfigBundle,
} from '@/lib/fees/config'

/** The two lists the price list is built from, each opened as a popup. */
type Sheet = 'heads' | 'groups'

const EMPTY: FeeConfigBundle = {
  categories: [], heads: [], groups: [], structures: [],
  items: [], installments: [], installmentItems: [],
}

export default function ConfigSection() {
  const { year, years } = useAcademicYear()
  const perms = useFeePermissions()
  const [bundle, setBundle] = useState<FeeConfigBundle>(EMPTY)
  const [loading, setLoading] = useState(true)
  const [sheet, setSheet] = useState<Sheet | null>(null)
  const [error, setError] = useState<string | null>(null)

  const canEdit = perms.can('fees.config.manage')

  const load = useCallback(async () => {
    if (!year) return
    setLoading(true)
    try {
      setBundle(await fetchFeeConfig(year.id))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the price list.')
    } finally {
      setLoading(false)
    }
  }, [year])

  useEffect(() => { void load() }, [load])

  if (perms.loading) {
    return <div className="p-10 flex justify-center"><Loader2 className="animate-spin text-[#8C8878]" /></div>
  }

  if (!perms.can('fees.view')) {
    return (
      <div className="max-w-md mx-auto mt-20 text-center px-6">
        <AlertTriangle size={26} className="mx-auto text-[#C9C4B4] mb-3" />
        <h2 className="text-base font-bold text-[#18181B]">No access to fees</h2>
        <p className="text-sm text-[#6B675A] mt-1">
          Your account does not hold the &ldquo;Open the fee module&rdquo; permission. An
          administrator can grant it in Admin Space → Fee Settings → Permissions.
        </p>
      </div>
    )
  }

  return (
    <>
      {!canEdit && (
        <div className="bg-[#FAF3DF] border border-[#E7D9AE] text-[#7A6220] text-sm px-4 py-3 ">
          You can see the price list but not change it — that needs the &ldquo;Edit the price
          list&rdquo; permission.
        </div>
      )}

      {error && (
        <div className="bg-[#FCECEC] border border-[#EFCCCC] text-[#A93232] text-sm px-4 py-3 ">{error}</div>
      )}

      {perms.can('fees.config.clone_year') && years.length > 1 && year && (
        <CloneCard currentYearId={year.id} onDone={() => void load()} />
      )}

      {/* The price list is the structures. Fee heads and groups are the two
          lists it is built from — reference data, edited now and then, and
          each one used to cost this screen a permanent tab. */}
      <div className="flex flex-wrap justify-end gap-1.5">
        <button onClick={() => setSheet('heads')} className={ADMIN.ghostBtn}>
          <FolderTree size={13} /> Fee heads
        </button>
        <button onClick={() => setSheet('groups')} className={ADMIN.ghostBtn}>
          <Users size={13} /> Groups
        </button>
      </div>

      {loading ? (
        <div className={`${ADMIN.card} p-10 flex items-center justify-center gap-2 text-sm text-[#6B675A]`}>
          <Loader2 size={16} className="animate-spin" /> Loading the price list…
        </div>
      ) : !year ? (
        <div className={`${ADMIN.card} p-6 text-sm text-[#6B675A]`}>
          No academic sessions exist yet. Add one in Admin Space → Fee Settings → Sessions.
        </div>
      ) : (
        <StructuresSection bundle={bundle} yearId={year.id} canEdit={canEdit}
                           canAutogen={perms.can('fees.invoice.autogen')}
                           showAmounts={!perms.amountsHidden}
                           onChanged={() => void load()} onError={setError} />
      )}

      {sheet && year && (
        <ModalShell
          onClose={() => setSheet(null)}
          sharp size="2xl"
          title={sheet === 'heads' ? 'Fee heads' : 'Groups'}
          subtitle={sheet === 'heads'
            ? 'Every line a bill can carry'
            : 'Who a structure prices, and who is in each group'}
          icon={sheet === 'heads' ? <FolderTree size={15} /> : <Users size={15} />}
          iconClassName="bg-[#27272A] text-[#B8983C]"
          bodyClassName="bg-[#FDFCF9] !px-3 sm:!px-4 !py-3 space-y-4"
          minHClass="sm:min-h-[32rem]"
        >
          {sheet === 'heads' ? (
            <HeadsSection bundle={bundle} yearId={year.id} canEdit={canEdit}
                          onChanged={() => void load()} onError={setError} />
          ) : (
            <>
              <GroupsSection bundle={bundle} yearId={year.id} canEdit={canEdit}
                             onChanged={() => void load()} onError={setError} />
              <GroupRoster bundle={bundle} yearId={year.id} canEdit={canEdit}
                           onError={setError} />
            </>
          )}
        </ModalShell>
      )}
    </>
  )
}

// ── Clone ───────────────────────────────────────────────────────────────
function CloneCard({ currentYearId, onDone }: { currentYearId: string; onDone: () => void }) {
  const { years } = useAcademicYear()
  const [from, setFrom] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<CloneResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const sources = years.filter(y => y.id !== currentYearId)
  const target = years.find(y => y.id === currentYearId)

  const run = async () => {
    if (!from) return
    setBusy(true); setError(null); setResult(null)
    try {
      setResult(await cloneFeeYear(from, currentYearId))
      onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not clone that year.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={`${ADMIN.card} p-4`}>
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className={`${ADMIN.label} block mb-1.5`}>Clone a year&rsquo;s plan into {target?.code}</label>
          <select value={from} onChange={e => setFrom(e.target.value)} className={`${ADMIN.inputPlain} w-48`}>
            <option value="">Choose a session…</option>
            {sources.map(y => <option key={y.id} value={y.id}>{y.code}</option>)}
          </select>
        </div>
        <button onClick={() => void run()} disabled={!from || busy} className={ADMIN.darkBtn}>
          {busy ? <Loader2 size={13} className="animate-spin" /> : <Copy size={13} />}
          Clone
        </button>
        <p className="text-xs text-[#8C8878] flex-1 min-w-[260px]">
          Copies the heads, groups, structures and installments with every due date moved on a
          year. Structures arrive as drafts and auto-generation stays off, so nothing bills itself
          before someone has looked at the prices. Running it twice adds nothing twice.
        </p>
      </div>

      {result && (
        <div className="mt-3 bg-[#EAF5EE] border border-[#C6E3D2] text-[#1F6B42] text-sm px-4 py-3 ">
          Cloned {result.heads} head{result.heads === 1 ? '' : 's'}, {result.groups} group
          {result.groups === 1 ? '' : 's'}, {result.structures} structure
          {result.structures === 1 ? '' : 's'}, {result.structure_items} priced line
          {result.structure_items === 1 ? '' : 's'} and {result.installments} installment
          {result.installments === 1 ? '' : 's'}, with due dates {result.year_delta} year
          {result.year_delta === 1 ? '' : 's'} later.
          {result.heads + result.structures + result.installments === 0 &&
            ' Everything was already here — nothing to do.'}
        </div>
      )}

      {error && (
        <div className="mt-3 bg-[#FCECEC] border border-[#EFCCCC] text-[#A93232] text-sm px-4 py-3 ">{error}</div>
      )}
    </div>
  )
}

// ── Heads ───────────────────────────────────────────────────────────────
function HeadsSection({
  bundle, yearId, canEdit, onChanged, onError,
}: {
  bundle: FeeConfigBundle; yearId: string; canEdit: boolean
  onChanged: () => void; onError: (m: string | null) => void
}) {
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState({ name: '', code: '', category_id: '', tax_rate: 0 })
  const [busy, setBusy] = useState(false)

  const add = async () => {
    setBusy(true); onError(null)
    try {
      await saveHead({
        academic_year_id: yearId,
        name: draft.name.trim(),
        code: (draft.code || draft.name).trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_'),
        category_id: draft.category_id || null,
        tax_rate: draft.tax_rate,
        sort: (bundle.heads.length + 1) * 10,
      })
      setDraft({ name: '', code: '', category_id: '', tax_rate: 0 })
      setAdding(false)
      onChanged()
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Could not save that fee head.')
    } finally {
      setBusy(false)
    }
  }

  const remove = async (id: string) => {
    onError(null)
    try { await deleteHead(id); onChanged() }
    catch (e) { onError(e instanceof Error ? e.message : 'Could not delete that fee head.') }
  }

  const catName = (id: string | null) =>
    bundle.categories.find(c => c.id === id)?.name ?? '—'

  return (
    <div className="space-y-3">
      <div className={`${ADMIN.card} overflow-hidden`}>
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-[#FAF8F2] border-b border-[#E3DFD3]">
              <th className="text-left px-4 py-2.5 text-[10px] font-bold uppercase tracking-widest text-[#6B675A]">Head</th>
              <th className="text-left px-4 py-2.5 text-[10px] font-bold uppercase tracking-widest text-[#6B675A]">Code</th>
              <th className="text-left px-4 py-2.5 text-[10px] font-bold uppercase tracking-widest text-[#6B675A]">Category</th>
              <th className="text-right px-4 py-2.5 text-[10px] font-bold uppercase tracking-widest text-[#6B675A]">Tax</th>
              <th className="w-10" />
            </tr>
          </thead>
          <tbody>
            {bundle.heads.map(h => (
              <tr key={h.id} className="border-b border-[#F0ECE2] last:border-0">
                <td className="px-4 py-2.5 font-medium text-[#18181B]">
                  {h.name}
                  {h.is_transport && (
                    <span className="ml-2 text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-[#F4F1E7] text-[#6B675A]">
                      Transport
                    </span>
                  )}
                </td>
                <td className="px-4 py-2.5 font-mono text-xs text-[#6B675A]">{h.code}</td>
                <td className="px-4 py-2.5 text-[#6B675A]">{catName(h.category_id)}</td>
                <td className="px-4 py-2.5 text-right text-[#6B675A]">
                  {Number(h.tax_rate) ? `${h.tax_rate}%` : '—'}
                </td>
                <td className="px-2">
                  {canEdit && (
                    <button onClick={() => void remove(h.id)}
                            className="p-1.5 text-[#C9C4B4] hover:text-[#A93232] transition-colors">
                      <Trash2 size={13} />
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {bundle.heads.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-sm text-[#8C8878]">
                No fee heads yet. Add Tuition first — everything else prices against it.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      {canEdit && (adding ? (
        <div className={`${ADMIN.card} p-4 space-y-3`}>
          <div className="grid sm:grid-cols-4 gap-3">
            <div>
              <label className={`${ADMIN.label} block mb-1.5`}>Name</label>
              <input value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })}
                     placeholder="Tuition" className={ADMIN.inputPlain} />
            </div>
            <div>
              <label className={`${ADMIN.label} block mb-1.5`}>Code</label>
              <input value={draft.code} onChange={e => setDraft({ ...draft, code: e.target.value })}
                     placeholder="auto" className={`${ADMIN.inputPlain} font-mono text-xs`} />
            </div>
            <div>
              <label className={`${ADMIN.label} block mb-1.5`}>Category</label>
              <select value={draft.category_id} onChange={e => setDraft({ ...draft, category_id: e.target.value })}
                      className={ADMIN.inputPlain}>
                <option value="">None</option>
                {bundle.categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className={`${ADMIN.label} block mb-1.5`}>Tax %</label>
              <input type="number" min={0} max={100} value={draft.tax_rate}
                     onChange={e => setDraft({ ...draft, tax_rate: Number(e.target.value) || 0 })}
                     className={ADMIN.inputPlain} />
            </div>
          </div>
          <p className="text-xs text-[#8C8878]">
            The code is what links this head to the same head in another year, so cross-year
            reporting and the clone both follow it. Leave it blank and one is made from the name.
          </p>
          <div className="flex gap-2">
            <button onClick={() => void add()} disabled={!draft.name.trim() || busy} className={ADMIN.darkBtn}>
              {busy ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Add head
            </button>
            <button onClick={() => setAdding(false)} className={ADMIN.ghostBtn}>Cancel</button>
          </div>
        </div>
      ) : (
        <button onClick={() => setAdding(true)} className={ADMIN.ghostBtn}>
          <Plus size={13} /> Add a fee head
        </button>
      ))}
    </div>
  )
}

// ── Groups ──────────────────────────────────────────────────────────────
function GroupsSection({
  bundle, yearId, canEdit, onChanged, onError,
}: {
  bundle: FeeConfigBundle; yearId: string; canEdit: boolean
  onChanged: () => void; onError: (m: string | null) => void
}) {
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState({ name: '', code: '', description: '', is_rte: false })
  const [busy, setBusy] = useState(false)

  const add = async () => {
    setBusy(true); onError(null)
    try {
      await saveGroup({
        academic_year_id: yearId,
        name: draft.name.trim(),
        code: (draft.code || draft.name).trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_'),
        description: draft.description.trim() || null,
        is_rte: draft.is_rte,
      })
      setDraft({ name: '', code: '', description: '', is_rte: false })
      setAdding(false)
      onChanged()
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Could not save that group.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {bundle.groups.map(g => (
          <div key={g.id} className={`${ADMIN.card} p-4`}>
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="text-sm font-bold text-[#18181B]">{g.name}</div>
                <div className="font-mono text-[11px] text-[#8C8878]">{g.code}</div>
              </div>
              <div className="flex flex-col gap-1 items-end">
                {g.is_default && (
                  <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-[#27272A] text-white">
                    Default
                  </span>
                )}
                {g.is_rte && (
                  <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-[#EEF2FB] text-[#3A5490] border border-[#CFDAEF]">
                    RTE
                  </span>
                )}
              </div>
            </div>
            {g.description && <p className="text-xs text-[#6B675A] mt-2">{g.description}</p>}
            <p className="text-[11px] text-[#8C8878] mt-2">
              {bundle.structures.filter(s => s.fee_group_id === g.id).length} structure(s)
            </p>
          </div>
        ))}
      </div>

      {canEdit && (adding ? (
        <div className={`${ADMIN.card} p-4 space-y-3`}>
          <div className="grid sm:grid-cols-3 gap-3">
            <div>
              <label className={`${ADMIN.label} block mb-1.5`}>Name</label>
              <input value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })}
                     placeholder="Staff Ward" className={ADMIN.inputPlain} />
            </div>
            <div>
              <label className={`${ADMIN.label} block mb-1.5`}>Code</label>
              <input value={draft.code} onChange={e => setDraft({ ...draft, code: e.target.value })}
                     placeholder="auto" className={`${ADMIN.inputPlain} font-mono text-xs`} />
            </div>
            <div>
              <label className={`${ADMIN.label} block mb-1.5`}>Bills nothing (RTE)</label>
              <select value={draft.is_rte ? 'yes' : 'no'}
                      onChange={e => setDraft({ ...draft, is_rte: e.target.value === 'yes' })}
                      className={ADMIN.inputPlain}>
                <option value="no">No</option>
                <option value="yes">Yes — claimed from the state</option>
              </select>
            </div>
          </div>
          <div>
            <label className={`${ADMIN.label} block mb-1.5`}>Description</label>
            <input value={draft.description} onChange={e => setDraft({ ...draft, description: e.target.value })}
                   className={ADMIN.inputPlain} />
          </div>
          <div className="flex gap-2">
            <button onClick={() => void add()} disabled={!draft.name.trim() || busy} className={ADMIN.darkBtn}>
              {busy ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Add group
            </button>
            <button onClick={() => setAdding(false)} className={ADMIN.ghostBtn}>Cancel</button>
          </div>
        </div>
      ) : (
        <button onClick={() => setAdding(true)} className={ADMIN.ghostBtn}>
          <Plus size={13} /> Add a group
        </button>
      ))}
    </div>
  )
}

// ── Structures ──────────────────────────────────────────────────────────
function StructuresSection({
  bundle, yearId, canEdit, canAutogen, showAmounts, onChanged, onError,
}: {
  bundle: FeeConfigBundle; yearId: string; canEdit: boolean; canAutogen: boolean
  showAmounts: boolean; onChanged: () => void; onError: (m: string | null) => void
}) {
  const [openId, setOpenId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState({ fee_group_id: '', grade: '' as string, name: '' })
  const [busy, setBusy] = useState(false)

  const groupName = (id: string) => bundle.groups.find(g => g.id === id)?.name ?? '—'

  const add = async () => {
    setBusy(true); onError(null)
    try {
      const grade = draft.grade === '' ? null : Number(draft.grade)
      await createStructure({
        academic_year_id: yearId,
        fee_group_id: draft.fee_group_id || bundle.groups.find(g => g.is_default)!.id,
        grade,
        name: draft.name.trim() ||
          `${grade === null ? 'All grades' : gradeLabel(grade)} — ${groupName(draft.fee_group_id)}`,
      })
      setDraft({ fee_group_id: '', grade: '', name: '' })
      setAdding(false)
      onChanged()
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Could not create that structure.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3">
      {bundle.structures.map(s => (
        <StructureCard
          key={s.id}
          structure={s}
          bundle={bundle}
          open={openId === s.id}
          onToggle={() => setOpenId(openId === s.id ? null : s.id)}
          canEdit={canEdit}
          canAutogen={canAutogen}
          showAmounts={showAmounts}
          onChanged={onChanged}
          onError={onError}
        />
      ))}

      {bundle.structures.length === 0 && (
        <div className={`${ADMIN.card} p-8 text-center text-sm text-[#8C8878]`}>
          No structures yet. A structure is the plan for one group and one grade — what is charged,
          how much, and when it falls due.
        </div>
      )}

      {canEdit && bundle.groups.length > 0 && (adding ? (
        <div className={`${ADMIN.card} p-4 space-y-3`}>
          <div className="grid sm:grid-cols-3 gap-3">
            <div>
              <label className={`${ADMIN.label} block mb-1.5`}>Group</label>
              <select value={draft.fee_group_id} onChange={e => setDraft({ ...draft, fee_group_id: e.target.value })}
                      className={ADMIN.inputPlain}>
                {bundle.groups.map(g => (
                  <option key={g.id} value={g.id}>{g.name}{g.is_default ? ' (default)' : ''}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={`${ADMIN.label} block mb-1.5`}>Grade</label>
              <select value={draft.grade} onChange={e => setDraft({ ...draft, grade: e.target.value })}
                      className={ADMIN.inputPlain}>
                <option value="">Every grade</option>
                {[-3, -2, -1, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(g => (
                  <option key={g} value={g}>{gradeLabel(g)}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={`${ADMIN.label} block mb-1.5`}>Name</label>
              <input value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })}
                     placeholder="auto" className={ADMIN.inputPlain} />
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={() => void add()} disabled={busy} className={ADMIN.darkBtn}>
              {busy ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Create
            </button>
            <button onClick={() => setAdding(false)} className={ADMIN.ghostBtn}>Cancel</button>
          </div>
        </div>
      ) : (
        <button onClick={() => setAdding(true)} className={ADMIN.ghostBtn}>
          <Plus size={13} /> Add a structure
        </button>
      ))}
    </div>
  )
}

function StructureCard({
  structure: s, bundle, open, onToggle, canEdit, canAutogen, showAmounts, onChanged, onError,
}: {
  structure: FeeConfigBundle['structures'][number]
  bundle: FeeConfigBundle
  open: boolean
  onToggle: () => void
  canEdit: boolean
  canAutogen: boolean
  showAmounts: boolean
  onChanged: () => void
  onError: (m: string | null) => void
}) {
  const items = useMemo(
    () => bundle.items.filter(i => i.structure_id === s.id), [bundle.items, s.id])
  const installments = useMemo(
    () => bundle.installments.filter(i => i.structure_id === s.id).sort((a, b) => a.seq - b.seq),
    [bundle.installments, s.id])
  const group = bundle.groups.find(g => g.id === s.fee_group_id)

  const headName = (id: string) => bundle.heads.find(h => h.id === id)?.name ?? 'Fee head'

  const publish = async () => {
    onError(null)
    try {
      await setStructureStatus(s.id, s.status === 'published' ? 'draft' : 'published')
      onChanged()
    } catch (e) { onError(e instanceof Error ? e.message : 'Could not change the status.') }
  }

  return (
    <div className={ADMIN.card}>
      <button onClick={onToggle} className="w-full flex items-center gap-3 px-4 py-3 text-left">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-bold text-[#18181B]">{s.name}</span>
            <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${STRUCTURE_CHIP[s.status]}`}>
              {s.status}
            </span>
            {group?.is_rte && (
              <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-[#EEF2FB] text-[#3A5490] border border-[#CFDAEF]">
                Bills nothing
              </span>
            )}
          </div>
          <div className="text-xs text-[#8C8878] mt-0.5">
            {group?.name} · {s.grade === null ? 'every grade' : gradeLabel(s.grade)} ·
            {' '}{items.length} head{items.length === 1 ? '' : 's'} ·
            {' '}{installments.length} installment{installments.length === 1 ? '' : 's'}
          </div>
        </div>
        <div className="text-sm font-bold text-[#18181B] flex-shrink-0">
          {inr(s.total_cached, showAmounts)}
        </div>
      </button>

      {open && (
        <div className="border-t border-[#F0ECE2] p-4 space-y-5">
          <StructureItems
            structureId={s.id} items={items} bundle={bundle} canEdit={canEdit}
            showAmounts={showAmounts} onChanged={onChanged} onError={onError} />

          <Installments
            structureId={s.id} installments={installments} bundle={bundle}
            canEdit={canEdit} canAutogen={canAutogen} showAmounts={showAmounts}
            headName={headName} onChanged={onChanged} onError={onError} />

          {canEdit && (
            <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-[#F0ECE2]">
              <button onClick={() => void publish()} className={ADMIN.darkBtn}>
                {s.status === 'published' ? 'Move back to draft' : 'Publish'}
              </button>
              <span className="text-xs text-[#8C8878]">
                {s.status === 'published'
                  ? 'Live. Bills can be generated from it.'
                  : 'A draft is never billed from — publish when the prices are right.'}
              </span>
              <button
                onClick={() => void deleteStructure(s.id).then(onChanged)}
                className="ml-auto p-1.5 text-[#C9C4B4] hover:text-[#A93232] transition-colors"
                title="Delete this structure"
              >
                <Trash2 size={13} />
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function StructureItems({
  structureId, items, bundle, canEdit, showAmounts, onChanged, onError,
}: {
  structureId: string
  items: FeeConfigBundle['items']
  bundle: FeeConfigBundle
  canEdit: boolean
  showAmounts: boolean
  onChanged: () => void
  onError: (m: string | null) => void
}) {
  const [headId, setHeadId] = useState('')
  const [amount, setAmount] = useState('')

  const unused = bundle.heads.filter(h => !items.some(i => i.fee_head_id === h.id))
  const total = items.reduce((a, i) => a + Number(i.amount), 0)

  const add = async () => {
    if (!headId) return
    onError(null)
    try {
      await setStructureItem(structureId, headId, Number(amount) || 0, (items.length + 1) * 10)
      setHeadId(''); setAmount('')
      onChanged()
    } catch (e) { onError(e instanceof Error ? e.message : 'Could not add that line.') }
  }

  return (
    <div>
      <h4 className={`${ADMIN.label} mb-2`}>What is charged</h4>
      <div className="space-y-1">
        {items.map(i => (
          <div key={i.id} className="flex items-center gap-3 py-1.5 px-3 bg-[#FAF8F2] rounded">
            <span className="text-sm text-[#18181B] flex-1">
              {bundle.heads.find(h => h.id === i.fee_head_id)?.name ?? 'Fee head'}
            </span>
            <span className="text-sm font-medium text-[#18181B]">{inr(i.amount, showAmounts)}</span>
            {canEdit && (
              <button
                onClick={() => void removeStructureItem(structureId, i.fee_head_id).then(onChanged)}
                className="p-1 text-[#C9C4B4] hover:text-[#A93232] transition-colors"
              >
                <Trash2 size={12} />
              </button>
            )}
          </div>
        ))}
        {items.length === 0 && (
          <p className="text-xs text-[#8C8878] py-2">Nothing priced yet.</p>
        )}
      </div>

      {items.length > 0 && (
        <div className="flex justify-between items-center mt-2 pt-2 border-t border-[#F0ECE2]">
          <span className={ADMIN.label}>Year total</span>
          <span className="text-sm font-bold text-[#18181B]">{inr(total, showAmounts)}</span>
        </div>
      )}

      {canEdit && unused.length > 0 && (
        <div className="flex gap-2 mt-3">
          <select value={headId} onChange={e => setHeadId(e.target.value)}
                  className={`${ADMIN.inputPlain} flex-1`}>
            <option value="">Add a fee head…</option>
            {unused.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
          </select>
          <input type="number" min={0} value={amount} onChange={e => setAmount(e.target.value)}
                 placeholder="Amount" className={`${ADMIN.inputPlain} w-32`} />
          <button onClick={() => void add()} disabled={!headId} className={ADMIN.darkBtn}>
            <Plus size={13} />
          </button>
        </div>
      )}
    </div>
  )
}

function Installments({
  structureId, installments, bundle, canEdit, canAutogen, showAmounts, headName, onChanged, onError,
}: {
  structureId: string
  installments: FeeConfigBundle['installments']
  bundle: FeeConfigBundle
  canEdit: boolean
  canAutogen: boolean
  showAmounts: boolean
  headName: (id: string) => string
  onChanged: () => void
  onError: (m: string | null) => void
}) {
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState({ name: '', due_date: '', percent: '' })

  const pctTotal = installments.reduce((a, i) => a + (Number(i.percent) || 0), 0)

  const add = async () => {
    onError(null)
    try {
      await saveInstallment({
        structure_id: structureId,
        seq: (installments[installments.length - 1]?.seq ?? 0) + 1,
        name: draft.name.trim() || `Term ${installments.length + 1}`,
        due_date: draft.due_date,
        percent: draft.percent === '' ? null : Number(draft.percent),
        sort: (installments.length + 1) * 10,
      })
      setDraft({ name: '', due_date: '', percent: '' })
      setAdding(false)
      onChanged()
    } catch (e) { onError(e instanceof Error ? e.message : 'Could not add that installment.') }
  }

  return (
    <div>
      <h4 className={`${ADMIN.label} mb-2`}>When it falls due</h4>
      <div className="space-y-1">
        {installments.map(i => {
          const explicit = bundle.installmentItems.filter(ii => ii.installment_id === i.id)
          return (
            <div key={i.id} className="flex flex-wrap items-center gap-3 py-2 px-3 bg-[#FAF8F2] rounded">
              <span className="text-xs font-mono text-[#8C8878] w-6">{i.seq}</span>
              <span className="text-sm text-[#18181B] flex-1 min-w-[100px]">{i.name}</span>
              <span className="text-xs text-[#6B675A]">{fmtDate(i.due_date)}</span>
              <span className="text-sm font-medium text-[#18181B] w-20 text-right">
                {explicit.length > 0
                  ? explicit.map(e => headName(e.fee_head_id)).join(', ')
                  : i.percent !== null ? `${Number(i.percent)}%`
                  : i.amount !== null ? inr(i.amount, showAmounts)
                  : 'The rest'}
              </span>
              {canAutogen && (
                <button
                  onClick={() => void setAutogen(i.id, !i.autogen_enabled, i.autogen_days_before).then(onChanged)}
                  title={i.autogen_enabled
                    ? `Bills generate themselves ${i.autogen_days_before} days before the due date`
                    : 'Bills are generated by hand'}
                  className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded transition-colors ${
                    i.autogen_enabled
                      ? 'bg-[#EAF5EE] text-[#1F6B42] border border-[#C6E3D2]'
                      : 'bg-white text-[#8C8878] border border-[#E3DFD3] hover:border-[#C9C4B4]'
                  }`}
                >
                  <Settings2 size={10} />
                  {i.autogen_enabled ? `Auto −${i.autogen_days_before}d` : 'Manual'}
                </button>
              )}
              {canEdit && (
                <button onClick={() => void deleteInstallment(i.id).then(onChanged)}
                        className="p-1 text-[#C9C4B4] hover:text-[#A93232] transition-colors">
                  <Trash2 size={12} />
                </button>
              )}
            </div>
          )
        })}
        {installments.length === 0 && (
          <p className="text-xs text-[#8C8878] py-2">
            No installments. Without one there is nothing to bill.
          </p>
        )}
      </div>

      {installments.length > 0 && pctTotal > 0 && pctTotal !== 100 && (
        <p className="text-xs text-[#7A6220] mt-2 flex items-start gap-1.5">
          <AlertTriangle size={12} className="mt-0.5 flex-shrink-0" />
          The percentages come to {pctTotal}%. The bills will still add up to the year&rsquo;s fee —
          the last installment absorbs the difference — but that is probably not what was meant.
        </p>
      )}

      {canEdit && (adding ? (
        <div className="flex flex-wrap gap-2 mt-3">
          <input value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })}
                 placeholder="Term 1" className={`${ADMIN.inputPlain} w-32`} />
          <input type="date" value={draft.due_date} onChange={e => setDraft({ ...draft, due_date: e.target.value })}
                 className={`${ADMIN.inputPlain} w-40`} />
          <input type="number" min={0} max={100} value={draft.percent}
                 onChange={e => setDraft({ ...draft, percent: e.target.value })}
                 placeholder="% of year" className={`${ADMIN.inputPlain} w-28`} />
          <button onClick={() => void add()} disabled={!draft.due_date} className={ADMIN.darkBtn}>
            <Check size={13} /> Add
          </button>
          <button onClick={() => setAdding(false)} className={ADMIN.ghostBtn}>Cancel</button>
        </div>
      ) : (
        <button onClick={() => setAdding(true)} className={`${ADMIN.ghostBtn} mt-3`}>
          <Plus size={13} /> Add an installment
        </button>
      ))}
    </div>
  )
}

