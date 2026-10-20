'use client'

import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { UserProfile, getDisplayRole } from '@/lib/supabase'
import { Chip, SearchField, Switch } from '@/components/salary/ui'
import { fetchAllSalaryMembers, fetchHiddenSalaryMemberIds, saveHiddenSalaryMemberIds } from '@/lib/salary'
import { SupportStaff, fetchSupportStaff } from '@/lib/supportStaff'

type Member = UserProfile | (SupportStaff & { email?: undefined; role?: undefined })

function isSupportMember(p: Member): p is SupportStaff & { email?: undefined; role?: undefined } {
  return !('role' in p) || p.role === undefined
}

/**
 * Lets an admin keep specific staff/driver/support staff off the Salary
 * app's member lists (Base Salaries, Bank Accounts) and payroll counts —
 * e.g. an admin account that isn't actually on payroll. Purely a visibility
 * switch: it doesn't touch that person's base salary, bank details, or any
 * pay cycle already run for them. Styled to match the Attendance Visibility
 * section on the same App Settings page.
 */
export default function HiddenMembersSettings() {
  const [loading, setLoading] = useState(true)
  const [people, setPeople] = useState<Member[]>([])
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const [query, setQuery] = useState('')
  const [saving, setSaving] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const [members, support, hiddenIds] = await Promise.all([
      fetchAllSalaryMembers(), fetchSupportStaff({ activeOnly: true }), fetchHiddenSalaryMemberIds(),
    ])
    setPeople([...members, ...support].sort((a, b) => a.full_name.localeCompare(b.full_name)))
    setHidden(new Set(hiddenIds))
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return people
    return people.filter(p => p.full_name.toLowerCase().includes(q) || (p.email ?? '').toLowerCase().includes(q))
  }, [people, query])

  const hiddenCount = hidden.size

  const handleToggleHidden = async (person: Member) => {
    setSaving(person.id)
    const next = new Set(hidden)
    if (next.has(person.id)) next.delete(person.id)
    else next.add(person.id)
    const res = await saveHiddenSalaryMemberIds(Array.from(next))
    if (res.success) setHidden(next)
    setSaving(null)
  }

  return (
    <div>
      <h3 className="text-[15px] font-semibold text-slate-900 leading-snug">Who appears in Salary</h3>
      <p className="text-[12.5px] text-slate-500 mt-0.5 mb-3 leading-relaxed">
        Everyone eligible shows up, admins included. Switch off anyone who is not actually on payroll.
        {hiddenCount > 0 && ` ${hiddenCount} hidden.`}
      </p>
      <SearchField value={query} onChange={setQuery} placeholder="Search staff, drivers or support staff" className="mb-2.5" />
      <div className="fx-card divide-y divide-[#EEEAE1] max-h-80 overflow-y-auto">
        {loading ? (
          <p className="text-[13px] text-slate-500 py-4 text-center">Loading…</p>
        ) : filtered.length === 0 ? (
          <p className="text-[13px] text-slate-500 py-4 text-center">Nobody matches.</p>
        ) : filtered.map(p => {
          const isHidden = hidden.has(p.id)
          return (
            <div key={p.id} className="flex items-center gap-3 px-3.5 py-2.5">
              <div className="flex-1 min-w-0">
                <p className="text-[13.5px] font-medium text-slate-900 break-words">{p.full_name}</p>
                <p className="text-[12px] text-slate-500 break-all">
                  {isSupportMember(p) ? (p.designation || 'Support staff') : `${getDisplayRole(p)} · ${p.email}`}
                </p>
              </div>
              {isHidden && <Chip tone="bad">Hidden</Chip>}
              <Switch
                checked={!isHidden}
                disabled={saving === p.id}
                onChange={() => handleToggleHidden(p)}
                label={isHidden ? `Show ${p.full_name} in Salary` : `Hide ${p.full_name} from Salary`}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}
