'use client'

// ─────────────────────────────────────────────────────────────────────────────
// Fee Configuration.
//
//   1. Terms and fee heads — the shape of the grid, side by side.
//   2. The issue panel — pick a term or a month, narrow by head and grade, and
//      the cells it covers light up in the grid below.
//   3. The grid — grades down, terms / monthly / other across.
//   4. What has been issued, with undo.
//   5. A quiet link to copy last session's grid forward.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { AnimatePresence, motion } from 'framer-motion'
import { AlertOctagon, BadgePercent, Copy, Lock, Plus, Receipt, Timer } from 'lucide-react'
import { useAcademicYear } from '@/contexts/AcademicYearContext'
import { useFeePermissions } from '@/hooks/useFeePermissions'
import { ADMIN, CHIP } from '@/components/fees/ui'
import { Loading, Notice, SectionBar, TitledPanel } from '@/components/fees/shell'
import {
  cloneGrid, defaultMonthDue, fetchFeeRoutes, fetchGrid, fetchStudents, issueProgress, monthLabel, rateKey,
  saveMonthDues, sessionMonths, setRates, type Progress,
  type ChargeRow, type GridBundle, type HeadRow, type IssueRow,
  type RateEdit, type StudentLite, type TermRow,
} from '@/lib/fees/grid'
import FeeGrid from './FeeGrid'
import ChargeSheet from './ChargeSheet'
import { HeadSheet, SplitSheet, TermSheet } from './SetupSheets'
import OptInSheet from './OptInSheet'
import { IssueBar, IssueSheet, IssuesLog, UndoSheet, emptyScope, type FeeRoute, type IssueScope } from './IssuePanel'
import { shortDate } from './kit'

const EMPTY: GridBundle = {
  terms: [], heads: [], groups: [], rates: [], charges: [], issues: [], cells: [], fineCategories: [],
  optins: new Map(), months: new Map(), chargeBilled: new Map(),
}

/** "Issued" only when every priced cell is; otherwise how far it has got. */
function IssuedChip({ p, kind }: { p?: Progress; kind: 'term' | 'head' }) {
  if (!p) return null
  if (p.months.length > 0) {
    const label = p.months.length <= 2 ? p.months.map(m => monthLabel(m, false)).join(', ') : `${p.months.length} months`
    return <span className={`${chip} bg-[#EAF5EE] text-[#1F6B42] border-[#C6E3D2]`} title={p.months.map(m => monthLabel(m)).join(', ')}>
      <Lock size={8} className="inline -mt-px" /> {label}
    </span>
  }
  if (p.issued === 0) return null
  if (p.issued >= p.priced) {
    return <span className={`${chip} bg-[#EAF5EE] text-[#1F6B42] border-[#C6E3D2]`}><Lock size={8} className="inline -mt-px" /> Issued</span>
  }
  return (
    <span className={`${chip} bg-[#FAF3DF] text-[#7A6220] border-[#E7D9AE]`}
          title={`Issued for ${p.issuedRows} of ${p.rows} priced rows${kind === 'head' ? ' across its terms' : ''}`}>
      Part · {p.issuedRows}/{p.rows} rows
    </span>
  )
}

type ChargeState = { kind: 'other' | 'fine'; charge: ChargeRow | null } | null

const EMPTY_SET: Set<string> = new Set()

const chip = `${CHIP} border`

export default function FeeGridSection({ onLateFees, onConcessions }: {
  onLateFees?: () => void
  /** Concessions are given here, beside the prices they come off. */
  onConcessions?: () => void
}) {
  const { year, years } = useAcademicYear()
  const perms = useFeePermissions()
  const [data, setData] = useState<GridBundle>(EMPTY)
  const [students, setStudents] = useState<StudentLite[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  const [termSheet, setTermSheet] = useState<{ term: TermRow | null } | null>(null)
  const [headSheet, setHeadSheet] = useState<{ head: HeadRow | null } | null>(null)
  const [splitGrade, setSplitGrade] = useState<number | null>(null)
  const [optHead, setOptHead] = useState<HeadRow | null>(null)
  const [chargeSheet, setChargeSheet] = useState<ChargeState>(null)
  const [issueOpen, setIssueOpen] = useState(false)
  const [undo, setUndo] = useState<IssueRow | null>(null)

  const canEdit = perms.can('fees.config.manage')
  const canIssue = perms.can('fees.invoice.generate')
  const canUndo = perms.can('fees.invoice.cancel')
  const canFine = perms.can('fees.fine.apply')

  const months = useMemo(() => (year ? sessionMonths(year.starts_on, year.ends_on) : []), [year])
  const [scope, setScope] = useState<IssueScope>(() => emptyScope([], []))
  const [routes, setRoutes] = useState<FeeRoute[]>([])
  useEffect(() => { fetchFeeRoutes().then(setRoutes) }, [])

  // Transport's "Issue in fee app" lands here with ?issue=bus&route=<id>: open
  // the issue panel on this month's Bus fee for that route.
  const params = useSearchParams()
  const issueParam = params.get('issue')
  const routeParam = params.get('route')
  const issueRef = useRef<HTMLDivElement>(null)
  const deepLinked = useRef(false)
  useEffect(() => {
    if (deepLinked.current || issueParam !== 'bus') return
    const bus = data.heads.find(h => h.active && h.is_transport && h.frequency === 'monthly')
    if (!bus) return
    deepLinked.current = true
    const ids = (routeParam ?? '').split(',').filter(Boolean)
    setScope(s => ({ ...s, mode: 'month', headIds: new Set([bus.id]), rowIds: new Set(), routeIds: new Set(ids) }))
    setTimeout(() => issueRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 200)
  }, [issueParam, routeParam, data.heads])

  const load = useCallback(async (quiet = false) => {
    if (!year) return
    if (!quiet) setLoading(true)
    try {
      setData(await fetchGrid(year.id))
      setLoadError(null)
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Could not load the fee grid.')
    } finally {
      setLoading(false)
    }
  }, [year])

  useEffect(() => { void load() }, [load])
  useEffect(() => { fetchStudents().then(setStudents).catch(() => setStudents([])) }, [])

  // Keep the issue panel pointing at something that exists.
  useEffect(() => {
    setScope(s => {
      const termOk = s.termId && data.terms.some(t => t.id === s.termId)
      const monthOk = s.month && months.includes(s.month)
      if (termOk && monthOk) return s
      const thisMonth = new Date().toISOString().slice(0, 7) + '-01'
      return {
        ...s,
        termId: termOk ? s.termId : data.terms[0]?.id ?? null,
        month: monthOk ? s.month : (months.includes(thisMonth) ? thisMonth : months[0] ?? null),
      }
    })
  }, [data.terms, months])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 3600)
    return () => clearTimeout(t)
  }, [toast])

  const commitRate = useCallback(async (edit: RateEdit) => {
    if (!year) return
    const key = rateKey(edit, edit.head_id, edit.term_id, edit.gender)
    const before = data.rates
    // Optimistic: the cell keeps the typed value while the save is in flight.
    const rest = before.filter(r => rateKey(r, r.head_id, r.term_id, r.gender) !== key)
    setData(d => ({
      ...d,
      rates: edit.amount === null ? rest : [...rest, {
        id: `tmp-${key}`, grade: edit.grade, group_id: edit.group_id, head_id: edit.head_id,
        term_id: edit.term_id, gender: edit.gender, amount: edit.amount,
      }],
    }))
    try {
      await setRates(year.id, [edit])
    } catch (e) {
      setData(d => ({ ...d, rates: before }))
      setToast(e instanceof Error ? e.message : 'Could not save that price.')
      throw e
    }
  }, [year, data.rates])

  const liveIssueFor = (chargeId: string) =>
    data.issues.find(i => i.charge_id === chargeId && i.status === 'issued') ?? null

  const termLocked = (t: TermRow) => data.cells.some(c => c.term_id === t.id)
  const headLocked = (h: HeadRow) => data.cells.some(c => c.head_id === h.id)
  const gradeLocked = (grade: number) => data.cells.some(c => c.grade === grade)
  const progress = useMemo(() => issueProgress(data), [data])

  /**
   * A grade's first split starts each new group on the grade's own prices,
   * so splitting never empties a row that was already priced.
   */
  const afterSplit = async (grade: number, created: { id: string }[], firstSplit: boolean) => {
    if (year && firstSplit && created.length) {
      const base = data.rates.filter(r => r.grade === grade && r.group_id === null)
      const edits = created.flatMap(g => base.map(r => ({
        grade, group_id: g.id, head_id: r.head_id, term_id: r.term_id, gender: r.gender, amount: r.amount,
      })))
      try { await setRates(year.id, edits) } catch { /* the split stands; prices can be typed in */ }
    }
    refresh()
  }

  const refresh = () => { void load(true) }

  if (perms.loading || (loading && !data.terms.length && !loadError)) return <Loading />

  if (!year) {
    return <Notice>No academic sessions exist yet. Add one in Fee Settings → Sessions.</Notice>
  }

  // The open charge, re-read after every refresh so the sheet never shows a
  // stale copy (an opt-in list saved from inside it, say).
  const openCharge = chargeSheet?.charge
    ? data.charges.find(c => c.id === chargeSheet.charge!.id) ?? chargeSheet.charge
    : null

  const headRows = [...data.heads].sort((a, b) =>
    (a.frequency === b.frequency ? 0 : a.frequency === 'term' ? -1 : 1) || a.sort - b.sort || a.name.localeCompare(b.name))

  return (
    <div className="pb-8">
      {loadError && <Notice tone="error">{loadError}</Notice>}
      {!canEdit && (
        <Notice tone="warn">
          You can see the fee grid but not change it — that needs the “Edit the price list” permission.
        </Notice>
      )}

      {/* ── What is charged besides the grid ───────────────────────────── */}
      {(canEdit || canFine || onLateFees || onConcessions) && (
        <div className="flex flex-wrap items-center gap-1.5 mb-3 sm:mb-4">
          {canEdit && (
            <button onClick={() => setChargeSheet({ kind: 'other', charge: null })} className={`${ADMIN.ghostBtn} h-9`}>
              <Receipt size={14} /> Other fee
            </button>
          )}
          {canFine && (
            <button onClick={() => setChargeSheet({ kind: 'fine', charge: null })} className={`${ADMIN.ghostBtn} h-9`}>
              <AlertOctagon size={14} /> Fine
            </button>
          )}
          {onLateFees && (
            <button onClick={onLateFees} className={`${ADMIN.ghostBtn} h-9`}>
              <Timer size={14} /> Late fee rules
            </button>
          )}
          {onConcessions && (
            <button onClick={onConcessions} className={`${ADMIN.ghostBtn} h-9`}>
              <BadgePercent size={14} /> Concessions
            </button>
          )}
        </div>
      )}

      {/* ── The grid's shape: terms and fee heads ──────────────────────── */}
      <div className="grid gap-3 lg:grid-cols-3 items-start">
        <TitledPanel
          title="Terms" count={data.terms.length || undefined}
          right={canEdit && (
            <button className={ADMIN.onDarkBtn} onClick={() => setTermSheet({ term: null })}>
              <Plus size={13} strokeWidth={2.5} /> Term
            </button>
          )}
        >
          {data.terms.length === 0 ? (
            <p className="px-3.5 py-4 text-[13px] text-slate-500 leading-snug">Add Term 1, Term 2… each with the date its fees fall due.</p>
          ) : data.terms.map(t => (
            <button key={t.id} onClick={() => canEdit && setTermSheet({ term: t })}
                    className="w-full grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 px-3.5 py-2.5 text-left border-b border-[#F0ECE2] last:border-b-0 hover:bg-[#FAF7F0]">
              <span className="text-[13.5px] font-semibold text-slate-900 break-words">{t.name}</span>
              <span className="text-[12px] text-slate-600 tabular-nums">due {shortDate(t.due_date)}</span>
              <span className="min-w-[62px] text-right">
                <IssuedChip p={progress.term.get(t.id)} kind="term" />
              </span>
            </button>
          ))}
        </TitledPanel>

        <MonthsPanel
          yearId={year.id} months={months} dues={data.months} cells={data.cells} canEdit={canEdit}
          hasMonthly={data.heads.some(h => h.frequency === 'monthly')}
          onSaved={refresh} onError={msg => setToast(msg)}
        />

        <TitledPanel
          title="Fee heads" count={data.heads.length || undefined}
          right={canEdit && (
            <button className={ADMIN.onDarkBtn} onClick={() => setHeadSheet({ head: null })}>
              <Plus size={13} strokeWidth={2.5} /> Head
            </button>
          )}
        >
          {headRows.length === 0 ? (
            <p className="px-3.5 py-4 text-[13px] text-slate-500 leading-snug">Tuition, Bus, Uniform, ID card, Water bottle — anything the school charges.</p>
          ) : (
            <div>
              {headRows.map(h => (
                <div key={h.id}
                     className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-3.5 py-2.5 border-b border-[#F0ECE2] last:border-b-0 hover:bg-[#FAF7F0]">
                  <button onClick={() => canEdit && setHeadSheet({ head: h })} className="text-left min-w-0">
                    <span className="block text-[13.5px] font-semibold text-slate-900 break-words">{h.name}</span>
                    {h.optional && (
                      <span className="block text-[12px] text-slate-500">
                        Optional · {data.optins.get(h.id)?.size ?? 0} opted in
                      </span>
                    )}
                  </button>
                  <span className="flex items-center gap-1 flex-wrap justify-end">
                    <IssuedChip p={progress.head.get(h.id)} kind="head" />
                    {h.optional && (
                      <button onClick={() => setOptHead(h)} title="Open the opt-in list"
                              className={`${chip} bg-white text-[#7A6220] border-[#B8983C] hover:bg-[#FAF3DF]`}>
                        Opt-in list
                      </button>
                    )}
                    {h.gender_split && (
                      <span className={`${chip} bg-white text-slate-600 border-[#E3DFD3]`}>B/G</span>
                    )}
                    <span className={`${chip} ${h.frequency === 'monthly'
                      ? 'bg-[#27272A] text-[#E9DDBB] border-[#27272A]'
                      : 'bg-[#F4F1E7] text-slate-600 border-[#E3DFD3]'}`}>
                      {h.frequency === 'monthly' ? 'Monthly' : 'Term-wise'}
                    </span>
                  </span>
                </div>
              ))}
            </div>
          )}
        </TitledPanel>
      </div>

      {/* ── Issue ──────────────────────────────────────────────────────── */}
      <div className="mt-3 scroll-mt-4" ref={issueRef}>
        <IssueBar
          scope={scope} setScope={setScope}
          terms={data.terms} heads={data.heads} groups={data.groups} months={months} monthDue={data.months}
          canIssue={canIssue} onReview={() => setIssueOpen(true)} routes={routes}
        />
      </div>

      {/* ── Grid ───────────────────────────────────────────────────────── */}
      <div className="mt-5">
        <SectionBar
          title="Fee grid"
          hint={<>Type a price into a cell. The <Plus size={10} className="inline -mt-px" /> beside a grade splits it into groups by section, and every section must land in a group.</>}
        />
        <FeeGrid
          terms={data.terms} heads={data.heads} groups={data.groups} rates={data.rates}
          cells={data.cells} charges={data.charges} issues={data.issues} students={students}
          scope={scope} canEdit={canEdit}
          optins={data.optins} termProgress={progress.term}
          onCommit={commitRate}
          onSplit={grade => setSplitGrade(grade)}
          onOptIns={h => setOptHead(h)}
          onOpenCharge={c => setChargeSheet({ kind: c.kind, charge: c })}
          onEditTerm={t => setTermSheet({ term: t })}
          onEditHead={h => setHeadSheet({ head: h })}
        />
      </div>

      <IssuesLog
        issues={data.issues} heads={data.heads} groups={data.groups} canUndo={canUndo} routes={routes}
        onUndo={setUndo}
        onOpenCharge={id => {
          const c = data.charges.find(x => x.id === id)
          if (c) setChargeSheet({ kind: c.kind, charge: c })
        }}
      />

      {perms.can('fees.config.clone_year') && years.length > 1 && (
        <CloneLink yearId={year.id} years={years.filter(y => y.id !== year.id)} onDone={msg => { setToast(msg); refresh() }} />
      )}

      {/* ── Sheets ─────────────────────────────────────────────────────── */}
      <TermSheet
        open={!!termSheet} onClose={() => setTermSheet(null)} yearId={year.id}
        term={termSheet?.term ?? null} nextSeq={(data.terms.at(-1)?.seq ?? 0) + 1}
        locked={termSheet?.term ? termLocked(termSheet.term) : false} onSaved={refresh}
      />
      <HeadSheet
        open={!!headSheet} onClose={() => setHeadSheet(null)} yearId={year.id}
        head={headSheet?.head ?? null} nextSort={data.heads.length + 1}
        locked={headSheet?.head ? headLocked(headSheet.head) : false} onSaved={refresh}
      />
      {splitGrade !== null && (
        <SplitSheet
          open onClose={() => setSplitGrade(null)} yearId={year.id}
          grade={splitGrade} groups={data.groups} students={students}
          locked={gradeLocked(splitGrade)}
          onSaved={(created, first) => void afterSplit(splitGrade, created, first)}
        />
      )}
      {optHead && (
        <OptInSheet
          open onClose={() => setOptHead(null)} yearId={year.id}
          target={{ head_id: optHead.id }}
          title={`${optHead.name} — opt-in list`}
          subtitle={`Optional ${optHead.frequency === 'monthly' ? 'monthly' : 'term-wise'} fee. Only ticked students are billed when it is issued.`}
          students={students} current={data.optins.get(optHead.id) ?? new Set()} canEdit={canEdit}
          onSaved={refresh}
        />
      )}
      <ChargeSheet
        open={!!chargeSheet} onClose={() => setChargeSheet(null)} yearId={year.id}
        kind={chargeSheet?.kind ?? 'other'} charge={openCharge}
        issue={openCharge ? liveIssueFor(openCharge.id) : null}
        optins={openCharge ? data.optins.get(openCharge.id) ?? EMPTY_SET : EMPTY_SET}
        billed={openCharge ? data.chargeBilled.get(openCharge.id) ?? EMPTY_SET : EMPTY_SET}
        students={students} fineCategories={data.fineCategories}
        canEdit={chargeSheet?.kind === 'fine' ? canFine : canEdit}
        canIssue={chargeSheet?.kind === 'fine' ? canFine : canIssue}
        onSaved={refresh}
        onUndo={i => { setChargeSheet(null); setUndo(i) }}
      />
      <IssueSheet
        open={issueOpen} onClose={() => setIssueOpen(false)} yearId={year.id}
        scope={scope} groups={data.groups} heads={data.heads}
        onIssued={() => { setToast('Issued. Those cells are now locked.'); refresh() }}
      />
      <UndoSheet issue={undo} onClose={() => setUndo(null)}
                 onDone={() => { setToast('Issue undone. The bills are withdrawn and the cells unlocked.'); refresh() }} />

      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }}
            transition={{ duration: 0.18 }}
            className="fixed z-[60] left-1/2 -translate-x-1/2 bottom-[max(1.25rem,env(safe-area-inset-bottom))]
                       bg-[#27272A] text-white text-[12px] pl-3 pr-4 py-2.5 border-l-[3px] border-[#B8983C]
                       shadow-[0_16px_40px_-16px_rgba(0,0,0,0.5)] max-w-[calc(100vw-32px)]"
            role="status"
          >
            {toast}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function CloneLink({
  yearId, years, onDone,
}: {
  yearId: string
  years: { id: string; code: string }[]
  onDone: (msg: string) => void
}) {
  const [from, setFrom] = useState(years[0]?.id ?? '')
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const go = async () => {
    setBusy(true); setError(null)
    try {
      const r = await cloneGrid(from, yearId)
      setConfirm(false)
      onDone(`Copied ${r.terms} terms, ${r.heads} heads, ${r.groups} groups, ${r.rates} prices and ${r.months} month due dates.`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not copy.')
    } finally {
      setBusy(false)
    }
  }

  const link = 'font-semibold text-[12.5px] text-[#8B6F47] hover:text-[#5E4A2F] underline underline-offset-2'

  return (
    <div className="mt-6 pt-3 border-t border-[#DCD6C9] flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-[12.5px] text-slate-500">
      <Copy size={13} />
      <span>Copy terms, heads and prices from</span>
      <select value={from} onChange={e => { setFrom(e.target.value); setConfirm(false) }}
              className="bg-transparent font-semibold text-slate-900 focus:outline-none cursor-pointer">
        {years.map(y => <option key={y.id} value={y.id}>{y.code}</option>)}
      </select>
      {confirm ? (
        <>
          <span>— anything already here is kept.</span>
          <button onClick={() => void go()} disabled={busy} className={link}>{busy ? 'Copying…' : 'Copy now'}</button>
          <button onClick={() => setConfirm(false)} className={link}>Cancel</button>
        </>
      ) : (
        <button onClick={() => setConfirm(true)} className={link}>Copy</button>
      )}
      {error && <span className="basis-full text-center text-[#A93232]">{error}</span>}
    </div>
  )
}

/**
 * When each month's fees fall due. Monthly heads are issued against these
 * dates, so issuing never asks for one. A month without a date falls due on
 * the 10th; a month already issued keeps its date.
 */
function MonthsPanel({
  yearId, months, dues, cells, canEdit, hasMonthly, onSaved, onError,
}: {
  yearId: string
  months: string[]
  dues: Map<string, string>
  cells: { bill_month: string | null }[]
  canEdit: boolean
  hasMonthly: boolean
  onSaved: () => void
  onError: (msg: string) => void
}) {
  const issued = useMemo(() => new Set(cells.map(c => c.bill_month).filter(Boolean) as string[]), [cells])
  const [day, setDay] = useState('10')
  const [busy, setBusy] = useState(false)

  const save = async (rows: { month: string; due_date: string }[]) => {
    setBusy(true)
    try { await saveMonthDues(yearId, rows); onSaved() }
    catch (e) { onError(e instanceof Error ? e.message : 'Could not save that date.') }
    finally { setBusy(false) }
  }

  const applyDay = () => {
    const d = Math.min(Math.max(Number(day) || 10, 1), 28)
    void save(months.filter(m => !issued.has(m)).map(m => ({ month: m, due_date: `${m.slice(0, 8)}${String(d).padStart(2, '0')}` })))
  }

  return (
    <TitledPanel title="Monthly due dates">
      {!hasMonthly && (
        <p className="px-3.5 pt-2.5 text-[12.5px] text-slate-500 leading-snug">Used by monthly heads such as Bus. Add one to start billing by month.</p>
      )}
      {canEdit && (
        <div className="flex flex-wrap items-center gap-1.5 px-3.5 py-2.5 border-b border-[#F0ECE2]">
          <span className="text-[13px] text-slate-600">Every month on day</span>
          <input type="number" min={1} max={28} value={day} onChange={e => setDay(e.target.value)}
                 className={`${ADMIN.inputPlain} !w-[58px] !min-h-8 !py-1 text-center tabular-nums`} />
          <button onClick={applyDay} disabled={busy} className={ADMIN.ghostBtn}>Apply</button>
          <span className="text-[12px] text-slate-400">Issued months keep theirs</span>
        </div>
      )}
      {/* One column on a phone: a native date field needs the width to show
          its whole date. */}
      <div className="grid grid-cols-1 sm:grid-cols-2">
        {months.map((m, i) => {
          const due = dues.get(m) ?? defaultMonthDue(m)
          const locked = issued.has(m)
          return (
            <label key={m}
                   className={`flex items-center gap-2 px-3.5 py-2 min-w-0 border-b border-[#F0ECE2] ${i % 2 === 0 ? 'sm:border-r' : ''}`}>
              <span className="text-[12.5px] font-semibold text-slate-900 w-[62px] flex-shrink-0">{monthLabel(m)}</span>
              {locked || !canEdit ? (
                <span className="text-[12px] text-slate-600 tabular-nums flex items-center gap-1 min-w-0">
                  {shortDate(due)} {locked && <Lock size={9} className="text-[#1F6B42]" />}
                </span>
              ) : (
                <input type="date" defaultValue={due} key={due}
                       onBlur={e => { if (e.target.value && e.target.value !== due) void save([{ month: m, due_date: e.target.value }]) }}
                       className="min-w-0 flex-1 bg-transparent text-[12px] text-slate-600 tabular-nums focus:outline-none focus:text-slate-900" />
              )}
            </label>
          )
        })}
      </div>
    </TitledPanel>
  )
}
