'use client'

// ─────────────────────────────────────────────────────────────────────────────
// Fee Configuration.
//
//   1. Terms and fee heads — the shape of the grid.
//   2. The issue bar — pick a term or a month, narrow by head and grade, and
//      the cells it covers light up in the grid below.
//   3. The grid — grades down, terms / monthly / other across.
//   4. What has been issued, with undo.
//   5. A quiet link to copy last session's grid forward.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  AlertOctagon, CalendarDays, Copy, Loader2, Lock, Plus, Receipt, Repeat, Tag,
} from 'lucide-react'
import { useAcademicYear } from '@/contexts/AcademicYearContext'
import { useFeePermissions } from '@/hooks/useFeePermissions'
import {
  cloneGrid, fetchGrid, fetchStudents, rateKey, sessionMonths, setRates,
  type ChargeRow, type GridBundle, type GroupRow, type HeadRow, type IssueRow,
  type RateEdit, type StudentLite, type TermRow,
} from '@/lib/fees/grid'
import FeeGrid from './FeeGrid'
import ChargeSheet from './ChargeSheet'
import { GroupSheet, HeadSheet, TermSheet } from './SetupSheets'
import { IssueBar, IssueSheet, IssuesLog, UndoSheet, emptyScope, type IssueScope } from './IssuePanel'
import { BTN, GLASS, SF, SYS, shortDate } from './glass'

const EMPTY: GridBundle = {
  terms: [], heads: [], groups: [], rates: [], charges: [], issues: [], cells: [], fineCategories: [],
}

type ChargeState = { kind: 'other' | 'fine'; charge: ChargeRow | null } | null

export default function FeeGridSection() {
  const { year, years } = useAcademicYear()
  const perms = useFeePermissions()
  const [data, setData] = useState<GridBundle>(EMPTY)
  const [students, setStudents] = useState<StudentLite[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  const [termSheet, setTermSheet] = useState<{ term: TermRow | null } | null>(null)
  const [headSheet, setHeadSheet] = useState<{ head: HeadRow | null } | null>(null)
  const [groupSheet, setGroupSheet] = useState<{ grade: number; group: GroupRow | null } | null>(null)
  const [chargeSheet, setChargeSheet] = useState<ChargeState>(null)
  const [issueOpen, setIssueOpen] = useState(false)
  const [undo, setUndo] = useState<IssueRow | null>(null)

  const canEdit = perms.can('fees.config.manage')
  const canIssue = perms.can('fees.invoice.generate')
  const canUndo = perms.can('fees.invoice.cancel')
  const canFine = perms.can('fees.fine.apply')

  const months = useMemo(() => (year ? sessionMonths(year.starts_on, year.ends_on) : []), [year])
  const [scope, setScope] = useState<IssueScope>(() => emptyScope([], []))

  const load = useCallback(async (quiet = false) => {
    if (!year) return
    if (!quiet) setLoading(true)
    try {
      const b = await fetchGrid(year.id)
      setData(b)
      setLoadError(null)
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Could not load the fee grid.')
    } finally {
      setLoading(false)
    }
  }, [year])

  useEffect(() => { void load() }, [load])
  useEffect(() => { fetchStudents().then(setStudents).catch(() => setStudents([])) }, [])

  // Keep the issue bar pointing at something that exists.
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
  const groupLocked = (g: GroupRow) => data.cells.some(c => c.group_id === g.id)

  const refresh = () => { void load(true) }

  if (perms.loading || (loading && !data.terms.length && !loadError)) {
    return (
      <div className="py-24 flex justify-center text-[rgba(60,60,67,0.6)]" style={SF}>
        <Loader2 className="animate-spin" />
      </div>
    )
  }

  if (!year) {
    return (
      <p className="px-4 py-12 text-center text-[14px] text-[rgba(60,60,67,0.6)]" style={SF}>
        No academic sessions exist yet. Add one in Fee Settings → Sessions.
      </p>
    )
  }

  const termHeads = data.heads.filter(h => h.frequency === 'term')
  const monthHeads = data.heads.filter(h => h.frequency === 'monthly')

  return (
    <div style={SF} className="relative isolate px-3 sm:px-0 pb-10">
      {/* Something for the glass to refract. Kept faint and behind the
          chrome only — the grid sits on solid white. */}
      <div aria-hidden className="pointer-events-none absolute inset-x-0 -top-6 h-[420px] -z-10 overflow-hidden">
        <div className="absolute -left-20 -top-24 w-[520px] h-[420px] rounded-full bg-[#5AC8FA]/25 blur-[90px]" />
        <div className="absolute left-1/3 -top-10 w-[460px] h-[360px] rounded-full bg-[#AF52DE]/[0.14] blur-[100px]" />
        <div className="absolute right-0 -top-20 w-[420px] h-[380px] rounded-full bg-[#34C759]/[0.14] blur-[90px]" />
      </div>

      {loadError && (
        <div className="mb-3 rounded-[14px] bg-[#FF3B30]/10 text-[#C4271D] text-[13.5px] px-4 py-3">{loadError}</div>
      )}
      {!canEdit && (
        <div className="mb-3 rounded-[14px] bg-[#FF9500]/10 text-[#9A5B00] text-[13.5px] px-4 py-3">
          You can see the fee grid but not change it — that needs the “Edit the price list” permission.
        </div>
      )}

      {/* ── Shape: terms and heads ─────────────────────────────────────── */}
      <div className="grid gap-3 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div className={`${GLASS} rounded-[22px] px-4 py-3.5`}>
          <div className="flex items-center gap-2 mb-2.5">
            <span className="w-7 h-7 rounded-[9px] flex items-center justify-center text-white" style={{ background: SYS.blue }}>
              <CalendarDays size={14} />
            </span>
            <h3 className="text-[15px] font-semibold text-[#1C1C1E] flex-1">Terms</h3>
            {canEdit && (
              <button className={BTN.plain} onClick={() => setTermSheet({ term: null })}><Plus size={15} strokeWidth={2.4} /> Term</button>
            )}
          </div>
          {data.terms.length === 0 ? (
            <p className="text-[13.5px] text-[rgba(60,60,67,0.6)]">Add Term 1, Term 2… each with the date its fees fall due.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {data.terms.map(t => (
                <button key={t.id} onClick={() => canEdit && setTermSheet({ term: t })}
                        className="group rounded-[14px] bg-white/80 ring-1 ring-black/[0.05] px-3 py-2 text-left hover:bg-white transition-colors">
                  <span className="flex items-center gap-1.5 text-[14px] font-semibold text-[#1C1C1E]">
                    {t.name}{termLocked(t) && <Lock size={11} className="text-[#34C759]" />}
                  </span>
                  <span className="block text-[12px] text-[rgba(60,60,67,0.6)]">Due {shortDate(t.due_date)}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className={`${GLASS} rounded-[22px] px-4 py-3.5`}>
          <div className="flex items-center gap-2 mb-2.5">
            <span className="w-7 h-7 rounded-[9px] flex items-center justify-center text-white" style={{ background: SYS.teal }}>
              <Tag size={14} />
            </span>
            <h3 className="text-[15px] font-semibold text-[#1C1C1E] flex-1">Fee heads</h3>
            {canEdit && (
              <button className={BTN.plain} onClick={() => setHeadSheet({ head: null })}><Plus size={15} strokeWidth={2.4} /> Head</button>
            )}
          </div>
          {data.heads.length === 0 ? (
            <p className="text-[13.5px] text-[rgba(60,60,67,0.6)]">Tuition, Bus, Uniform, ID card, Water bottle — anything the school charges.</p>
          ) : (
            <div className="grid gap-2">
              {[{ label: 'Term-wise', list: termHeads, icon: <CalendarDays size={12} /> },
                { label: 'Monthly', list: monthHeads, icon: <Repeat size={12} /> }]
                .filter(g => g.list.length > 0)
                .map(g => (
                  <div key={g.label} className="flex flex-wrap items-center gap-1.5">
                    <span className="inline-flex items-center gap-1 text-[12px] text-[rgba(60,60,67,0.6)] w-[82px]">{g.icon} {g.label}</span>
                    {g.list.map(h => (
                      <button key={h.id} onClick={() => canEdit && setHeadSheet({ head: h })}
                              className="inline-flex items-center gap-1.5 rounded-full bg-white/80 ring-1 ring-black/[0.05] h-8 px-3 text-[13.5px] font-medium text-[#1C1C1E] hover:bg-white transition-colors">
                        {h.name}
                        {h.gender_split && (
                          <span className="text-[10.5px] font-bold"><span className="text-[#0A84FF]">B</span><span className="text-[rgba(60,60,67,0.3)]">/</span><span className="text-[#FF2D55]">G</span></span>
                        )}
                        {headLocked(h) && <Lock size={11} className="text-[#34C759]" />}
                      </button>
                    ))}
                  </div>
                ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Issue bar ──────────────────────────────────────────────────── */}
      <div className="sticky top-2 z-30 mt-3">
        <IssueBar
          scope={scope} setScope={setScope}
          terms={data.terms} heads={data.heads} groups={data.groups} months={months}
          canIssue={canIssue} onReview={() => setIssueOpen(true)}
        />
      </div>

      {/* ── Grid ───────────────────────────────────────────────────────── */}
      <div className="mt-5 mb-2.5 flex flex-wrap items-end gap-2 px-1">
        <div className="mr-auto">
          <h2 className="text-[24px] leading-tight font-bold tracking-[-0.02em] text-[#1C1C1E]">Fee grid</h2>
          <p className="text-[13px] text-[rgba(60,60,67,0.6)]">
            Session {year.code} · type a price into any cell; press <span className="inline-flex items-center gap-0.5"><Plus size={11} /></span> beside a grade to split it into groups by section.
          </p>
        </div>
        {canEdit && (
          <button onClick={() => setChargeSheet({ kind: 'other', charge: null })} className={BTN.glass}>
            <Receipt size={14} color={SYS.indigo} /> Other fee
          </button>
        )}
        {canFine && (
          <button onClick={() => setChargeSheet({ kind: 'fine', charge: null })} className={BTN.glass}>
            <AlertOctagon size={14} color={SYS.red} /> Issue fine
          </button>
        )}
      </div>

      <FeeGrid
        terms={data.terms} heads={data.heads} groups={data.groups} rates={data.rates}
        cells={data.cells} charges={data.charges} issues={data.issues} students={students}
        scope={scope} canEdit={canEdit}
        onCommit={commitRate}
        onAddGroup={grade => setGroupSheet({ grade, group: null })}
        onEditGroup={g => setGroupSheet({ grade: g.grade, group: g })}
        onOpenCharge={c => setChargeSheet({ kind: c.kind, charge: c })}
        onEditTerm={t => setTermSheet({ term: t })}
        onEditHead={h => setHeadSheet({ head: h })}
      />

      <IssuesLog
        issues={data.issues} heads={data.heads} groups={data.groups} canUndo={canUndo}
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
      {groupSheet && (
        <GroupSheet
          open onClose={() => setGroupSheet(null)} yearId={year.id}
          grade={groupSheet.grade} group={groupSheet.group} groups={data.groups} students={students}
          locked={groupSheet.group ? groupLocked(groupSheet.group) : false} onSaved={refresh}
        />
      )}
      <ChargeSheet
        open={!!chargeSheet} onClose={() => setChargeSheet(null)} yearId={year.id}
        kind={chargeSheet?.kind ?? 'other'} charge={chargeSheet?.charge ?? null}
        issue={chargeSheet?.charge ? liveIssueFor(chargeSheet.charge.id) : null}
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
            initial={{ opacity: 0, y: 20, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }} transition={{ type: 'spring', stiffness: 380, damping: 30 }}
            className={`fixed z-[60] left-1/2 -translate-x-1/2 bottom-[max(1.25rem,env(safe-area-inset-bottom))] ${GLASS}
                        rounded-full px-4 py-2.5 text-[13.5px] text-[#1C1C1E] max-w-[calc(100vw-32px)]`}
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
      onDone(`Copied ${r.terms} terms, ${r.heads} heads, ${r.groups} groups and ${r.rates} prices.`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not copy.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-8 flex flex-wrap items-center justify-center gap-2 text-[12.5px] text-[rgba(60,60,67,0.6)]">
      <Copy size={12} />
      <span>Copy terms, heads and prices from</span>
      <select value={from} onChange={e => { setFrom(e.target.value); setConfirm(false) }}
              className="bg-transparent text-[#007AFF] font-medium focus:outline-none cursor-pointer">
        {years.map(y => <option key={y.id} value={y.id}>{y.code}</option>)}
      </select>
      {confirm ? (
        <>
          <span>— anything already here is kept.</span>
          <button onClick={go} disabled={busy} className="text-[#007AFF] font-semibold hover:underline">
            {busy ? 'Copying…' : 'Copy now'}
          </button>
          <button onClick={() => setConfirm(false)} className="hover:underline">Cancel</button>
        </>
      ) : (
        <button onClick={() => setConfirm(true)} className="text-[#007AFF] font-medium hover:underline">Copy</button>
      )}
      {error && <span className="basis-full text-center text-[#FF3B30]">{error}</span>}
    </div>
  )
}
