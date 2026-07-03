'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  fetchPeriodSlots, fetchConstraints, addConstraint, deleteConstraint, setValueConstraint,
} from '@/lib/timetable'
import type {
  PeriodSlot, TimetableConfig, TimetableConstraint, ConstraintScope, ConstraintType, Weekday,
} from '@/lib/timetable'

/**
 * Loads a config's teaching slots + constraints and exposes the two mutations
 * every constraint editor needs: toggle a time-off / pin slot, and commit a
 * numeric min/max value. Shared by the Teacher and Subject modals (and the
 * Homeroom hub) so constraint editing behaves identically everywhere.
 */
export function useConstraints(config: TimetableConfig) {
  const [slots, setSlots] = useState<PeriodSlot[]>([])
  const [constraints, setConstraints] = useState<TimetableConstraint[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    const [sl, cons] = await Promise.all([fetchPeriodSlots(config.id), fetchConstraints(config.id)])
    setSlots(sl.filter((s) => !s.is_break))
    setConstraints(cons)
    setLoading(false)
  }, [config.id])

  useEffect(() => { load() }, [load])

  const toggleSlot = useCallback(
    async (scope: ConstraintScope, scopeId: string | null, type: ConstraintType, day: Weekday, slotId: string) => {
      const existing = constraints.find(
        (c) => c.type === type && c.scope === scope && (c.scope_id ?? null) === scopeId && c.day === day && c.slot_id === slotId,
      )
      if (existing) {
        await deleteConstraint(existing.id)
        setConstraints((prev) => prev.filter((c) => c.id !== existing.id))
      } else {
        const created = await addConstraint({ config_id: config.id, scope, scope_id: scopeId, type, day, slot_id: slotId })
        if (created) setConstraints((prev) => [...prev, created])
      }
    },
    [constraints, config.id],
  )

  const commitValue = useCallback(
    async (scope: ConstraintScope, scopeId: string | null, homeroomId: string | null, type: ConstraintType, value: number) => {
      await setValueConstraint({ config_id: config.id, scope, scope_id: scopeId, homeroom_id: homeroomId, type, value, existing: constraints })
      setConstraints(await fetchConstraints(config.id))
    },
    [constraints, config.id],
  )

  return { slots, constraints, loading, toggleSlot, commitValue, reload: load }
}
