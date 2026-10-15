'use client'

// ─────────────────────────────────────────────────────────────────────────────
// An "other" fee or a fine, for a hand-picked set of students.
//
// The same sheet creates one and, later, shows it: open a chip in the grid's
// Other column and you are looking at the form you filled in, read-only, with
// what was issued and to whom. A thing that looks different every time you
// meet it is a thing nobody trusts.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useEffect, useMemo, useState } from 'react'
import {
  AlertOctagon, CheckCircle2, Loader2, Lock, Pencil, Receipt, Search, Send, Trash2, Undo2, X,
} from 'lucide-react'
import { GRADE_OPTIONS, gradeLabel, gradeShortLabel } from '@/lib/grades'
import {
  NO_GRADE_LABEL, deleteCharge, issueCharge, saveCharge,
  type ChargeFilters, type ChargeRow, type FineCategory, type IssueRow, type StudentLite,
} from '@/lib/fees/grid'
import {
  BTN, Chip, ErrorNote, FIELD, GlassSheet, Group, GroupRowItem, INLINE_FIELD, SYS, Segmented,
  rupees, shortDate, todayIso,
} from './glass'

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
  const accent = kind === 'fine' ? SYS.red : SYS.indigo
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

  // Load the sheet from the charge (or blank).
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
  const readOnly = !editing

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
      const gradeList = Array.from(grades).map(g => (g === 'none' ? null : Number(g)))
      await saveCharge(yearId, {
        id: charge?.id, kind, title, description, amount: amountNum, due_date: due,
        student_ids: selected.map(s => s.id),
        filters: {
          grades: gradeList, sections: Array.from(sections),
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

  const issueExisting = async () => {
    if (!charge) return
    setBusy(true); setError(null)
    try { await issueCharge(charge.id); onSaved(); onClose() }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not issue.') }
    finally { setBusy(false) }
  }

  const remove = async () => {
    if (!charge) return
    setBusy(true); setError(null)
    try { await deleteCharge(charge.id); onSaved(); onClose() }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not delete.') }
    finally { setBusy(false) }
  }

  const noun = kind === 'fine' ? 'fine' : 'fee'
  const sheetTitle = charge ? charge.title : kind === 'fine' ? 'Issue a fine' : 'New other fee'

  const footer = editing ? (
    <div className="flex flex-wrap items-center gap-2">
      <div className="text-[13px] text-[rgba(60,60,67,0.6)] mr-auto tabular-nums">
        {selected.length} student{selected.length === 1 ? '' : 's'}
        {amountNum > 0 && <> · <span className="text-[#1C1C1E] font-semibold">{rupees(amountNum * selected.length)}</span></>}
      </div>
      <button onClick={() => (charge ? setEditing(false) : onClose())} className={BTN.glass}>Cancel</button>
      {kind === 'other' && (
        <button onClick={() => submit(false)} disabled={busy} className={BTN.glass}>Save as draft</button>
      )}
      {canIssue && (
        <button onClick={() => submit(true)} disabled={busy} className={BTN.primary}
                style={{ background: accent, boxShadow: `0 6px 16px -8px ${accent}` }}>
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
          {kind === 'fine' ? 'Issue fine' : 'Save & issue'}
        </button>
      )}
    </div>
  ) : (
    <div className="flex flex-wrap items-center gap-2">
      {!issue && canEdit && (
        <button onClick={remove} disabled={busy} className={BTN.destructive}><Trash2 size={14} /> Delete</button>
      )}
      <div className="flex-1" />
      {!issue && canEdit && (
        <button onClick={() => setEditing(true)} className={BTN.glass}><Pencil size={13} /> Edit</button>
      )}
      {!issue && canIssue && (
        <button onClick={issueExisting} disabled={busy} className={BTN.primary}
                style={{ background: accent }}>
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} Issue now
        </button>
      )}
      {issue && (
        <button onClick={() => onUndo(issue)} className={BTN.destructive}><Undo2 size={14} /> Undo issue</button>
      )}
    </div>
  )

  return (
    <GlassSheet
      open={open} onClose={onClose} size="xl" accent={accent}
      icon={kind === 'fine' ? <AlertOctagon size={18} /> : <Receipt size={18} />}
      title={sheetTitle}
      subtitle={charge
        ? (issue
          ? <span className="inline-flex items-center gap-1 text-[#248A3D]"><CheckCircle2 size={13} /> Issued {shortDate(issue.issued_at.slice(0, 10))} · locked</span>
          : `Draft ${noun} — not billed yet`)
        : kind === 'fine'
          ? 'Billed straight away to the students you choose.'
          : 'Billed under “Other” to the students you choose.'}
      footer={footer}
    >
      {/* What */}
      <Group
        header="What parents will see"
        footer={editing && triedSave && problem ? <span className="text-[#FF3B30]">{problem}</span>
          : editing ? 'Be specific — this title is the line on the bill.' : undefined}
      >
        <GroupRowItem label="Title">
          {readOnly ? <span className="text-[15px] text-right font-medium">{title}</span> : (
            <input value={title} onChange={e => setTitle(e.target.value)} className={INLINE_FIELD}
                   placeholder={kind === 'fine' ? 'Library book returned late' : 'Annual Day costume'} autoFocus={!charge} />
          )}
        </GroupRowItem>
        {kind === 'fine' && fineCategories.length > 0 && (
          <div className="px-4 py-2.5 flex flex-wrap gap-1.5 items-center">
            <span className="text-[15px] text-[#1C1C1E] mr-2">Kind</span>
            {fineCategories.map(c => (
              <Chip key={c.id} on={category === c.id} tone={SYS.red} disabled={readOnly}
                    onClick={() => {
                      setCategory(category === c.id ? null : c.id)
                      if (!amount && c.default_amount > 0) setAmount(String(c.default_amount))
                    }}>
                {c.name}
              </Chip>
            ))}
          </div>
        )}
        <GroupRowItem label="Amount">
          {readOnly ? <span className="text-[15px] tabular-nums font-semibold">{rupees(amountNum)}</span> : (
            <input type="number" min={0} inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)}
                   className={`${INLINE_FIELD} tabular-nums`} placeholder="₹0" />
          )}
        </GroupRowItem>
        <GroupRowItem label="Due date">
          {readOnly ? <span className="text-[15px]">{shortDate(due)}</span> : (
            <input type="date" value={due} onChange={e => setDue(e.target.value)} className={INLINE_FIELD} />
          )}
        </GroupRowItem>
        {(editing || description) && (
          <div className="px-4 py-2.5">
            {readOnly ? <p className="text-[14px] text-[rgba(60,60,67,0.75)] whitespace-pre-wrap">{description}</p> : (
              <textarea value={description} onChange={e => setDescription(e.target.value)} rows={2}
                        className="w-full bg-transparent text-[15px] resize-none focus:outline-none placeholder:text-[rgba(60,60,67,0.3)]"
                        placeholder="A note for parents (optional)" />
            )}
          </div>
        )}
      </Group>

      {/* Who */}
      {editing && (
        <Group header="Who pays" footer="Pick grades, then narrow by section or gender. Search adds any one student.">
          <div className="px-4 py-3">
            <div className="flex flex-wrap gap-1.5">
              {GRADE_OPTIONS.map(g => (
                <Chip key={g.value} tone={accent} on={grades.has(gkey(g.value))}
                      onClick={() => toggleSet(grades, gkey(g.value), setGrades)}>
                  {gradeShortLabel(g.value)}
                </Chip>
              ))}
              <Chip tone={accent} on={grades.has('none')} onClick={() => toggleSet(grades, 'none', setGrades)}>
                No grade
              </Chip>
            </div>

            {sectionOptions.length > 0 && (
              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                <span className="text-[12.5px] text-[rgba(60,60,67,0.6)] mr-1">Sections</span>
                {sectionOptions.map(sec => (
                  <Chip key={sec} tone={accent} on={sections.has(sec)} onClick={() => toggleSet(sections, sec, setSections)}>
                    {sec}
                  </Chip>
                ))}
                {sections.size > 0 && <button className={BTN.plain} onClick={() => setSections(new Set())}>All sections</button>}
              </div>
            )}

            <div className="mt-3 flex items-center gap-2">
              <span className="text-[12.5px] text-[rgba(60,60,67,0.6)]">Gender</span>
              <Segmented<GenderFilter> size="sm" value={gender} onChange={setGender}
                options={[{ value: 'all', label: 'All' }, { value: 'male', label: 'Boys' }, { value: 'female', label: 'Girls' }]} />
            </div>

            <div className="mt-3 relative">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[rgba(60,60,67,0.45)]" />
              <input value={query} onChange={e => setQuery(e.target.value)} className={`${FIELD} pl-9`}
                     placeholder="Add a student by name or admission no." />
              {search.length > 0 && (
                <div className="absolute z-10 left-0 right-0 mt-1 rounded-[12px] bg-white/90 backdrop-blur-2xl ring-1 ring-black/[0.06] shadow-[0_20px_40px_-20px_rgba(0,0,0,0.35)] overflow-hidden">
                  {search.map(s => (
                    <button key={s.id} type="button"
                            onClick={() => { setPicked(new Set(picked).add(s.id)); const ex = new Set(excluded); ex.delete(s.id); setExcluded(ex); setQuery('') }}
                            className="w-full text-left px-3.5 py-2 hover:bg-[#007AFF]/[0.06] flex items-center gap-2">
                      <span className="text-[14px] text-[#1C1C1E] flex-1 truncate">{s.full_name}</span>
                      <span className="text-[12px] text-[rgba(60,60,67,0.6)]">
                        {s.grade === null ? NO_GRADE_LABEL : `${gradeShortLabel(s.grade)}${s.section ? `-${s.section}` : ''}`}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </Group>
      )}

      <Group header={`${selected.length} student${selected.length === 1 ? '' : 's'}${amountNum > 0 ? ` · ${rupees(amountNum * selected.length)}` : ''}`}>
        {selected.length === 0 ? (
          <p className="px-4 py-4 text-[13.5px] text-[rgba(60,60,67,0.6)]">
            {editing ? 'Choose a grade or search for a student to start.' : 'No students.'}
          </p>
        ) : (
          <div className="max-h-[260px] overflow-y-auto">
            {selected
              .slice()
              .sort((a, b) => (a.grade ?? 99) - (b.grade ?? 99) || (a.section ?? '').localeCompare(b.section ?? '') || a.full_name.localeCompare(b.full_name))
              .map(s => (
                <div key={s.id} className="flex items-center gap-2 px-4 h-10 border-b last:border-b-0 border-[rgba(60,60,67,0.08)]">
                  <span className="text-[14px] text-[#1C1C1E] flex-1 truncate">{s.full_name}</span>
                  <span className="text-[12px] text-[rgba(60,60,67,0.6)] tabular-nums">
                    {s.grade === null ? 'No grade' : `${gradeLabel(s.grade)}${s.section ? ` ${s.section}` : ''}`}
                  </span>
                  {editing && (
                    <button onClick={() => removeStudent(s.id)} aria-label={`Remove ${s.full_name}`}
                            className="w-6 h-6 rounded-full flex items-center justify-center text-[rgba(60,60,67,0.45)] hover:bg-black/5">
                      <X size={13} />
                    </button>
                  )}
                </div>
              ))}
          </div>
        )}
      </Group>

      {issue && (
        <p className="mt-3 px-1 text-[12.5px] text-[rgba(60,60,67,0.6)] flex items-center gap-1.5">
          <Lock size={12} className="text-[#34C759]" />
          Issued to {issue.invoice_count} student{issue.invoice_count === 1 ? '' : 's'} for {rupees(issue.total)}. Undo the issue to change anything.
        </p>
      )}
      <ErrorNote>{error}</ErrorNote>
    </GlassSheet>
  )
}
