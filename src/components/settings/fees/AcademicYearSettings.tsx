'use client'

// The school's sessions.
//
// This used to be a rule in three source files that disagreed with each other
// between January and March. It is now a list a school can see and correct: a
// session that runs June to April, or a year closed early, is now expressible
// rather than something the code refuses to believe.

import React, { useCallback, useEffect, useState } from 'react'
import { CalendarRange, Check, Loader2, Plus, Star } from 'lucide-react'
import { ADMIN, GOLD, fmtDate } from '@/components/fees/ui'
import {
  createAcademicYear, defaultYearDates, deriveYearCode, listAcademicYears,
  normalizeYearCode, sessionProgress, setActiveAcademicYear, updateAcademicYear,
  type AcademicYearRow,
} from '@/lib/academicYear'

export default function AcademicYearSettings({ onChanged }: { onChanged?: () => void }) {
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

  if (loading) {
    return (
      <div className={`${ADMIN.card} p-8 flex items-center justify-center gap-2 text-sm text-[#71717A]`}>
        <Loader2 size={16} className="animate-spin" /> Loading sessions…
      </div>
    )
  }

  const suggestion = defaultYearDates(normalizeYearCode(newCode) ?? '')

  return (
    <div className="space-y-4">
      <div className={`${ADMIN.card} p-4`}>
        <div className="flex items-start gap-3">
          <CalendarRange size={18} className="mt-0.5 flex-shrink-0" style={{ color: GOLD }} />
          <div className="text-sm text-[#52525B] leading-relaxed">
            <p className="font-semibold text-[#27272A] mb-1">One active session at a time</p>
            <p>
              The active session is what the whole app defaults to. Staff can still
              switch to an earlier one to take a payment against last year&rsquo;s
              dues — that lands in the right year&rsquo;s books rather than today&rsquo;s.
            </p>
          </div>
        </div>
      </div>

      {error && (
        <div className="bg-rose-50 border border-rose-200 text-rose-700 text-sm px-4 py-3 rounded-lg">{error}</div>
      )}

      <div className={`${ADMIN.card} divide-y divide-[#F4F4F5]`}>
        {years.map(y => {
          const progress = sessionProgress(y, today)
          const isCurrent = y.starts_on <= today && today <= y.ends_on
          return (
            <div key={y.id} className="p-4">
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-2 min-w-[120px]">
                  <span className="text-sm font-bold text-[#27272A]">{y.code}</span>
                  {y.is_active && (
                    <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-[#27272A] text-white">
                      <Star size={9} /> Active
                    </span>
                  )}
                  {!y.is_active && isCurrent && (
                    <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-[#FBF6E9] text-[#8A6D1F] border border-[#EFE3C4]">
                      Today falls here
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="date" value={y.starts_on}
                    onChange={e => void editDates(y, { starts_on: e.target.value })}
                    className={`${ADMIN.inputPlain} w-[150px]`}
                  />
                  <span className="text-xs text-[#A1A1AA]">to</span>
                  <input
                    type="date" value={y.ends_on}
                    onChange={e => void editDates(y, { ends_on: e.target.value })}
                    className={`${ADMIN.inputPlain} w-[150px]`}
                  />
                </div>

                <div className="flex-1 min-w-[140px]">
                  <div className="h-1.5 bg-[#F4F4F5] rounded-full overflow-hidden">
                    <div className="h-full bg-[#27272A]" style={{ width: `${progress * 100}%` }} />
                  </div>
                  <div className="text-[10px] text-[#A1A1AA] mt-1">
                    {progress === 0 ? 'Not started'
                      : progress === 1 ? 'Finished'
                      : `${Math.round(progress * 100)}% through`}
                  </div>
                </div>

                {busy === y.id ? (
                  <Loader2 size={14} className="animate-spin text-[#A1A1AA]" />
                ) : !y.is_active && (
                  <button onClick={() => void activate(y.id)} className={ADMIN.ghostBtn}>
                    Make active
                  </button>
                )}
              </div>
              {y.promoted_at && (
                <p className="text-xs text-[#A1A1AA] mt-2">
                  Students were promoted out of this session on {fmtDate(y.promoted_at.slice(0, 10))}.
                </p>
              )}
            </div>
          )
        })}
      </div>

      {adding ? (
        <div className={`${ADMIN.card} p-4 space-y-3`}>
          <div>
            <label className={`${ADMIN.label} block mb-1.5`}>New session</label>
            <input
              value={newCode}
              onChange={e => setNewCode(e.target.value)}
              placeholder={deriveYearCode(new Date(Date.now() + 365 * 864e5))}
              className={`${ADMIN.inputPlain} max-w-[200px]`}
            />
          </div>
          {suggestion && (
            <p className="text-xs text-[#A1A1AA]">
              Will run {fmtDate(suggestion.starts_on)} to {fmtDate(suggestion.ends_on)}.
              Adjust the dates afterwards if the school year is different.
            </p>
          )}
          <div className="flex gap-2">
            <button
              onClick={() => void add()}
              disabled={!normalizeYearCode(newCode) || busy === 'new'}
              className={ADMIN.darkBtn}
            >
              {busy === 'new' ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
              Add
            </button>
            <button onClick={() => { setAdding(false); setNewCode('') }} className={ADMIN.ghostBtn}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button onClick={() => setAdding(true)} className={ADMIN.ghostBtn}>
          <Plus size={13} /> Add a session
        </button>
      )}
    </div>
  )
}
