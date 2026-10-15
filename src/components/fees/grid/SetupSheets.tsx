'use client'

// The three small sheets that shape the grid: a term, a fee head, and a group
// of sections inside a grade.

import React, { useEffect, useMemo, useState } from 'react'
import { CalendarDays, Layers, Loader2, Lock, Tag, Trash2 } from 'lucide-react'
import { gradeLabel } from '@/lib/grades'
import {
  deleteGroup, deleteHead, deleteTerm, saveGroup, saveHead, saveTerm,
  type Frequency, type GroupRow, type HeadRow, type StudentLite, type TermRow,
} from '@/lib/fees/grid'
import {
  BTN, Chip, ErrorNote, GlassSheet, Group, GroupRowItem, INLINE_FIELD, SYS, Segmented,
} from './glass'

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
    <GlassSheet
      open={open} onClose={onClose} size="md" accent={SYS.blue}
      icon={<CalendarDays size={18} />}
      title={term ? term.name : 'New term'}
      subtitle="Term-wise fees are billed against this due date."
      footer={
        <div className="flex items-center gap-2">
          {term && !locked && (
            <button onClick={remove} disabled={busy} className={BTN.destructive}><Trash2 size={14} /> Delete</button>
          )}
          <div className="flex-1" />
          <button onClick={onClose} className={BTN.glass}>Cancel</button>
          <button onClick={save} disabled={busy} className={BTN.primary}>
            {busy && <Loader2 size={14} className="animate-spin" />} {term ? 'Save term' : 'Add term'}
          </button>
        </div>
      }
    >
      <Group footer={locked ? 'Fees for this term have been issued, so its due date is locked. Undo those issues to change it.' : undefined}>
        <GroupRowItem label="Name">
          <input value={name} onChange={e => setName(e.target.value)} className={INLINE_FIELD} placeholder="Term 1" />
        </GroupRowItem>
        <GroupRowItem label="Due date" hint={locked ? <Lock size={14} className="text-[#34C759]" /> : undefined}>
          <input type="date" value={due} disabled={locked} onChange={e => setDue(e.target.value)} className={INLINE_FIELD} />
        </GroupRowItem>
      </Group>
      <ErrorNote>{error}</ErrorNote>
    </GlassSheet>
  )
}

// ── Head ────────────────────────────────────────────────────────────────
export function HeadSheet({
  open, onClose, yearId, head, nextSort, locked, onSaved,
}: {
  open: boolean; onClose: () => void; yearId: string
  head: HeadRow | null; nextSort: number; locked: boolean; onSaved: () => void
}) {
  const [name, setName] = useState('')
  const [frequency, setFrequency] = useState<Frequency>('term')
  const [split, setSplit] = useState(false)
  const { busy, error, run } = useBusy()

  useEffect(() => {
    if (!open) return
    setName(head?.name ?? '')
    setFrequency(head?.frequency ?? 'term')
    setSplit(head?.gender_split ?? false)
  }, [open, head])

  const save = () => run(async () => {
    if (name.trim().length < 2) throw new Error('Name the fee head — Tuition, Bus, Uniform…')
    await saveHead(yearId, { id: head?.id, name, frequency, gender_split: split, sort: head?.sort ?? nextSort })
    onSaved(); onClose()
  })

  const remove = () => run(async () => {
    if (!head) return
    await deleteHead(head.id)
    onSaved(); onClose()
  })

  return (
    <GlassSheet
      open={open} onClose={onClose} size="md" accent={SYS.teal}
      icon={<Tag size={18} />}
      title={head ? head.name : 'New fee head'}
      subtitle="A line on the bill. Tuition, Bus, Uniform, ID card — anything the school charges."
      footer={
        <div className="flex items-center gap-2">
          {head && !locked && (
            <button onClick={remove} disabled={busy} className={BTN.destructive}><Trash2 size={14} /> Delete</button>
          )}
          <div className="flex-1" />
          <button onClick={onClose} className={BTN.glass}>Cancel</button>
          <button onClick={save} disabled={busy} className={BTN.primary}>
            {busy && <Loader2 size={14} className="animate-spin" />} {head ? 'Save head' : 'Add head'}
          </button>
        </div>
      }
    >
      <Group>
        <GroupRowItem label="Name">
          <input value={name} autoFocus onChange={e => setName(e.target.value)} className={INLINE_FIELD} placeholder="Tuition" />
        </GroupRowItem>
      </Group>

      <Group
        header="Collected"
        footer={frequency === 'term'
          ? 'Billed once per term, on the term’s due date. Each term gets its own column.'
          : 'Billed every month you issue it — bus fees usually work this way.'}
      >
        <div className="px-4 py-2.5 flex items-center justify-between gap-3">
          <span className="text-[15px] text-[#1C1C1E]">Frequency</span>
          <div className={locked ? 'pointer-events-none opacity-50' : ''}>
            <Segmented<Frequency>
              value={frequency} onChange={setFrequency}
              options={[{ value: 'term', label: 'Term-wise' }, { value: 'monthly', label: 'Monthly' }]}
            />
          </div>
        </div>
      </Group>

      <Group footer="Turn on when boys and girls pay different amounts, like uniforms. Each cell then takes two figures.">
        <div className="px-4 py-2.5 flex items-center justify-between gap-3">
          <span className="text-[15px] text-[#1C1C1E]">Different for boys and girls</span>
          <button
            type="button" role="switch" aria-checked={split} disabled={locked}
            onClick={() => setSplit(s => !s)}
            className="relative w-[51px] h-[31px] rounded-full transition-colors disabled:opacity-50 flex-shrink-0"
            style={{ background: split ? SYS.green : 'rgba(120,120,128,0.16)' }}
          >
            <span
              className="absolute top-[2px] w-[27px] h-[27px] rounded-full bg-white shadow-[0_3px_8px_rgba(0,0,0,0.15),0_3px_1px_rgba(0,0,0,0.06)] transition-all"
              style={{ left: split ? 22 : 2 }}
            />
          </button>
        </div>
      </Group>

      {locked && (
        <p className="mt-3 px-1 text-[12.5px] text-[rgba(60,60,67,0.6)] flex items-center gap-1.5">
          <Lock size={12} className="text-[#34C759]" /> Fees under this head have been issued. You can rename it, but how it is collected is locked.
        </p>
      )}
      <ErrorNote>{error}</ErrorNote>
    </GlassSheet>
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
    <GlassSheet
      open={open} onClose={onClose} size="md" accent={SYS.indigo}
      icon={<Layers size={18} />}
      title={group ? `${gradeLabel(grade)} · ${group.name}` : `New group in ${gradeLabel(grade)}`}
      subtitle="A group gets its own row in the grid and prices the sections you give it. Sections left out stay on the grade’s own row."
      footer={
        <div className="flex items-center gap-2">
          {group && !locked && (
            <button onClick={remove} disabled={busy} className={BTN.destructive}><Trash2 size={14} /> Delete</button>
          )}
          <div className="flex-1" />
          <button onClick={onClose} className={BTN.glass}>Cancel</button>
          <button onClick={save} disabled={busy} className={BTN.primary}>
            {busy && <Loader2 size={14} className="animate-spin" />} {group ? 'Save group' : 'Add group'}
          </button>
        </div>
      }
    >
      <Group>
        <GroupRowItem label="Name">
          <input value={name} onChange={e => setName(e.target.value)} className={INLINE_FIELD} placeholder="Science stream" />
        </GroupRowItem>
      </Group>

      <Group header="Sections" footer="A section can belong to only one group.">
        <div className="px-4 py-3 flex flex-wrap gap-1.5">
          {known.length === 0 && <span className="text-[13px] text-[rgba(60,60,67,0.6)]">No sections found for this grade yet — add one below.</span>}
          {known.map(sec => {
            const other = takenBy(sec)
            return (
              <Chip key={sec} on={sections.includes(sec)} onClick={() => toggle(sec)} disabled={!!other} tone={SYS.indigo}>
                {sec}
                <span className="opacity-60 text-[11px]">{other ? `in ${other.name}` : countIn(sec)}</span>
              </Chip>
            )
          })}
        </div>
        <div className="px-4 py-2 flex items-center gap-2">
          <input
            value={extra}
            onChange={e => setExtra(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && extra.trim()) {
                e.preventDefault()
                toggle(extra.trim().toUpperCase()); setExtra('')
              }
            }}
            className="flex-1 bg-transparent text-[15px] focus:outline-none placeholder:text-[rgba(60,60,67,0.3)]"
            placeholder="Add a section, e.g. E"
          />
          <button type="button" className={BTN.plain} disabled={!extra.trim()}
                  onClick={() => { toggle(extra.trim().toUpperCase()); setExtra('') }}>Add</button>
        </div>
      </Group>
      {locked && (
        <p className="mt-3 px-1 text-[12.5px] text-[rgba(60,60,67,0.6)] flex items-center gap-1.5">
          <Lock size={12} className="text-[#34C759]" /> This group has issued fees and cannot be deleted until they are undone.
        </p>
      )}
      <ErrorNote>{error}</ErrorNote>
    </GlassSheet>
  )
}
