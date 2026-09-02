'use client'

import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { Search, EyeOff } from 'lucide-react'
import { UserProfile, getDisplayRole } from '@/lib/supabase'
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
    <div className="border-t border-[#E4E4E7] pt-5 mt-5">
      <p className="text-[10px] font-bold uppercase tracking-widest text-[#525252] mb-3">Salary App Visibility</p>
      <p className="text-xs text-[#71717A] mb-3">
        Everyone eligible (including admins) appears in the Salary app&apos;s member lists and payroll counts by
        default. Hide individuals who aren&apos;t actually on payroll ({hiddenCount} hidden).
      </p>
      <div className="relative mb-3">
        <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#71717A]" />
        <input type="text" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search staff, drivers or support staff…"
          className="w-full pl-9 pr-3 py-2 text-sm border border-[#D4D4D8] focus:outline-none focus:border-[#27272A] bg-white transition-colors" />
      </div>
      <div className="space-y-px max-h-80 overflow-y-auto">
        {loading ? (
          <p className="text-xs text-[#A1A1AA] py-3 text-center">Loading…</p>
        ) : filtered.length === 0 ? (
          <p className="text-xs text-[#A1A1AA] py-3 text-center">No one matches your search.</p>
        ) : filtered.map(p => {
          const isHidden = hidden.has(p.id)
          return (
            <div key={p.id} className="flex items-center gap-3 px-3 py-2.5 bg-[#F5F5F5] border border-[#E4E4E7]">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-[#18181B] truncate">{p.full_name}</p>
                <p className="text-[11px] text-[#71717A] truncate">
                  {isSupportMember(p) ? (p.designation || 'Support Staff') : `${getDisplayRole(p)} · ${p.email}`}
                </p>
              </div>
              {isHidden && <EyeOff size={14} className="text-rose-500 flex-shrink-0" />}
              <button
                role="switch" aria-checked={isHidden} disabled={saving === p.id}
                onClick={() => handleToggleHidden(p)}
                title={isHidden ? 'Hidden from the Salary app' : 'Visible in the Salary app'}
                className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer border-2 border-transparent transition-colors focus:outline-none disabled:opacity-50 ${isHidden ? 'bg-[#27272A]' : 'bg-[#D4D4D8]'}`}
              >
                <span className={`pointer-events-none inline-block h-5 w-5 transform bg-white shadow transition duration-200 ${isHidden ? 'translate-x-5' : 'translate-x-0'}`} />
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
