'use client'

// The school's sessions, and carrying unpaid dues from one into the next.
//
// Sessions used to be a rule in three source files that disagreed between
// January and March. They are a list a school can see and correct: a session
// that runs June to April, or a year closed early, is expressible rather than
// something the code refuses to believe.
//
// Carrying dues forward moves each unpaid bill's balance into one "brought
// forward" bill in the next session and closes the old bill against it, so the
// money is owed in exactly one place. Running it again finds nothing left to
// move; a bill that reopens later (a reversed payment) carries only what
// reopened.

import React, { useCallback, useEffect, useState } from 'react'
import { ArrowRight, Check, Loader2, Plus } from 'lucide-react'
import { ADMIN, CHIP, fmtDate, inr } from '@/components/fees/ui'
import { FormGroup, Loading, Notice } from '@/components/fees/shell'
import { useFeePermissions } from '@/hooks/useFeePermissions'
import { carryForward } from '@/lib/fees/reports'
import {
  createAcademicYear, defaultYearDates, deriveYearCode, listAcademicYears,
  normalizeYearCode, sessionProgress, setActiveAcademicYear, updateAcademicYear,
  type AcademicYearRow,
} from '@/lib/academicYear'

export default function AcademicYearSettings({ onChanged }: { onChanged?: () => void }) {
  const perms = useFeePermissions()
  const [years, setYears] = useState<AcademicYearRow[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [newCode, setNewCode] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try { setYears(await listAcademicYears()) } finally { setLoading(false) }
  }, [])

  useEffect(() => { void load() }, [load])

  const today = new Date().toISOString().slice(0, 10)

  const activate = async (id: string) => {
    setBusy(id); setError(null)
    try {
      await setActiveAcademicYear(id)
      await load()
      onChanged?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not change the active session.')
    } finally {
      setBusy(null)
    }
  }

  const editDates = async (row: AcademicYearRow, patch: Partial<AcademicYearRow>) => {
    setBusy(row.id); setError(null)
    try {
      await updateAcademicYear(row.id, patch)
      await load()
      onChanged?.()
    } catch (e) {
      // The exclusion constraint raises when two sessions would cover the same
      // day. Say what that means rather than leaking the constraint name.
      const message = e instanceof Error ? e.message : ''
      setError(message.includes('academic_years_no_overlap')
        ? 'Those dates overlap another session. Two sessions cannot cover the same day.'
        : message || 'Could not save those dates.')
    } finally {
      setBusy(null)
    }
  }

  const add = async () => {
    const code = normalizeYearCode(newCode)
    if (!code) return
    setBusy('new'); setError(null)
    try {
      await createAcademicYear({ code })
      setNewCode(''); setAdding(false)
      await load()
      onChanged?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add that session.')
    } finally {
      setBusy(null)
    }
  }

  if (loading) return <Loading />

  const suggestion = defaultYearDates(normalizeYearCode(newCode) ?? '')
  const ordered = [...years].sort((a, b) => a.starts_on.localeCompare(b.starts_on))

  return (
    <div className="space-y-5">
      {error && <Notice tone="error">{error}</Notice>}

      <FormGroup
        title="Sessions"
        note="The active session is what the whole app opens on. Staff can still switch to an earlier one to take a payment against last year's dues, and it lands in that year's books."
      >
        {ordered.map(y => {
          const progress = sessionProgress(y, today)
          const isCurrent = y.starts_on <= today && today <= y.ends_on
          return (
            <div key={y.id} className="px-3.5 py-3 space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[15px] font-bold text-slate-900 tabular-nums">{y.code}</span>
                  {y.is_active && <span className={`${CHIP} bg-[#27272A] text-[#E9DDBB]`}>Active</span>}
                  {!y.is_active && isCurrent && <span className={`${CHIP} bg-[#FBF1D6] text-[#7A5D12]`}>Today falls here</span>}
                </div>
                {busy === y.id ? (
                  <Loader2 size={15} className="animate-spin text-slate-400" />
                ) : !y.is_active && (
                  <button onClick={() => void activate(y.id)} className={ADMIN.ghostBtn}>Make active</button>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <input type="date" value={y.starts_on} aria-label={`${y.code} starts`}
                       onChange={e => void editDates(y, { starts_on: e.target.value })}
                       className={`${ADMIN.inputPlain} !w-[156px]`} />
                <span className="text-[12.5px] text-slate-400">to</span>
                <input type="date" value={y.ends_on} aria-label={`${y.code} ends`}
                       onChange={e => void editDates(y, { ends_on: e.target.value })}
                       className={`${ADMIN.inputPlain} !w-[156px]`} />
              </div>
              <div className="flex items-center gap-2.5">
                <span className="flex-1 h-1.5 bg-[#EEEAE1] rounded-full overflow-hidden">
                  <span className="block h-full rounded-full bg-[#6B5536]" style={{ width: `${progress * 100}%` }} />
                </span>
                <span className="text-[12px] text-slate-500 tabular-nums flex-shrink-0">
                  {progress === 0 ? 'Not started' : progress === 1 ? 'Finished' : `${Math.round(progress * 100)}% through`}
                </span>
              </div>
              {y.promoted_at && (
                <p className="text-[12px] text-slate-500">
                  Students were promoted out of this session on {fmtDate(y.promoted_at.slice(0, 10))}.
                </p>
              )}
            </div>
          )
        })}

        {adding ? (
          <div className="px-3.5 py-3 space-y-2.5 bg-[#FBFAF6]">
            <label className="block">
              <span className="block text-[12px] font-medium text-slate-500 mb-1">New session</span>
              <input value={newCode} onChange={e => setNewCode(e.target.value)}
                     placeholder={deriveYearCode(new Date(Date.now() + 365 * 864e5))}
                     className={`${ADMIN.inputPlain} !w-[200px]`} autoFocus />
            </label>
            {suggestion && (
              <p className="text-[12px] text-slate-500 leading-snug">
                Runs {fmtDate(suggestion.starts_on)} to {fmtDate(suggestion.ends_on)}. Change the dates afterwards if the school year is different.
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <button onClick={() => void add()} disabled={!normalizeYearCode(newCode) || busy === 'new'} className={ADMIN.darkBtn}>
                {busy === 'new' ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Add session
              </button>
              <button onClick={() => { setAdding(false); setNewCode('') }} className={ADMIN.ghostBtn}>Cancel</button>
            </div>
          </div>
        ) : (
          <button onClick={() => setAdding(true)}
                  className="w-full flex items-center gap-2 px-3.5 py-3 text-[13.5px] font-semibold text-[#8B6F47] hover:bg-[#FBF8F2] text-left">
            <Plus size={15} /> Add a session
          </button>
        )}
      </FormGroup>

      {perms.can('fees.config.clone_year') && ordered.length > 1 && (
        <CarryForward years={ordered} />
      )}
    </div>
  )
}

/**
 * Move one session's unpaid balances into the next. Preview first: it writes
 * a debt against real families and the figure should be read before it lands.
 */
function CarryForward({ years }: { years: AcademicYearRow[] }) {
  const perms = useFeePermissions()
  const showAmounts = !perms.amountsHidden
  const active = years.find(y => y.is_active) ?? years[years.length - 1]
  const [from, setFrom] = useState(active?.id ?? '')
  const later = years.filter(y => y.starts_on > (years.find(x => x.id === from)?.starts_on ?? ''))
  const [to, setTo] = useState(later[0]?.id ?? '')
  const [preview, setPreview] = useState<{ students: number; bills: number; total: number; held: number } | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!later.some(y => y.id === to)) setTo(later[0]?.id ?? '')
    setPreview(null)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from])

  const run = async (commit: boolean) => {
    if (!from || !to) return
    setBusy(true); setError(null); setDone(null)
    try {
      const r = await carryForward(from, to, commit)
      if (commit) {
        setPreview(null)
        setDone(r.students === 0
          ? 'Nothing was left to carry.'
          : `${r.students} student${r.students === 1 ? '' : 's'} now owe ${inr(r.total, showAmounts)} in ${years.find(y => y.id === to)?.code}, as one brought-forward bill each.`)
      } else {
        setPreview({ students: r.students, bills: r.bills ?? 0, total: r.total, held: r.held ?? 0 })
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The carry-forward did not run.')
    } finally {
      setBusy(false)
    }
  }

  const fromCode = years.find(y => y.id === from)?.code
  const toCode = years.find(y => y.id === to)?.code

  return (
    <FormGroup
      title="Carry unpaid dues forward"
      note="Each unpaid bill is closed in its own session and its balance becomes a line on one brought-forward bill in the next, so it is owed in one place only. Running it twice moves nothing the second time."
    >
      <div className="px-3.5 py-3 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <select value={from} onChange={e => setFrom(e.target.value)} aria-label="From session"
                  className={`${ADMIN.select} min-w-[120px]`}>
            {years.slice(0, -1).map(y => <option key={y.id} value={y.id}>{y.code}</option>)}
          </select>
          <ArrowRight size={16} className="text-slate-400" />
          <select value={to} onChange={e => { setTo(e.target.value); setPreview(null) }} aria-label="Into session"
                  className={`${ADMIN.select} min-w-[120px]`} disabled={later.length === 0}>
            {later.length === 0 && <option value="">No later session</option>}
            {later.map(y => <option key={y.id} value={y.id}>{y.code}</option>)}
          </select>
          <button onClick={() => void run(false)} disabled={busy || !to} className={ADMIN.ghostBtn}>
            {busy && !preview ? <Loader2 size={14} className="animate-spin" /> : null} Preview
          </button>
        </div>

        {preview && (
          <div className="border-l-[3px] border-[#B8983C] bg-[#FBF4E2] px-3.5 py-2.5 text-[13px] text-[#5E4A12] leading-relaxed">
            {preview.students === 0 ? (
              <>Nothing in {fromCode} is waiting to be carried.</>
            ) : (
              <>
                {preview.bills} unpaid bill{preview.bills === 1 ? '' : 's'} from {preview.students} student{preview.students === 1 ? '' : 's'},{' '}
                <b>{inr(preview.total, showAmounts)}</b> in all, would move into {toCode}. Nothing has been written yet.
              </>
            )}
            {preview.held > 0 && (
              <span className="block mt-1">
                {preview.held} bill{preview.held === 1 ? '' : 's'} with a cheque still at the bank stay{preview.held === 1 ? 's' : ''} in {fromCode} until it clears or bounces.
              </span>
            )}
            {preview.students > 0 && (
              <button onClick={() => void run(true)} disabled={busy} className={`${ADMIN.darkBtn} mt-2.5`}>
                {busy ? <Loader2 size={14} className="animate-spin" /> : <ArrowRight size={14} />} Carry into {toCode}
              </button>
            )}
          </div>
        )}
        {done && <Notice tone="good">{done}</Notice>}
        {error && <Notice tone="error">{error}</Notice>}
      </div>
    </FormGroup>
  )
}
