'use client'

// ─────────────────────────────────────────────────────────────────────────────
// Issuing: the panel above the grid that picks a slice of it, the sheet that
// previews exactly what that slice will bill, and the log of what has been
// issued with the way back out.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Bus, GraduationCap, Layers, Loader2, Lock, Send, Tags, Undo2 } from 'lucide-react'
import { FilterMenu } from '@/components/fees/glass'
import { ADMIN, INVOICE_CHIP } from '@/components/fees/ui'
import { CELL, Col, List, ListHead, Row, Segmented, StatStrip } from '@/components/fees/shell'
import { GRADE_OPTIONS, gradeShortLabel } from '@/lib/grades'
import {
  NO_GRADE_LABEL, defaultMonthDue, gridRows, issueBlockers, issueGrid, issueTransport, monthLabel, rowId, rowLabel, undoIssue,
  type Blocker, type GridRowKey, type GroupRow, type HeadRow, type IssueRow, type IssueSummary, type TermRow,
  type TransportIssueSummary,
} from '@/lib/fees/grid'
import { Aside, ErrorNote, FeeSheet, Field, rupees, shortDate } from './kit'

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
  /** Bus fee only: the routes to bill. Empty = every route. */
  routeIds: Set<string>
}

/** A transport route, as the issue panel offers it for the Bus fee. */
export interface FeeRoute {
  id: string
  name: string
  code: string | null
  color: string
  direction: 'inbound' | 'outbound'
}

/** The Bus fee is in the selection: a monthly issue that includes its head. */
export function busInScope(scope: IssueScope, heads: HeadRow[]): HeadRow | null {
  const bus = heads.find(h => h.active && h.is_transport && h.frequency === 'monthly') ?? null
  if (!bus || scope.mode !== 'month' || !scope.month) return null
  return scope.headIds.size === 0 || scope.headIds.has(bus.id) ? bus : null
}

export function emptyScope(terms: TermRow[], months: string[]): IssueScope {
  return {
    mode: 'term', termId: terms[0]?.id ?? null, month: months[0] ?? null,
    headIds: new Set(), rowIds: new Set(), routeIds: new Set(),
  }
}

const NO_GRADE = 'none'

export function IssueBar({
  scope, setScope, terms, heads, groups, months, monthDue, canIssue, onReview, routes = [],
}: {
  scope: IssueScope
  setScope: (s: IssueScope) => void
  terms: TermRow[]
  heads: HeadRow[]
  groups: GroupRow[]
  months: string[]
  /** Month → the due date set for it, if any. Issuing uses it, or the 10th. */
  monthDue: Map<string, string>
  canIssue: boolean
  onReview: () => void
  /** Transport routes, for billing the Bus fee route by route. */
  routes?: FeeRoute[]
}) {
  const bus = busInScope(scope, heads)
  const modeHeads = heads.filter(h => h.active && h.frequency === (scope.mode === 'term' ? 'term' : 'monthly'))
  const rows = gridRows(groups)
  const term = terms.find(t => t.id === scope.termId)

  const set = (patch: Partial<IssueScope>) => setScope({ ...scope, ...patch })
  const gradeRows = (g: number | null) => rows.filter(r => r.grade === g).map(rowId)
  const gradeOn = (g: number | null) => gradeRows(g).every(id => scope.rowIds.has(id))
  const groupedGrades = new Set(groups.filter(g => gradeOn(g.grade)).map(g => g.grade))
  const gradeKeys = [...GRADE_OPTIONS.map(g => String(g.value)), NO_GRADE]
  const groupRows = rows.filter(r => r.grade !== null && groupedGrades.has(r.grade))
  const groupRowIds = groupRows.map(rowId)

  const ready = scope.mode === 'term' ? !!scope.termId : !!scope.month
  const period = scope.mode === 'term' ? term?.name ?? 'No term' : scope.month ? monthLabel(scope.month) : 'No month'
  // The due date is never asked for here: a term carries its own, and so does
  // a month (set beside the terms, the 10th if nobody set one).
  const due = scope.mode === 'term' ? (term ? shortDate(term.due_date) : '—')
    : scope.month ? shortDate(monthDue.get(scope.month) ?? defaultMonthDue(scope.month)) : '—'
  const summary = [
    period,
    scope.headIds.size === 0 ? `all ${scope.mode === 'term' ? 'term-wise' : 'monthly'} heads` : `${scope.headIds.size} head${scope.headIds.size === 1 ? '' : 's'}`,
    scope.rowIds.size === 0 ? 'every grade' : `${scope.rowIds.size} row${scope.rowIds.size === 1 ? '' : 's'}`,
    ...(bus && routes.length ? [scope.routeIds.size === 0 ? 'every route' : `${scope.routeIds.size} route${scope.routeIds.size === 1 ? '' : 's'}`] : []),
    `due ${due}`,
  ].join(' · ')

  return (
    <section className="fx-card fx-bleed min-w-0">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 bg-[#F7F5F0] border-b border-[#EEEAE1] px-3.5 py-2.5">
        <span className="inline-flex items-center gap-1.5 text-[13.5px] font-semibold text-slate-900">
          <Send size={14} className="text-[#8B6F47]" /> Issue fees
        </span>
        <span className="text-[12px] text-slate-500 leading-snug break-words flex-1 min-w-0 max-sm:basis-full max-sm:order-3">{summary}</span>
        <button onClick={onReview} disabled={!ready || !canIssue}
                title={canIssue ? 'Preview exactly what this will bill' : 'You do not have permission to issue fees'}
                className={`${ADMIN.goldBtn} ml-auto`}>
          Review &amp; issue
        </button>
      </div>

      <div className="p-3 sm:p-3.5 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Segmented<IssueMode>
            value={scope.mode}
            onChange={m => set({ mode: m, headIds: new Set() })}
            options={[{ key: 'term', label: 'By term' }, { key: 'month', label: 'By month' }]}
          />
          {scope.mode === 'term' ? (
            terms.length === 0
              ? <span className="text-[13px] text-slate-500">Add a term first.</span>
              : <Segmented<string> value={scope.termId ?? ''} onChange={id => set({ termId: id })}
                                   options={terms.map(t => ({ key: t.id, label: t.name }))} />
          ) : (
            <select value={scope.month ?? ''} onChange={e => set({ month: e.target.value })}
                    aria-label="Month" className={ADMIN.select}>
              {months.map(m => <option key={m} value={m}>{monthLabel(m)}</option>)}
            </select>
          )}
          <span className="sm:ml-auto text-[13px] text-slate-600">
            <span className={ADMIN.label}>Due</span> <span className="font-bold text-slate-900 tabular-nums ml-1">{due}</span>
            <span className="text-slate-400"> · {scope.mode === 'term' ? 'the term’s date' : 'set under monthly due dates'}</span>
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 pt-2.5 border-t border-[#F0ECE2]">
          {modeHeads.length === 0 ? (
            <span className="text-[13px] text-slate-500">
              No {scope.mode === 'term' ? 'term-wise' : 'monthly'} heads yet.
            </span>
          ) : (
            <FilterMenu
              label="Fee heads" icon={Tags} allLabel="All" width={260}
              value={Array.from(scope.headIds)}
              onChange={v => set({ headIds: new Set(v) })}
              options={modeHeads.map(h => ({ key: h.id, label: h.name }))}
            />
          )}
          {bus && routes.length > 0 && (
            <FilterMenu
              label="Routes" icon={Bus} allLabel="All" width={280}
              value={Array.from(scope.routeIds)}
              onChange={v => set({ routeIds: new Set(v) })}
              options={routes.map(r => ({
                key: r.id,
                label: `${r.code ? `${r.code} · ` : ''}${r.name} ${r.direction === 'inbound' ? '→ school' : '← school'}`,
              }))}
            />
          )}
          <FilterMenu
            label="Grades" icon={GraduationCap} allLabel="All" width={220}
            value={gradeKeys.filter(k => gradeOn(k === NO_GRADE ? null : Number(k)))}
            onChange={v => {
              const n = new Set(scope.rowIds)
              for (const k of gradeKeys) {
                const ids = gradeRows(k === NO_GRADE ? null : Number(k))
                if (v.includes(k)) ids.forEach(id => n.add(id)); else if (ids.every(id => n.has(id))) ids.forEach(id => n.delete(id))
              }
              set({ rowIds: n })
            }}
            options={[...GRADE_OPTIONS.map(g => ({ key: String(g.value), label: gradeShortLabel(g.value) })), { key: NO_GRADE, label: 'No grade' }]}
          />
          {groupedGrades.size > 0 && (
            <FilterMenu
              label="Groups" icon={Layers} allLabel="All" width={260}
              value={groupRowIds.filter(id => scope.rowIds.has(id))}
              onChange={v => {
                const n = new Set(scope.rowIds)
                groupRowIds.forEach(id => (v.includes(id) ? n.add(id) : n.delete(id)))
                set({ rowIds: n })
              }}
              options={groupRows.map(r => ({ key: rowId(r), label: rowLabel(r, groups) }))}
            />
          )}
          {bus && routes.length > 0 && (
            <span className="basis-full text-[12px] text-slate-500">The Bus fee is billed by route; grades do not apply to it.</span>
          )}
        </div>
      </div>
    </section>
  )
}

export function scopeRequest(scope: IssueScope, groups: GroupRow[]) {
  const rows: GridRowKey[] = gridRows(groups).filter(r => scope.rowIds.has(rowId(r)))
  return {
    term_id: scope.mode === 'term' ? scope.termId : null,
    month: scope.mode === 'month' ? scope.month : null,
    due_date: null,
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
  const [bus, setBus] = useState<TransportIssueSummary | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // The Bus fee is billed by route, not by grade: it joins a monthly issue
  // when its head is in the selection and every grade is (a grade filter has
  // no meaning for a route).
  const busHead = busInScope(scope, heads)
  const withBus = !!busHead && scope.rowIds.size === 0
  const routeIds = Array.from(scope.routeIds)

  useEffect(() => {
    if (!open) return
    setPreview(null); setBus(null); setError(null); setLoading(true)
    Promise.all([
      issueGrid(yearId, scopeRequest(scope, groups), false),
      withBus ? issueTransport(yearId, scope.month as string, false, { route_ids: routeIds }) : Promise.resolve(null),
    ])
      .then(([g, b]) => { setPreview(g); setBus(b) })
      .catch(e => setError(e instanceof Error ? e.message : 'Could not preview.'))
      .finally(() => setLoading(false))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const gridBills = preview?.invoices ?? 0
  const busLines = bus?.lines ?? 0
  const totalBills = gridBills + (bus?.invoices ?? 0)
  const grandTotal = (preview?.total ?? 0) + (bus?.total ?? 0)

  const commit = async () => {
    setBusy(true); setError(null)
    try {
      if (gridBills > 0) await issueGrid(yearId, scopeRequest(scope, groups), true)
      if (withBus && busLines > 0) await issueTransport(yearId, scope.month as string, true, { route_ids: routeIds })
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
          <p className="text-[12px] text-slate-500 mr-auto leading-snug max-w-[44ch]">
            Issued cells lock. You can undo while nobody has paid against them.
          </p>
          <button onClick={onClose} className={ADMIN.ghostBtn}>Cancel</button>
          <button onClick={() => void commit()} disabled={busy || loading || !preview || (gridBills === 0 && busLines === 0)}
                  className={ADMIN.goldBtn}>
            {busy && <Loader2 size={13} className="animate-spin" />}
            {gridBills + busLines > 0 ? `Issue ${rupees(grandTotal)}` : 'Issue'}
          </button>
        </div>
      }
    >
      {loading && (
        <div className="py-12 flex justify-center"><Loader2 className="animate-spin text-slate-500" /></div>
      )}
      {preview && (
        <>
          <div className="-mx-4 sm:mx-0 [&>div]:mb-0">
            <StatStrip stats={[
              { label: 'Students', value: String(preview.students) },
              { label: 'Bills', value: String(totalBills) },
              { label: 'Total', value: rupees(grandTotal), strong: true },
            ]} />
          </div>

          {busHead && !withBus && (
            <Aside>
              The Bus fee is billed by route, so it is left out when only some grades are picked. Issue it with every
              grade selected, or from Transport.
            </Aside>
          )}

          {preview.invoices === 0 && busLines === 0 && (
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
          {preview.unassigned > 0 && (
            <Aside tone="warn">
              <AlertTriangle size={11} className="inline mr-1 -mt-0.5" />
              {preview.unassigned} student{preview.unassigned === 1 ? ' is' : 's are'} in a section that no group of
              their grade covers, and will not be billed. Finish that grade’s split first if they should be.
            </Aside>
          )}
          {preview.not_opted > 0 && (
            <Aside>
              {preview.not_opted} optional line{preview.not_opted === 1 ? '' : 's'} left off for students not on that fee’s opt-in list.
            </Aside>
          )}
          {preview.no_gender > 0 && (
            <Aside tone="warn">
              <AlertTriangle size={11} className="inline mr-1 -mt-0.5" />
              {preview.no_gender} boys/girls line{preview.no_gender === 1 ? '' : 's'} will be left off because the student has no gender recorded. Add it in their student details, then issue again.
            </Aside>
          )}

          {bus && bus.by_route.length > 0 && (
            <List className="!mx-0 !border">
              <ListHead cols={BY_ROW_COLS}>
                <Col>Bus fee · route</Col><Col right>Riders</Col><Col right>Amount</Col>
              </ListHead>
              {bus.by_route.map(r => (
                <Row key={r.route_id} cols={BY_ROW_COLS}>
                  <span className={`${CELL.A1} text-[13px] text-slate-900 break-words`}>
                    {r.route_name}
                    {r.unset && <span className="ml-1.5 text-[11px] text-[#A93232]">· pricing not chosen</span>}
                    {r.unpriced > 0 && <span className="ml-1.5 text-[11px] text-[#A93232]">· {r.unpriced} without a price</span>}
                    {r.already > 0 && <span className="ml-1.5 text-[12px] text-slate-500">· {r.already} already billed</span>}
                  </span>
                  <span className={`${CELL.A2} sm:text-right text-[11.5px] text-slate-600 tabular-nums`}>
                    {r.ready}<span className="sm:hidden"> riders</span>
                  </span>
                  <span className={`${CELL.B1} text-right text-[11.5px] font-semibold tabular-nums`}>{rupees(r.total)}</span>
                </Row>
              ))}
            </List>
          )}
          {bus && (bus.unset > 0 || bus.unpriced > 0) && (
            <Aside tone="warn">
              <AlertTriangle size={11} className="inline mr-1 -mt-0.5" />
              {bus.unset + bus.unpriced} rider{bus.unset + bus.unpriced === 1 ? '' : 's'} will not get a Bus fee line — their
              route has no pricing chosen or no amount for them. Set it on the route’s Fees tab in Transport.
            </Aside>
          )}

          {preview.by_row.length > 0 && (
            <List className="!mx-0 !border">
              <ListHead cols={BY_ROW_COLS}>
                <Col>Row</Col><Col right>Students</Col><Col right>Amount</Col>
              </ListHead>
              {preview.by_row.map(r => (
                <Row key={rowId(r)} cols={BY_ROW_COLS}>
                  <span className={`${CELL.A1} text-[13px] text-slate-900 break-words`}>
                    {r.grade === null ? NO_GRADE_LABEL : rowLabel(r, groups)}
                  </span>
                  <span className={`${CELL.A2} sm:text-right text-[11.5px] text-slate-600 tabular-nums`}>
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
        <div className="py-10 flex justify-center"><Loader2 className="animate-spin text-slate-500" /></div>
      )}
      {blocked && (
        <>
          <ErrorNote>
            Students have paid against these bills. Reverse each payment, or refund it in full, before this issue can be undone.
          </ErrorNote>
          <div className="bg-white border border-[#E3DFD3]">
            <div className="bg-[#F7F5F0] border-b border-[#EEEAE1] px-3.5 py-2.5 text-[12px] font-semibold text-slate-700">
              Money held
            </div>
            {blockers!.map(b => (
              <div key={b.payment_id} className="flex items-center gap-3 px-3 py-2 border-b border-[#F0ECE2] last:border-b-0">
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] text-slate-900 break-words">{b.student_name}</div>
                  <div className="text-[12px] text-slate-500 break-words">
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
  issues, heads, groups, canUndo, onUndo, onOpenCharge, routes = [],
}: {
  issues: IssueRow[]; heads: HeadRow[]; groups: GroupRow[]; canUndo: boolean
  routes?: FeeRoute[]
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
          <h2 className="font-display text-[15px] sm:text-[16px] font-bold text-slate-900 leading-snug">Issued</h2>
          <p className="text-[12px] text-slate-500 mt-0.5 leading-snug">
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
        {list.length === 0 && <p className="px-3 py-5 text-[12px] text-slate-500">Nothing is issued right now.</p>}
        {list.map(i => {
          const h = i.filters?.head_ids?.length ? i.filters.head_ids.map(id => headName.get(id) ?? 'Head').join(', ') : null
          const r = i.filters?.rows?.length ? i.filters.rows.map(x => rowLabel(x, groups)).join(', ') : null
          const routeNames = i.filters?.routes?.length
            ? i.filters.routes.map(id => routes.find(x => x.id === id)?.name ?? 'Route').join(', ')
            : 'every route'
          const scope = i.kind === 'charge'
            ? 'Other fee or fine'
            : i.filters?.transport
              ? ['Monthly', h ?? 'Bus fee', routeNames].join(' · ')
              : [i.bill_month ? 'Monthly' : 'Term-wise', h ?? 'all heads', r ?? 'every grade'].join(' · ')
          const isUndone = i.status === 'undone'
          return (
            <Row key={i.id} cols={LOG_COLS} trailing={1} className={isUndone ? 'opacity-60' : ''}>
              <span className={`${CELL.A1} flex items-center gap-1.5 min-w-0`}>
                <span className={`flex-shrink-0 inline-flex items-center h-5 px-2 rounded-full text-[10.5px] font-semibold leading-none whitespace-nowrap ${
                  isUndone ? INVOICE_CHIP.draft : INVOICE_CHIP.paid}`}>
                  {isUndone ? 'Undone' : 'Issued'}
                </span>
                {i.kind === 'charge' && i.charge_id ? (
                  <button onClick={() => onOpenCharge(i.charge_id!)}
                          className="text-[13px] font-medium text-slate-900 break-words hover:underline text-left">
                    {i.title}
                  </button>
                ) : (
                  <span className="text-[13px] font-medium text-slate-900 break-words">
                    {i.bill_month ? monthLabel(i.bill_month) : i.title}
                  </span>
                )}
              </span>
              <span className={`${CELL.A2} text-[12px] text-slate-500 break-words`}>
                {isUndone ? `Undone — ${i.undo_reason ?? ''}` : scope}
              </span>
              <span className={`${CELL.DESKTOP} text-[12px] text-slate-600 whitespace-nowrap`}>{shortDate(i.due_date)}</span>
              <span className={`${CELL.DESKTOP} text-right text-[11.5px] text-slate-600 tabular-nums`}>{i.invoice_count}</span>
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
