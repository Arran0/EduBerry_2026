'use client'

// ─────────────────────────────────────────────────────────────────────────────
// Fee Configuration — the price list.
//
// Round 1 of docs/fee-upgrade-plan.md. Before this, a fee head had one
// `default_amount` for the whole school, so Grade 1 and Grade 12 tuition were
// the same number and there was no way to say "three terms, due 10 April,
// 10 August, 10 December". This is where that gets set up once a year and then
// cloned forward rather than rebuilt.
//
// The screen is a toolbar and a grid. It used to be a full-width card about
// cloning — two controls and a four-line paragraph, above the fold, every
// visit, for a thing done once a year — and then a stack of accordions you
// priced one line at a time. Cloning is now one row of that toolbar, and the
// prices are a table: see `config/FeeGrid.tsx`.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useCallback, useEffect, useState } from 'react'
import {
  AlertTriangle, Check, Copy, FolderTree, Loader2, Plus, Trash2, Users,
} from 'lucide-react'
import { useAcademicYear } from '@/contexts/AcademicYearContext'
import { useFeePermissions } from '@/hooks/useFeePermissions'
import { ADMIN } from '@/components/fees/ui'
import FeeGrid from '@/components/fees/config/FeeGrid'
import GroupRoster from '@/components/fees/config/GroupRoster'
import GroupEditor from '@/components/fees/config/GroupEditor'
import ModalShell from '@/components/ui/ModalShell'
import {
  cloneFeeYear, deleteHead, fetchFeeConfig, saveHead,
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
        <div className="bg-[#FAF3DF] border border-[#E7D9AE] text-[#7A6220] text-sm px-4 py-3">
          You can see the price list but not change it — that needs the &ldquo;Edit the price
          list&rdquo; permission.
        </div>
      )}

      {error && (
        <div className="bg-[#FCECEC] border border-[#EFCCCC] text-[#A93232] text-sm px-4 py-3">{error}</div>
      )}

      {/* ── One toolbar: where the lists live, and the once-a-year clone ── */}
      <div className="flex flex-wrap items-center gap-1.5">
        <button onClick={() => setSheet('heads')} className={ADMIN.ghostBtn}>
          <FolderTree size={13} /> Fee heads
          <span className="text-[#A8A395]">{bundle.heads.length}</span>
        </button>
        <button onClick={() => setSheet('groups')} className={ADMIN.ghostBtn}>
          <Users size={13} /> Groups
          <span className="text-[#A8A395]">{bundle.groups.length}</span>
        </button>
        <div className="flex-1" />
        {perms.can('fees.config.clone_year') && years.length > 1 && year && (
          <CloneBar currentYearId={year.id} onDone={() => void load()} />
        )}
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
        <FeeGrid
          bundle={bundle} yearId={year.id} canEdit={canEdit}
          canAutogen={perms.can('fees.invoice.autogen')}
          showAmounts={!perms.amountsHidden}
          onChanged={() => void load()} onError={setError}
        />
      )}

      {sheet && year && (
        <ModalShell
          onClose={() => setSheet(null)}
          sharp size="2xl"
          title={sheet === 'heads' ? 'Fee heads' : 'Groups'}
          subtitle={sheet === 'heads'
            ? 'Every line a bill can carry — each one becomes a column on the grid'
            : 'Who a row of the grid prices, and who is in each group'}
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
              <GroupEditor bundle={bundle} yearId={year.id} canEdit={canEdit}
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
/**
 * Cloning last year's plan, as one row.
 *
 * This was a full-width card with a heading, two controls and a four-line
 * explanation of what a clone copies — permanently on screen, above the price
 * list, for an action taken once a year. The explanation is now on the button
 * that does it, and the result speaks for itself afterwards.
 */
function CloneBar({ currentYearId, onDone }: { currentYearId: string; onDone: () => void }) {
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
    <div className="flex flex-wrap items-center gap-1.5">
      <span className={`${ADMIN.label} hidden sm:inline`}>Copy into {target?.code}</span>
      <select value={from} onChange={e => setFrom(e.target.value)}
              className="bg-white border border-[#E3DFD3] px-2 py-[7px] text-[11px] font-bold
                         uppercase tracking-[0.06em] text-[#18181B] focus:outline-none
                         focus:border-[#27272A]">
        <option value="">A past session…</option>
        {sources.map(y => <option key={y.id} value={y.id}>{y.code}</option>)}
      </select>
      <button onClick={() => void run()} disabled={!from || busy} className={ADMIN.ghostBtn}
              title="Copies the heads, groups, rows and terms with every due date moved on a year.
Rows arrive as drafts and auto-generation stays off, so nothing bills itself before someone has
looked at the prices. Running it twice adds nothing twice.">
        {busy ? <Loader2 size={13} className="animate-spin" /> : <Copy size={13} />} Clone
      </button>

      {result && (
        <span className="text-[11px] text-[#1F6B42] bg-[#EAF5EE] border border-[#C6E3D2] px-2 py-1">
          {result.heads + result.structures + result.installments === 0
            ? 'Everything was already here.'
            : `${result.heads} heads, ${result.groups} groups, ${result.structures} rows, ${
                result.installments} terms — dates moved on ${result.year_delta} year${
                result.year_delta === 1 ? '' : 's'}.`}
        </span>
      )}
      {error && (
        <span className="text-[11px] text-[#A93232] bg-[#FCECEC] border border-[#EFCCCC] px-2 py-1">
          {error}
        </span>
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
