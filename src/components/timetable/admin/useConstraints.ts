'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  fetchPeriodSlots, fetchConstraints, addConstraint, deleteConstraint, setValueConstraint,
} from '@/lib/timetable'
import type {
  PeriodSlot, TimetableConfig, TimetableConstraint, ConstraintScope, ConstraintType, Weekday,
} from '@/lib/timetable'
import { useTimetableDraftOptional } from '../draft/TimetableDraftContext'

/**
 * A config's teaching slots and constraints, with the two mutations every
 * constraint editor needs: toggle a time-off / pin slot, and commit a numeric
 * min/max value. Shared by the Teacher and Subject editors (and the Classes
 * one) so constraint editing behaves the same everywhere.
 *
 * Inside the workspace the constraints are the draft's own. The editors used
 * to keep a private copy, so a load limit set here was saved to the database
 * but never reached the draft — the next Generate ran without it until the
 * page was reloaded. Sharing the draft's array closes that gap and saves the
 * two reads an editor made every time it opened.
 */
export function useConstraints(config: TimetableConfig) {
  const draft = useTimetableDraftOptional()
  const shared = !!draft && draft.config.id === config.id

  const [ownSlots, setOwnSlots] = useState<PeriodSlot[]>([])
  const [ownConstraints, setOwnConstraints] = useState<TimetableConstraint[]>([])
  const [ownLoading, setOwnLoading] = useState(!shared)

  const load = useCallback(async () => {
    if (shared) {
      draft!.setConstraints(await fetchConstraints(config.id))
      return
    }
    setOwnLoading(true)
    const [sl, cons] = await Promise.all([fetchPeriodSlots(config.id), fetchConstraints(config.id)])
    setOwnSlots(sl.filter((s) => !s.is_break))
    setOwnConstraints(cons)
    setOwnLoading(false)
    // `draft` is read through `shared`; its identity changes on every edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.id, shared])

  useEffect(() => { if (!shared) load() }, [shared, load])

  const draftSlots = draft?.slots
  const slots = useMemo(
    () => (shared ? (draftSlots ?? []).filter((s) => !s.is_break) : ownSlots),
    [shared, draftSlots, ownSlots],
  )
  const constraints = shared ? draft!.constraints : ownConstraints
  const setConstraints = shared ? draft!.setConstraints : setOwnConstraints
  const loading = shared ? draft!.loading : ownLoading

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
    [constraints, config.id, setConstraints],
  )

  const commitValue = useCallback(
    async (scope: ConstraintScope, scopeId: string | null, homeroomId: string | null, type: ConstraintType, value: number) => {
      await setValueConstraint({ config_id: config.id, scope, scope_id: scopeId, homeroom_id: homeroomId, type, value, existing: constraints })
      setConstraints(await fetchConstraints(config.id))
    },
    [constraints, config.id, setConstraints],
  )

  return { slots, constraints, loading, toggleSlot, commitValue, reload: load }
}
