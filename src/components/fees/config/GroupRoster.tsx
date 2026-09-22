'use client'

// ─────────────────────────────────────────────────────────────────────────────
// Who is in which fee group.
//
// The module had every part of this except the screen: a table, RLS, a data
// layer and a four-rank resolver in the engine — and no way to put a student
// in a group. So every student fell through to the default, and "Staff Ward"
// and "RTE" were price lists nobody could be on.
//
// Two things this screen refuses to hide:
//
//   A student who already has a fee profile was priced when that profile was
//   made. Changing their group afterwards has to re-price the profile too, or
//   nothing visible happens — the worst kind of control, one that looks like
//   it worked. The row shows the assignment and the profile's own group side
//   by side when they disagree, and assigning re-prices.
//
//   A group with no structure that fits a student cannot price them. That is
//   reported per student by name, not swallowed, because the alternative is a
//   bill that silently never generates.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Check, Loader2, RotateCcw, UserPlus, Users } from 'lucide-react'
import ModalShell from '@/components/ui/ModalShell'
import { ADMIN } from '@/components/fees/ui'
import { StudentPicker } from '@/components/fees/controls'
import { SearchField, Btn, Empty, Notice, StatStrip } from '@/components/fees/shell'
import { gradeLabel } from '@/lib/grades'
import {
  clearAssignments, fetchRoster, reassignGroup,
  type FeeConfigBundle, type ReassignResult, type RosterStudent,
} from '@/lib/fees/config'

export default function GroupRoster({
  bundle, yearId, canEdit, onError,
}: {
  bundle: FeeConfigBundle
  yearId: string
  canEdit: boolean
  onError: (m: string | null) => void
}) {
  const [roster, setRoster] = useState<RosterStudent[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [klass, setKlass] = useState('')
  const [groupFilter, setGroupFilter] = useState('')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [assigning, setAssigning] = useState(false)
  const [result, setResult] = useState<ReassignResult | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setRoster(await fetchRoster(yearId))
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Could not load the roster.')
    } finally {
      setLoading(false)
    }
  }, [yearId, onError])

  useEffect(() => { void load() }, [load])

  const groupsById = useMemo(
    () => new Map(bundle.groups.map(g => [g.id, g])), [bundle.groups])
  const defaultGroup = useMemo(
    () => bundle.groups.find(g => g.is_default) ?? null, [bundle.groups])

  const classes = useMemo(() => {
    const s = new Set<string>()
    roster.forEach(r => s.add(`${gradeLabel(r.grade)}${r.section ?? ''}`))
    return Array.from(s).sort()
  }, [roster])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return roster.filter(r => {
      if (klass && `${gradeLabel(r.grade)}${r.section ?? ''}` !== klass) return false
      if (groupFilter === '__none__' && r.assigned_group_id) return false
      if (groupFilter && groupFilter !== '__none__' && r.assigned_group_id !== groupFilter) return false
      if (!q) return true
      return r.full_name.toLowerCase().includes(q)
          || (r.admission_no ?? '').toLowerCase().includes(q)
    })
  }, [roster, query, klass, groupFilter])

  const counts = useMemo(() => {
    const assigned = roster.filter(r => r.assigned_group_id).length
    const drifted = roster.filter(r =>
      r.profile_id && r.assigned_group_id && r.profile_group_id !== r.assigned_group_id).length
    return { total: roster.length, assigned, unassigned: roster.length - assigned, drifted }
  }, [roster])

  const toggle = (id: string) => setPicked(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })

  const allShownPicked = shown.length > 0 && shown.every(r => picked.has(r.student_id))

  const clear = async () => {
    setBusy(true)
    onError(null)
    try {
      await clearAssignments(yearId, Array.from(picked))
      setPicked(new Set())
      await load()
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Could not clear those assignments.')
    } finally {
      setBusy(false)
    }
  }

  /**
   * One student, straight into the group being looked at.
   *
   * Filtering to a group and then hunting for a name in a nine-hundred-row
   * table, ticking it, and opening a sheet to confirm the group you are already
   * looking at is four steps to say one thing. Typing the name is one.
   */
  const focusedGroup = groupFilter && groupFilter !== '__none__'
    ? groupsById.get(groupFilter) ?? null
    : null

  const [justAdded, setJustAdded] = useState<string | null>(null)

  const addOne = async (studentId: string, name: string) => {
    if (!focusedGroup) return
    setBusy(true)
    onError(null)
    try {
      const result = await reassignGroup({
        academicYearId: yearId,
        studentIds: [studentId],
        feeGroupId: focusedGroup.id,
        isRte: focusedGroup.is_rte,
        bundle,
        roster,
      })
      await load()
      setJustAdded(result.unpriced.length > 0
        ? `${name} is in ${focusedGroup.name}, but nothing can price them: ${result.unpriced[0].reason}`
        : `${name} added to ${focusedGroup.name}.`)
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Could not add that student.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2.5">
      <StatStrip
        loading={loading}
        stats={[
          { label: 'Students', value: String(counts.total) },
          { label: 'In a group', value: String(counts.assigned) },
          { label: 'On the default', value: String(counts.unassigned) },
          { label: 'Need re-pricing', value: String(counts.drifted),
            tone: counts.drifted > 0 ? '#7A6220' : undefined, strong: counts.drifted > 0 },
        ]}
      />

      {counts.drifted > 0 && (
        <Notice tone="warn">
          {counts.drifted} student{counts.drifted === 1 ? ' was' : 's were'} moved to a different
          group after their fee profile was built, so their next bill would still come from the old
          price list. Select them and assign again to re-price.
        </Notice>
      )}

      {!defaultGroup && (
        <Notice tone="error">
          No group is marked as the default. A student with no assignment has nothing to fall back
          on and cannot be billed at all.
        </Notice>
      )}

      <div className={`${ADMIN.card} p-2.5 flex flex-wrap items-center gap-1.5`}>
        <SearchField value={query} onChange={setQuery} placeholder="Name or admission number…"
                     className="max-w-xs" />
        <select value={klass} onChange={e => setKlass(e.target.value)}
                className="bg-white border border-[#E3DFD3] px-2 py-[7px] text-[11px] font-bold
                           uppercase tracking-[0.06em] text-[#18181B] focus:outline-none
                           focus:border-[#27272A]">
          <option value="">Every class</option>
          {classes.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={groupFilter}
                onChange={e => { setGroupFilter(e.target.value); setJustAdded(null) }}
                className="bg-white border border-[#E3DFD3] px-2 py-[7px] text-[11px] font-bold
                           uppercase tracking-[0.06em] text-[#18181B] focus:outline-none
                           focus:border-[#27272A]">
          <option value="">Every group</option>
          <option value="__none__">Not assigned</option>
          {bundle.groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
        </select>

        <Btn onClick={() => setPicked(allShownPicked
              ? new Set()
              : new Set(shown.map(r => r.student_id)))}
             disabled={shown.length === 0}>
          {allShownPicked ? 'Clear' : `Select ${shown.length}`}
        </Btn>

        <div className="flex-1" />

        {canEdit && (
          <>
            <Btn onClick={() => void clear()} disabled={busy || picked.size === 0}>
              <RotateCcw size={12} /> Back to default
            </Btn>
            <Btn tone="dark" onClick={() => setAssigning(true)} disabled={picked.size === 0}>
              <Users size={12} /> Assign {picked.size || ''}
            </Btn>
          </>
        )}
      </div>

      {canEdit && focusedGroup && (
        <div className={`${ADMIN.card} p-2.5`}>
          <div className="flex flex-wrap items-center gap-2">
            <span className={`${ADMIN.label} flex items-center gap-1.5 flex-shrink-0`}>
              <UserPlus size={12} /> Add to {focusedGroup.name}
            </span>
            <div className="flex-1 min-w-[220px] max-w-md">
              <StudentPicker
                people={roster.filter(r => r.assigned_group_id !== focusedGroup.id)}
                onPick={p => void addOne(p.student_id, p.full_name)}
                placeholder="Type a name or admission number…"
              />
            </div>
            {busy && <Loader2 size={13} className="animate-spin text-[#8C8878]" />}
          </div>
          {justAdded && (
            <p className="text-[11px] text-[#1F6B42] mt-1.5">{justAdded}</p>
          )}
        </div>
      )}

      <div className={`${ADMIN.card} overflow-hidden`}>
        {loading ? (
          <Empty>Loading the roster…</Empty>
        ) : shown.length === 0 ? (
          <Empty>No students match that.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead className="bg-[#FAF8F2]">
                <tr className="text-[9.5px] font-bold uppercase tracking-[0.12em] text-[#8C8878]">
                  <th className="w-8 px-2.5 py-2" />
                  <th className="text-left px-2.5 py-2">Student</th>
                  <th className="text-left px-2.5 py-2 w-20">Class</th>
                  <th className="text-left px-2.5 py-2 w-28">Admission</th>
                  <th className="text-left px-2.5 py-2">Fee group</th>
                  <th className="text-left px-2.5 py-2 w-44">Note</th>
                </tr>
              </thead>
              <tbody>
                {shown.map(r => {
                  const assigned = r.assigned_group_id ? groupsById.get(r.assigned_group_id) : null
                  const drifted = Boolean(r.profile_id && r.assigned_group_id
                    && r.profile_group_id !== r.assigned_group_id)
                  return (
                    <tr key={r.student_id}
                        className={`border-t border-[#F0ECE2] ${
                          picked.has(r.student_id) ? 'bg-[#FAF3DF]' : 'hover:bg-[#FAF8F2]'}`}>
                      <td className="px-2.5 py-1.5">
                        <input type="checkbox" checked={picked.has(r.student_id)}
                               onChange={() => toggle(r.student_id)}
                               aria-label={`Select ${r.full_name}`} />
                      </td>
                      <td className="px-2.5 py-1.5 text-[#18181B]">{r.full_name}</td>
                      <td className="px-2.5 py-1.5 text-[#6B675A]">
                        {gradeLabel(r.grade)}{r.section ?? ''}
                      </td>
                      <td className="px-2.5 py-1.5 font-mono text-[11px] text-[#8C8878]">
                        {r.admission_no ?? '—'}
                      </td>
                      <td className="px-2.5 py-1.5">
                        {assigned ? (
                          <span className="inline-flex items-center gap-1.5">
                            <span className="text-[#18181B] font-semibold">{assigned.name}</span>
                            {r.assigned_is_rte && (
                              <span className="text-[9px] font-bold uppercase tracking-[0.08em]
                                               px-1 py-px bg-[#EEF2FB] text-[#3A5490]
                                               border border-[#CFDAEF]">RTE</span>
                            )}
                            {r.prorate_from && (
                              <span className="text-[10px] text-[#8C8878]">
                                from {r.prorate_from}
                              </span>
                            )}
                          </span>
                        ) : (
                          <span className="text-[#8C8878]">
                            {defaultGroup ? `${defaultGroup.name} (default)` : 'Nothing applies'}
                          </span>
                        )}
                        {drifted && (
                          <span className="block text-[10px] text-[#7A6220] mt-0.5">
                            Billed as {groupsById.get(r.profile_group_id ?? '')?.name ?? 'another group'}
                            {' '}until re-priced
                          </span>
                        )}
                      </td>
                      <td className="px-2.5 py-1.5 text-[11px] text-[#8C8878] truncate max-w-[11rem]">
                        {r.note ?? ''}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {assigning && (
        <AssignSheet
          bundle={bundle}
          yearId={yearId}
          roster={roster}
          studentIds={Array.from(picked)}
          onClose={() => setAssigning(false)}
          onDone={async r => {
            setAssigning(false)
            setResult(r)
            setPicked(new Set())
            await load()
          }}
        />
      )}

      {result && (
        <ModalShell onClose={() => setResult(null)} sharp size="sm" title="Assigned"
                    icon={<Check size={15} />} iconClassName="bg-[#EAF5EE] text-[#1F6B42]">
          <p className="text-[12.5px] text-[#6B675A] leading-relaxed">
            {result.assigned} student{result.assigned === 1 ? '' : 's'} moved.
            {result.repriced > 0
              ? ` ${result.repriced} already had a fee profile and ${
                  result.repriced === 1 ? 'was' : 'were'} re-priced, so the next bill comes from the new list. Bills already issued are unchanged.`
              : ' None of them had a fee profile yet, so nothing needed re-pricing.'}
          </p>
          {result.unpriced.length > 0 && (
            <div className="mt-3 border border-[#EFCCCC] bg-[#FCECEC] p-2.5">
              <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-[#A93232]">
                {result.unpriced.length} could not be priced
              </p>
              <ul className="mt-1.5 space-y-1">
                {result.unpriced.map(u => (
                  <li key={u.studentId} className="text-[11px] text-[#A93232] leading-snug">
                    <strong>{u.name}</strong> — {u.reason}
                  </li>
                ))}
              </ul>
              <p className="text-[10.5px] text-[#A93232] mt-1.5 leading-snug">
                They are in the group, but nothing will bill them until a published structure
                covers their grade.
              </p>
            </div>
          )}
          <div className="flex justify-end mt-4">
            <Btn tone="dark" onClick={() => setResult(null)}>Done</Btn>
          </div>
        </ModalShell>
      )}
    </div>
  )
}

function AssignSheet({
  bundle, yearId, roster, studentIds, onClose, onDone,
}: {
  bundle: FeeConfigBundle
  yearId: string
  roster: RosterStudent[]
  studentIds: string[]
  onClose: () => void
  onDone: (r: ReassignResult) => Promise<void>
}) {
  const [groupId, setGroupId] = useState(bundle.groups[0]?.id ?? '')
  const [prorate, setProrate] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const group = bundle.groups.find(g => g.id === groupId)
  const withProfiles = roster.filter(
    r => studentIds.includes(r.student_id) && r.profile_id).length

  // What the chosen group can actually price, so an empty group is visible
  // before the button is pressed rather than in the failure list after.
  const structures = bundle.structures.filter(
    s => s.fee_group_id === groupId && s.status === 'published')

  return (
    <ModalShell
      onClose={onClose} sharp size="sm"
      title={`Assign ${studentIds.length} student${studentIds.length === 1 ? '' : 's'}`}
      icon={<Users size={15} />} iconClassName="bg-[#F4F1E7] text-[#6B675A]"
      footer={
        <div className="flex items-center justify-end gap-2">
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn tone="dark" disabled={busy || !groupId}
               onClick={async () => {
                 setBusy(true); setError(null)
                 try {
                   const r = await reassignGroup({
                     academicYearId: yearId,
                     studentIds,
                     feeGroupId: groupId,
                     isRte: group?.is_rte ?? false,
                     prorateFrom: prorate || null,
                     note: note.trim() || null,
                     bundle,
                     roster,
                   })
                   await onDone(r)
                 } catch (e) {
                   setError(e instanceof Error ? e.message : 'Could not assign those students.')
                 } finally { setBusy(false) }
               }}>
            {busy && <Loader2 size={12} className="animate-spin" />} Assign
          </Btn>
        </div>
      }
    >
      <div className="space-y-3">
        <label className="block">
          <span className={ADMIN.label}>Fee group</span>
          <select value={groupId} onChange={e => setGroupId(e.target.value)}
                  className={`${ADMIN.inputPlain} mt-1`}>
            {bundle.groups.map(g => (
              <option key={g.id} value={g.id}>
                {g.name}{g.is_default ? ' · default' : ''}{g.is_rte ? ' · bills nothing' : ''}
              </option>
            ))}
          </select>
        </label>

        {group?.is_rte && (
          <Notice tone="info">
            {group.name} bills nothing. These students still get a fee profile — the RTE register
            needs one to hang off, and a student without one is invisible to every fee screen.
          </Notice>
        )}

        {structures.length === 0 && !group?.is_rte && (
          <Notice tone="warn">
            {group?.name ?? 'That group'} has no published structure. Students will fall back to
            the default group&rsquo;s prices, or go unpriced if it has none either.
          </Notice>
        )}

        <label className="block">
          <span className={ADMIN.label}>Charge only from</span>
          <input type="date" value={prorate} onChange={e => setProrate(e.target.value)}
                 className={`${ADMIN.inputPlain} mt-1`} />
          <p className="mt-1 text-[10.5px] text-[#8C8878] leading-snug">
            For a mid-year joiner. Leave blank to charge the whole session.
          </p>
        </label>

        <label className="block">
          <span className={ADMIN.label}>Note</span>
          <input value={note} onChange={e => setNote(e.target.value)}
                 placeholder="Second child; staff ward from June"
                 className={`${ADMIN.inputPlain} mt-1`} />
        </label>

        {withProfiles > 0 && (
          <Notice tone="warn">
            {withProfiles} of them already {withProfiles === 1 ? 'has' : 'have'} a fee profile and
            will be re-priced onto this group&rsquo;s structure. Bills already issued stay as they
            are — this decides what the next one costs.
          </Notice>
        )}

        {error && (
          <div className="flex items-start gap-2 p-2.5 bg-[#FCECEC] border border-[#EFCCCC]">
            <AlertTriangle size={12} className="text-[#A93232] mt-0.5 flex-shrink-0" />
            <p className="text-[11px] text-[#A93232]">{error}</p>
          </div>
        )}
      </div>
    </ModalShell>
  )
}
