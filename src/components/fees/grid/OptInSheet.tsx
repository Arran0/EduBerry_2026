'use client'

// ─────────────────────────────────────────────────────────────────────────────
// The opt-in list for an optional fee — a head like Bus or Lunch, or an other
// fee like a trip. Only students ticked here are billed when it is issued.
//
// Students already billed by a live issue are shown ticked and fixed: taking
// them off the list would not take the bill back, and a list that disagrees
// with the bills is worse than no list.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useEffect, useMemo, useState } from 'react'
import { Check, ListChecks, Loader2, Search } from 'lucide-react'
import { ADMIN } from '@/components/fees/ui'
import { gradeLabel, gradeShortLabel } from '@/lib/grades'
import { saveOptins, type StudentLite } from '@/lib/fees/grid'
import { ErrorNote, FeeSheet, Pick } from './kit'

const gkey = (g: number | null) => (g === null ? 'none' : String(g))

export default function OptInSheet({
  open, onClose, yearId, target, title, subtitle, students, current, billed, canEdit, onSaved,
}: {
  open: boolean
  onClose: () => void
  yearId: string
  target: { head_id: string } | { charge_id: string }
  title: string
  subtitle?: string
  /** Who may opt in: every student for a head, the students offered for an other fee. */
  students: StudentLite[]
  current: Set<string>
  billed?: Set<string>
  canEdit: boolean
  onSaved: () => void
}) {
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [grade, setGrade] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setPicked(new Set(current)); setGrade(null); setQuery(''); setError(null)
  }, [open, current])

  const grades = useMemo(() => {
    const set = new Map<string, number | null>()
    for (const s of students) set.set(gkey(s.grade), s.grade)
    return Array.from(set.values()).sort((a, b) => (a ?? 99) - (b ?? 99))
  }, [students])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return students
      .filter(s => grade === null || gkey(s.grade) === grade)
      .filter(s => !q || s.full_name.toLowerCase().includes(q) || (s.admission_no ?? '').toLowerCase().includes(q))
      .sort((a, b) => (a.grade ?? 99) - (b.grade ?? 99) || (a.section ?? '').localeCompare(b.section ?? '') || a.full_name.localeCompare(b.full_name))
  }, [students, grade, query])

  const isBilled = (id: string) => billed?.has(id) ?? false
  const toggle = (id: string) => {
    if (!canEdit || isBilled(id)) return
    setPicked(p => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n })
  }
  const setShown = (on: boolean) => setPicked(p => {
    const n = new Set(p)
    for (const s of shown) { if (isBilled(s.id)) continue; if (on) n.add(s.id); else n.delete(s.id) }
    return n
  })

  const add = Array.from(picked).filter(id => !current.has(id))
  const remove = Array.from(current).filter(id => !picked.has(id) && !isBilled(id))

  const save = async () => {
    setBusy(true); setError(null)
    try { await saveOptins(yearId, target, add, remove); onSaved(); onClose() }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not save the list.') }
    finally { setBusy(false) }
  }

  const shownPicked = shown.filter(s => picked.has(s.id)).length

  return (
    <FeeSheet
      open={open} onClose={onClose} size="lg" icon={<ListChecks size={15} />}
      title={title} subtitle={subtitle}
      footer={
        <div className="flex items-center gap-2">
          <span className="text-[12px] text-slate-500 mr-auto tabular-nums">
            <span className="font-bold text-slate-900">{picked.size}</span> opted in
            {(add.length > 0 || remove.length > 0) && <> · {add.length} to add, {remove.length} to remove</>}
          </span>
          <button onClick={onClose} className={ADMIN.ghostBtn}>{canEdit ? 'Cancel' : 'Close'}</button>
          {canEdit && (
            <button onClick={() => void save()} disabled={busy || (add.length === 0 && remove.length === 0)} className={ADMIN.darkBtn}>
              {busy && <Loader2 size={13} className="animate-spin" />} Save list
            </button>
          )}
        </div>
      }
    >
      <div className="bg-white border border-[#E3DFD3] p-2.5 space-y-2.5">
        <div className="flex flex-wrap gap-1">
          <Pick on={grade === null} onClick={() => setGrade(null)}>All</Pick>
          {grades.map(g => (
            <Pick key={gkey(g)} on={grade === gkey(g)} onClick={() => setGrade(gkey(g))}>
              {g === null ? 'No grade' : gradeShortLabel(g)}
            </Pick>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2 pt-2.5 border-t border-[#F0ECE2]">
          <div className="relative flex-1 min-w-[180px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input value={query} onChange={e => setQuery(e.target.value)} className={ADMIN.input}
                   placeholder="Name or admission number" />
          </div>
          {canEdit && (
            <>
              <button onClick={() => setShown(true)} className={ADMIN.ghostBtn}>Tick all {shown.length}</button>
              <button onClick={() => setShown(false)} className={ADMIN.ghostBtn}>Clear shown</button>
            </>
          )}
        </div>
      </div>

      <div className="bg-white border border-[#E3DFD3]">
        <div className="flex items-center gap-2 bg-[#F7F5F0] border-b border-[#EEEAE1] px-3.5 py-2.5">
          <span className="text-[12px] font-semibold text-slate-700">Students</span>
          <span className="text-[9.5px] font-bold tabular-nums text-[#B8983C]">{shownPicked} of {shown.length} ticked</span>
        </div>
        <div className="max-h-[360px] overflow-y-auto">
          {shown.length === 0 && <p className="px-3 py-5 text-[12px] text-slate-500">Nobody matches.</p>}
          {shown.map(s => {
            const on = picked.has(s.id)
            const locked = isBilled(s.id)
            return (
              <button key={s.id} type="button" onClick={() => toggle(s.id)} disabled={!canEdit && !locked}
                      className="w-full flex items-center gap-2.5 px-3 py-[6px] text-left border-b border-[#F0ECE2] last:border-b-0 hover:bg-[#FAF8F2] disabled:hover:bg-transparent">
                <span className={`w-4 h-4 flex items-center justify-center border flex-shrink-0 ${
                  on ? 'bg-[#27272A] border-[#27272A] text-[#B8983C]' : 'bg-white border-[#C9C4B4]'}`}>
                  {on && <Check size={11} strokeWidth={3} />}
                </span>
                <span className="text-[13px] text-slate-900 flex-1 break-words">{s.full_name}</span>
                {locked && (
                  <span className="inline-flex items-center h-5 px-2 rounded-full text-[10.5px] font-semibold leading-none whitespace-nowrap bg-[#EAF5EE] text-[#1F6B42] border border-[#C6E3D2]">
                    Billed
                  </span>
                )}
                <span className="text-[12px] text-slate-500 tabular-nums w-[84px] text-right">
                  {s.grade === null ? 'No grade' : `${gradeLabel(s.grade)}${s.section ? ` ${s.section}` : ''}`}
                </span>
              </button>
            )
          })}
        </div>
      </div>
      <ErrorNote>{error}</ErrorNote>
    </FeeSheet>
  )
}
