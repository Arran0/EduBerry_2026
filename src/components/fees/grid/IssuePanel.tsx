'use client'

// ─────────────────────────────────────────────────────────────────────────────
// Issuing: the panel above the grid that picks a slice of it, the sheet that
// previews exactly what that slice will bill, and the log of what has been
// issued with the way back out.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Loader2, Lock, Send, Undo2 } from 'lucide-react'
import { ADMIN, INVOICE_CHIP } from '@/components/fees/ui'
import { CELL, Col, List, ListHead, Row, Segmented, StatStrip } from '@/components/fees/shell'
import { GRADE_OPTIONS, gradeShortLabel } from '@/lib/grades'
import {
  NO_GRADE_LABEL, gridRows, issueBlockers, issueGrid, monthLabel, rowId, rowLabel, undoIssue,
  type Blocker, type GridRowKey, type GroupRow, type HeadRow, type IssueRow, type IssueSummary, type TermRow,
} from '@/lib/fees/grid'
import { Aside, ErrorNote, FeeSheet, Field, Pick, rupees, shortDate } from './kit'

export type IssueMode = 'term' | 'month'

/** What the panel has selected — the grid tints the cells it covers. */
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
  const groupedGrades = new Set(groups.filter(g => gradeOn(g.grade)).map(g => g.grade))

  const ready = scope.mode === 'term' ? !!scope.termId : !!scope.month
  const period = scope.mode === 'term' ? term?.name ?? 'No term' : scope.month ? monthLabel(scope.month) : 'No month'
  const due = scope.due
    ? shortDate(scope.due)
    : scope.mode === 'term' ? (term ? shortDate(term.due_date) : '—')
    : scope.month ? shortDate(`${scope.month.slice(0, 8)}10`) : '—'
  const summary = [
    period,
    scope.headIds.size === 0 ? `all ${scope.mode === 'term' ? 'term-wise' : 'monthly'} heads` : `${scope.headIds.size} head${scope.headIds.size === 1 ? '' : 's'}`,
    scope.rowIds.size === 0 ? 'every grade' : `${scope.rowIds.size} row${scope.rowIds.size === 1 ? '' : 's'}`,
    `due ${due}`,
  ].join(' · ')

  const label = `${ADMIN.label} w-[64px] flex-shrink-0`

  return (
    <section className="bg-white border border-[#E3DFD3] -mx-3 sm:mx-0 max-sm:border-x-0">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 bg-[#27272A] px-3 py-1.5">
        <span className="inline-flex items-center gap-1.5 text-[9.5px] font-bold uppercase tracking-[0.12em] text-[#D4D4D8]">
          <Send size={11} className="text-[#B8983C]" /> Issue fees
        </span>
        <span className="text-[11px] text-[#A1A1AA] truncate flex-1 min-w-0 max-sm:basis-full max-sm:order-3">{summary}</span>
        <button onClick={onReview} disabled={!ready || !canIssue}
                title={canIssue ? 'Preview exactly what this will bill' : 'You do not have permission to issue fees'}
                className={`${ADMIN.goldBtn} !py-[6px] ml-auto`}>
          Review &amp; issue
        </button>
      </div>

      <div className="p-2.5 sm:p-3 space-y-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <Segmented<IssueMode>
            value={scope.mode}
            onChange={m => set({ mode: m, headIds: new Set() })}
            options={[{ key: 'term', label: 'By term' }, { key: 'month', label: 'By month' }]}
          />
          {scope.mode === 'term' ? (
            terms.length === 0
              ? <span className="text-[11.5px] text-[#8C8878]">Add a term first.</span>
              : <Segmented<string> value={scope.termId ?? ''} onChange={id => set({ termId: id })}
                                   options={terms.map(t => ({ key: t.id, label: t.name }))} />
          ) : (
            <select value={scope.month ?? ''} onChange={e => set({ month: e.target.value })}
                    aria-label="Month" className={ADMIN.select}>
              {months.map(m => <option key={m} value={m}>{monthLabel(m)}</option>)}
            </select>
          )}
          <label className="flex items-center gap-2 sm:ml-auto">
            <span className={ADMIN.label}>Due</span>
            <input type="date" value={scope.due} onChange={e => set({ due: e.target.value })}
                   title={scope.mode === 'term' ? 'Leave empty to use the term’s due date' : 'Leave empty for the 10th of the month'}
                   className={`${ADMIN.inputPlain} !w-auto !py-[5px]`} />
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-1 pt-2.5 border-t border-[#F0ECE2]">
          <span className={label}>Heads</span>
          <Pick on={scope.headIds.size === 0} onClick={() => set({ headIds: new Set() })}>All</Pick>
          {modeHeads.map(h => (
            <Pick key={h.id} on={scope.headIds.has(h.id)} onClick={() => toggle('headIds', h.id)}>{h.name}</Pick>
          ))}
          {modeHeads.length === 0 && (
            <span className="text-[11.5px] text-[#8C8878] ml-1">
              No {scope.mode === 'term' ? 'term-wise' : 'monthly'} heads yet.
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1 pt-2.5 border-t border-[#F0ECE2]">
          <span className={label}>Grades</span>
          <Pick on={scope.rowIds.size === 0} onClick={() => set({ rowIds: new Set() })}>All</Pick>
          {GRADE_OPTIONS.map(g => (
            <Pick key={g.value} on={gradeOn(g.value)} onClick={() => toggleGrade(g.value)}>{gradeShortLabel(g.value)}</Pick>
          ))}
          <Pick on={gradeOn(null)} onClick={() => toggleGrade(null)}>No grade</Pick>
        </div>

        {groupedGrades.size > 0 && (
          <div className="flex flex-wrap items-center gap-1 pt-2.5 border-t border-[#F0ECE2]">
            <span className={label}>Rows</span>
            {rows.filter(r => r.grade !== null && groupedGrades.has(r.grade)).map(r => (
              <Pick key={rowId(r)} tone="gold" on={scope.rowIds.has(rowId(r))} onClick={() => toggle('rowIds', rowId(r))}>
                {rowLabel(r, groups)}
              </Pick>
            ))}
          </div>
        )}
      </div>
    </section>
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
const BY_ROW_COLS = 'sm:grid-cols-[minmax(0,1fr)_96px_120px]'

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
    <FeeSheet
      open={open} onClose={onClose} size="lg" icon={<Send size={15} />}
      title={preview ? `Issue ${preview.title}` : 'Issue fees'}
      subtitle={preview ? `Due ${shortDate(preview.due_date)} · ${headNames}` : headNames}
      footer={
        <div className="flex items-center gap-2">
          <p className="text-[11px] text-[#8C8878] mr-auto leading-snug max-w-[44ch]">
            Issued cells lock. You can undo while nobody has paid against them.
          </p>
          <button onClick={onClose} className={ADMIN.ghostBtn}>Cancel</button>
          <button onClick={() => void commit()} disabled={busy || loading || !preview || preview.invoices === 0}
                  className={ADMIN.goldBtn}>
            {busy && <Loader2 size={13} className="animate-spin" />}
            {preview && preview.invoices > 0 ? `Issue ${rupees(preview.total)}` : 'Issue'}
          </button>
        </div>
      }
    >
      {loading && (
        <div className="py-12 flex justify-center"><Loader2 className="animate-spin text-[#8C8878]" /></div>
      )}
      {preview && (
        <>
          <div className="-mx-4 sm:mx-0 [&>div]:mb-0">
            <StatStrip stats={[
              { label: 'Students', value: String(preview.students) },
              { label: 'Bills', value: String(preview.invoices) },
              { label: 'Total', value: rupees(preview.total), strong: true },
            ]} />
          </div>

          {preview.invoices === 0 && (
            <Aside tone="warn">
              Nothing to bill in this selection — the cells are empty, already issued, or no students sit in those rows.
            </Aside>
          )}
          {preview.already_issued_cells > 0 && (
            <Aside tone="good">
              <Lock size={11} className="inline mr-1 -mt-0.5" />
              {preview.already_issued_cells} cell{preview.already_issued_cells === 1 ? ' was' : 's were'} already issued for this period and will be skipped.
            </Aside>
          )}
          {preview.no_gender > 0 && (
            <Aside tone="warn">
              <AlertTriangle size={11} className="inline mr-1 -mt-0.5" />
              {preview.no_gender} boys/girls line{preview.no_gender === 1 ? '' : 's'} will be left off because the student has no gender recorded. Add it in their student details, then issue again.
            </Aside>
          )}

          {preview.by_row.length > 0 && (
            <List className="!mx-0 !border">
              <ListHead cols={BY_ROW_COLS}>
                <Col>Row</Col><Col right>Students</Col><Col right>Amount</Col>
              </ListHead>
              {preview.by_row.map(r => (
                <Row key={rowId(r)} cols={BY_ROW_COLS}>
                  <span className={`${CELL.A1} text-[12.5px] text-[#18181B] truncate`}>
                    {r.grade === null ? NO_GRADE_LABEL : rowLabel(r, groups)}
                  </span>
                  <span className={`${CELL.A2} sm:text-right text-[11.5px] text-[#6B675A] tabular-nums`}>
                    {r.students}<span className="sm:hidden"> students</span>
                  </span>
                  <span className={`${CELL.B1} text-right text-[11.5px] font-semibold tabular-nums`}>{rupees(r.total)}</span>
                </Row>
              ))}
            </List>
          )}
        </>
      )}
      <ErrorNote>{error}</ErrorNote>
    </FeeSheet>
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
    <FeeSheet
      open={!!issue} onClose={onClose} icon={<Undo2 size={15} />}
      title={issue ? `Undo “${issue.title}”` : 'Undo issue'}
      subtitle={issue ? `${issue.invoice_count} bills · ${rupees(issue.total)}` : undefined}
      footer={
        <div className="flex items-center gap-2 justify-end">
          <button onClick={onClose} className={ADMIN.ghostBtn}>Keep it</button>
          <button onClick={() => void go()} disabled={busy || blockers === null || blocked}
                  className={`${ADMIN.darkBtn} !bg-[#A93232] !border-[#A93232] hover:!bg-[#8E2828]`}>
            {busy && <Loader2 size={13} className="animate-spin" />} Withdraw bills
          </button>
        </div>
      }
    >
      {blockers === null && !error && (
        <div className="py-10 flex justify-center"><Loader2 className="animate-spin text-[#8C8878]" /></div>
      )}
      {blocked && (
        <>
          <ErrorNote>
            Students have paid against these bills. Reverse each payment, or refund it in full, before this issue can be undone.
          </ErrorNote>
          <div className="bg-white border border-[#E3DFD3]">
            <div className="bg-[#27272A] px-3 py-1.5 text-[9.5px] font-bold uppercase tracking-[0.12em] text-[#D4D4D8]">
              Money held
            </div>
            {blockers!.map(b => (
              <div key={b.payment_id} className="flex items-center gap-3 px-3 py-2 border-b border-[#F0ECE2] last:border-b-0">
                <div className="flex-1 min-w-0">
                  <div className="text-[12.5px] text-[#18181B] truncate">{b.student_name}</div>
                  <div className="text-[11px] text-[#8C8878] truncate">
                    <span className="font-mono">{b.receipt_no ?? 'No receipt yet'}</span>
                    {' · '}{b.status === 'pending' ? 'payment in progress' : 'paid'}
                    {b.refunded > 0 && ` · ${rupees(b.refunded)} refunded`}
                  </div>
                </div>
                <span className="text-[11.5px] font-semibold tabular-nums">{rupees(b.allocated)}</span>
              </div>
            ))}
          </div>
        </>
      )}
      {blockers !== null && !blocked && (
        <Field label="Why is this being undone?"
               hint="Every bill in this issue is withdrawn with this reason, and its cells unlock so the amounts can change.">
          <textarea value={reason} onChange={e => setReason(e.target.value)} rows={3} autoFocus
                    className={`${ADMIN.inputPlain} resize-none`}
                    placeholder="e.g. Wrong bus fee for Grade 4" />
        </Field>
      )}
      <ErrorNote>{error}</ErrorNote>
    </FeeSheet>
  )
}

// ── Log ─────────────────────────────────────────────────────────────────
const LOG_COLS = 'sm:grid-cols-[minmax(0,200px)_minmax(0,1fr)_96px_72px_112px_88px]'

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
    <section className="mt-5">
      <div className="flex items-end justify-between gap-2 mb-2">
        <div>
          <h2 className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#3F3F46] leading-tight">Issued</h2>
          <p className="text-[10.5px] text-[#8C8878] mt-0.5">
            What has been billed from the grid. Undo withdraws the bills and unlocks the cells.
          </p>
        </div>
        {undone.length > 0 && (
          <button className={ADMIN.ghostBtn} onClick={() => setShowUndone(s => !s)}>
            {showUndone ? 'Hide undone' : `Show ${undone.length} undone`}
          </button>
        )}
      </div>
      <List>
        <ListHead cols={LOG_COLS}>
          <Col>Issue</Col><Col>What it covered</Col><Col>Due</Col><Col right>Bills</Col><Col right>Total</Col><Col right>&nbsp;</Col>
        </ListHead>
        {list.length === 0 && <p className="px-3 py-5 text-[12px] text-[#8C8878]">Nothing is issued right now.</p>}
        {list.map(i => {
          const h = i.filters?.head_ids?.length ? i.filters.head_ids.map(id => headName.get(id) ?? 'Head').join(', ') : null
          const r = i.filters?.rows?.length ? i.filters.rows.map(x => rowLabel(x, groups)).join(', ') : null
          const scope = i.kind === 'charge'
            ? 'Other fee or fine'
            : [i.bill_month ? 'Monthly' : 'Term-wise', h ?? 'all heads', r ?? 'every grade'].join(' · ')
          const isUndone = i.status === 'undone'
          return (
            <Row key={i.id} cols={LOG_COLS} trailing={1} className={isUndone ? 'opacity-60' : ''}>
              <span className={`${CELL.A1} flex items-center gap-1.5 min-w-0`}>
                <span className={`flex-shrink-0 text-[9px] font-bold uppercase tracking-[0.08em] px-1.5 py-[2px] ${
                  isUndone ? INVOICE_CHIP.draft : INVOICE_CHIP.paid}`}>
                  {isUndone ? 'Undone' : 'Issued'}
                </span>
                {i.kind === 'charge' && i.charge_id ? (
                  <button onClick={() => onOpenCharge(i.charge_id!)}
                          className="text-[12.5px] font-medium text-[#18181B] truncate hover:underline text-left">
                    {i.title}
                  </button>
                ) : (
                  <span className="text-[12.5px] font-medium text-[#18181B] truncate">
                    {i.bill_month ? monthLabel(i.bill_month) : i.title}
                  </span>
                )}
              </span>
              <span className={`${CELL.A2} text-[11px] text-[#8C8878] truncate`}>
                {isUndone ? `Undone — ${i.undo_reason ?? ''}` : scope}
              </span>
              <span className={`${CELL.DESKTOP} text-[11px] text-[#6B675A] whitespace-nowrap`}>{shortDate(i.due_date)}</span>
              <span className={`${CELL.DESKTOP} text-right text-[11.5px] text-[#6B675A] tabular-nums`}>{i.invoice_count}</span>
              <span className={`${CELL.B1} text-right text-[11.5px] font-semibold tabular-nums`}>{rupees(i.total)}</span>
              <span className={`${CELL.END} flex justify-end`}>
                {!isUndone && canUndo && (
                  <button onClick={() => onUndo(i)} title="Undo this issue" aria-label={`Undo ${i.title}`}
                          className={`${ADMIN.ghostBtn} max-sm:!px-1.5`}>
                    <Undo2 size={12} /> <span className="max-sm:hidden">Undo</span>
                  </button>
                )}
              </span>
            </Row>
          )
        })}
      </List>
    </section>
  )
}
