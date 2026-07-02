'use client'

import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { Plus, Trash2, Loader2, Users, X, UserPlus } from 'lucide-react'
import {
  fetchGroupsForHomeroom, createGroup, deleteGroup,
  addGroupMemberByEmail, removeGroupMember, fetchSubjects,
} from '@/lib/timetable'
import type { HomeroomGroup, HomeroomGroupKind, Subject } from '@/lib/timetable'
import { fetchAllHomerooms } from '@/lib/homerooms'
import type { Homeroom } from '@/lib/homerooms'
import { INPUT, BTN_PRIMARY, Section, Field, SmartSelect } from '../ui'
import type { SmartOption } from '../ui'
import NameLink from '../NameLink'

const GROUP_COLORS = ['#2563eb', '#059669', '#d97706', '#7c3aed', '#db2777', '#0891b2', '#dc2626', '#65a30d']

// Divide a homeroom into named groups — subject-filtered (e.g. Biology vs
// Computer students) or custom — and add students to each by email.
export default function GroupsTab() {
  const [homerooms, setHomerooms] = useState<Homeroom[]>([])
  const [subjects, setSubjects] = useState<Subject[]>([])
  const [homeroomId, setHomeroomId] = useState('')
  const [groups, setGroups] = useState<HomeroomGroup[]>([])
  const [loadingRefs, setLoadingRefs] = useState(true)
  const [loadingGroups, setLoadingGroups] = useState(false)

  // New-group form
  const [name, setName] = useState('')
  const [kind, setKind] = useState<HomeroomGroupKind>('custom')
  const [subjectId, setSubjectId] = useState('')
  const [color, setColor] = useState(GROUP_COLORS[0])
  const [adding, setAdding] = useState(false)

  const loadRefs = useCallback(async () => {
    setLoadingRefs(true)
    const [hr, subj] = await Promise.all([fetchAllHomerooms(), fetchSubjects()])
    setHomerooms(hr)
    setSubjects(subj)
    setLoadingRefs(false)
  }, [])

  const loadGroups = useCallback(async () => {
    if (!homeroomId) {
      setGroups([])
      return
    }
    setLoadingGroups(true)
    setGroups(await fetchGroupsForHomeroom(homeroomId))
    setLoadingGroups(false)
  }, [homeroomId])

  useEffect(() => {
    loadRefs()
  }, [loadRefs])

  useEffect(() => {
    loadGroups()
  }, [loadGroups])

  const homeroomOptions: SmartOption[] = useMemo(
    () => homerooms.map((h) => ({ value: h.id, label: h.name })),
    [homerooms],
  )
  const subjectOptions: SmartOption[] = useMemo(
    () => subjects.map((s) => ({ value: s.id, label: s.name, color: s.color ?? undefined })),
    [subjects],
  )

  const handleAdd = async () => {
    if (!homeroomId || !name.trim()) return
    setAdding(true)
    const created = await createGroup({
      homeroom_id: homeroomId,
      name: name.trim(),
      kind,
      subject_id: kind === 'subject' ? subjectId || null : null,
      color,
    })
    setAdding(false)
    if (created) {
      setName('')
      setSubjectId('')
      setKind('custom')
      setColor(GROUP_COLORS[(groups.length + 1) % GROUP_COLORS.length])
      loadGroups()
    }
  }

  return (
    <div>
      <Section
        title="Homeroom groups"
        hint="Split a class into groups — subject-filtered (Biology vs Computer) or custom-named — then add students by email. Groups become the targeting unit for split classes."
        first
      >
        <Field label="Class">
          <SmartSelect
            options={homeroomOptions}
            value={homeroomId}
            onChange={setHomeroomId}
            placeholder={loadingRefs ? 'Loading…' : 'Select a class…'}
            searchPlaceholder="Search classes…"
          />
        </Field>
      </Section>

      {homeroomId && (
        <>
          {/* New group */}
          <Section title="Add a group">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 items-end">
              <Field label="Group name">
                <input className={INPUT} placeholder="e.g. Biology / Group A" value={name} onChange={(e) => setName(e.target.value)} />
              </Field>
              <Field label="Type">
                <select className={INPUT} value={kind} onChange={(e) => setKind(e.target.value as HomeroomGroupKind)}>
                  <option value="custom">Custom</option>
                  <option value="subject">Subject-based</option>
                </select>
              </Field>
              {kind === 'subject' ? (
                <Field label="Subject">
                  <SmartSelect options={subjectOptions} value={subjectId} onChange={setSubjectId} placeholder="Select subject…" searchPlaceholder="Search subjects…" allowClear />
                </Field>
              ) : (
                <div />
              )}
              <Field label="Colour">
                <div className="flex gap-1 flex-wrap pt-1">
                  {GROUP_COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setColor(c)}
                      className={`w-6 h-6 border-2 ${color === c ? 'border-[#18181B]' : 'border-transparent'}`}
                      style={{ background: c }}
                    />
                  ))}
                </div>
              </Field>
            </div>
            <button onClick={handleAdd} disabled={adding || !name.trim()} className={`${BTN_PRIMARY} mt-3`}>
              {adding ? <Loader2 className="animate-spin" size={15} /> : <Plus size={15} />}
              Add group
            </button>
          </Section>

          {/* Existing groups */}
          <Section title="Groups">
            {loadingGroups ? (
              <div className="flex justify-center py-8 text-[#A1A1AA]">
                <Loader2 className="animate-spin" size={20} />
              </div>
            ) : groups.length === 0 ? (
              <p className="text-xs text-[#A1A1AA] py-2">No groups yet for this class.</p>
            ) : (
              <div className="grid gap-4 lg:grid-cols-2">
                {groups.map((g) => (
                  <GroupCard key={g.id} group={g} onChanged={loadGroups} />
                ))}
              </div>
            )}
          </Section>
        </>
      )}
    </div>
  )
}

// ── One group card: header + members + add-by-email ──────────

function GroupCard({ group, onChanged }: { group: HomeroomGroup; onChanged: () => void }) {
  const [emails, setEmails] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ added: number; failed: string[] } | null>(null)

  const members = group.members ?? []

  const handleAdd = async () => {
    const list = emails
      .split(/[\s,;]+/)
      .map((e) => e.trim())
      .filter(Boolean)
    if (list.length === 0) return
    setBusy(true)
    setResult(null)
    let added = 0
    const failed: string[] = []
    for (const email of list) {
      const res = await addGroupMemberByEmail(group.id, email)
      if (res.success) added++
      else failed.push(`${email} (${res.error})`)
    }
    setBusy(false)
    setResult({ added, failed })
    setEmails('')
    onChanged()
  }

  return (
    <div className="border border-[#E4E4E7] bg-white">
      <div className="flex items-center gap-2.5 px-3 py-2 border-b border-[#E4E4E7] bg-[#FAFAF9]">
        <span className="w-3 h-3 flex-shrink-0" style={{ background: group.color ?? '#94a3b8' }} />
        <span className="font-semibold text-sm text-[#18181B] flex-1 truncate">{group.name}</span>
        {group.kind === 'subject' && group.subject && (
          <span className="text-[10px] px-1.5 py-0.5 bg-white border border-[#E4E4E7] text-[#71717A]">{group.subject.name}</span>
        )}
        <span className="text-[11px] text-[#71717A] flex items-center gap-1">
          <Users size={12} /> {members.length}
        </span>
        <button
          onClick={async () => {
            if (confirm(`Delete group "${group.name}"?`)) {
              await deleteGroup(group.id)
              onChanged()
            }
          }}
          className="text-[#D4D4D8] hover:text-rose-500 transition-colors flex-shrink-0"
        >
          <Trash2 size={14} />
        </button>
      </div>

      {/* Members */}
      <div className="p-3 space-y-px">
        {members.length === 0 ? (
          <p className="text-xs text-[#A1A1AA] py-1">No students yet.</p>
        ) : (
          members.map((m) => (
            <div key={m.id} className="flex items-center gap-2 px-2 py-1.5 bg-[#F5F5F5] border border-[#E4E4E7] text-sm">
              <NameLink
                kind="student"
                id={m.student_id}
                name={m.student?.full_name ?? m.student?.email ?? 'Student'}
                className="flex-1 min-w-0 truncate text-[#18181B]"
              />
              <button
                onClick={async () => {
                  await removeGroupMember(group.id, m.student_id)
                  onChanged()
                }}
                className="text-[#D4D4D8] hover:text-rose-500 transition-colors flex-shrink-0"
              >
                <X size={14} />
              </button>
            </div>
          ))
        )}
      </div>

      {/* Add by email */}
      <div className="p-3 pt-0">
        <textarea
          className={`${INPUT} w-full h-16 resize-none`}
          placeholder="Add students by email (comma, space or newline separated)…"
          value={emails}
          onChange={(e) => setEmails(e.target.value)}
        />
        {result && (
          <div className="mt-1.5 text-xs">
            {result.added > 0 && <p className="text-emerald-600">Added {result.added} student{result.added > 1 ? 's' : ''}.</p>}
            {result.failed.length > 0 && (
              <ul className="text-rose-600 list-disc list-inside">
                {result.failed.map((f, i) => (
                  <li key={i} className="truncate">{f}</li>
                ))}
              </ul>
            )}
          </div>
        )}
        <button onClick={handleAdd} disabled={busy || !emails.trim()} className={`${BTN_PRIMARY} mt-2`}>
          {busy ? <Loader2 className="animate-spin" size={14} /> : <UserPlus size={14} />}
          Add students
        </button>
      </div>
    </div>
  )
}
