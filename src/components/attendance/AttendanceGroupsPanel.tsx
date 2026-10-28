'use client'

// ─────────────────────────────────────────────────────────────────────────────
// Attendance groups — one panel per half of Attendance Rules.
//
//   Staff     — named sets of people ("Primary teachers", "Office"), built by
//               picking people or pulling in a whole teacher team.
//   Students  — named sets of homerooms ("Pre-primary", "Grades 9–12"), so a
//               student follows their class in and out of a group.
//
// A group is what a holiday calendar is given to, so each part of the school
// can keep its own days off.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useMemo, useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import { Check, Layers, Loader2, Pencil, Plus, Trash2, Users, X } from 'lucide-react'
import ModalShell from '@/components/ui/ModalShell'
import { AX, EmptyLine, Field, Panel, SearchField } from '@/components/admin/ui'
import { UserProfile } from '@/lib/supabase'
import { Homeroom } from '@/lib/homerooms'
import { fetchTeamStaffById } from '@/lib/teams'
import {
  AttendanceAudience, AttendanceGroup, deleteAttendanceGroup, saveAttendanceGroup,
} from '@/lib/attendanceCalendars'

interface Props {
  audience: AttendanceAudience
  groups: AttendanceGroup[]
  viewerId: string
  /** Staff groups: the people that can be added. */
  staff?: UserProfile[]
  /** Staff groups: teams whose members can be pulled in at once. */
  teams?: { id: string; name: string }[]
  /** Student groups: the homerooms that can be added. */
  homerooms?: Homeroom[]
  onChanged: () => void
}

export default function AttendanceGroupsPanel({ audience, groups, viewerId, staff = [], teams = [], homerooms = [], onChanged }: Props) {
  const [editing, setEditing] = useState<AttendanceGroup | 'new' | null>(null)
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const staffById = useMemo(() => new Map(staff.map(s => [s.id, s])), [staff])
  const homeroomById = useMemo(() => new Map(homerooms.map(h => [h.id, h])), [homerooms])
  const isStaff = audience === 'staff'

  async function handleDelete(g: AttendanceGroup) {
    setDeletingId(g.id)
    const ok = await deleteAttendanceGroup(audience, g.id, viewerId)
    setDeletingId(null); setConfirmingId(null)
    if (ok) onChanged()
  }

  function memberSummary(g: AttendanceGroup): string {
    const names = g.member_ids
      .map(id => isStaff ? staffById.get(id)?.full_name : homeroomById.get(id)?.name)
      .filter((n): n is string => !!n)
    const noun = isStaff ? (g.member_ids.length === 1 ? 'person' : 'people') : (g.member_ids.length === 1 ? 'class' : 'classes')
    if (names.length === 0) return `No ${isStaff ? 'people' : 'classes'} yet`
    const shown = names.slice(0, 3).join(', ')
    return `${g.member_ids.length} ${noun} · ${shown}${names.length > 3 ? ` +${names.length - 3}` : ''}`
  }

  return (
    <Panel
      icon={Layers}
      title={isStaff ? 'Staff groups' : 'Student groups'}
      className="h-full"
      description={isStaff
        ? 'Divide the staff into groups, so each can keep its own holiday calendar. One person can sit in several.'
        : 'Divide the classes into groups (by wing, grade band or shift), so each can keep its own holiday calendar.'}
    >
      {groups.length === 0 ? (
        <EmptyLine icon={Layers} fill>No groups yet. Without groups, a calendar covers {isStaff ? 'all staff' : 'every class'}.</EmptyLine>
      ) : (
        <ul className="flex-1 space-y-1.5 max-h-80 overflow-y-auto overscroll-contain pr-0.5">
          {groups.map(g => (
            <li key={g.id} className={`${AX.row} !items-start`}>
              <span className="mt-0.5 text-[#B8983C] flex-shrink-0"><Users size={14} /></span>
              <div className="flex-1 min-w-0">
                <p className="text-[13.5px] font-semibold text-[#18181B] truncate">{g.name}</p>
                <p className="text-[12px] text-[#71717A] leading-snug break-words">{memberSummary(g)}</p>
              </div>
              {confirmingId === g.id ? (
                <div className="flex items-center gap-1 -my-1 -mr-1.5">
                  <button onClick={() => handleDelete(g)} disabled={deletingId === g.id} className={`${AX.ghost} !h-8`}>
                    {deletingId === g.id ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />} Delete
                  </button>
                  <button onClick={() => setConfirmingId(null)} aria-label="Keep group" className={AX.icon}><X size={14} /></button>
                </div>
              ) : (
                <div className="flex items-center -my-1 -mr-1.5">
                  <button onClick={() => setEditing(g)} aria-label={`Edit ${g.name}`} className={AX.icon}><Pencil size={13} /></button>
                  <button onClick={() => setConfirmingId(g.id)} aria-label={`Delete ${g.name}`} className={AX.iconDanger}><Trash2 size={14} /></button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      <button
        onClick={() => setEditing('new')}
        className="mt-2 w-full inline-flex items-center justify-center gap-1.5 h-9 rounded-lg text-[13px] font-semibold text-[#27272A] hover:bg-[#F5F5F5] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B8983C]/60"
      >
        <Plus size={14} /> Add group
      </button>

      <AnimatePresence>
        {editing && (
          <GroupModal
            key="group-modal"
            audience={audience}
            group={editing === 'new' ? null : editing}
            viewerId={viewerId}
            staff={staff}
            teams={teams}
            homerooms={homerooms}
            onClose={() => setEditing(null)}
            onSaved={() => { setEditing(null); onChanged() }}
          />
        )}
      </AnimatePresence>
    </Panel>
  )
}

function GroupModal({ audience, group, viewerId, staff, teams, homerooms, onClose, onSaved }: {
  audience: AttendanceAudience
  group: AttendanceGroup | null
  viewerId: string
  staff: UserProfile[]
  teams: { id: string; name: string }[]
  homerooms: Homeroom[]
  onClose: () => void
  onSaved: () => void
}) {
  const isStaff = audience === 'staff'
  const [name, setName] = useState(group?.name ?? '')
  const [description, setDescription] = useState(group?.description ?? '')
  const [selected, setSelected] = useState<Set<string>>(new Set(group?.member_ids ?? []))
  const [query, setQuery] = useState('')
  const [teamLoading, setTeamLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const toggle = (id: string) => setSelected(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })

  async function addTeam(teamId: string) {
    if (!teamId) return
    setTeamLoading(true)
    const members = await fetchTeamStaffById(teamId)
    setSelected(prev => new Set([...prev, ...members.filter(m => !m.attendance_hidden).map(m => m.id)]))
    setTeamLoading(false)
  }

  const filteredStaff = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = q ? staff.filter(s => s.full_name.toLowerCase().includes(q) || (s.email ?? '').toLowerCase().includes(q)) : staff
    // Members first, so what the group holds is visible without scrolling.
    return [...list].sort((a, b) => Number(selected.has(b.id)) - Number(selected.has(a.id)) || a.full_name.localeCompare(b.full_name))
  }, [staff, query, selected])

  // Homerooms by grade, so a whole grade can be picked at once.
  const homeroomsByGrade = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = q ? homerooms.filter(h => h.name.toLowerCase().includes(q)) : homerooms
    const map = new Map<string, Homeroom[]>()
    for (const h of list) {
      const key = h.grade == null ? 'Other' : `Grade ${h.grade}`
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(h)
    }
    return [...map.entries()]
  }, [homerooms, query])

  async function handleSave() {
    setError(null)
    if (!name.trim()) { setError('Give the group a name.'); return }
    setSaving(true)
    const id = await saveAttendanceGroup(audience, { id: group?.id, name, description, member_ids: [...selected] }, viewerId)
    setSaving(false)
    if (!id) { setError('Could not save the group. Please try again.'); return }
    onSaved()
  }

  return (
    <ModalShell
      onClose={onClose}
      sharp size="lg"
      title={group ? 'Edit group' : `New ${isStaff ? 'staff' : 'student'} group`}
      subtitle={isStaff ? 'Pick people, or pull in a whole team' : 'Pick classes, or a whole grade'}
      icon={<Layers size={15} />}
      iconClassName="bg-[#27272A] text-[#B8983C]"
      minHClass="sm:min-h-[34rem]"
      footer={
        <div className="flex items-center gap-2">
          {error && <p className="flex-1 text-[12.5px] text-[#B42318]">{error}</p>}
          <span className={`${error ? '' : 'flex-1'} text-[12px] text-[#71717A] tabular-nums`}>
            {selected.size} {isStaff ? (selected.size === 1 ? 'person' : 'people') : (selected.size === 1 ? 'class' : 'classes')}
          </span>
          <button onClick={onClose} className={AX.ghost}>Cancel</button>
          <button onClick={handleSave} disabled={saving} className={AX.primary}>
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Save group
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Name">
            <input value={name} onChange={e => setName(e.target.value)} placeholder={isStaff ? 'e.g. Primary teachers' : 'e.g. Pre-primary'} className={AX.field} autoFocus />
          </Field>
          <Field label="Note (optional)">
            <input value={description} onChange={e => setDescription(e.target.value)} placeholder="Who this group is for" className={AX.field} />
          </Field>
        </div>

        <div className="flex flex-col sm:flex-row gap-2">
          <div className="flex-1"><SearchField value={query} onChange={setQuery} placeholder={isStaff ? 'Search staff' : 'Search classes'} /></div>
          {isStaff && teams.length > 0 && (
            <select
              value=""
              onChange={e => addTeam(e.target.value)}
              disabled={teamLoading}
              className={`${AX.field} sm:!w-52`}
              aria-label="Add a whole team"
            >
              <option value="">{teamLoading ? 'Adding…' : 'Add a whole team…'}</option>
              {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          )}
        </div>

        {isStaff ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            {filteredStaff.length === 0 ? (
              <div className="sm:col-span-2"><EmptyLine icon={Users}>No staff match your search.</EmptyLine></div>
            ) : filteredStaff.map(s => (
              <CheckRow key={s.id} checked={selected.has(s.id)} onToggle={() => toggle(s.id)} title={s.full_name} detail={s.role} />
            ))}
          </div>
        ) : homeroomsByGrade.length === 0 ? (
          <EmptyLine icon={Users}>{homerooms.length === 0 ? 'No homerooms set up yet.' : 'No classes match your search.'}</EmptyLine>
        ) : (
          <div className="space-y-3">
            {homeroomsByGrade.map(([grade, list]) => {
              const all = list.every(h => selected.has(h.id))
              return (
                <div key={grade}>
                  <div className="flex items-center justify-between mb-1.5">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-[#71717A]">{grade}</p>
                    <button
                      onClick={() => setSelected(prev => {
                        const next = new Set(prev)
                        for (const h of list) { if (all) next.delete(h.id); else next.add(h.id) }
                        return next
                      })}
                      className="text-[12px] font-semibold text-[#8A6F22] hover:underline"
                    >
                      {all ? 'Clear grade' : 'Whole grade'}
                    </button>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                    {list.map(h => (
                      <CheckRow key={h.id} checked={selected.has(h.id)} onToggle={() => toggle(h.id)} title={h.name} detail={h.section ? `Section ${h.section}` : undefined} />
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </ModalShell>
  )
}

function CheckRow({ checked, onToggle, title, detail }: { checked: boolean; onToggle: () => void; title: string; detail?: string }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      onClick={onToggle}
      className={`flex items-center gap-2.5 px-3 py-2 rounded-lg border text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B8983C]/60 ${
        checked ? 'bg-[#27272A] border-[#27272A] text-white' : 'bg-white border-[#E4E4E7] text-[#18181B] hover:border-[#A1A1AA]'
      }`}
    >
      <span className={`w-4 h-4 rounded flex items-center justify-center flex-shrink-0 border ${checked ? 'bg-[#B8983C] border-[#B8983C]' : 'border-[#D4D4D8]'}`}>
        {checked && <Check size={11} className="text-[#18181B]" strokeWidth={3} />}
      </span>
      <span className="min-w-0">
        <span className="block text-[13px] font-medium truncate">{title}</span>
        {detail && <span className={`block text-[11px] capitalize truncate ${checked ? 'text-zinc-400' : 'text-[#71717A]'}`}>{detail}</span>}
      </span>
    </button>
  )
}
