'use client'

// ─────────────────────────────────────────────────────────────────────────────
// The price list as one grid.
//
// It used to be a stack of accordion cards: one per structure, each hiding a
// "What is charged" list you added a head to from a dropdown and a number box,
// one head at a time, one card at a time. Setting up a school of twelve grades
// and four groups meant opening forty-eight cards and pressing a plus button
// two hundred times, and at no point could anyone see the thing they were
// actually building — the table of what each group pays for each head.
//
// So: the table. Groups and grades down the side, fee heads across the top,
// an amount in every cell. It reads like the sheet of paper the prices were
// almost certainly worked out on, and it is editable in place: type, tab,
// type. Each cell saves itself when it is left, and only if the number
// actually changed — tabbing through a row you did not edit writes nothing.
//
// Two things stay off the grid, because they are not per-cell facts:
//   Publish     a structure's status, which belongs to the whole row
//   Terms       when the year's money falls due, which is a small table of its
//               own and sits behind a button on the row
// ─────────────────────────────────────────────────────────────────────────────

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle, CalendarDays, Check, Loader2, Plus, Settings2, Trash2,
} from 'lucide-react'
import ModalShell from '@/components/ui/ModalShell'
import { ADMIN, STRUCTURE_CHIP, fmtDate, inr } from '@/components/fees/ui'
import { gradeLabel, GRADE_OPTIONS } from '@/lib/grades'
import {
  createStructure, deleteInstallment, deleteStructure, removeStructureItem,
  saveInstallment, setAutogen, setStructureItem, setStructureStatus,
  type FeeConfigBundle, type FeeStructureRow,
} from '@/lib/fees/config'

interface Props {
  bundle: FeeConfigBundle
  yearId: string
  canEdit: boolean
  canAutogen: boolean
  showAmounts: boolean
  onChanged: () => void
  onError: (m: string | null) => void
}

/** `structureId:headId`, the key a cell's pending edit is held under. */
const cellKey = (structureId: string, headId: string) => `${structureId}:${headId}`

export default function FeeGrid({
  bundle, yearId, canEdit, canAutogen, showAmounts, onChanged, onError,
}: Props) {
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState<Set<string>>(new Set())
  const [adding, setAdding] = useState(false)
  const [terms, setTerms] = useState<FeeStructureRow | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<FeeStructureRow | null>(null)

  // Rows read down the page the way the groups are listed — default group
  // first, then the rest — and inside a group by grade, "every grade" first.
  const rows = useMemo(() => {
    const groupOrder = new Map(bundle.groups.map((g, i) => [g.id, i]))
    return [...bundle.structures].sort((a, b) => {
      const ga = groupOrder.get(a.fee_group_id) ?? 99
      const gb = groupOrder.get(b.fee_group_id) ?? 99
      if (ga !== gb) return ga - gb
      if (a.grade === b.grade) return a.name.localeCompare(b.name)
      if (a.grade === null) return -1
      if (b.grade === null) return 1
      return a.grade - b.grade
    })
  }, [bundle.structures, bundle.groups])

  const amountOf = useCallback((structureId: string, headId: string): number | null => {
    const item = bundle.items.find(i => i.structure_id === structureId && i.fee_head_id === headId)
    return item ? Number(item.amount) : null
  }, [bundle.items])

  // A write elsewhere (a clone, another tab) reloads the bundle; drafts for
  // cells that now agree with the database are stale and would otherwise sit
  // there looking like unsaved work.
  useEffect(() => { setDrafts({}) }, [bundle])

  const commit = async (structureId: string, headId: string, raw: string) => {
    const key = cellKey(structureId, headId)
    const current = amountOf(structureId, headId)
    const trimmed = raw.trim()
    const next = trimmed === '' ? null : Number(trimmed)

    if (next !== null && !Number.isFinite(next)) { clearDraft(key); return }
    // Nothing typed, nothing different — the common case when tabbing across.
    if ((next === null && current === null) || (next !== null && current !== null && next === current)) {
      clearDraft(key)
      return
    }

    setSaving(s => new Set(s).add(key))
    onError(null)
    try {
      if (next === null || next === 0) {
        // A blank and a zero mean the same thing to a reader: this group does
        // not pay this head. Storing a zero line would put a ₹0 row on the
        // bill saying so out loud.
        if (current !== null) await removeStructureItem(structureId, headId)
      } else {
        const sort = (bundle.heads.findIndex(h => h.id === headId) + 1) * 10
        await setStructureItem(structureId, headId, next, sort)
      }
      clearDraft(key)
      onChanged()
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Could not save that amount.')
    } finally {
      setSaving(s => { const n = new Set(s); n.delete(key); return n })
    }
  }

  const clearDraft = (key: string) =>
    setDrafts(d => { const next = { ...d }; delete next[key]; return next })

  const groupName = (id: string) => bundle.groups.find(g => g.id === id)?.name ?? '—'
  const isRte = (id: string) => bundle.groups.find(g => g.id === id)?.is_rte ?? false

  const columnTotal = (headId: string) =>
    bundle.items.filter(i => i.fee_head_id === headId).reduce((a, i) => a + Number(i.amount), 0)

  const rowTotal = (structureId: string) =>
    bundle.items.filter(i => i.structure_id === structureId).reduce((a, i) => a + Number(i.amount), 0)

  if (bundle.heads.length === 0) {
    return (
      <div className={`${ADMIN.card} p-8 text-center`}>
        <p className="text-sm text-[#6B675A] max-w-md mx-auto">
          No fee heads yet, so there is nothing to price. Add Tuition first — press{' '}
          <strong className="text-[#18181B]">Fee heads</strong> above — and every head you add
          becomes a column here.
        </p>
      </div>
    )
  }

  return (
    <>
      <div className={`${ADMIN.card} overflow-hidden`}>
        <div className="overflow-x-auto">
          <table className="text-[12.5px] border-collapse min-w-full">
            <thead>
              <tr className="bg-[#FAF8F2]">
                <th className="sticky left-0 z-20 bg-[#FAF8F2] text-left px-2.5 py-2 min-w-[190px]
                               border-b border-r border-[#E3DFD3]
                               text-[9.5px] font-bold uppercase tracking-[0.12em] text-[#8C8878]">
                  Group · class
                </th>
                {bundle.heads.map(h => (
                  <th key={h.id}
                      className="px-2 py-2 min-w-[92px] border-b border-r border-[#F0ECE2]
                                 text-right text-[9.5px] font-bold uppercase tracking-[0.1em]
                                 text-[#8C8878] align-bottom">
                    <span className="block text-[#3F3F46] normal-case tracking-normal
                                     text-[11px] font-bold leading-tight">
                      {h.name}
                    </span>
                    {Number(h.tax_rate) > 0 && (
                      <span className="block text-[9px] text-[#8C8878]">+{h.tax_rate}% tax</span>
                    )}
                  </th>
                ))}
                <th className="px-2.5 py-2 border-b border-[#E3DFD3] text-right min-w-[90px]
                               text-[9.5px] font-bold uppercase tracking-[0.12em] text-[#8C8878]">
                  Year
                </th>
                <th className="px-2 py-2 border-b border-[#E3DFD3] w-[1%]" />
              </tr>
            </thead>

            <tbody>
              {rows.map(s => {
                const rte = isRte(s.fee_group_id)
                const installments = bundle.installments.filter(i => i.structure_id === s.id)
                return (
                  <tr key={s.id} className="hover:bg-[#FDFCF9] group/row">
                    {/* The row's identity, pinned while the heads scroll. */}
                    <th className="sticky left-0 z-10 bg-white group-hover/row:bg-[#FDFCF9]
                                   text-left px-2.5 py-1.5 border-b border-r border-[#F0ECE2]
                                   font-normal align-top">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-[12.5px] font-bold text-[#18181B]">
                          {groupName(s.fee_group_id)}
                        </span>
                        <span className="text-[11px] text-[#6B675A]">
                          {s.grade === null ? 'every class' : gradeLabel(s.grade)}
                        </span>
                      </div>
                      <div className="flex items-center gap-1 mt-1">
                        <button
                          onClick={() => canEdit && void setStructureStatus(
                            s.id, s.status === 'published' ? 'draft' : 'published').then(onChanged)}
                          disabled={!canEdit}
                          title={canEdit
                            ? s.status === 'published' ? 'Move back to draft' : 'Publish — bills can be generated from it'
                            : undefined}
                          className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-px
                                      border ${STRUCTURE_CHIP[s.status]} ${
                            canEdit ? 'cursor-pointer hover:opacity-80' : ''}`}>
                          {s.status}
                        </button>
                        {rte && (
                          <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-px
                                           bg-[#EEF2FB] text-[#3A5490] border border-[#CFDAEF]">
                            bills nothing
                          </span>
                        )}
                        <button onClick={() => setTerms(s)}
                                title="When this year's money falls due"
                                className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-px
                                            border ${
                                  installments.length === 0
                                    ? 'bg-[#FAF3DF] text-[#7A6220] border-[#E7D9AE]'
                                    : 'bg-white text-[#6B675A] border-[#E3DFD3] hover:border-[#C9C4B4]'
                                }`}>
                          <CalendarDays size={9} className="inline -mt-px mr-0.5" />
                          {installments.length === 0 ? 'no terms' : `${installments.length} terms`}
                        </button>
                      </div>
                    </th>

                    {bundle.heads.map(h => {
                      const key = cellKey(s.id, h.id)
                      const stored = amountOf(s.id, h.id)
                      const value = drafts[key] ?? (stored === null ? '' : String(stored))
                      const busy = saving.has(key)
                      return (
                        <td key={h.id} className="border-b border-r border-[#F0ECE2] p-0 relative">
                          <input
                            type="number" min={0} inputMode="decimal"
                            value={value}
                            disabled={!canEdit}
                            placeholder="—"
                            onChange={e => setDrafts(d => ({ ...d, [key]: e.target.value }))}
                            onBlur={e => void commit(s.id, h.id, e.target.value)}
                            onKeyDown={e => {
                              if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                              if (e.key === 'Escape') clearDraft(key)
                            }}
                            className={`w-full bg-transparent px-2 py-2 text-right tabular-nums
                                        text-[12.5px] focus:outline-none focus:bg-[#FAF3DF]
                                        focus:ring-1 focus:ring-inset focus:ring-[#B8983C]
                                        disabled:text-[#8C8878] ${
                              drafts[key] !== undefined ? 'text-[#7A6220] font-semibold' : 'text-[#18181B]'
                            } ${stored === null ? 'placeholder:text-[#D8D3C5]' : ''}`}
                          />
                          {busy && (
                            <Loader2 size={11}
                                     className="animate-spin text-[#B8983C] absolute left-1.5 top-2.5" />
                          )}
                        </td>
                      )
                    })}

                    <td className="px-2.5 py-1.5 border-b border-[#F0ECE2] text-right
                                   font-bold tabular-nums text-[#18181B]">
                      {inr(rowTotal(s.id), showAmounts)}
                    </td>
                    <td className="px-1 py-1.5 border-b border-[#F0ECE2]">
                      {canEdit && (
                        <button onClick={() => setConfirmDelete(s)}
                                title="Delete this row"
                                className="p-1 text-[#D8D3C5] hover:text-[#A93232] transition-colors">
                          <Trash2 size={12} />
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}

              {rows.length === 0 && (
                <tr>
                  <td colSpan={bundle.heads.length + 3}
                      className="px-4 py-10 text-center text-[12.5px] text-[#8C8878]">
                    No rows yet. A row is one group at one class level — what they are charged,
                    head by head.
                  </td>
                </tr>
              )}
            </tbody>

            {rows.length > 0 && (
              <tfoot>
                <tr className="bg-[#FAF8F2]">
                  <th className="sticky left-0 z-10 bg-[#FAF8F2] text-left px-2.5 py-2
                                 border-t border-r border-[#E3DFD3]
                                 text-[9.5px] font-bold uppercase tracking-[0.12em] text-[#8C8878]">
                    Every row, added up
                  </th>
                  {bundle.heads.map(h => (
                    <td key={h.id}
                        className="px-2 py-2 border-t border-r border-[#F0ECE2] text-right
                                   tabular-nums text-[11.5px] text-[#6B675A]">
                      {columnTotal(h.id) === 0 ? '—' : inr(columnTotal(h.id), showAmounts)}
                    </td>
                  ))}
                  <td className="px-2.5 py-2 border-t border-[#E3DFD3] text-right
                                 tabular-nums text-[11.5px] font-bold text-[#18181B]">
                    {inr(rows.reduce((a, s) => a + rowTotal(s.id), 0), showAmounts)}
                  </td>
                  <td className="border-t border-[#E3DFD3]" />
                </tr>
              </tfoot>
            )}
          </table>
        </div>

        {canEdit && (
          <div className="border-t border-[#F0ECE2] px-2.5 py-2">
            {adding ? (
              <AddRow bundle={bundle} yearId={yearId}
                      onClose={() => setAdding(false)}
                      onAdded={() => { setAdding(false); onChanged() }}
                      onError={onError} />
            ) : (
              <button onClick={() => setAdding(true)} className={ADMIN.ghostBtn}
                      disabled={bundle.groups.length === 0}>
                <Plus size={13} /> Add a row
              </button>
            )}
          </div>
        )}
      </div>

      <p className="text-[11px] text-[#8C8878] mt-1.5 leading-relaxed">
        Type an amount and move on — each cell saves itself. A blank cell means that group is not
        charged that head at all. Only <strong className="text-[#6B675A]">published</strong> rows
        can be billed from; press the status chip to publish or pull one back.
      </p>

      {terms && (
        <TermsSheet structure={terms} bundle={bundle} canEdit={canEdit} canAutogen={canAutogen}
                    showAmounts={showAmounts} onClose={() => setTerms(null)}
                    onChanged={onChanged} onError={onError} />
      )}

      {confirmDelete && (
        <ModalShell onClose={() => setConfirmDelete(null)} sharp size="sm"
                    title="Delete this row" icon={<AlertTriangle size={15} />}
                    iconClassName="bg-[#FCECEC] text-[#A93232]">
          <p className="text-sm text-[#6B675A] leading-relaxed">
            {groupName(confirmDelete.fee_group_id)} ·{' '}
            {confirmDelete.grade === null ? 'every class' : gradeLabel(confirmDelete.grade)} and
            its {bundle.items.filter(i => i.structure_id === confirmDelete.id).length} priced
            line{bundle.items.filter(i => i.structure_id === confirmDelete.id).length === 1 ? '' : 's'}{' '}
            go. Bills already issued from it are unaffected — they carry their own copy of the
            price.
          </p>
          <div className="flex items-center justify-end gap-2 mt-4">
            <button onClick={() => setConfirmDelete(null)} className={ADMIN.ghostBtn}>Keep it</button>
            <button
              onClick={() => {
                const id = confirmDelete.id
                setConfirmDelete(null)
                void deleteStructure(id)
                  .then(onChanged)
                  .catch(e => onError(e instanceof Error ? e.message : 'Could not delete that row.'))
              }}
              className={`${ADMIN.darkBtn} px-4`}>
              <Trash2 size={13} /> Delete
            </button>
          </div>
        </ModalShell>
      )}
    </>
  )
}

// ── A new row ─────────────────────────────────────────────────────────────
function AddRow({
  bundle, yearId, onClose, onAdded, onError,
}: {
  bundle: FeeConfigBundle
  yearId: string
  onClose: () => void
  onAdded: () => void
  onError: (m: string | null) => void
}) {
  const [groupId, setGroupId] = useState(
    bundle.groups.find(g => g.is_default)?.id ?? bundle.groups[0]?.id ?? '')
  const [grade, setGrade] = useState('')
  const [busy, setBusy] = useState(false)

  /** Every class at once, or one class — and every class already spoken for. */
  const taken = new Set(bundle.structures
    .filter(s => s.fee_group_id === groupId)
    .map(s => (s.grade === null ? 'all' : String(s.grade))))

  const add = async () => {
    if (!groupId) return
    setBusy(true); onError(null)
    try {
      const g = grade === '' ? null : Number(grade)
      const name = `${g === null ? 'All grades' : gradeLabel(g)} — ${
        bundle.groups.find(x => x.id === groupId)?.name ?? 'Group'}`
      await createStructure({ academic_year_id: yearId, fee_group_id: groupId, grade: g, name })
      onAdded()
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Could not add that row.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-wrap items-end gap-2">
      <label className="block">
        <span className={ADMIN.label}>Group</span>
        <select value={groupId} onChange={e => setGroupId(e.target.value)}
                className={`${ADMIN.inputPlain} mt-1 w-44`}>
          {bundle.groups.map(g => (
            <option key={g.id} value={g.id}>{g.name}{g.is_default ? ' (default)' : ''}</option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className={ADMIN.label}>Class</span>
        <select value={grade} onChange={e => setGrade(e.target.value)}
                className={`${ADMIN.inputPlain} mt-1 w-40`}>
          <option value="" disabled={taken.has('all')}>
            Every class{taken.has('all') ? ' — already there' : ''}
          </option>
          {GRADE_OPTIONS.map(g => (
            <option key={g.value} value={String(g.value)} disabled={taken.has(String(g.value))}>
              {g.label}{taken.has(String(g.value)) ? ' — already there' : ''}
            </option>
          ))}
        </select>
      </label>
      <button onClick={() => void add()} disabled={busy || !groupId} className={ADMIN.darkBtn}>
        {busy ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Add
      </button>
      <button onClick={onClose} className={ADMIN.ghostBtn}>Cancel</button>
      <p className="text-[11px] text-[#8C8878] flex-1 min-w-[200px]">
        A row for one class beats a row for every class: the most specific row that fits a student
        is the one they are billed from.
      </p>
    </div>
  )
}

// ── When it falls due ─────────────────────────────────────────────────────
function TermsSheet({
  structure, bundle, canEdit, canAutogen, showAmounts, onClose, onChanged, onError,
}: {
  structure: FeeStructureRow
  bundle: FeeConfigBundle
  canEdit: boolean
  canAutogen: boolean
  showAmounts: boolean
  onClose: () => void
  onChanged: () => void
  onError: (m: string | null) => void
}) {
  const installments = bundle.installments
    .filter(i => i.structure_id === structure.id)
    .sort((a, b) => a.seq - b.seq)

  const [draft, setDraft] = useState({ name: '', due_date: '', percent: '' })
  const [busy, setBusy] = useState(false)

  const pctTotal = installments.reduce((a, i) => a + (Number(i.percent) || 0), 0)
  const headName = (id: string) => bundle.heads.find(h => h.id === id)?.name ?? 'Fee head'
  const total = bundle.items
    .filter(i => i.structure_id === structure.id)
    .reduce((a, i) => a + Number(i.amount), 0)

  const add = async () => {
    setBusy(true); onError(null)
    try {
      await saveInstallment({
        structure_id: structure.id,
        seq: (installments[installments.length - 1]?.seq ?? 0) + 1,
        name: draft.name.trim() || `Term ${installments.length + 1}`,
        due_date: draft.due_date,
        percent: draft.percent === '' ? null : Number(draft.percent),
        sort: (installments.length + 1) * 10,
      })
      setDraft({ name: '', due_date: '', percent: '' })
      onChanged()
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Could not add that term.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <ModalShell
      onClose={onClose} sharp size="lg"
      title="When it falls due"
      subtitle={`${structure.name} · ${inr(total, showAmounts)} a year`}
      icon={<CalendarDays size={15} />} iconClassName="bg-[#27272A] text-[#B8983C]"
      bodyClassName="bg-[#FDFCF9] !px-3 sm:!px-4 !py-3"
    >
      <div className="space-y-1">
        {installments.map(i => {
          const explicit = bundle.installmentItems.filter(ii => ii.installment_id === i.id)
          return (
            <div key={i.id}
                 className="flex flex-wrap items-center gap-3 py-2 px-3 bg-white border border-[#E3DFD3]">
              <span className="text-xs font-mono text-[#8C8878] w-5">{i.seq}</span>
              <span className="text-[12.5px] text-[#18181B] flex-1 min-w-[100px]">{i.name}</span>
              <span className="text-[11.5px] text-[#6B675A]">{fmtDate(i.due_date)}</span>
              <span className="text-[12.5px] font-medium text-[#18181B] w-24 text-right">
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
                  className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase
                              tracking-wider px-2 py-1 transition-colors ${
                    i.autogen_enabled
                      ? 'bg-[#EAF5EE] text-[#1F6B42] border border-[#C6E3D2]'
                      : 'bg-white text-[#8C8878] border border-[#E3DFD3] hover:border-[#C9C4B4]'
                  }`}>
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
          <p className="text-[12.5px] text-[#8C8878] py-2">
            No terms yet. Without one there is nothing to bill, however the prices are set.
          </p>
        )}
      </div>

      {installments.length > 0 && pctTotal > 0 && pctTotal !== 100 && (
        <p className="text-[11px] text-[#7A6220] mt-2 flex items-start gap-1.5">
          <AlertTriangle size={12} className="mt-0.5 flex-shrink-0" />
          The percentages come to {pctTotal}%. The bills will still add up to the year&rsquo;s fee —
          the last term absorbs the difference — but that is probably not what was meant.
        </p>
      )}

      {canEdit && (
        <div className="flex flex-wrap items-end gap-2 mt-3 pt-3 border-t border-[#E3DFD3]">
          <label className="block">
            <span className={ADMIN.label}>Name</span>
            <input value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })}
                   placeholder={`Term ${installments.length + 1}`}
                   className={`${ADMIN.inputPlain} mt-1 w-32`} />
          </label>
          <label className="block">
            <span className={ADMIN.label}>Due</span>
            <input type="date" value={draft.due_date}
                   onChange={e => setDraft({ ...draft, due_date: e.target.value })}
                   className={`${ADMIN.inputPlain} mt-1 w-40`} />
          </label>
          <label className="block">
            <span className={ADMIN.label}>% of the year</span>
            <input type="number" min={0} max={100} value={draft.percent}
                   onChange={e => setDraft({ ...draft, percent: e.target.value })}
                   placeholder={installments.length === 0 ? '100' : ''}
                   className={`${ADMIN.inputPlain} mt-1 w-28`} />
          </label>
          <button onClick={() => void add()} disabled={busy || !draft.due_date}
                  className={ADMIN.darkBtn}>
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />} Add term
          </button>
        </div>
      )}
    </ModalShell>
  )
}
