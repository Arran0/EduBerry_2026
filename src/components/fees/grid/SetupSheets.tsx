'use client'

// The three small sheets that shape the grid: a term, a fee head, and a group
// of sections inside a grade.

import React, { useEffect, useMemo, useState } from 'react'
import { CalendarDays, Layers, Loader2, Lock, Tag, Trash2 } from 'lucide-react'
import { ADMIN } from '@/components/fees/ui'
import { Segmented } from '@/components/fees/shell'
import { gradeLabel } from '@/lib/grades'
import {
  deleteHead, deleteTerm, saveGradeSplit, saveHead, saveTerm,
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
type Payers = 'all' | 'optin'

export function HeadSheet({
  open, onClose, yearId, head, nextSort, locked, onSaved,
}: {
  open: boolean; onClose: () => void; yearId: string
  head: HeadRow | null; nextSort: number; locked: boolean; onSaved: () => void
}) {
  const [name, setName] = useState('')
  const [frequency, setFrequency] = useState<Frequency>('term')
  const [split, setSplit] = useState<Split>('same')
  const [payers, setPayers] = useState<Payers>('all')
  const { busy, error, run } = useBusy()

  useEffect(() => {
    if (!open) return
    setName(head?.name ?? '')
    setFrequency(head?.frequency ?? 'term')
    setSplit(head?.gender_split ? 'split' : 'same')
    setPayers(head?.optional ? 'optin' : 'all')
  }, [open, head])

  const save = () => run(async () => {
    if (name.trim().length < 2) throw new Error('Name the fee head — Tuition, Bus, Uniform…')
    await saveHead(yearId, {
      id: head?.id, name, frequency, gender_split: split === 'split', optional: payers === 'optin',
      sort: head?.sort ?? nextSort,
    })
    onSaved(); onClose()
  })

  const remove = () => run(async () => {
    if (!head) return
    await deleteHead(head.id)
    onSaved(); onClose()
  })

  // The Bus fee head belongs to Transport: it is monthly, everyone on a route
  // pays, and the amounts live on the routes. Only its name is editable here.
  const transport = !!head?.is_transport

  return (
    <FeeSheet
      open={open} onClose={onClose} icon={<Tag size={15} />}
      title={head ? head.name : 'New fee head'}
      subtitle="A line on the bill — tuition, bus, uniform, ID card, anything the school charges"
      footer={<Footer onDelete={head && !locked && !transport ? remove : undefined} onCancel={onClose}
                      onSave={save} busy={busy} saveLabel={head ? 'Save head' : 'Add head'} />}
    >
      <Field label="Name">
        <input value={name} autoFocus onChange={e => setName(e.target.value)} className={ADMIN.inputPlain} placeholder="Tuition" />
      </Field>

      {transport && (
        <Aside tone="good">
          This is the session’s <span className="font-semibold">Bus fee</span>. It is billed monthly to every rider, at the
          amount their route sets — by stop or by student — in Transport → Configuration. Issue a month here or there;
          each child gets one bill with a line per route they ride.
        </Aside>
      )}

      {!transport && (<>
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

      <Field
        label="Who pays"
        hint={payers === 'all'
          ? 'Everyone in a priced row is billed.'
          : 'Optional: only students on this head’s opt-in list are billed — bus, lunch, a club. Keep the list from the grid’s column header.'}
      >
        <Segmented<Payers> fill value={payers} onChange={setPayers}
          options={[{ key: 'all', label: 'Everyone' }, { key: 'optin', label: 'Only those who opt in' }]} />
      </Field>
      </>)}

      {locked && !transport && (
        <Aside tone="good">
          <Lock size={11} className="inline mr-1 -mt-0.5" />
          Some fees under this head have already been issued. You can rename it and change who pays,
          but how it is collected stays as it is until those issues are undone.
        </Aside>
      )}
      <ErrorNote>{error}</ErrorNote>
    </FeeSheet>
  )
}

// ── Splitting a grade into groups ───────────────────────────────────────
/**
 * One sheet for a grade's whole split. Groups are defined together, and every
 * section of the grade must land in exactly one of them before it saves — a
 * half-split grade would leave students priced by nothing. With no groups the
 * grade is a single row again.
 */
export function SplitSheet({
  open, onClose, yearId, grade, groups, students, locked, onSaved,
}: {
  open: boolean; onClose: () => void; yearId: string; grade: number
  groups: GroupRow[]; students: StudentLite[]; locked: boolean
  onSaved: (created: { name: string; id: string }[], firstSplit: boolean) => void
}) {
  interface Draft { key: string; id?: string; name: string }
  const existing = useMemo(() => groups.filter(g => g.grade === grade).sort((a, b) => a.sort - b.sort), [groups, grade])
  const [drafts, setDrafts] = useState<Draft[]>([])
  const [owner, setOwner] = useState<Record<string, string>>({})
  const [extra, setExtra] = useState('')
  const [tried, setTried] = useState(false)
  const { busy, error, run } = useBusy()

  useEffect(() => {
    if (!open) return
    setTried(false); setExtra('')
    if (existing.length) {
      setDrafts(existing.map(g => ({ key: g.id, id: g.id, name: g.name })))
      const o: Record<string, string> = {}
      existing.forEach(g => g.sections.forEach(sec => { o[sec] = g.id }))
      setOwner(o)
    } else {
      setDrafts([{ key: 'n1', name: 'Group A' }, { key: 'n2', name: 'Group B' }])
      setOwner({})
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, grade])

  const sections = useMemo(() => {
    const set = new Set<string>()
    for (const st of students) if (st.grade === grade && st.section) set.add(st.section.trim().toUpperCase())
    existing.forEach(g => g.sections.forEach(x => set.add(x)))
    Object.keys(owner).forEach(x => set.add(x))
    return Array.from(set).sort()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [students, grade, existing, owner])

  const countIn = (sec: string) =>
    students.filter(s => s.grade === grade && (s.section ?? '').trim().toUpperCase() === sec).length

  const unassigned = sections.filter(sec => !drafts.some(d => d.key === owner[sec]))
  const empty = drafts.filter(d => !sections.some(sec => owner[sec] === d.key))
  const names = drafts.map(d => d.name.trim().toLowerCase())
  const dupName = names.some((n, i) => n && names.indexOf(n) !== i)
  const problem = drafts.length === 1 ? 'A split needs at least two groups. To price the whole grade together, remove the split.'
    : drafts.some(d => !d.name.trim()) ? 'Every group needs a name.'
    : dupName ? 'Two groups have the same name.'
    : unassigned.length ? `Put ${unassigned.join(', ')} in a group — every section must belong to one.`
    : empty.length ? `${empty.map(e => e.name || 'A group').join(', ')} has no sections. Give it one or remove it.`
    : null

  const addGroup = () => setDrafts(d => [...d, { key: `n${Date.now()}`, name: `Group ${String.fromCharCode(65 + d.length)}` }])
  const removeGroup = (key: string) => {
    setDrafts(d => d.filter(x => x.key !== key))
    setOwner(o => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== key)))
  }
  const addSection = () => {
    const v = extra.trim().toUpperCase()
    if (v && !sections.includes(v)) setOwner(o => ({ ...o, [v]: '' }))
    setExtra('')
  }

  const save = () => run(async () => {
    setTried(true)
    if (problem) throw new Error(problem)
    const next = drafts.map(d => ({
      id: d.id, name: d.name, sections: sections.filter(sec => owner[sec] === d.key),
    }))
    const created = await saveGradeSplit(yearId, grade, existing, next)
    onSaved(created, existing.length === 0); onClose()
  })

  const unsplit = () => run(async () => {
    await saveGradeSplit(yearId, grade, existing, [])
    onSaved([], false); onClose()
  })

  return (
    <FeeSheet
      open={open} onClose={onClose} size="lg" icon={<Layers size={15} />}
      title={existing.length ? `${gradeLabel(grade)} — groups` : `Split ${gradeLabel(grade)} into groups`}
      subtitle="Each group gets its own row in the grid and its own prices"
      footer={locked ? (
        <div className="flex justify-end"><button onClick={onClose} className={ADMIN.ghostBtn}>Close</button></div>
      ) : (
        <div className="flex items-center gap-2">
          {existing.length > 0 && (
            <button onClick={unsplit} disabled={busy}
                    className={`${ADMIN.ghostBtn} hover:!text-[#A93232] hover:!border-[#EFCCCC]`}>
              <Trash2 size={13} /> Remove split
            </button>
          )}
          <div className="flex-1" />
          <button onClick={onClose} className={ADMIN.ghostBtn}>Cancel</button>
          <button onClick={save} disabled={busy} className={ADMIN.darkBtn}>
            {busy && <Loader2 size={13} className="animate-spin" />} Save groups
          </button>
        </div>
      )}
    >
      {locked && (
        <Aside tone="good">
          <Lock size={11} className="inline mr-1 -mt-0.5" />
          Fees have been issued to {gradeLabel(grade)}, so its groups are locked. Undo those issues to change who is in which group.
        </Aside>
      )}

      <Field label="Groups">
        <div className="bg-white border border-[#E3DFD3] divide-y divide-[#F0ECE2]">
          {drafts.map((d, i) => (
            <div key={d.key} className="flex items-center gap-2 px-2.5 py-2">
              <span className="w-5 text-[10px] font-bold text-[#B8983C] tabular-nums">{i + 1}</span>
              <input value={d.name} disabled={locked}
                     onChange={e => setDrafts(ds => ds.map(x => x.key === d.key ? { ...x, name: e.target.value } : x))}
                     className={`${ADMIN.inputPlain} flex-1`} placeholder="Science stream" />
              <span className="text-[11px] text-[#8C8878] tabular-nums w-[72px] text-right">
                {(n => `${n} student${n === 1 ? '' : 's'}`)(sections.filter(sec => owner[sec] === d.key).reduce((a, sec) => a + countIn(sec), 0))}
              </span>
              {!locked && (
                <button onClick={() => removeGroup(d.key)} aria-label={`Remove ${d.name}`}
                        className="w-7 h-7 flex items-center justify-center text-[#C9C4B4] hover:text-[#A93232]">
                  <Trash2 size={13} />
                </button>
              )}
            </div>
          ))}
          {!locked && (
            <button onClick={addGroup} className="w-full text-left px-2.5 py-2 text-[10.5px] font-bold uppercase tracking-[0.08em] text-[#6B675A] hover:text-[#18181B] hover:bg-[#FAF8F2]">
              + Add a group
            </button>
          )}
        </div>
      </Field>

      <Field label="Which group each section belongs to"
             hint="Every section must be in exactly one group."
             error={tried && problem ? problem : undefined}>
        <div className="bg-white border border-[#E3DFD3] divide-y divide-[#F0ECE2]">
          {sections.length === 0 && (
            <p className="px-3 py-3 text-[12px] text-[#8C8878]">No sections found for this grade yet — add one below.</p>
          )}
          {sections.map(sec => {
            const missing = !drafts.some(d => d.key === owner[sec])
            return (
              <div key={sec} className={`flex flex-wrap items-center gap-2 px-2.5 py-2 ${missing && tried ? 'bg-[#FCECEC]' : ''}`}>
                <span className="w-[86px] flex-shrink-0">
                  <span className="text-[12.5px] font-bold text-[#18181B]">Section {sec}</span>
                  <span className="block text-[10.5px] text-[#8C8878] tabular-nums">{countIn(sec)} student{countIn(sec) === 1 ? '' : 's'}</span>
                </span>
                <div className="flex flex-wrap gap-1">
                  {drafts.map(d => (
                    <Pick key={d.key} on={owner[sec] === d.key} disabled={locked}
                          onClick={() => setOwner(o => ({ ...o, [sec]: d.key }))}>
                      {d.name || 'Unnamed'}
                    </Pick>
                  ))}
                </div>
                {missing && <span className="ml-auto text-[10px] font-bold uppercase tracking-[0.08em] text-[#A93232]">No group</span>}
              </div>
            )
          })}
          {!locked && (
            <div className="flex items-center gap-1.5 px-2.5 py-2">
              <input value={extra} onChange={e => setExtra(e.target.value)}
                     onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addSection() } }}
                     className={`${ADMIN.inputPlain} flex-1`} placeholder="A section with no students yet, e.g. E" />
              <button type="button" className={ADMIN.ghostBtn} disabled={!extra.trim()} onClick={addSection}>Add</button>
            </div>
          )}
        </div>
      </Field>
      <ErrorNote>{error && error !== problem ? error : null}</ErrorNote>
    </FeeSheet>
  )
}
