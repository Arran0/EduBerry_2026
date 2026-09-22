'use client'

// ─────────────────────────────────────────────────────────────────────────────
// Fee groups, and who lands in one.
//
// A group is a column of the price list: "what this set of students pays". The
// old form made one and stopped there, leaving the office to go and tick forty
// children by hand — so in practice groups were made for whole classes and then
// never populated, and every student fell through to the default.
//
// Creating a group now takes the obvious next step with it: pick the classes
// and sections it covers and those students are put in it on the spot, with the
// count shown before the button is pressed.
//
// What a group is NOT for: a discount. "Staff ward" and "Sibling" were being
// built as groups, which meant a second copy of every price, kept in step by
// hand, and a child who is both a staff ward and a sibling could only be in one
// of them. Those are concessions — a percentage off a bill, in the Collection
// Center — and this screen says so where somebody would otherwise start.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { BadgePercent, Check, Loader2, Plus, Users, X } from 'lucide-react'
import { ADMIN } from '@/components/fees/ui'
import { gradeLabel } from '@/lib/grades'
import {
  fetchFeeConfig, fetchRoster, reassignGroup, saveGroup,
  type FeeConfigBundle, type RosterStudent,
} from '@/lib/fees/config'

export default function GroupEditor({
  bundle, yearId, canEdit, onChanged, onError,
}: {
  bundle: FeeConfigBundle
  yearId: string
  canEdit: boolean
  onChanged: () => void
  onError: (m: string | null) => void
}) {
  const [adding, setAdding] = useState(false)

  return (
    <div className="space-y-3">
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
        {bundle.groups.map(g => (
          <div key={g.id} className={`${ADMIN.card} p-3`}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="text-[13px] font-bold text-[#18181B] truncate">{g.name}</div>
                <div className="font-mono text-[10.5px] text-[#8C8878]">{g.code}</div>
              </div>
              <div className="flex flex-col gap-1 items-end flex-shrink-0">
                {g.is_default && (
                  <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-px bg-[#27272A] text-white">
                    Default
                  </span>
                )}
                {g.is_rte && (
                  <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-px bg-[#EEF2FB] text-[#3A5490] border border-[#CFDAEF]">
                    RTE
                  </span>
                )}
              </div>
            </div>
            {g.description && <p className="text-[11px] text-[#6B675A] mt-1.5">{g.description}</p>}
            <p className="text-[10.5px] text-[#8C8878] mt-1.5">
              {bundle.structures.filter(s => s.fee_group_id === g.id).length} row
              {bundle.structures.filter(s => s.fee_group_id === g.id).length === 1 ? '' : 's'} on
              the grid
            </p>
          </div>
        ))}
      </div>

      <div className="flex items-start gap-2 p-2.5 bg-[#FAF8F2] border border-[#E3DFD3]">
        <BadgePercent size={13} className="text-[#7A6220] mt-0.5 flex-shrink-0" />
        <p className="text-[11px] text-[#6B675A] leading-relaxed">
          <strong className="text-[#18181B]">Staff wards, siblings and other discounts do not
          need a group.</strong>{' '}
          A group is a second copy of the whole price list, kept in step by hand, and a child can
          only be in one — so a staff ward who is also a second sibling has to be put in whichever
          group somebody picked. Set those up once as discount types under Collection Center →
          Concessions instead: they come off the bill as a named line, they stack, and the price
          list stays in one place.
        </p>
      </div>

      {canEdit && (adding ? (
        <AddGroupForm
          yearId={yearId}
          onClose={() => setAdding(false)}
          onAdded={() => { setAdding(false); onChanged() }}
          onError={onError}
        />
      ) : (
        <button onClick={() => setAdding(true)} className={ADMIN.ghostBtn}>
          <Plus size={13} /> Add a group
        </button>
      ))}
    </div>
  )
}

// ── Making one ────────────────────────────────────────────────────────────
function AddGroupForm({
  yearId, onClose, onAdded, onError,
}: {
  yearId: string
  onClose: () => void
  onAdded: () => void
  onError: (m: string | null) => void
}) {
  const [draft, setDraft] = useState({ name: '', code: '', description: '', is_rte: false })
  const [grades, setGrades] = useState<Set<number>>(new Set())
  const [sections, setSections] = useState<Set<string>>(new Set())
  const [roster, setRoster] = useState<RosterStudent[] | null>(null)
  const [loadingRoster, setLoadingRoster] = useState(true)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<{ added: number; repriced: number; unpriced: number } | null>(null)

  // The roster is what makes the count below honest, so it is fetched when the
  // form opens rather than when the button is pressed.
  const load = useCallback(async () => {
    setLoadingRoster(true)
    try { setRoster(await fetchRoster(yearId)) }
    catch { setRoster([]) }
    finally { setLoadingRoster(false) }
  }, [yearId])

  useEffect(() => { void load() }, [load])

  const gradeOptions = useMemo(() => {
    const seen = new Set<number>()
    for (const r of roster ?? []) if (r.grade !== null) seen.add(r.grade)
    return [...seen].sort((a, b) => a - b)
  }, [roster])

  const sectionOptions = useMemo(() => {
    const seen = new Set<string>()
    for (const r of roster ?? []) {
      // Only the sections of the classes being picked — offering "D" when no
      // chosen class has one is an invitation to select nothing.
      if (grades.size > 0 && (r.grade === null || !grades.has(r.grade))) continue
      if (r.section) seen.add(r.section)
    }
    return [...seen].sort()
  }, [roster, grades])

  /** Who the picks come to. No class picked means nobody — not everybody. */
  const matched = useMemo(() => {
    if (!roster || grades.size === 0) return []
    return roster.filter(r =>
      r.grade !== null && grades.has(r.grade)
      && (sections.size === 0 || (r.section !== null && sections.has(r.section))))
  }, [roster, grades, sections])

  const toggle = <T,>(set: Set<T>, value: T, apply: (next: Set<T>) => void) => {
    const next = new Set(set)
    if (next.has(value)) next.delete(value); else next.add(value)
    apply(next)
  }

  const save = async () => {
    setBusy(true); onError(null)
    const code = (draft.code || draft.name).trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_')
    try {
      await saveGroup({
        academic_year_id: yearId,
        name: draft.name.trim(),
        code,
        description: draft.description.trim() || null,
        is_rte: draft.is_rte,
      })

      if (matched.length === 0) { onAdded(); return }

      // The group has to exist before anybody can be put in it, and its id
      // comes back with the reloaded price list rather than from the upsert.
      const fresh = await fetchFeeConfig(yearId)
      const group = fresh.groups.find(g => g.code === code)
      if (!group) { onAdded(); return }

      const result = await reassignGroup({
        academicYearId: yearId,
        studentIds: matched.map(m => m.student_id),
        feeGroupId: group.id,
        isRte: draft.is_rte,
        note: `Added with the ${draft.name.trim()} group`,
        bundle: fresh,
        roster: roster ?? [],
      })
      setDone({
        added: result.assigned,
        repriced: result.repriced,
        unpriced: result.unpriced.length,
      })
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Could not save that group.')
      setBusy(false)
    }
  }

  if (done) {
    return (
      <div className="bg-[#EAF5EE] border border-[#C6E3D2] p-3">
        <p className="text-[12.5px] text-[#1F6B42] leading-relaxed">
          <strong>{draft.name.trim()}</strong> created with {done.added} student
          {done.added === 1 ? '' : 's'} in it.
          {done.repriced > 0
            ? ` ${done.repriced} already had a fee account and ${
                done.repriced === 1 ? 'was' : 'were'} re-priced; bills already issued are unchanged.`
            : ''}
          {done.unpriced > 0
            ? ` ${done.unpriced} cannot be priced yet — give the group a row on the grid and publish it, or they stay on the default group's prices.`
            : ''}
        </p>
        <button onClick={onAdded} className={`${ADMIN.darkBtn} mt-2.5`}>Done</button>
      </div>
    )
  }

  return (
    <div className={`${ADMIN.card} p-3 space-y-3`}>
      <div className="grid sm:grid-cols-3 gap-3">
        <label className="block">
          <span className={ADMIN.label}>Name</span>
          <input value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })}
                 placeholder="Boarders" className={`${ADMIN.inputPlain} mt-1`} autoFocus />
        </label>
        <label className="block">
          <span className={ADMIN.label}>Code</span>
          <input value={draft.code} onChange={e => setDraft({ ...draft, code: e.target.value })}
                 placeholder="auto" className={`${ADMIN.inputPlain} mt-1 font-mono text-xs`} />
        </label>
        <label className="block">
          <span className={ADMIN.label}>Bills nothing (RTE)</span>
          <select value={draft.is_rte ? 'yes' : 'no'}
                  onChange={e => setDraft({ ...draft, is_rte: e.target.value === 'yes' })}
                  className={`${ADMIN.inputPlain} mt-1`}>
            <option value="no">No</option>
            <option value="yes">Yes — claimed from the state</option>
          </select>
        </label>
      </div>

      <label className="block">
        <span className={ADMIN.label}>Description</span>
        <input value={draft.description} onChange={e => setDraft({ ...draft, description: e.target.value })}
               placeholder="Full boarding — mess and hostel on top of tuition"
               className={`${ADMIN.inputPlain} mt-1`} />
      </label>

      {/* ── Who goes in it ───────────────────────────────────────────── */}
      <div className="border-t border-[#F0ECE2] pt-3">
        <span className={ADMIN.label}>Put these students in it straight away</span>

        {loadingRoster ? (
          <p className="mt-1.5 text-[11.5px] text-[#8C8878] flex items-center gap-1.5">
            <Loader2 size={12} className="animate-spin" /> Reading the roster…
          </p>
        ) : gradeOptions.length === 0 ? (
          <p className="mt-1.5 text-[11.5px] text-[#8C8878]">
            No students on the roster yet. The group can be made now and filled later.
          </p>
        ) : (
          <>
            <div className="mt-1.5">
              <span className="text-[10.5px] text-[#8C8878]">Classes</span>
              <div className="flex flex-wrap gap-1 mt-1">
                {gradeOptions.map(g => (
                  <Pick key={g} on={grades.has(g)}
                        onClick={() => toggle(grades, g, setGrades)}>
                    {gradeLabel(g)}
                  </Pick>
                ))}
              </div>
            </div>

            {grades.size > 0 && sectionOptions.length > 0 && (
              <div className="mt-2">
                <span className="text-[10.5px] text-[#8C8878]">
                  Sections <span className="text-[#A8A395]">— leave blank for all of them</span>
                </span>
                <div className="flex flex-wrap gap-1 mt-1">
                  {sectionOptions.map(s => (
                    <Pick key={s} on={sections.has(s)}
                          onClick={() => toggle(sections, s, setSections)}>
                      {s}
                    </Pick>
                  ))}
                </div>
              </div>
            )}

            <p className="mt-2 text-[11.5px] text-[#6B675A]">
              {grades.size === 0 ? (
                <span className="text-[#8C8878]">
                  No class picked, so the group starts empty. Students can be added one at a time
                  from the roster below.
                </span>
              ) : (
                <>
                  <Users size={12} className="inline -mt-px mr-1 text-[#8C8878]" />
                  <strong className="text-[#18181B]">{matched.length}</strong> student
                  {matched.length === 1 ? '' : 's'} will be put in this group.
                  {matched.some(m => m.assigned_group_id) && (
                    <span className="text-[#7A6220]">
                      {' '}{matched.filter(m => m.assigned_group_id).length} of them are in another
                      group today and will move.
                    </span>
                  )}
                </>
              )}
            </p>
          </>
        )}
      </div>

      <div className="flex gap-2">
        <button onClick={() => void save()} disabled={!draft.name.trim() || busy}
                className={ADMIN.darkBtn}>
          {busy ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
          {matched.length > 0 ? `Create with ${matched.length}` : 'Create group'}
        </button>
        <button onClick={onClose} className={ADMIN.ghostBtn}><X size={13} /> Cancel</button>
      </div>
    </div>
  )
}

function Pick({
  on, onClick, children,
}: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-2 py-1 text-[11px] font-bold uppercase tracking-[0.06em] leading-none border
                  transition-colors ${
        on ? 'bg-[#27272A] text-white border-[#27272A]'
           : 'bg-white text-[#6B675A] border-[#E3DFD3] hover:border-[#C9C4B4] hover:text-[#18181B]'
      }`}
    >
      {children}
    </button>
  )
}
