'use client'

import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { Loader2, Check, Ban } from 'lucide-react'
import {
  fetchPeriodSlots, fetchUnavailability, addUnavailability, removeUnavailability,
  WEEKDAY_LABELS,
} from '@/lib/timetable'
import type { PeriodSlot, TeacherUnavailability, TimetableConfig, Weekday } from '@/lib/timetable'
import { fetchAllProfiles } from '@/lib/admin'
import { isStaffRole } from '@/lib/supabase'
import type { UserProfile } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { SmartSelect, SECTION_LABEL } from '../ui'
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
    <div>
      {/* Member toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-4">
        <div className="flex items-center gap-2.5 flex-1 min-w-0">
          <span className={`${SECTION_LABEL} flex-shrink-0`}>Staff member</span>
          <div className="flex-1 min-w-0">
            <SmartSelect
              options={teacherOptions}
              value={teacherId}
              onChange={setTeacherId}
              placeholder="Select staff…"
              searchPlaceholder="Search staff by name or email…"
            />
          </div>
        </div>
        <div className="sm:flex-shrink-0 text-xs">
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
      <p className="text-xs text-[#71717A] mb-4">
        Tap any period to mark this member <strong>unavailable</strong>. The generator will never
        schedule them into blocked periods.
      </p>

      {/* Week calendar */}
      {loading ? (
        <div className="flex justify-center py-10 text-[#A1A1AA]">
          <Loader2 className="animate-spin" size={20} />
        </div>
      ) : slots.length === 0 ? (
        <p className="text-sm text-[#71717A] py-6 text-center">
          Add teaching period slots in the <strong>Setup</strong> tab first.
        </p>
      ) : (
        <div className="overflow-x-auto border border-[#D4D4D8]">
          <table className="w-full border-collapse text-sm min-w-[34rem] table-fixed">
            <colgroup>
              <col className="w-28" />
              {days.map((d) => <col key={d} />)}
            </colgroup>
            <thead>
              <tr className="bg-[#FAFAF9]">
                <th className="p-2 text-left text-[10px] font-bold uppercase tracking-widest text-[#525252] sticky left-0 bg-[#FAFAF9] z-10">Period</th>
                {days.map((d) => (
                  <th key={d} className="p-3 text-center text-[11px] font-semibold text-[#52525B] border-l border-[#E4E4E7]">
                    <span className="hidden sm:inline">{WEEKDAY_LABELS[d]}</span>
                    <span className="sm:hidden">{WEEKDAY_LABELS[d].slice(0, 3)}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {slots.map((s) => (
                <tr key={s.id}>
                  <td className="p-2 text-[11px] text-[#71717A] whitespace-nowrap sticky left-0 bg-white z-10 border-t border-[#E4E4E7]">
                    <div className="font-medium text-[#52525B]">{s.label}</div>
                    <div className="tabular-nums text-[#A1A1AA]">{s.start_time.slice(0, 5)}</div>
                  </td>
                  {days.map((d) => {
                    const blocked = !!blockFor(d, s.id)
                    const key = `${d}-${s.id}`
                    return (
                      <td key={d} className="p-1.5 border-t border-l border-[#E4E4E7]">
                        <button
                          onClick={() => toggle(d, s.id)}
                          disabled={busyKey === key || !teacherId}
                          className={`w-full h-12 text-xs font-medium transition-colors flex items-center justify-center gap-1.5 ${
                            blocked
                              ? 'bg-rose-100 text-rose-700 hover:bg-rose-200'
                              : 'bg-emerald-50 text-emerald-600/80 hover:bg-emerald-100'
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
