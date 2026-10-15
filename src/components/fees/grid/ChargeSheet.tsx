'use client'

// ─────────────────────────────────────────────────────────────────────────────
// An "other" fee or a fine, for a hand-picked set of students.
//
// The same sheet creates one and, later, shows it: open a chip in the grid's
// Other column and you are looking at the form you filled in, read-only, with
// what was issued and to whom.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useEffect, useMemo, useState } from 'react'
import {
  AlertOctagon, Check, Loader2, Lock, Pencil, Receipt, Search, Send, Trash2, Undo2, X,
} from 'lucide-react'
import { ADMIN, INVOICE_CHIP } from '@/components/fees/ui'
import { Segmented } from '@/components/fees/shell'
import { GRADE_OPTIONS, gradeLabel, gradeShortLabel } from '@/lib/grades'
import {
  NO_GRADE_LABEL, deleteCharge, issueCharge, saveCharge,
  type ChargeFilters, type ChargeRow, type FineCategory, type IssueRow, type StudentLite,
} from '@/lib/fees/grid'
import { Aside, ErrorNote, FeeSheet, Field, Pick, rupees, shortDate, todayIso } from './kit'

type GenderFilter = 'all' | 'male' | 'female'
const gkey = (g: number | null) => (g === null ? 'none' : String(g))

function plusDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00`)
  d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** A title parents will understand: a couple of words, not "misc" or "fee". */
function titleProblem(t: string): string | null {
  const s = t.trim()
  if (!s) return 'Write a title. Parents read it on the bill.'
  if (s.length < 6 || s.split(/\s+/).filter(Boolean).length < 2) {
    return 'Make the title say what it is for — at least two words, like “Annual Day costume”.'
  }
  if (/^(fee|fees|misc|other|charge|payment|fine)s?$/i.test(s)) return 'That title is too vague.'
  return null
}

export default function ChargeSheet({
  open, onClose, yearId, kind, charge, issue, students, fineCategories, canEdit, canIssue,
  onSaved, onUndo,
}: {
  open: boolean
  onClose: () => void
  yearId: string
  kind: 'other' | 'fine'
  charge: ChargeRow | null
  /** The live issue for this charge, if it has been issued. */
  issue: IssueRow | null
  students: StudentLite[]
  fineCategories: FineCategory[]
  canEdit: boolean
  canIssue: boolean
  onSaved: () => void
  onUndo: (issue: IssueRow) => void
}) {
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState('')
  const [amount, setAmount] = useState('')
  const [due, setDue] = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState<string | null>(null)
  const [grades, setGrades] = useState<Set<string>>(new Set())
  const [sections, setSections] = useState<Set<string>>(new Set())
  const [gender, setGender] = useState<GenderFilter>('all')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [excluded, setExcluded] = useState<Set<string>>(new Set())
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [triedSave, setTriedSave] = useState(false)

  const byId = useMemo(() => new Map(students.map(s => [s.id, s])), [students])

  useEffect(() => {
    if (!open) return
    setError(null); setTriedSave(false); setQuery('')
    setEditing(!charge)
    setTitle(charge?.title ?? '')
    setAmount(charge ? String(charge.amount) : '')
    setDue(charge?.due_date ?? plusDays(todayIso(), 14))
    setDescription(charge?.description ?? '')
    setCategory(charge?.fine_category_id ?? null)
    const f: ChargeFilters = charge?.filters ?? {}
    setGrades(new Set((f.grades ?? []).map(gkey)))
    setSections(new Set(f.sections ?? []))
    setGender(f.gender ?? 'all')
    setPicked(new Set(f.picked ?? []))
    setExcluded(new Set())
  }, [open, charge])

  const matches = (s: StudentLite) =>
    grades.has(gkey(s.grade))
    && (sections.size === 0 || sections.has((s.section ?? '').trim().toUpperCase()))
    && (gender === 'all' || s.gender === gender)

  // Rebuild exclusions for an existing charge once students are known.
  useEffect(() => {
    if (!open || !charge || students.length === 0) return
    const final = new Set(charge.students.map(s => s.student_id))
    const ex = new Set<string>()
    for (const s of students) if (matches(s) && !final.has(s.id)) ex.add(s.id)
    setExcluded(ex)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, charge, students.length])

  const matched = useMemo(() => students.filter(matches),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [students, grades, sections, gender])

  const selected = useMemo(() => {
    if (!editing && charge) {
      return charge.students.map(s => byId.get(s.student_id) ?? {
        id: s.student_id, full_name: 'Student', grade: s.grade, section: s.section, gender: null, admission_no: null,
      })
    }
    const ids = new Set<string>()
    for (const s of matched) if (!excluded.has(s.id)) ids.add(s.id)
    picked.forEach(id => ids.add(id))
    return Array.from(ids).map(id => byId.get(id)).filter(Boolean) as StudentLite[]
  }, [editing, charge, matched, excluded, picked, byId])

  const sectionOptions = useMemo(() => {
    const set = new Set<string>()
    for (const s of students) if (grades.has(gkey(s.grade)) && s.section) set.add(s.section.trim().toUpperCase())
    return Array.from(set).sort()
  }, [students, grades])

  const search = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (q.length < 2) return []
    return students.filter(s =>
      s.full_name.toLowerCase().includes(q) || (s.admission_no ?? '').toLowerCase().includes(q)).slice(0, 8)
  }, [query, students])

  const amountNum = Number(amount)
  const problem = titleProblem(title)

  const toggleSet = (set: Set<string>, v: string, setter: (s: Set<string>) => void) => {
    const n = new Set(set)
    if (n.has(v)) n.delete(v); else n.add(v)
    setter(n)
  }

  const removeStudent = (id: string) => {
    if (picked.has(id)) { const n = new Set(picked); n.delete(id); setPicked(n) }
    else { const n = new Set(excluded); n.add(id); setExcluded(n) }
  }

  const submit = async (issueNow: boolean) => {
    setTriedSave(true)
    if (problem) { setError(problem); return }
    if (!(amountNum > 0)) { setError('Enter an amount more than zero.'); return }
    if (!due) { setError('Pick a due date.'); return }
    if (selected.length === 0) { setError('Choose at least one student.'); return }
    setBusy(true); setError(null)
    try {
      await saveCharge(yearId, {
        id: charge?.id, kind, title, description, amount: amountNum, due_date: due,
        student_ids: selected.map(s => s.id),
        filters: {
          grades: Array.from(grades).map(g => (g === 'none' ? null : Number(g))),
          sections: Array.from(sections),
          gender: gender === 'all' ? null : gender, picked: Array.from(picked),
        },
        fine_category_id: kind === 'fine' ? category : null,
        issue: issueNow,
      })
      onSaved(); onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save.')
    } finally {
      setBusy(false)
    }
  }

  const act = async (fn: () => Promise<void>) => {
    setBusy(true); setError(null)
    try { await fn(); onSaved(); onClose() }
    catch (e) { setError(e instanceof Error ? e.message : 'Something went wrong.') }
    finally { setBusy(false) }
  }

  const noun = kind === 'fine' ? 'fine' : 'fee'
  const total = amountNum > 0 ? amountNum * selected.length : 0

  const footer = editing ? (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-[11px] text-[#8C8878] mr-auto tabular-nums">
        {selected.length} student{selected.length === 1 ? '' : 's'}
        {total > 0 && <> · <span className="font-bold text-[#18181B]">{rupees(total)}</span></>}
      </span>
      <button onClick={() => (charge ? setEditing(false) : onClose())} className={ADMIN.ghostBtn}>Cancel</button>
      {kind === 'other' && (
        <button onClick={() => void submit(false)} disabled={busy} className={ADMIN.ghostBtn}>Save draft</button>
      )}
      {canIssue && (
        <button onClick={() => void submit(true)} disabled={busy} className={ADMIN.goldBtn}>
          {busy ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
          {kind === 'fine' ? 'Issue fine' : 'Save & issue'}
        </button>
      )}
    </div>
  ) : (
    <div className="flex flex-wrap items-center gap-2">
      {!issue && canEdit && charge && (
        <button onClick={() => void act(() => deleteCharge(charge.id))} disabled={busy}
                className={`${ADMIN.ghostBtn} hover:!text-[#A93232] hover:!border-[#EFCCCC]`}>
          <Trash2 size={13} /> Delete
        </button>
      )}
      <div className="flex-1" />
      {!issue && canEdit && (
        <button onClick={() => setEditing(true)} className={ADMIN.ghostBtn}><Pencil size={12} /> Edit</button>
      )}
      {!issue && canIssue && charge && (
        <button onClick={() => void act(() => issueCharge(charge.id))} disabled={busy} className={ADMIN.goldBtn}>
          {busy ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />} Issue now
        </button>
      )}
      {issue && (
        <button onClick={() => onUndo(issue)} className={`${ADMIN.ghostBtn} hover:!text-[#A93232] hover:!border-[#EFCCCC]`}>
          <Undo2 size={13} /> Undo issue
        </button>
      )}
    </div>
  )

  return (
    <FeeSheet
      open={open} onClose={onClose} size="xl"
      icon={kind === 'fine' ? <AlertOctagon size={15} /> : <Receipt size={15} />}
      title={charge ? charge.title : kind === 'fine' ? 'Issue a fine' : 'New other fee'}
      subtitle={charge
        ? (issue ? `Issued ${shortDate(issue.issued_at.slice(0, 10))} · locked` : `Draft ${noun} — not billed yet`)
        : kind === 'fine' ? 'Billed straight away to the students you choose' : 'Billed under “Other” to the students you choose'}
      footer={footer}
    >
      {charge && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className={`text-[9px] font-bold uppercase tracking-[0.08em] px-1.5 py-[2px] ${
            kind === 'fine' ? INVOICE_CHIP.overdue : 'bg-[#FAF3DF] text-[#7A6220] border border-[#E7D9AE]'}`}>
            {kind === 'fine' ? 'Fine' : 'Other fee'}
          </span>
          <span className={`text-[9px] font-bold uppercase tracking-[0.08em] px-1.5 py-[2px] ${
            issue ? INVOICE_CHIP.paid : INVOICE_CHIP.draft}`}>
            {issue ? 'Issued' : 'Draft'}
          </span>
        </div>
      )}

      {/* What the bill says */}
      {editing ? (
        <div className="grid sm:grid-cols-[minmax(0,1fr)_140px_160px] gap-3">
          <Field label="Title on the bill"
                 error={triedSave && problem ? problem : undefined}
                 hint="Be specific — parents read this line.">
            <input value={title} onChange={e => setTitle(e.target.value)} className={ADMIN.inputPlain}
                   placeholder={kind === 'fine' ? 'Library book returned late' : 'Annual Day costume'} autoFocus={!charge} />
          </Field>
          <Field label="Amount per student">
            <input type="number" min={0} inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)}
                   className={`${ADMIN.inputPlain} tabular-nums text-right`} placeholder="₹0" />
          </Field>
          <Field label="Due date">
            <input type="date" value={due} onChange={e => setDue(e.target.value)} className={ADMIN.inputPlain} />
          </Field>
          {kind === 'fine' && fineCategories.length > 0 && (
            <Field label="Kind of fine" className="sm:col-span-3">
              <div className="flex flex-wrap gap-1.5">
                {fineCategories.map(c => (
                  <Pick key={c.id} on={category === c.id} tone="bad"
                        onClick={() => {
                          setCategory(category === c.id ? null : c.id)
                          if (!amount && c.default_amount > 0) setAmount(String(c.default_amount))
                        }}>
                    {c.name}
                  </Pick>
                ))}
              </div>
            </Field>
          )}
          <Field label="Note for parents (optional)" className="sm:col-span-3">
            <textarea value={description} onChange={e => setDescription(e.target.value)} rows={2}
                      className={`${ADMIN.inputPlain} resize-none`} placeholder="What this covers, if the title needs it" />
          </Field>
        </div>
      ) : (
        <dl className="grid grid-cols-3 border border-[#E3DFD3] bg-white divide-x divide-[#E3DFD3]">
          {[
            { k: 'Per student', v: rupees(amountNum) },
            { k: 'Due', v: shortDate(due) },
            { k: 'Total', v: rupees(total) },
          ].map(x => (
            <div key={x.k} className="px-3 py-2 min-w-0">
              <dt className={ADMIN.label}>{x.k}</dt>
              <dd className="text-[15px] font-bold tabular-nums text-[#18181B] truncate">{x.v}</dd>
            </div>
          ))}
          {description && (
            <p className="col-span-3 px-3 py-2 border-t border-[#E3DFD3] !border-l-0 text-[12px] text-[#52525B] whitespace-pre-wrap">
              {description}
            </p>
          )}
        </dl>
      )}

      {/* Who pays */}
      {editing && (
        <Field label="Who pays" hint="Pick grades, then narrow by section or gender. Search adds any one student.">
          <div className="bg-white border border-[#E3DFD3] p-2.5 space-y-2.5">
            <div className="flex flex-wrap gap-1">
              {GRADE_OPTIONS.map(g => (
                <Pick key={g.value} on={grades.has(gkey(g.value))}
                      onClick={() => toggleSet(grades, gkey(g.value), setGrades)}>
                  {gradeShortLabel(g.value)}
                </Pick>
              ))}
              <Pick on={grades.has('none')} onClick={() => toggleSet(grades, 'none', setGrades)}>No grade</Pick>
            </div>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pt-2.5 border-t border-[#F0ECE2]">
              <div className="flex flex-wrap items-center gap-1">
                <span className={`${ADMIN.label} mr-1`}>Sections</span>
                {sectionOptions.length === 0 && <span className="text-[11px] text-[#A8A395]">Pick a grade first</span>}
                {sectionOptions.map(sec => (
                  <Pick key={sec} on={sections.has(sec)} onClick={() => toggleSet(sections, sec, setSections)}>{sec}</Pick>
                ))}
                {sections.size > 0 && (
                  <button className="text-[10.5px] font-semibold text-[#6B675A] hover:text-[#18181B] underline ml-1"
                          onClick={() => setSections(new Set())}>All</button>
                )}
              </div>
              <div className="flex items-center gap-2">
                <span className={ADMIN.label}>Gender</span>
                <Segmented<GenderFilter> size="sm" value={gender} onChange={setGender}
                  options={[{ key: 'all', label: 'All' }, { key: 'male', label: 'Boys' }, { key: 'female', label: 'Girls' }]} />
              </div>
            </div>

            <div className="relative pt-2.5 border-t border-[#F0ECE2]">
              <Search size={14} className="absolute left-3 top-[calc(50%+5px)] -translate-y-1/2 text-[#8C8878]" />
              <input value={query} onChange={e => setQuery(e.target.value)} className={ADMIN.input}
                     placeholder="Add one student by name or admission number" />
              {search.length > 0 && (
                <div className="absolute z-10 left-0 right-0 mt-px bg-white border border-[#27272A] shadow-[0_12px_28px_-12px_rgba(0,0,0,0.35)]">
                  {search.map(s => (
                    <button key={s.id} type="button"
                            onClick={() => {
                              setPicked(new Set(picked).add(s.id))
                              const ex = new Set(excluded); ex.delete(s.id); setExcluded(ex)
                              setQuery('')
                            }}
                            className="w-full text-left px-3 py-2 hover:bg-[#FAF8F2] flex items-center gap-2 border-b border-[#F0ECE2] last:border-b-0">
                      <span className="text-[12.5px] text-[#18181B] flex-1 truncate">{s.full_name}</span>
                      <span className="text-[11px] text-[#8C8878]">
                        {s.grade === null ? NO_GRADE_LABEL : `${gradeShortLabel(s.grade)}${s.section ? ` ${s.section}` : ''}`}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </Field>
      )}

      {/* The students */}
      <div className="bg-white border border-[#E3DFD3]">
        <div className="flex items-center gap-2 bg-[#27272A] px-3 py-1.5">
          <span className="text-[9.5px] font-bold uppercase tracking-[0.12em] text-[#D4D4D8]">Students</span>
          <span className="text-[9.5px] font-bold tabular-nums text-[#B8983C]">{selected.length}</span>
          {total > 0 && <span className="ml-auto text-[11px] font-bold tabular-nums text-white">{rupees(total)}</span>}
        </div>
        {selected.length === 0 ? (
          <p className="px-3 py-5 text-[12px] text-[#8C8878]">
            {editing ? 'Choose a grade, or search for a student, to start.' : 'No students.'}
          </p>
        ) : (
          <div className="max-h-[240px] overflow-y-auto">
            {selected
              .slice()
              .sort((a, b) => (a.grade ?? 99) - (b.grade ?? 99) || (a.section ?? '').localeCompare(b.section ?? '') || a.full_name.localeCompare(b.full_name))
              .map(s => (
                <div key={s.id} className="flex items-center gap-2 px-3 py-[6px] border-b border-[#F0ECE2] last:border-b-0 hover:bg-[#FAF8F2]">
                  <span className="text-[12.5px] text-[#18181B] flex-1 truncate">{s.full_name}</span>
                  <span className="text-[11px] text-[#8C8878] tabular-nums">
                    {s.grade === null ? 'No grade' : `${gradeLabel(s.grade)}${s.section ? ` ${s.section}` : ''}`}
                  </span>
                  {editing && (
                    <button onClick={() => removeStudent(s.id)} aria-label={`Remove ${s.full_name}`}
                            className="w-6 h-6 flex items-center justify-center text-[#C9C4B4] hover:text-[#A93232]">
                      <X size={13} />
                    </button>
                  )}
                  {!editing && issue && <Check size={12} className="text-[#1F6B42]" />}
                </div>
              ))}
          </div>
        )}
      </div>

      {issue && (
        <Aside tone="good">
          <Lock size={11} className="inline mr-1 -mt-0.5" />
          Issued to {issue.invoice_count} student{issue.invoice_count === 1 ? '' : 's'} for {rupees(issue.total)}. Undo the issue to change anything.
        </Aside>
      )}
      <ErrorNote>{error}</ErrorNote>
    </FeeSheet>
  )
}
