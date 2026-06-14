'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { Loader2 } from 'lucide-react'
import {
  fetchPeriodSlots, fetchUnavailability, addUnavailability, removeUnavailability,
  WEEKDAY_LABELS,
} from '@/lib/timetable'
import type { PeriodSlot, TeacherUnavailability, TimetableConfig, Weekday } from '@/lib/timetable'
import { fetchAllProfiles } from '@/lib/admin'
import { isStaffRole } from '@/lib/supabase'
import type { UserProfile } from '@/lib/supabase'

const input =
  'border border-slate-300 rounded-lg bg-white px-3 py-2 text-sm focus:outline-none focus:border-slate-800 transition-colors'

export default function AvailabilityTab({ config }: { config: TimetableConfig }) {
  const [teachers, setTeachers] = useState<UserProfile[]>([])
  const [teacherId, setTeacherId] = useState('')
  const [slots, setSlots] = useState<PeriodSlot[]>([])
  const [blocks, setBlocks] = useState<TeacherUnavailability[]>([])
  const [loading, setLoading] = useState(true)
  const [busyKey, setBusyKey] = useState<string | null>(null)

  const days = config.working_days

  const loadRefs = useCallback(async () => {
    setLoading(true)
    const [profiles, periodSlots, unavail] = await Promise.all([
      fetchAllProfiles(),
      fetchPeriodSlots(config.id),
      fetchUnavailability(config.id),
    ])
    setTeachers(profiles.filter((p) => isStaffRole(p.role)))
    setSlots(periodSlots.filter((s) => !s.is_break))
    setBlocks(unavail)
    setLoading(false)
  }, [config.id])

  useEffect(() => {
    loadRefs()
  }, [loadRefs])

  const blockFor = (day: Weekday, slotId: string) =>
    blocks.find((b) => b.teacher_id === teacherId && b.day === day && b.slot_id === slotId)

  const toggle = async (day: Weekday, slotId: string) => {
    if (!teacherId) return
    const key = `${day}-${slotId}`
    setBusyKey(key)
    const existing = blockFor(day, slotId)
    if (existing) {
      await removeUnavailability(existing.id)
      setBlocks((prev) => prev.filter((b) => b.id !== existing.id))
    } else {
      const created = await addUnavailability({
        config_id: config.id,
        teacher_id: teacherId,
        day,
        slot_id: slotId,
      })
      if (created) setBlocks((prev) => [...prev, created])
    }
    setBusyKey(null)
  }

  return (
    <div className="space-y-4">
      <section className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
        <h3 className="font-semibold text-slate-800 mb-1">Teacher availability</h3>
        <p className="text-xs text-slate-500 mb-3">
          Pick a teacher and tap any period to mark them <strong>unavailable</strong>. The generator
          will never schedule a blocked teacher into those periods.
        </p>

        <select className={`${input} max-w-xs`} value={teacherId} onChange={(e) => setTeacherId(e.target.value)}>
          <option value="">Select a teacher…</option>
          {teachers.map((t) => (
            <option key={t.id} value={t.id}>{t.full_name}</option>
          ))}
        </select>
      </section>

      {loading ? (
        <div className="flex justify-center py-10 text-slate-400">
          <Loader2 className="animate-spin" size={20} />
        </div>
      ) : !teacherId ? null : slots.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-8 text-center text-slate-500 text-sm">
          Add teaching period slots in the <strong>Setup</strong> tab first.
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-3 overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className="p-2 text-left text-xs font-medium text-slate-400">Period</th>
                {days.map((d) => (
                  <th key={d} className="p-2 text-center text-xs font-medium text-slate-500">
                    {WEEKDAY_LABELS[d].slice(0, 3)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {slots.map((s) => (
                <tr key={s.id}>
                  <td className="p-2 text-xs text-slate-500 whitespace-nowrap">
                    {s.label} <span className="text-slate-300">·</span> {s.start_time.slice(0, 5)}
                  </td>
                  {days.map((d) => {
                    const blocked = !!blockFor(d, s.id)
                    const key = `${d}-${s.id}`
                    return (
                      <td key={d} className="p-1">
                        <button
                          onClick={() => toggle(d, s.id)}
                          disabled={busyKey === key}
                          className={`w-full h-9 rounded-md text-xs font-medium transition-colors ${
                            blocked
                              ? 'bg-rose-100 text-rose-700 hover:bg-rose-200'
                              : 'bg-slate-50 text-slate-300 hover:bg-slate-100'
                          }`}
                        >
                          {busyKey === key ? '…' : blocked ? 'Blocked' : '—'}
                        </button>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
