// ============================================================
// Timetable Health Score — a pure 0–100 quality metric with a
// component breakdown and a ranked list of the biggest problems.
// Builds on the generator's conflict detection and the shared
// constraints index. UI-free.
// ============================================================

import type {
  PlacedEntry, PeriodSlot, Requirement, TimetableConstraint, HomeroomLite, TimetableConfig, Weekday,
} from './types'
import { detectConflicts } from './generator'
import {
  buildConstraintIndex, cellKey, timeOffBlocked, limitBucketsFor,
} from './constraints'
import { teacherIdsOf } from './types'

export interface HealthComponent {
  key: string
  label: string
  score: number // 0..100
  weight: number
}

export interface HealthIssue {
  severity: 'critical' | 'warning' | 'info'
  message: string
  homeroomId?: string
  teacherId?: string
  subjectId?: string
  day?: Weekday
  slotId?: string
}

export interface HealthReport {
  score: number // 0..100
  band: 'green' | 'amber' | 'red'
  hardViolations: number
  components: HealthComponent[]
  issues: HealthIssue[]
}

export interface HealthInput {
  entries: PlacedEntry[]
  requirements: Requirement[]
  constraints: TimetableConstraint[]
  slots: PeriodSlot[]
  config: TimetableConfig
  homerooms: HomeroomLite[]
  unavailability?: { teacher_id: string; day: Weekday; slot_id: string; id: string; config_id: string; created_at: string }[]
  // Optional label resolvers for readable issues.
  homeroomName?: (id: string) => string
  teacherName?: (id: string) => string
  subjectName?: (id: string) => string
}

const clamp = (n: number) => Math.max(0, Math.min(100, n))

export function computeHealth(input: HealthInput): HealthReport {
  const { entries, requirements, constraints, slots, config, homerooms } = input
  const hrName = input.homeroomName ?? ((id) => id.slice(0, 8))
  const tName = input.teacherName ?? ((id) => id.slice(0, 8))
  const sName = input.subjectName ?? ((id) => id.slice(0, 8))

  const days = config.working_days
  const teaching = slots.filter((s) => !s.is_break)
  const slotOrder = new Map(teaching.map((s, i) => [s.id, i]))
  const index = buildConstraintIndex(constraints, homerooms)
  for (const u of input.unavailability ?? []) {
    if (!index.teacherTimeOff.has(u.teacher_id)) index.teacherTimeOff.set(u.teacher_id, new Set())
    index.teacherTimeOff.get(u.teacher_id)!.add(cellKey(u.day, u.slot_id))
  }

  const issues: HealthIssue[] = []

  // ── 1. Hard clashes (double-book / time-off / pin) ───────────
  const hardConflicts = detectConflicts(entries, input.unavailability ?? [], constraints, homerooms)
  const hardKinds = new Set([
    'teacher_double_booked', 'room_double_booked', 'homeroom_double_booked', 'time_off_violated',
  ])
  const hard = hardConflicts.filter((c) => hardKinds.has(c.kind))
  for (const c of hard.slice(0, 12)) {
    issues.push({ severity: 'critical', message: c.message, homeroomId: c.homeroomId, teacherId: c.teacherId, subjectId: c.subjectId, day: c.day, slotId: c.slotId })
  }
  const clashScore = clamp(100 - hard.length * 20)

  // ── 2. Coverage (placed required periods vs needed) ──────────
  const placedByKey = new Map<string, number>()
  for (const e of entries) {
    const k = `${e.homeroomId}|${e.subjectId}|${e.groupId ?? ''}`
    placedByKey.set(k, (placedByKey.get(k) ?? 0) + 1)
  }
  let required = 0
  let missing = 0
  for (const r of requirements) {
    required += r.periods_per_week
    const got = placedByKey.get(`${r.homeroom_id}|${r.subject_id}|${r.group_id ?? ''}`) ?? 0
    const short = Math.max(0, r.periods_per_week - got)
    missing += short
    if (short > 0) {
      issues.push({
        severity: 'critical',
        message: `${hrName(r.homeroom_id)}: ${sName(r.subject_id)} short by ${short} period${short > 1 ? 's' : ''} (${got}/${r.periods_per_week}).`,
        homeroomId: r.homeroom_id, subjectId: r.subject_id,
      })
    }
  }
  const coverageScore = required === 0 ? 100 : clamp(100 - (missing / required) * 100)

  // ── 3. Constraint satisfaction (min targets, pins, max caps) ─
  let constraintChecks = 0
  let constraintPass = 0

  // min per week/day + max caps evaluated per bucket.
  for (const rule of index.limits) {
    const buckets = new Map<string, number>()
    for (const e of entries) {
      const p = {
        homeroomId: e.homeroomId, subjectId: e.subjectId,
        teacherId: e.teacherId, teacherIds: teacherIdsOf(e),
      }
      // A co-taught period counts against each of its teachers.
      for (const key of limitBucketsFor(rule, p, e.day)) {
        buckets.set(key, (buckets.get(key) ?? 0) + 1)
      }
    }
    for (const count of buckets.values()) {
      constraintChecks++
      const ok = rule.kind === 'max' ? count <= rule.value : count >= rule.value
      if (ok) constraintPass++
      else if (rule.kind === 'min') {
        issues.push({ severity: 'warning', message: `A ${rule.scope} is under its minimum of ${rule.value} (${count}).` })
      }
    }
  }

  // pins
  const filled = new Set<string>()
  for (const e of entries) {
    for (const t of teacherIdsOf(e)) filled.add(`${e.homeroomId}__${e.day}__${e.slotId}__${t}`)
  }
  for (const pin of index.pins) {
    constraintChecks++
    const [day, slotId] = pin.key.split('__')
    if (pin.classTeacherId && filled.has(`${pin.homeroomId}__${day}__${slotId}__${pin.classTeacherId}`)) {
      constraintPass++
    } else {
      issues.push({ severity: 'warning', message: `${hrName(pin.homeroomId)}: pinned class-teacher period is unfilled.`, homeroomId: pin.homeroomId })
    }
  }
  const constraintScore = constraintChecks === 0 ? 100 : clamp((constraintPass / constraintChecks) * 100)

  // ── 4. Teacher idle gaps ─────────────────────────────────────
  const tSlots = new Map<string, Set<number>>()
  for (const e of entries) {
    for (const t of teacherIdsOf(e)) {
      const k = `${t}|${e.day}`
      if (!tSlots.has(k)) tSlots.set(k, new Set())
      tSlots.get(k)!.add(slotOrder.get(e.slotId) ?? 0)
    }
  }
  let gaps = 0
  const gapByTeacher = new Map<string, number>()
  for (const [k, set] of tSlots) {
    const idxs = [...set].sort((a, b) => a - b)
    const span = idxs[idxs.length - 1] - idxs[0] + 1
    const g = span - idxs.length
    gaps += g
    if (g > 0) {
      const t = k.split('|')[0]
      gapByTeacher.set(t, (gapByTeacher.get(t) ?? 0) + g)
    }
  }
  for (const [t, g] of [...gapByTeacher.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)) {
    issues.push({ severity: 'info', message: `${tName(t)} has ${g} idle gap${g > 1 ? 's' : ''} across the week.`, teacherId: t })
  }
  const gapScore = clamp(100 - gaps * 5)

  // ── 5. Subject spread (same subject repeated in a day) ───────
  const subjDay = new Map<string, number>()
  for (const e of entries) {
    const k = `${e.homeroomId}|${e.subjectId}|${e.groupId ?? ''}|${e.day}`
    subjDay.set(k, (subjDay.get(k) ?? 0) + 1)
  }
  let clusters = 0
  for (const c of subjDay.values()) if (c > 1) clusters += c - 1
  const spreadScore = clamp(100 - clusters * 4)

  // ── 6. Daily load balance across homerooms ───────────────────
  const hrDay = new Map<string, number>()
  for (const e of entries) hrDay.set(`${e.homeroomId}|${e.day}`, (hrDay.get(`${e.homeroomId}|${e.day}`) ?? 0) + 1)
  const hrLoads = new Map<string, number[]>()
  for (const [k, v] of hrDay) {
    const hr = k.split('|')[0]
    if (!hrLoads.has(hr)) hrLoads.set(hr, [])
    hrLoads.get(hr)!.push(v)
  }
  let imbalance = 0
  for (const loads of hrLoads.values()) {
    const avg = loads.reduce((a, b) => a + b, 0) / Math.max(1, days.length)
    for (const l of loads) imbalance += Math.abs(l - avg)
  }
  const balanceScore = clamp(100 - imbalance * 2)

  // ── Weighted total ───────────────────────────────────────────
  const components: HealthComponent[] = [
    { key: 'coverage', label: 'Coverage', score: coverageScore, weight: 0.30 },
    { key: 'clash', label: 'Clash-free', score: clashScore, weight: 0.25 },
    { key: 'constraints', label: 'Constraints met', score: constraintScore, weight: 0.20 },
    { key: 'gaps', label: 'Teacher gaps', score: gapScore, weight: 0.10 },
    { key: 'spread', label: 'Subject spread', score: spreadScore, weight: 0.08 },
    { key: 'balance', label: 'Daily balance', score: balanceScore, weight: 0.07 },
  ]
  let total = components.reduce((s, c) => s + c.score * c.weight, 0)

  // Any hard violation or missing coverage caps the score out of the green band.
  const hardViolations = hard.length + (missing > 0 ? 1 : 0)
  if (hardViolations > 0) total = Math.min(total, 59)

  const score = Math.round(clamp(total))
  const band: HealthReport['band'] = score >= 80 && hardViolations === 0 ? 'green' : score >= 50 ? 'amber' : 'red'

  const rank = { critical: 0, warning: 1, info: 2 }
  issues.sort((a, b) => rank[a.severity] - rank[b.severity])

  return { score, band, hardViolations, components, issues: issues.slice(0, 12) }
}
