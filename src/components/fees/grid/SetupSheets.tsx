'use client'

// The three small sheets that shape the grid: a term, a fee head, and a group
// of sections inside a grade.

import React, { useEffect, useMemo, useState } from 'react'
import { CalendarDays, Layers, Loader2, Lock, Tag, Trash2 } from 'lucide-react'
import { ADMIN } from '@/components/fees/ui'
import { Segmented } from '@/components/fees/shell'
import { gradeLabel } from '@/lib/grades'
import {
  deleteGroup, deleteHead, deleteTerm, saveGroup, saveHead, saveTerm,
  type Frequency, type GroupRow, type HeadRow, type StudentLite, type TermRow,
} from '@/lib/fees/grid'
import { Aside, ErrorNote, FeeSheet, Field, Pick } from './kit'

function useBusy() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setError(null)
    try { await fn() } catch (e) { setError(e instanceof Error ? e.message : 'Something went wrong') }
    finally { setBusy(false) }
  }
  return { busy, error, run }
}

function Footer({ onDelete, onCancel, onSave, busy, saveLabel }: {
  onDelete?: () => void
  onCancel: () => void
  onSave: () => void
  busy: boolean
  saveLabel: string
}) {
  return (
    <div className="flex items-center gap-2">
      {onDelete && (
        <button onClick={onDelete} disabled={busy}
                className={`${ADMIN.ghostBtn} hover:!text-[#A93232] hover:!border-[#EFCCCC]`}>
          <Trash2 size={13} /> Delete
        </button>
      )}
      <div className="flex-1" />
      <button onClick={onCancel} className={ADMIN.ghostBtn}>Cancel</button>
      <button onClick={onSave} disabled={busy} className={ADMIN.darkBtn}>
        {busy && <Loader2 size={13} className="animate-spin" />} {saveLabel}
      </button>
    </div>
  )
}

// ── Term ────────────────────────────────────────────────────────────────
export function TermSheet({
  open, onClose, yearId, term, nextSeq, locked, onSaved,
}: {
  open: boolean; onClose: () => void; yearId: string
  term: TermRow | null; nextSeq: number; locked: boolean; onSaved: () => void
}) {
  const [name, setName] = useState('')
  const [due, setDue] = useState('')
  const { busy, error, run } = useBusy()

  useEffect(() => {
    if (!open) return
    setName(term?.name ?? `Term ${nextSeq}`)
    setDue(term?.due_date ?? '')
  }, [open, term, nextSeq])

  const save = () => run(async () => {
    if (!name.trim()) throw new Error('Give the term a name.')
    if (!due) throw new Error('Pick the date this term’s fees are due.')
    await saveTerm(yearId, { id: term?.id, name, seq: term?.seq ?? nextSeq, due_date: due })
    onSaved(); onClose()
  })

  const remove = () => run(async () => {
    if (!term) return
    await deleteTerm(term.id)
    onSaved(); onClose()
  })

  return (
    <FeeSheet
      open={open} onClose={onClose} icon={<CalendarDays size={15} />}
      title={term ? term.name : 'New term'}
      subtitle="Term-wise fees are billed against this due date"
      footer={<Footer onDelete={term && !locked ? remove : undefined} onCancel={onClose}
                      onSave={save} busy={busy} saveLabel={term ? 'Save term' : 'Add term'} />}
    >
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="Name">
          <input value={name} onChange={e => setName(e.target.value)} className={ADMIN.inputPlain} placeholder="Term 1" />
        </Field>
        <Field label="Due date">
          <input type="date" value={due} disabled={locked} onChange={e => setDue(e.target.value)}
                 className={`${ADMIN.inputPlain} disabled:bg-[#F4F1E7] disabled:text-[#8C8878]`} />
        </Field>
      </div>
      {locked && (
        <Aside tone="good">
          <Lock size={11} className="inline mr-1 -mt-0.5" />
          Fees for this term have been issued, so its due date is locked. Undo those issues to change it.
        </Aside>
      )}
      <ErrorNote>{error}</ErrorNote>
    </FeeSheet>
  )
}

// ── Head ────────────────────────────────────────────────────────────────
type Split = 'same' | 'split'

export function HeadSheet({
  open, onClose, yearId, head, nextSort, locked, onSaved,
}: {
  open: boolean; onClose: () => void; yearId: string
  head: HeadRow | null; nextSort: number; locked: boolean; onSaved: () => void
}) {
  const [name, setName] = useState('')
  const [frequency, setFrequency] = useState<Frequency>('term')
  const [split, setSplit] = useState<Split>('same')
  const { busy, error, run } = useBusy()

  useEffect(() => {
    if (!open) return
    setName(head?.name ?? '')
    setFrequency(head?.frequency ?? 'term')
    setSplit(head?.gender_split ? 'split' : 'same')
  }, [open, head])

  const save = () => run(async () => {
    if (name.trim().length < 2) throw new Error('Name the fee head — Tuition, Bus, Uniform…')
    await saveHead(yearId, {
      id: head?.id, name, frequency, gender_split: split === 'split', sort: head?.sort ?? nextSort,
    })
    onSaved(); onClose()
  })

  const remove = () => run(async () => {
    if (!head) return
    await deleteHead(head.id)
    onSaved(); onClose()
  })

  return (
    <FeeSheet
      open={open} onClose={onClose} icon={<Tag size={15} />}
      title={head ? head.name : 'New fee head'}
      subtitle="A line on the bill — tuition, bus, uniform, ID card, anything the school charges"
      footer={<Footer onDelete={head && !locked ? remove : undefined} onCancel={onClose}
                      onSave={save} busy={busy} saveLabel={head ? 'Save head' : 'Add head'} />}
    >
      <Field label="Name">
        <input value={name} autoFocus onChange={e => setName(e.target.value)} className={ADMIN.inputPlain} placeholder="Tuition" />
      </Field>

      <Field
        label="Collected"
        hint={frequency === 'term'
          ? 'Billed once per term, on the term’s due date. Each term gets its own column in the grid.'
          : 'One amount, billed every month you issue it — bus fees usually work this way.'}
      >
        <div className={locked ? 'pointer-events-none opacity-50' : ''}>
          <Segmented<Frequency> fill value={frequency} onChange={setFrequency}
            options={[{ key: 'term', label: 'Term-wise' }, { key: 'monthly', label: 'Monthly' }]} />
        </div>
      </Field>

      <Field
        label="Boys and girls"
        hint="Choose “Different” when boys and girls pay different amounts, like uniforms. Each cell then takes two figures."
      >
        <div className={locked ? 'pointer-events-none opacity-50' : ''}>
          <Segmented<Split> fill value={split} onChange={setSplit}
            options={[{ key: 'same', label: 'Same for all' }, { key: 'split', label: 'Different' }]} />
        </div>
      </Field>

      {locked && (
        <Aside tone="good">
          <Lock size={11} className="inline mr-1 -mt-0.5" />
          Fees under this head have been issued. You can rename it, but how it is collected is locked.
        </Aside>
      )}
      <ErrorNote>{error}</ErrorNote>
    </FeeSheet>
  )
}

// ── Group ───────────────────────────────────────────────────────────────
export function GroupSheet({
  open, onClose, yearId, grade, group, groups, students, locked, onSaved,
}: {
  open: boolean; onClose: () => void; yearId: string; grade: number
  group: GroupRow | null; groups: GroupRow[]; students: StudentLite[]; locked: boolean
  onSaved: () => void
}) {
  const [name, setName] = useState('')
  const [sections, setSections] = useState<string[]>([])
  const [extra, setExtra] = useState('')
  const { busy, error, run } = useBusy()

  const gradeGroups = groups.filter(g => g.grade === grade)

  useEffect(() => {
    if (!open) return
    setName(group?.name ?? `Group ${String.fromCharCode(65 + gradeGroups.filter(g => g.id !== group?.id).length)}`)
    setSections(group?.sections ?? [])
    setExtra('')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, group])

  const known = useMemo(() => {
    const s = new Set<string>()
    for (const st of students) if (st.grade === grade && st.section) s.add(st.section.trim().toUpperCase())
    for (const g of gradeGroups) g.sections.forEach(x => s.add(x))
    sections.forEach(x => s.add(x))
    return Array.from(s).sort()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [students, grade, groups, sections])

  const takenBy = (sec: string) => gradeGroups.find(g => g.id !== group?.id && g.sections.includes(sec))
  const countIn = (sec: string) => students.filter(s => s.grade === grade && (s.section ?? '').trim().toUpperCase() === sec).length

  const toggle = (sec: string) =>
    setSections(cur => cur.includes(sec) ? cur.filter(x => x !== sec) : [...cur, sec].sort())

  const addExtra = () => {
    const v = extra.trim().toUpperCase()
    if (v && !sections.includes(v)) toggle(v)
    setExtra('')
  }

  const save = () => run(async () => {
    if (!name.trim()) throw new Error('Name the group.')
    if (sections.length === 0) throw new Error('Give the group at least one section.')
    await saveGroup(yearId, { id: group?.id, grade, name, sections, sort: group?.sort ?? gradeGroups.length + 1 })
    onSaved(); onClose()
  })

  const remove = () => run(async () => {
    if (!group) return
    await deleteGroup(group.id)
    onSaved(); onClose()
  })

  return (
    <FeeSheet
      open={open} onClose={onClose} icon={<Layers size={15} />}
      title={group ? `${gradeLabel(grade)} · ${group.name}` : `New group in ${gradeLabel(grade)}`}
      subtitle="A group gets its own row in the grid and prices the sections you give it"
      footer={<Footer onDelete={group && !locked ? remove : undefined} onCancel={onClose}
                      onSave={save} busy={busy} saveLabel={group ? 'Save group' : 'Add group'} />}
    >
      <Field label="Name">
        <input value={name} onChange={e => setName(e.target.value)} className={ADMIN.inputPlain} placeholder="Science stream" />
      </Field>

      <Field label="Sections" hint="A section can belong to only one group. Sections left out stay on the grade’s own row.">
        <div className="bg-white border border-[#E3DFD3] p-2.5">
          <div className="flex flex-wrap gap-1.5">
            {known.length === 0 && (
              <span className="text-[12px] text-[#8C8878]">No sections found for this grade yet — add one below.</span>
            )}
            {known.map(sec => {
              const other = takenBy(sec)
              return (
                <Pick key={sec} on={sections.includes(sec)} onClick={() => toggle(sec)} disabled={!!other}
                      title={other ? `Already in ${other.name}` : `${countIn(sec)} students`}>
                  {sec}
                  <span className="font-semibold normal-case tracking-normal opacity-60">
                    {other ? `in ${other.name}` : countIn(sec)}
                  </span>
                </Pick>
              )
            })}
          </div>
          <div className="flex items-center gap-1.5 mt-2.5 pt-2.5 border-t border-[#F0ECE2]">
            <input
              value={extra}
              onChange={e => setExtra(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addExtra() } }}
              className={`${ADMIN.inputPlain} flex-1`}
              placeholder="Another section, e.g. E"
            />
            <button type="button" className={ADMIN.ghostBtn} disabled={!extra.trim()} onClick={addExtra}>Add</button>
          </div>
        </div>
      </Field>

      {locked && (
        <Aside tone="good">
          <Lock size={11} className="inline mr-1 -mt-0.5" />
          This group has issued fees and cannot be deleted until they are undone.
        </Aside>
      )}
      <ErrorNote>{error}</ErrorNote>
    </FeeSheet>
  )
}
