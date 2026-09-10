// ============================================================
// Constraint index — turns the flat timetable_constraints rows into
// fast lookup structures shared by the generator (hard/soft
// enforcement) and detectConflicts (live highlighting).
// ============================================================

import type { TimetableConstraint, HomeroomLite, Weekday } from './types'

export const cellKey = (day: Weekday, slotId: string) => `${day}__${slotId}`

// A resolved min/max rule. Applies to placements whose scope entity
// matches scopeId (null = all) and, optionally, a single homeroom.
export interface LimitRule {
  scope: 'teacher' | 'subject' | 'homeroom'
  scopeId: string | null
  homeroomId: string | null
  period: 'day' | 'week'
  kind: 'max' | 'min'
  value: number
}

export interface PinRule {
  homeroomId: string
  classTeacherId: string | null
  key: string // cellKey
}

export interface ConstraintIndex {
  // time-off cell-key sets per entity id; the '*' entry applies to all of that scope.
  teacherTimeOff: Map<string, Set<string>>
  homeroomTimeOff: Map<string, Set<string>>
  subjectTimeOff: Map<string, Set<string>>
  pins: PinRule[]
  // teacherId or '*' -> max consecutive periods
  maxInARow: Map<string, number>
  limits: LimitRule[]
  hasAny: boolean
}

const PLACEMENT_SCOPES = new Set(['teacher', 'subject', 'homeroom'])

export function buildConstraintIndex(
  constraints: TimetableConstraint[],
  homerooms: HomeroomLite[],
): ConstraintIndex {
  const classTeacher = new Map(homerooms.map((h) => [h.id, h.class_teacher_id]))

  const idx: ConstraintIndex = {
    teacherTimeOff: new Map(),
    homeroomTimeOff: new Map(),
    subjectTimeOff: new Map(),
    pins: [],
    maxInARow: new Map(),
    limits: [],
    hasAny: constraints.length > 0,
  }

  const addTimeOff = (map: Map<string, Set<string>>, id: string, key: string) => {
    if (!map.has(id)) map.set(id, new Set())
    map.get(id)!.add(key)
  }

  for (const c of constraints) {
    switch (c.type) {
      case 'time_off': {
        if (!c.day || !c.slot_id) break
        const key = cellKey(c.day, c.slot_id)
        const id = c.scope_id ?? '*'
        if (c.scope === 'teacher') addTimeOff(idx.teacherTimeOff, id, key)
        else if (c.scope === 'homeroom') addTimeOff(idx.homeroomTimeOff, id, key)
        else if (c.scope === 'subject') addTimeOff(idx.subjectTimeOff, id, key)
        break
      }
      case 'pin_class_teacher': {
        if (!c.day || !c.slot_id || c.scope !== 'class_teacher' || !c.scope_id) break
        idx.pins.push({
          homeroomId: c.scope_id,
          classTeacherId: classTeacher.get(c.scope_id) ?? null,
          key: cellKey(c.day, c.slot_id),
        })
        break
      }
      case 'max_in_a_row': {
        if (c.value == null || c.scope !== 'teacher') break
        const id = c.scope_id ?? '*'
        const prev = idx.maxInARow.get(id)
        idx.maxInARow.set(id, prev == null ? c.value : Math.min(prev, c.value))
        break
      }
      case 'min_per_day':
      case 'max_per_day':
      case 'min_per_week':
      case 'max_per_week': {
        if (c.value == null || !PLACEMENT_SCOPES.has(c.scope)) break
        idx.limits.push({
          scope: c.scope as LimitRule['scope'],
          scopeId: c.scope_id,
          homeroomId: c.homeroom_id,
          period: c.type.endsWith('day') ? 'day' : 'week',
          kind: c.type.startsWith('min') ? 'min' : 'max',
          value: c.value,
        })
        break
      }
    }
  }

  return idx
}

// A candidate placement, as far as constraints care. A period can be
// co-taught, so `teacherIds` (primary first) is the authoritative list and
// `teacherId` is only its head.
export interface PlacementLite {
  homeroomId: string
  subjectId: string
  teacherId: string | null
  teacherIds?: string[]
}

// Every teacher on a placement, primary included, de-duped.
export function placementTeachers(p: PlacementLite): string[] {
  const out: string[] = []
  for (const id of [p.teacherId, ...(p.teacherIds ?? [])]) {
    if (id && !out.includes(id)) out.push(id)
  }
  return out
}

export function limitApplies(rule: LimitRule, p: PlacementLite): boolean {
  if (rule.homeroomId && rule.homeroomId !== p.homeroomId) return false
  if (rule.scope === 'teacher') {
    const teachers = placementTeachers(p)
    return teachers.length > 0 && (rule.scopeId === null || teachers.includes(rule.scopeId))
  }
  if (rule.scope === 'subject') return rule.scopeId === null || rule.scopeId === p.subjectId
  return rule.scopeId === null || rule.scopeId === p.homeroomId
}

/**
 * Every bucket a placement contributes to under one rule — empty when the rule
 * doesn't apply. A co-taught period counts against EACH of its teachers, so a
 * teacher-scoped rule yields one bucket per teacher; other scopes yield one.
 */
export function limitBucketsFor(rule: LimitRule, p: PlacementLite, day: Weekday): string[] {
  if (!limitApplies(rule, p)) return []
  const hr = rule.homeroomId ? `|${rule.homeroomId}` : ''
  const d = rule.period === 'day' ? `|${day}` : ''
  if (rule.scope === 'teacher') {
    return placementTeachers(p)
      .filter((t) => rule.scopeId === null || rule.scopeId === t)
      .map((t) => `teacher:${t}${hr}${d}`)
  }
  const entity = rule.scope === 'subject' ? p.subjectId : p.homeroomId
  return [`${rule.scope}:${entity}${hr}${d}`]
}

// True when the given entity is blocked at cellKey by a time-off (its own or an "all").
export function timeOffBlocked(map: Map<string, Set<string>>, id: string | null, key: string): boolean {
  if (map.get('*')?.has(key)) return true
  if (id && map.get(id)?.has(key)) return true
  return false
}

// Effective max-consecutive for a teacher (min of their specific rule and the "all" rule).
export function effectiveMaxInARow(idx: ConstraintIndex, teacherId: string | null): number | null {
  const all = idx.maxInARow.get('*')
  const own = teacherId ? idx.maxInARow.get(teacherId) : undefined
  if (all == null && own == null) return null
  if (all == null) return own!
  if (own == null) return all
  return Math.min(all, own)
}
