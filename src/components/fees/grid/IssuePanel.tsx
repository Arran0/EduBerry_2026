'use client'

// ─────────────────────────────────────────────────────────────────────────────
// Issuing: the floating bar above the grid that picks a slice of it, the sheet
// that previews exactly what that slice will bill, and the log of what has
// been issued with the way back out.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle, CheckCircle2, ChevronDown, Loader2, Lock, Send, Undo2,
} from 'lucide-react'
import { GRADE_OPTIONS, gradeShortLabel } from '@/lib/grades'
import {
  NO_GRADE_LABEL, gridRows, issueBlockers, issueGrid, monthLabel, rowId, rowLabel, undoIssue,
  type Blocker, type GridRowKey, type GroupRow, type HeadRow, type IssueRow, type IssueSummary, type TermRow,
} from '@/lib/fees/grid'
import {
  BTN, Chip, ErrorNote, FIELD, GLASS, GlassSheet, Group, SYS, Segmented, rupees, shortDate,
} from './glass'

export type IssueMode = 'term' | 'month'

/** What the bar has selected — the grid tints the cells it covers. */
export interface IssueScope {
  mode: IssueMode
  termId: string | null
  month: string | null
  /** Empty = every head of the mode's kind. */
  headIds: Set<string>
  /** Empty = every row. */
  rowIds: Set<string>
  due: string
}

export function emptyScope(terms: TermRow[], months: string[]): IssueScope {
  return {
    mode: 'term', termId: terms[0]?.id ?? null, month: months[0] ?? null,
    headIds: new Set(), rowIds: new Set(), due: '',
  }
}

export function IssueBar({
  scope, setScope, terms, heads, groups, months, canIssue, onReview,
}: {
  scope: IssueScope
  setScope: (s: IssueScope) => void
  terms: TermRow[]
  heads: HeadRow[]
  groups: GroupRow[]
  months: string[]
  canIssue: boolean
  onReview: () => void
}) {
  const [moreOpen, setMoreOpen] = useState(false)
  const modeHeads = heads.filter(h => h.active && h.frequency === (scope.mode === 'term' ? 'term' : 'monthly'))
  const rows = gridRows(groups)
  const term = terms.find(t => t.id === scope.termId)

  const set = (patch: Partial<IssueScope>) => setScope({ ...scope, ...patch })
  const toggle = (key: 'headIds' | 'rowIds', id: string) => {
    const n = new Set(scope[key]); if (n.has(id)) n.delete(id); else n.add(id)
    set({ [key]: n } as Partial<IssueScope>)
  }
  const gradeRows = (g: number | null) => rows.filter(r => r.grade === g).map(rowId)
  const gradeOn = (g: number | null) => gradeRows(g).every(id => scope.rowIds.has(id))
  const toggleGrade = (g: number | null) => {
    const ids = gradeRows(g)
    const n = new Set(scope.rowIds)
    if (ids.every(id => n.has(id))) ids.forEach(id => n.delete(id)); else ids.forEach(id => n.add(id))
    set({ rowIds: n })
  }
  const groupRowsInScope = rows.filter(r => r.group_id && gradeOn(r.grade))

  const ready = scope.mode === 'term' ? !!scope.termId : !!scope.month
  const headSummary = scope.headIds.size === 0 ? `All ${scope.mode === 'term' ? 'term-wise' : 'monthly'} heads` : `${scope.headIds.size} head${scope.headIds.size === 1 ? '' : 's'}`
  const rowSummary = scope.rowIds.size === 0 ? 'every grade' : `${scope.rowIds.size} row${scope.rowIds.size === 1 ? '' : 's'}`

  return (
    <div className={`${GLASS} rounded-[22px] px-3 sm:px-4 py-3`}>
      <div className="flex flex-wrap items-center gap-2.5">
        <div className="flex items-center gap-2 mr-1">
          <span className="w-7 h-7 rounded-[9px] flex items-center justify-center text-white" style={{ background: SYS.blue }}>
            <Send size={14} />
          </span>
          <span className="text-[15px] font-semibold text-[#1C1C1E]">Issue fees</span>
        </div>
        <Segmented<IssueMode>
          value={scope.mode}
          onChange={m => set({ mode: m, headIds: new Set() })}
          options={[{ value: 'term', label: 'By term' }, { value: 'month', label: 'By month' }]}
        />

        {scope.mode === 'term' ? (
          <div className="flex flex-wrap gap-1.5">
            {terms.length === 0 && <span className="text-[13px] text-[rgba(60,60,67,0.6)]">Add a term first</span>}
            {terms.map(t => (
              <Chip key={t.id} on={scope.termId === t.id} onClick={() => set({ termId: t.id })}>{t.name}</Chip>
            ))}
          </div>
        ) : (
          <select
            value={scope.month ?? ''}
            onChange={e => set({ month: e.target.value })}
            className="h-8 rounded-full bg-[rgba(118,118,128,0.12)] px-3 text-[13px] font-medium text-[#1C1C1E] focus:outline-none focus:ring-2 focus:ring-[#007AFF]/40"
          >
            {months.map(m => <option key={m} value={m}>{monthLabel(m)}</option>)}
          </select>
        )}

        <div className="flex-1" />
        <button onClick={() => setMoreOpen(o => !o)} className={BTN.glass} aria-expanded={moreOpen}>
          {headSummary}, {rowSummary}
          <ChevronDown size={14} className={`transition-transform ${moreOpen ? 'rotate-180' : ''}`} />
        </button>
        <button onClick={onReview} disabled={!ready || !canIssue} className={BTN.primary}
                title={canIssue ? undefined : 'You do not have permission to issue fees'}>
          Review & issue
        </button>
      </div>

      {moreOpen && (
        <div className="mt-3 pt-3 border-t border-black/[0.06] grid gap-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[12.5px] text-[rgba(60,60,67,0.6)] w-[72px]">Fee heads</span>
            <Chip on={scope.headIds.size === 0} onClick={() => set({ headIds: new Set() })}>All</Chip>
            {modeHeads.map(h => (
              <Chip key={h.id} on={scope.headIds.has(h.id)} onClick={() => toggle('headIds', h.id)}>{h.name}</Chip>
            ))}
            {modeHeads.length === 0 && (
              <span className="text-[12.5px] text-[rgba(60,60,67,0.6)]">
                No {scope.mode === 'term' ? 'term-wise' : 'monthly'} heads yet.
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[12.5px] text-[rgba(60,60,67,0.6)] w-[72px]">Grades</span>
            <Chip on={scope.rowIds.size === 0} onClick={() => set({ rowIds: new Set() })}>All</Chip>
            {GRADE_OPTIONS.map(g => (
              <Chip key={g.value} on={gradeOn(g.value)} onClick={() => toggleGrade(g.value)}>{gradeShortLabel(g.value)}</Chip>
            ))}
            <Chip on={gradeOn(null)} onClick={() => toggleGrade(null)}>No grade</Chip>
          </div>
          {groupRowsInScope.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[12.5px] text-[rgba(60,60,67,0.6)] w-[72px]">Rows</span>
              {rows.filter(r => r.grade !== null && groupRowsInScope.some(x => x.grade === r.grade)).map(r => (
                <Chip key={rowId(r)} on={scope.rowIds.has(rowId(r))} onClick={() => toggle('rowIds', rowId(r))} tone={SYS.indigo}>
                  {rowLabel(r, groups)}
                </Chip>
              ))}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[12.5px] text-[rgba(60,60,67,0.6)] w-[72px]">Due date</span>
            <input type="date" value={scope.due} onChange={e => set({ due: e.target.value })}
                   className="h-8 rounded-full bg-[rgba(118,118,128,0.12)] px-3 text-[13px] focus:outline-none focus:ring-2 focus:ring-[#007AFF]/40" />
            <span className="text-[12.5px] text-[rgba(60,60,67,0.6)]">
              {scope.due ? '' : scope.mode === 'term'
                ? (term ? `Defaults to ${term.name}’s due date, ${shortDate(term.due_date)}` : '')
                : 'Defaults to the 10th of the month'}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}

export function scopeRequest(scope: IssueScope, groups: GroupRow[]) {
  const rows: GridRowKey[] = gridRows(groups).filter(r => scope.rowIds.has(rowId(r)))
  return {
    term_id: scope.mode === 'term' ? scope.termId : null,
    month: scope.mode === 'month' ? scope.month : null,
    due_date: scope.due || null,
    head_ids: Array.from(scope.headIds),
    rows: scope.rowIds.size ? rows : null,
  }
}

// ── Preview and confirm ─────────────────────────────────────────────────
export function IssueSheet({
  open, onClose, yearId, scope, groups, heads, onIssued,
}: {
  open: boolean; onClose: () => void; yearId: string; scope: IssueScope
  groups: GroupRow[]; heads: HeadRow[]; onIssued: () => void
}) {
  const [preview, setPreview] = useState<IssueSummary | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setPreview(null); setError(null); setLoading(true)
    issueGrid(yearId, scopeRequest(scope, groups), false)
      .then(setPreview)
      .catch(e => setError(e instanceof Error ? e.message : 'Could not preview.'))
      .finally(() => setLoading(false))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const commit = async () => {
    setBusy(true); setError(null)
    try {
      await issueGrid(yearId, scopeRequest(scope, groups), true)
      onIssued(); onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not issue.')
    } finally {
      setBusy(false)
    }
  }

  const headNames = scope.headIds.size
    ? heads.filter(h => scope.headIds.has(h.id)).map(h => h.name).join(', ')
    : `All ${scope.mode === 'term' ? 'term-wise' : 'monthly'} heads`

  return (
    <GlassSheet
      open={open} onClose={onClose} size="lg" accent={SYS.blue} icon={<Send size={18} />}
      title={preview ? `Issue ${preview.title}` : 'Issue fees'}
      subtitle={preview ? `Due ${shortDate(preview.due_date)} · ${headNames}` : headNames}
      footer={
        <div className="flex items-center gap-2">
          <p className="text-[12.5px] text-[rgba(60,60,67,0.6)] mr-auto leading-snug max-w-[46ch]">
            Issued cells lock. You can undo while nobody has paid against them.
          </p>
          <button onClick={onClose} className={BTN.glass}>Cancel</button>
          <button onClick={commit} disabled={busy || loading || !preview || preview.invoices === 0} className={BTN.primary}>
            {busy && <Loader2 size={14} className="animate-spin" />}
            {preview && preview.invoices > 0 ? `Issue ${rupees(preview.total)}` : 'Issue'}
          </button>
        </div>
      }
    >
      {loading && (
        <div className="py-12 flex justify-center text-[rgba(60,60,67,0.6)]"><Loader2 className="animate-spin" /></div>
      )}
      {preview && (
        <>
          <div className="grid grid-cols-3 gap-2 mt-1">
            {[
              { label: 'Students', value: String(preview.students) },
              { label: 'Total', value: rupees(preview.total) },
              { label: 'Cells', value: String(preview.cells) },
            ].map(s => (
              <div key={s.label} className="rounded-[14px] bg-white px-3.5 py-3">
                <div className="text-[22px] font-bold tracking-[-0.02em] tabular-nums text-[#1C1C1E] leading-none">{s.value}</div>
                <div className="text-[12px] text-[rgba(60,60,67,0.6)] mt-1.5">{s.label}</div>
              </div>
            ))}
          </div>

          {preview.invoices === 0 && (
            <div className="mt-3 rounded-[12px] bg-[#FF9500]/10 text-[#9A5B00] text-[13px] px-3.5 py-2.5">
              Nothing to bill in this selection — the cells are empty, already issued, or no students sit in those rows.
            </div>
          )}
          {preview.already_issued_cells > 0 && (
            <div className="mt-3 rounded-[12px] bg-[#34C759]/10 text-[#1E6B34] text-[13px] px-3.5 py-2.5 flex gap-2">
              <Lock size={14} className="mt-0.5 flex-shrink-0" />
              {preview.already_issued_cells} cell{preview.already_issued_cells === 1 ? ' was' : 's were'} already issued for this period and will be skipped.
            </div>
          )}
          {preview.no_gender > 0 && (
            <div className="mt-3 rounded-[12px] bg-[#FF9500]/10 text-[#9A5B00] text-[13px] px-3.5 py-2.5 flex gap-2">
              <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
              {preview.no_gender} boys/girls line{preview.no_gender === 1 ? '' : 's'} will be left off because the student has no gender recorded. Add it in their student details, then issue again.
            </div>
          )}

          {preview.by_row.length > 0 && (
            <Group header="By row">
              {preview.by_row.map(r => (
                <div key={rowId(r)} className="flex items-center gap-3 px-4 h-11">
                  <span className="text-[14.5px] text-[#1C1C1E] flex-1 truncate">
                    {r.grade === null ? NO_GRADE_LABEL : rowLabel(r, groups)}
                  </span>
                  <span className="text-[13px] text-[rgba(60,60,67,0.6)] tabular-nums">{r.students} students</span>
                  <span className="text-[14.5px] font-semibold tabular-nums w-[96px] text-right">{rupees(r.total)}</span>
                </div>
              ))}
            </Group>
          )}
        </>
      )}
      <ErrorNote>{error}</ErrorNote>
    </GlassSheet>
  )
}

// ── Undo ────────────────────────────────────────────────────────────────
export function UndoSheet({
  issue, onClose, onDone,
}: { issue: IssueRow | null; onClose: () => void; onDone: () => void }) {
  const [blockers, setBlockers] = useState<Blocker[] | null>(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!issue) return
    setBlockers(null); setReason(''); setError(null)
    issueBlockers(issue.id).then(setBlockers).catch(e => setError(e instanceof Error ? e.message : 'Could not check payments.'))
  }, [issue])

  const go = async () => {
    if (!issue) return
    if (reason.trim().length < 3) { setError('Say why — it goes on every withdrawn bill.'); return }
    setBusy(true); setError(null)
    try { await undoIssue(issue.id, reason.trim()); onDone(); onClose() }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not undo.') }
    finally { setBusy(false) }
  }

  const blocked = (blockers?.length ?? 0) > 0

  return (
    <GlassSheet
      open={!!issue} onClose={onClose} size="md" accent={SYS.red} icon={<Undo2 size={18} />}
      title={issue ? `Undo “${issue.title}”` : 'Undo issue'}
      subtitle={issue ? `${issue.invoice_count} bills · ${rupees(issue.total)}` : undefined}
      footer={
        <div className="flex items-center gap-2 justify-end">
          <button onClick={onClose} className={BTN.glass}>Keep it</button>
          <button onClick={go} disabled={busy || blockers === null || blocked} className={BTN.destructive}>
            {busy && <Loader2 size={14} className="animate-spin" />} Withdraw bills
          </button>
        </div>
      }
    >
      {blockers === null && !error && (
        <div className="py-10 flex justify-center text-[rgba(60,60,67,0.6)]"><Loader2 className="animate-spin" /></div>
      )}
      {blocked && (
        <>
          <div className="rounded-[12px] bg-[#FF3B30]/10 text-[#C4271D] text-[13px] px-3.5 py-2.5 mt-1">
            Students have paid against these bills. Reverse each payment, or refund it in full, before this issue can be undone.
          </div>
          <Group header="Money held">
            {blockers!.map(b => (
              <div key={b.payment_id} className="flex items-center gap-3 px-4 h-12">
                <div className="flex-1 min-w-0">
                  <div className="text-[14.5px] truncate">{b.student_name}</div>
                  <div className="text-[12px] text-[rgba(60,60,67,0.6)]">
                    {b.receipt_no ?? 'No receipt yet'} · {b.status === 'pending' ? 'payment in progress' : 'paid'}
                    {b.refunded > 0 && ` · ${rupees(b.refunded)} refunded`}
                  </div>
                </div>
                <span className="text-[14.5px] font-semibold tabular-nums">{rupees(b.allocated)}</span>
              </div>
            ))}
          </Group>
        </>
      )}
      {blockers !== null && !blocked && (
        <>
          <p className="text-[14px] text-[rgba(60,60,67,0.75)] mt-1 leading-relaxed">
            Every bill in this issue is withdrawn and its cells unlock, so the amounts can be changed and issued again.
          </p>
          <textarea
            value={reason} onChange={e => setReason(e.target.value)} rows={3} autoFocus
            className={`${FIELD} h-auto py-2.5 mt-3 resize-none`}
            placeholder="Why is this being undone? e.g. Wrong bus fee for Grade 4"
          />
        </>
      )}
      <ErrorNote>{error}</ErrorNote>
    </GlassSheet>
  )
}

// ── Log ─────────────────────────────────────────────────────────────────
export function IssuesLog({
  issues, heads, groups, canUndo, onUndo, onOpenCharge,
}: {
  issues: IssueRow[]; heads: HeadRow[]; groups: GroupRow[]; canUndo: boolean
  onUndo: (i: IssueRow) => void; onOpenCharge: (chargeId: string) => void
}) {
  const [showUndone, setShowUndone] = useState(false)
  const live = issues.filter(i => i.status === 'issued')
  const undone = issues.filter(i => i.status === 'undone')
  const list = showUndone ? issues : live
  const headName = useMemo(() => new Map(heads.map(h => [h.id, h.name])), [heads])

  if (issues.length === 0) return null

  return (
    <section className="mt-6">
      <div className="flex items-end justify-between px-1 mb-2">
        <h3 className="text-[20px] font-bold tracking-[-0.01em] text-[#1C1C1E]">Issued</h3>
        {undone.length > 0 && (
          <button className={BTN.plain} onClick={() => setShowUndone(s => !s)}>
            {showUndone ? 'Hide undone' : `Show ${undone.length} undone`}
          </button>
        )}
      </div>
      <div className="rounded-[16px] bg-white overflow-hidden ring-1 ring-black/[0.04] divide-y divide-[rgba(60,60,67,0.1)]">
        {list.length === 0 && <p className="px-4 py-4 text-[13.5px] text-[rgba(60,60,67,0.6)]">Nothing is issued right now.</p>}
        {list.map(i => {
          const heads = i.filters?.head_ids?.length ? i.filters.head_ids.map(id => headName.get(id) ?? 'Head').join(', ') : null
          const rows = i.filters?.rows?.length ? i.filters.rows.map(r => rowLabel(r, groups)).join(', ') : null
          const scope = i.kind === 'charge'
            ? 'Other fee / fine'
            : [i.bill_month ? `Monthly · ${monthLabel(i.bill_month)}` : 'Term-wise', heads ?? 'all heads', rows ?? 'every grade'].join(' · ')
          return (
            <div key={i.id} className={`flex items-center gap-3 px-4 py-3 ${i.status === 'undone' ? 'opacity-55' : ''}`}>
              <span className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
                    style={{ background: i.status === 'issued' ? `${SYS.green}1F` : SYS.fill }}>
                {i.status === 'issued' ? <CheckCircle2 size={16} color={SYS.green} /> : <Undo2 size={15} color={SYS.secondary} />}
              </span>
              <div className="flex-1 min-w-0">
                <button
                  className="text-[15px] font-semibold text-[#1C1C1E] truncate text-left hover:underline disabled:no-underline"
                  disabled={i.kind !== 'charge' || !i.charge_id}
                  onClick={() => i.charge_id && onOpenCharge(i.charge_id)}
                >
                  {i.title}
                </button>
                <div className="text-[12.5px] text-[rgba(60,60,67,0.6)] truncate">
                  {i.status === 'undone' ? `Undone — ${i.undo_reason ?? ''}` : `${scope} · due ${shortDate(i.due_date)}`}
                </div>
              </div>
              <div className="text-right flex-shrink-0">
                <div className="text-[15px] font-semibold tabular-nums">{rupees(i.total)}</div>
                <div className="text-[12px] text-[rgba(60,60,67,0.6)] tabular-nums">{i.invoice_count} bills</div>
              </div>
              {i.status === 'issued' && canUndo && (
                <button onClick={() => onUndo(i)} className={BTN.plain} aria-label={`Undo ${i.title}`}>
                  <Undo2 size={14} /> <span className="hidden sm:inline">Undo</span>
                </button>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}
