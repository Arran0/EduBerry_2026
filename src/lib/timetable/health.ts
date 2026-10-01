// ============================================================
// Timetable Health Score — a pure 0–100 quality metric with a
// component breakdown and a ranked list of the biggest problems.
// Builds on the generator's conflict detection and the shared
// constraints index. UI-free.
// ============================================================

import type {
  PlacedEntry, PeriodSlot, Requirement, TimetableConstraint, HomeroomLite, TimetableConfig, Weekday,
  GeneratorConflict, SlotGroup, CombinedClassInput,
} from './types'
import { detectConflicts, buildSchedules, scheduleFor } from './generator'
import { buildConstraintIndex, cellKey, limitBucketsFor } from './constraints'
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
  /** What to actually do about it, when there is a clear answer. */
  fix?: string
  homeroomId?: string
  teacherId?: string
  subjectId?: string
  day?: Weekday
  slotId?: string
}

/**
 * A ranked, concrete thing to change. Issues say what is wrong; these say what
 * to do, in the order most likely to move the score.
 */
export interface HealthSuggestion {
  /** The action, as an imperative. */
  title: string
  /** Why, with the numbers behind it. */
  detail: string
  /** Where in the workspace to do it. */
  where: string
}

export interface HealthReport {
  score: number // 0..100
  band: 'green' | 'amber' | 'red'
  hardViolations: number
  components: HealthComponent[]
  issues: HealthIssue[]
  suggestions: HealthSuggestion[]
}

export interface HealthInput {
  entries: PlacedEntry[]
  requirements: Requirement[]
  constraints: TimetableConstraint[]
  slots: PeriodSlot[]
  config: TimetableConfig
  homerooms: HomeroomLite[]
  // Round 9: the extra bell schedules and who follows them. Omitting both
  // scores everything against the config's single week, as before.
  slotGroups?: SlotGroup[]
  homeroomGroupIds?: Record<string, string | null>
  /** Combined lessons, so capacity advice counts the periods they occupy. */
  combined?: CombinedClassInput[]
  unavailability?: { teacher_id: string; day: Weekday; slot_id: string; id: string; config_id: string; created_at: string }[]
  /**
   * detectConflicts() over the same entries, when the caller has already run it
   * (the builder does, to highlight cells). Scanning is O(entries) and the
   * result is identical, so re-running it here would just double the work on
   * every edit. Omit it and this computes its own.
   */
  conflicts?: GeneratorConflict[]
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

  // Periods of different bell schedules are different rows, so ordering them
  // by position alone interleaves two bands into one meaningless sequence.
  // The solver's config-wide clock is what the gap and run maths needs.
  const sched = buildSchedules(config, slots, input.slotGroups ?? [], input.homeroomGroupIds ?? {})
  const slotOrder = sched.clock
  const weekDays = (homeroomId: string) => scheduleFor(sched, homeroomId).days
  const index = buildConstraintIndex(constraints, homerooms)
  for (const u of input.unavailability ?? []) {
    if (!index.teacherTimeOff.has(u.teacher_id)) index.teacherTimeOff.set(u.teacher_id, new Set())
    index.teacherTimeOff.get(u.teacher_id)!.add(cellKey(u.day, u.slot_id))
  }

  const issues: HealthIssue[] = []

  // ── 1. Hard clashes (double-book / time-off / pin) ───────────
  const hardConflicts =
    input.conflicts ?? detectConflicts(entries, input.unavailability ?? [], constraints, homerooms)
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
  // A double or triple is one lesson occupying several periods, not a subject
  // taught twice — counting its periods would mark every deliberate block as
  // poor spread and quietly drag the score down.
  const subjDay = new Map<string, number>()
  const countedUnits = new Set<string>()
  for (const e of entries) {
    const k = `${e.homeroomId}|${e.subjectId}|${e.groupId ?? ''}|${e.day}`
    const unit = e.blockKey ? `blk:${e.blockKey}` : `one:${e.slotId}`
    if (countedUnits.has(`${k}|${unit}`)) continue
    countedUnits.add(`${k}|${unit}`)
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
  for (const [hr, loads] of hrLoads) {
    // Each class is levelled against the length of its own week.
    const avg = loads.reduce((a, b) => a + b, 0) / Math.max(1, weekDays(hr).length)
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

  const suggestions = buildSuggestions({
    input, sched, index, missing, required, hard, gaps, clusters, imbalance,
    components,
  })

  return { score, band, hardViolations, components, issues: issues.slice(0, 12), suggestions }
}

// ── What to do about it ──────────────────────────────────────

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/**
 * Capacity per class: the periods its week can hold against the periods its
 * requirements ask for. Lessons that cannot be placed are usually arithmetic
 * rather than bad luck, and this is the arithmetic.
 *
 * Parallel split groups share a period, so the busiest group counts once
 * rather than every group adding up.
 */
function classCapacity(input: HealthInput, sched: ReturnType<typeof buildSchedules>) {
  const out: { homeroomId: string; wanted: number; available: number; timeOff: number }[] = []
  const homerooms = new Set(input.requirements.map((r) => r.homeroom_id))
  for (const c of input.combined ?? []) for (const m of c.members) homerooms.add(m.homeroomId)

  for (const hr of homerooms) {
    const geo = scheduleFor(sched, hr)
    const total = geo.days.length * geo.teachingSlots.length
    const timeOff = input.constraints.filter(
      (c) => c.type === 'time_off' && c.scope === 'homeroom' && c.scope_id === hr,
    ).length

    let whole = 0
    const byGroup = new Map<string, number>()
    for (const r of input.requirements) {
      if (r.homeroom_id !== hr) continue
      if (r.group_id) byGroup.set(r.group_id, (byGroup.get(r.group_id) ?? 0) + r.periods_per_week)
      else whole += r.periods_per_week
    }
    for (const c of input.combined ?? []) {
      for (const m of c.members) {
        if (m.homeroomId !== hr) continue
        if (m.groupId) byGroup.set(m.groupId, (byGroup.get(m.groupId) ?? 0) + c.periodsPerWeek)
        else whole += c.periodsPerWeek
      }
    }
    const groupPeak = byGroup.size > 0 ? Math.max(...byGroup.values()) : 0
    out.push({
      homeroomId: hr,
      wanted: whole + groupPeak,
      available: Math.max(0, total - timeOff),
      timeOff,
    })
  }
  return out
}

/**
 * Teacher load: how many periods each teacher is asked to cover against how
 * many their week actually has. A teacher booked beyond their week is the
 * other common reason periods go unplaced, and no amount of solver effort
 * fixes it.
 */
function teacherLoad(input: HealthInput, sched: ReturnType<typeof buildSchedules>) {
  const wanted = new Map<string, number>()
  const weekOf = new Map<string, number>()
  for (const r of input.requirements) {
    for (const t of teacherIdsOf(r)) {
      wanted.set(t, (wanted.get(t) ?? 0) + r.periods_per_week)
      const geo = scheduleFor(sched, r.homeroom_id)
      weekOf.set(t, Math.max(weekOf.get(t) ?? 0, geo.days.length * geo.teachingSlots.length))
    }
  }
  for (const c of input.combined ?? []) {
    for (const t of c.teacherIds) wanted.set(t, (wanted.get(t) ?? 0) + c.periodsPerWeek)
  }
  const out: { teacherId: string; wanted: number; available: number }[] = []
  for (const [t, n] of wanted) {
    const timeOff = input.constraints.filter(
      (c) => c.type === 'time_off' && c.scope === 'teacher' && c.scope_id === t,
    ).length
    out.push({ teacherId: t, wanted: n, available: Math.max(0, (weekOf.get(t) ?? 0) - timeOff) })
  }
  return out
}

function buildSuggestions({
  input, sched, index, missing, required, hard, gaps, clusters, imbalance, components,
}: {
  input: HealthInput
  sched: ReturnType<typeof buildSchedules>
  index: ReturnType<typeof buildConstraintIndex>
  missing: number
  required: number
  hard: GeneratorConflict[]
  gaps: number
  clusters: number
  imbalance: number
  components: HealthComponent[]
}): HealthSuggestion[] {
  const out: HealthSuggestion[] = []
  const hrName = input.homeroomName ?? ((id: string) => id.slice(0, 8))
  const tName = input.teacherName ?? ((id: string) => id.slice(0, 8))

  // ── Setup traps that make lessons unplaceable no matter what.
  // A class on a week with no periods can never be scheduled, and the grid
  // does not make that obvious on its own.
  const emptyWeekClasses = [...new Set(input.requirements.map((r) => r.homeroom_id))]
    .filter((hr) => scheduleFor(sched, hr).teachingSlots.length === 0)
  if (emptyWeekClasses.length > 0) {
    out.push({
      title: 'Give every class a week with periods in it',
      detail:
        `${plural(emptyWeekClasses.length, 'class has', 'classes have')} no teaching periods at all — ` +
        emptyWeekClasses.slice(0, 3).map(hrName).join(', ') +
        '. Nothing can be scheduled for them until the period group they follow has period slots.',
      where: 'Configuration → Period groups',
    })
  }

  // ── Blockers next: nothing else matters while periods are missing.
  if (missing > 0) {
    const over = classCapacity(input, sched).filter((c) => c.wanted > c.available)
    if (over.length > 0) {
      const worst = [...over].sort((a, b) => (b.wanted - b.available) - (a.wanted - a.available))
      out.push({
        title: 'Make room in the week, or ask for fewer periods',
        detail:
          `${plural(over.length, 'class')} ${over.length === 1 ? 'wants' : 'want'} more periods than ${
            over.length === 1 ? 'its week holds' : 'their weeks hold'
          } — no solver setting can fix that. ` +
          worst.slice(0, 3).map((c) =>
            `${hrName(c.homeroomId)} asks for ${c.wanted} and has ${c.available}${
              c.timeOff > 0 ? ` (${c.timeOff} marked time off)` : ''
            }`,
          ).join('; ') + '.',
        where: 'Configuration → Period slots, or Homeroom → Requirements',
      })
    }

    const stretched = teacherLoad(input, sched).filter((t) => t.wanted > t.available)
    if (stretched.length > 0) {
      const worst = [...stretched].sort((a, b) => (b.wanted - b.available) - (a.wanted - a.available))
      out.push({
        title: 'Spread the load of over-booked teachers',
        detail:
          `${plural(stretched.length, 'teacher')} ${stretched.length === 1 ? 'is' : 'are'} assigned more periods than their week has: ` +
          worst.slice(0, 3).map((t) => `${tName(t.teacherId)} ${t.wanted}/${t.available}`).join(', ') +
          '. Share those subjects with another teacher, or cut their periods.',
        where: 'Homeroom → Requirements (teachers), or Teacher → Time off',
      })
    }

    if (over.length === 0 && stretched.length === 0) {
      // The totals fit, so what is blocking is the shape of the week.
      const blockReqs = input.requirements.filter((r) => (r.min_block ?? 1) > 1)
      const tight = input.requirements.filter(
        (r) => r.periods_per_week > r.max_per_day * Math.max(1, scheduleFor(sched, r.homeroom_id).days.length),
      )
      out.push({
        title: 'Loosen what is pinning the week down',
        detail:
          `${plural(missing, 'period')} of ${required} could not be placed even though the totals fit, ` +
          'so something is blocking the slots rather than filling them. ' +
          [
            index.pins.length > 0 ? `${plural(index.pins.length, 'class-teacher pin')}` : '',
            blockReqs.length > 0 ? `${plural(blockReqs.length, 'double/triple requirement')}` : '',
            tight.length > 0 ? `${plural(tight.length, 'requirement')} capped too low per day` : '',
          ].filter(Boolean).join(', ') ||
          'Check time off and max-per-day caps.',
        where: 'Homeroom → Time off, Teacher → Time off, Subject → limits',
      })
      if (blockReqs.length > 0) {
        out.push({
          title: 'Check the doubles have somewhere to land',
          detail:
            `${plural(blockReqs.length, 'requirement')} asks for consecutive periods. A block needs that many ` +
            'back-to-back teaching slots on one day with no break between them — if breaks split the day into ' +
            'short runs, there may be nowhere it can go.',
          where: 'Configuration → Period slots',
        })
      }
    }

    out.push({
      title: 'Generate again',
      detail:
        'The search is randomized and keeps the best week it finds, so a second run sometimes places ' +
        'periods the first could not. If the same periods stay unplaced across runs, the cause is one ' +
        'of the above rather than luck.',
      where: 'Generate',
    })
  }

  // ── Hard clashes.
  if (hard.length > 0) {
    const kinds = new Set(hard.map((c) => c.kind))
    out.push({
      title: 'Clear the clashes highlighted in red',
      detail:
        `${plural(hard.length, 'cell')} ${hard.length === 1 ? 'breaks' : 'break'} a hard rule` +
        (kinds.has('teacher_double_booked') ? ' — a teacher is in two classes at once' : '') +
        (kinds.has('time_off_violated') ? ' — a lesson sits in a period marked off' : '') +
        '. Drag the lesson elsewhere, or pin the one that must stay and regenerate around it.',
      where: 'Master grid',
    })
  }

  // ── Soft quality, worst component first, and only when it is actually weak.
  const scoreOf = (key: string) => components.find((c) => c.key === key)?.score ?? 100

  if (missing === 0 && hard.length === 0) {
    if (scoreOf('constraints') < 80) {
      out.push({
        title: 'Review the limits that are not being met',
        detail:
          'Minimum per-day or per-week targets are going unmet, or pinned class-teacher periods are unfilled. ' +
          'A minimum the week has no room for will never be satisfied — check it against what the class is actually taught.',
        where: 'Teacher / Subject → limits, Homeroom → Pin class teacher',
      })
    }
    if (scoreOf('spread') < 80) {
      out.push({
        title: 'Stop subjects bunching into the same day',
        detail:
          `${plural(clusters, 'extra lesson')} of a subject lands on a day that already had one. ` +
          'Lowering max / day on those requirements forces the solver to spread them across the week. ' +
          '(Deliberate doubles are not counted here.)',
        where: 'Homeroom → Requirements → Max / day',
      })
    }
    if (scoreOf('gaps') < 80) {
      out.push({
        title: 'Close the free periods stranded in teachers’ days',
        detail:
          `${plural(gaps, 'idle gap')} across the week. Teachers who teach only a few periods are the usual cause — ` +
          'grouping their classes onto fewer days, or setting max periods in a row, gives the solver something to aim at.',
        where: 'Teacher → Max periods in a row',
      })
    }
    if (scoreOf('balance') < 80) {
      out.push({
        title: 'Even out the long and short days',
        detail:
          `Daily loads vary by about ${Math.round(imbalance)} periods across the week. ` +
          'This usually follows from time off on some days, or from a class whose periods do not divide evenly into its days.',
        where: 'Homeroom → Time off, Configuration → Period slots',
      })
    }
  }

  return out.slice(0, 5)
}
