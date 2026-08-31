'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { Users, Check } from 'lucide-react'
import Avatar from '@/components/Avatar'
import { getDisplayRole, UserProfile } from '@/lib/supabase'
import { fetchAllSalaryMembers, fetchHiddenSalaryMemberIds, saveHiddenSalaryMemberIds } from '@/lib/salary'

/**
 * Lets an admin keep specific staff/driver accounts off the Salary app's
 * member lists (Base Salaries, Bank Accounts) and payroll counts — e.g. an
 * admin account that isn't actually on payroll. Purely a visibility switch:
 * it doesn't touch that person's base salary, bank details, or any pay
 * cycle already run for them.
 */
export default function HiddenMembersSettings() {
  const [loading, setLoading] = useState(true)
  const [people, setPeople] = useState<UserProfile[]>([])
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const [members, hiddenIds] = await Promise.all([fetchAllSalaryMembers(), fetchHiddenSalaryMemberIds()])
    setPeople(members)
    setHidden(new Set(hiddenIds))
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const toggle = (id: string) => {
    setHidden(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
    setSaved(false)
  }

  const save = async () => {
    setSaving(true)
    const res = await saveHiddenSalaryMemberIds(Array.from(hidden))
    setSaving(false)
    if (res.success) { setSaved(true); setTimeout(() => setSaved(false), 2000) }
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
      <div className="flex items-center gap-2 mb-2">
        <div className="p-1.5 bg-slate-100 rounded-lg"><Users size={16} className="text-slate-600" /></div>
        <h2 className="font-semibold text-slate-800">Members shown in the Salary app</h2>
      </div>
      <p className="text-xs text-slate-500 mb-4 leading-relaxed">
        Untick someone to keep them off the Base Salaries and Bank Accounts lists (and the payroll counts) —
        for example, an admin account that isn&apos;t actually on payroll. This only changes visibility here;
        their base salary, bank details, and any pay cycle already run for them are untouched.
      </p>

      {loading ? (
        <p className="text-sm text-slate-400">Loading…</p>
      ) : people.length === 0 ? (
        <p className="text-sm text-slate-400">No staff or driver accounts yet.</p>
      ) : (
        <div className="space-y-0.5 max-h-80 overflow-y-auto pr-1 -mx-1">
          {people.map(p => (
            <label
              key={p.id}
              className="flex items-center gap-2.5 py-1.5 px-1 rounded-lg hover:bg-slate-50 cursor-pointer select-none"
            >
              <input
                type="checkbox"
                checked={!hidden.has(p.id)}
                onChange={() => toggle(p.id)}
                className="w-3.5 h-3.5 accent-slate-700 flex-shrink-0"
              />
              <Avatar avatarUrl={p.avatar_url} name={p.full_name} size={24} userId={p.id} />
              <span className="text-sm text-slate-700 truncate">{p.full_name}</span>
              <span className="text-xs text-slate-400 truncate">{getDisplayRole(p)}</span>
            </label>
          ))}
        </div>
      )}

      <button
        onClick={save}
        disabled={saving || loading}
        className="btn-primary text-sm mt-4 flex items-center gap-2 disabled:opacity-50"
      >
        {saved ? <><Check size={15} /> Saved</> : saving ? 'Saving…' : 'Save visibility'}
      </button>
    </div>
  )
}
