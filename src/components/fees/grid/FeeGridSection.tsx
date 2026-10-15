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

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { AlertOctagon, Copy, Lock, Plus, Receipt, Timer } from 'lucide-react'
import { useAcademicYear } from '@/contexts/AcademicYearContext'
import { useFeePermissions } from '@/hooks/useFeePermissions'
import { ADMIN } from '@/components/fees/ui'
import { Loading, Notice, SectionBar, TitledPanel } from '@/components/fees/shell'
import {
  cloneGrid, fetchGrid, fetchStudents, rateKey, sessionMonths, setRates,
  type ChargeRow, type GridBundle, type GroupRow, type HeadRow, type IssueRow,
  type RateEdit, type StudentLite, type TermRow,
} from '@/lib/fees/grid'
import FeeGrid from './FeeGrid'
import ChargeSheet from './ChargeSheet'
import { GroupSheet, HeadSheet, TermSheet } from './SetupSheets'
import { IssueBar, IssueSheet, IssuesLog, UndoSheet, emptyScope, type IssueScope } from './IssuePanel'
import { shortDate } from './kit'

const EMPTY: GridBundle = {
  terms: [], heads: [], groups: [], rates: [], charges: [], issues: [], cells: [], fineCategories: [],
}

type ChargeState = { kind: 'other' | 'fine'; charge: ChargeRow | null } | null

const chip = 'inline-block text-[9px] font-bold uppercase tracking-[0.08em] px-1.5 py-[2px] border leading-none whitespace-nowrap'

export default function FeeGridSection({ onLateFees }: { onLateFees?: () => void }) {
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
  const groupLocked = (g: GroupRow) => data.cells.some(c => c.group_id === g.id)

  const refresh = () => { void load(true) }

  if (perms.loading || (loading && !data.terms.length && !loadError)) return <Loading />

  if (!year) {
    return <Notice>No academic sessions exist yet. Add one in Fee Settings → Sessions.</Notice>
  }

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

      {/* ── The grid's shape: terms and fee heads ──────────────────────── */}
      <div className="grid gap-3 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] items-start">
        <TitledPanel
          title="Terms" count={data.terms.length || undefined}
          right={canEdit && (
            <button className={ADMIN.onDarkBtn} onClick={() => setTermSheet({ term: null })}>
              <Plus size={11} strokeWidth={2.5} /> Term
            </button>
          )}
        >
          {data.terms.length === 0 ? (
            <p className="px-3 py-4 text-[12px] text-[#8C8878]">Add Term 1, Term 2… each with the date its fees fall due.</p>
          ) : data.terms.map(t => (
            <button key={t.id} onClick={() => canEdit && setTermSheet({ term: t })}
                    className="w-full grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 px-3 py-[7px] text-left border-b border-[#F0ECE2] last:border-b-0 hover:bg-[#FAF8F2]">
              <span className="text-[12.5px] font-semibold text-[#18181B] truncate">{t.name}</span>
              <span className="text-[11px] text-[#6B675A] tabular-nums">due {shortDate(t.due_date)}</span>
              <span className="w-[62px] text-right">
                {termLocked(t) && (
                  <span className={`${chip} bg-[#EAF5EE] text-[#1F6B42] border-[#C6E3D2]`}><Lock size={8} className="inline -mt-px" /> Issued</span>
                )}
              </span>
            </button>
          ))}
        </TitledPanel>

        <TitledPanel
          title="Fee heads" count={data.heads.length || undefined}
          right={canEdit && (
            <button className={ADMIN.onDarkBtn} onClick={() => setHeadSheet({ head: null })}>
              <Plus size={11} strokeWidth={2.5} /> Head
            </button>
          )}
        >
          {headRows.length === 0 ? (
            <p className="px-3 py-4 text-[12px] text-[#8C8878]">Tuition, Bus, Uniform, ID card, Water bottle — anything the school charges.</p>
          ) : (
            <div className="grid sm:grid-cols-2">
              {headRows.map(h => (
                <button key={h.id} onClick={() => canEdit && setHeadSheet({ head: h })}
                        className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-3 py-[7px] text-left border-b border-[#F0ECE2] sm:odd:border-r hover:bg-[#FAF8F2]">
                  <span className="text-[12.5px] font-semibold text-[#18181B] truncate flex items-center gap-1.5">
                    {h.name}
                    {headLocked(h) && <Lock size={10} className="text-[#1F6B42] flex-shrink-0" />}
                  </span>
                  <span className="flex items-center gap-1">
                    {h.gender_split && (
                      <span className={`${chip} bg-white text-[#52525B] border-[#E3DFD3]`}>B/G</span>
                    )}
                    <span className={`${chip} ${h.frequency === 'monthly'
                      ? 'bg-[#27272A] text-[#B8983C] border-[#27272A]'
                      : 'bg-[#F4F1E7] text-[#6B675A] border-[#E3DFD3]'}`}>
                      {h.frequency === 'monthly' ? 'Monthly' : 'Term-wise'}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </TitledPanel>
      </div>

      {/* ── Issue ──────────────────────────────────────────────────────── */}
      <div className="mt-3">
        <IssueBar
          scope={scope} setScope={setScope}
          terms={data.terms} heads={data.heads} groups={data.groups} months={months}
          canIssue={canIssue} onReview={() => setIssueOpen(true)}
        />
      </div>

      {/* ── Grid ───────────────────────────────────────────────────────── */}
      <div className="mt-5">
        <SectionBar
          title="Fee grid"
          hint={<>Session {year.code} · type a price into a cell · <Plus size={10} className="inline -mt-px" /> beside a grade splits it into groups by section</>}
          actions={
            <>
              {canEdit && (
                <button onClick={() => setChargeSheet({ kind: 'other', charge: null })} className={ADMIN.ghostBtn}>
                  <Receipt size={13} /> <span className="max-sm:hidden">Other</span> fee
                </button>
              )}
              {canFine && (
                <button onClick={() => setChargeSheet({ kind: 'fine', charge: null })} className={ADMIN.ghostBtn}>
                  <AlertOctagon size={13} /> Fine
                </button>
              )}
              {onLateFees && (
                <button onClick={onLateFees} className={ADMIN.ghostBtn} title="Late fee settings">
                  <Timer size={13} /> <span className="max-sm:hidden">Late fees</span>
                </button>
              )}
            </>
          }
        />
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
      </div>

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
      onDone(`Copied ${r.terms} terms, ${r.heads} heads, ${r.groups} groups and ${r.rates} prices.`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not copy.')
    } finally {
      setBusy(false)
    }
  }

  const link = 'font-bold uppercase tracking-[0.08em] text-[10px] text-[#52525B] hover:text-[#18181B] underline underline-offset-2'

  return (
    <div className="mt-6 pt-3 border-t border-[#E3DFD3] flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-[11px] text-[#8C8878]">
      <Copy size={11} />
      <span>Copy terms, heads and prices from</span>
      <select value={from} onChange={e => { setFrom(e.target.value); setConfirm(false) }}
              className="bg-transparent font-bold text-[#18181B] focus:outline-none cursor-pointer">
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
