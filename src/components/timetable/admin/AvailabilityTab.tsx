'use client'

import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { Loader2, Check, Ban, Users } from 'lucide-react'
import {
  fetchPeriodSlots, fetchUnavailability, addUnavailability, removeUnavailability,
  WEEKDAY_LABELS,
} from '@/lib/timetable'
import type { PeriodSlot, TeacherUnavailability, TimetableConfig, Weekday } from '@/lib/timetable'
import { fetchAllProfiles } from '@/lib/admin'
import { isStaffRole } from '@/lib/supabase'
import type { UserProfile } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { PANEL, PANEL_PAD, SmartSelect, SECTION_LABEL } from '../ui'
import type { SmartOption } from '../ui'

export default function AvailabilityTab({ config }: { config: TimetableConfig }) {
  const { profile } = useAuth()
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

  // Default the selected member to the current admin/staff user, else first staff.
  useEffect(() => {
    if (teacherId || teachers.length === 0) return
    const mine = profile && teachers.some((t) => t.id === profile.id) ? profile.id : null
    setTeacherId(mine ?? teachers[0].id)
  }, [teachers, profile, teacherId])

  const teacherOptions: SmartOption[] = useMemo(
    () =>
      teachers.map((t) => ({
        value: t.id,
        label: t.full_name + (profile?.id === t.id ? ' (you)' : ''),
        sublabel: t.email,
        badge: t.role,
      })),
    [teachers, profile],
  )

  const blockFor = (day: Weekday, slotId: string) =>
    blocks.find((b) => b.teacher_id === teacherId && b.day === day && b.slot_id === slotId)

  const blockedCount = useMemo(
    () => blocks.filter((b) => b.teacher_id === teacherId).length,
    [blocks, teacherId],
  )

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
      {/* Member toolbar */}
      <section className={`${PANEL} px-3 sm:px-4 py-3`}>
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="flex items-center gap-2 flex-shrink-0">
            <Users size={16} className="text-slate-400" />
            <span className={SECTION_LABEL}>Staff member</span>
          </div>
          <div className="sm:w-80">
            <SmartSelect
              options={teacherOptions}
              value={teacherId}
              onChange={setTeacherId}
              placeholder="Select staff…"
              searchPlaceholder="Search staff by name or email…"
            />
          </div>
          <div className="sm:ml-auto text-xs text-slate-500">
            {blockedCount > 0 ? (
              <span className="inline-flex items-center gap-1.5 text-rose-600 font-medium">
                <Ban size={13} /> {blockedCount} blocked period{blockedCount === 1 ? '' : 's'}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-emerald-600 font-medium">
                <Check size={13} /> Fully available
              </span>
            )}
          </div>
        </div>
        <p className="text-xs text-slate-500 mt-2.5">
          Tap any period to mark this member <strong>unavailable</strong>. The generator will never
          schedule them into blocked periods.
        </p>
      </section>

      {/* Week calendar */}
      {loading ? (
        <div className="flex justify-center py-10 text-slate-400">
          <Loader2 className="animate-spin" size={20} />
        </div>
      ) : slots.length === 0 ? (
        <div className={`${PANEL} p-8 text-center text-slate-500 text-sm`}>
          Add teaching period slots in the <strong>Setup</strong> tab first.
        </div>
      ) : (
        <div className={`${PANEL} p-2 sm:p-3 overflow-x-auto`}>
          <table className="w-full border-collapse text-sm min-w-[34rem]">
            <thead>
              <tr>
                <th className="p-2 text-left text-xs font-semibold text-slate-400 sticky left-0 bg-white z-10">Period</th>
                {days.map((d) => (
                  <th key={d} className="p-2 text-center text-xs font-semibold text-slate-600">
                    <span className="hidden sm:inline">{WEEKDAY_LABELS[d]}</span>
                    <span className="sm:hidden">{WEEKDAY_LABELS[d].slice(0, 3)}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {slots.map((s) => (
                <tr key={s.id}>
                  <td className="p-2 text-xs text-slate-500 whitespace-nowrap sticky left-0 bg-white z-10 border-t border-slate-100">
                    <div className="font-medium text-slate-600">{s.label}</div>
                    <div className="tabular-nums text-slate-400">{s.start_time.slice(0, 5)}</div>
                  </td>
                  {days.map((d) => {
                    const blocked = !!blockFor(d, s.id)
                    const key = `${d}-${s.id}`
                    return (
                      <td key={d} className="p-1 border-t border-slate-100">
                        <button
                          onClick={() => toggle(d, s.id)}
                          disabled={busyKey === key || !teacherId}
                          className={`w-full h-10 rounded-lg text-xs font-medium transition-colors flex items-center justify-center gap-1 ${
                            blocked
                              ? 'bg-rose-100 text-rose-700 hover:bg-rose-200'
                              : 'bg-emerald-50/70 text-emerald-600/70 hover:bg-emerald-100'
                          }`}
                        >
                          {busyKey === key ? (
                            <Loader2 size={13} className="animate-spin" />
                          ) : blocked ? (
                            <><Ban size={12} /> Blocked</>
                          ) : (
                            <Check size={13} />
                          )}
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
