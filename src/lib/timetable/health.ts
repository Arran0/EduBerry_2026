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
import type { SlotGeometry } from './generator'
import { teacherWorkloads, overloadedTeachers } from './workload'
import { buildConstraintIndex, cellKey, limitBucketsFor, timeOffBlocked } from './constraints'
import { teacherIdsOf } from './types'

export interface HealthComponent {
  key: string
  label: string
  score: number // 0..100
  weight: number
  /** What this category measures, in one sentence, for the UI's footnote. */
  help: string
  /** What raises it, when there is a clear answer. */
  lever?: string
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
  // Teacher names are only needed by the suggestions, which resolve their own.
  const sName = input.subjectName ?? ((id) => id.slice(0, 8))

  // Periods of different bell schedules are different rows, so a class is
  // always scored against the days of its own band rather than the config's.
  const sched = buildSchedules(config, slots, input.slotGroups ?? [], input.homeroomGroupIds ?? {})
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
  // A combined lesson's periods belong to the combined lesson, not to a
  // same-subject requirement that happens to share the class — counting them
  // for both would report a requirement as covered by somebody else's lesson.
  const placedByKey = new Map<string, number>()
  for (const e of entries) {
    if (e.combinedKey) continue
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
  // Combined lessons count towards coverage too. Scoring only
  // timetable_requirements meant a school whose assembly could not be placed
  // was told its week was complete, which is how two unplaced periods survived
  // next to a green health score. The periods are shared by every member
  // class, so each one counts once rather than once per class.
  for (const c of input.combined ?? []) {
    required += c.periodsPerWeek
    const placed = new Set<string>()
    for (const e of entries) {
      if (e.combinedKey?.startsWith(`${c.id}__`)) placed.add(`${e.day}__${e.slotId}`)
    }
    const short = Math.max(0, c.periodsPerWeek - placed.size)
    missing += short
    if (short > 0) {
      const where = c.members.length === 1
        ? hrName(c.members[0].homeroomId)
        : `${c.members.length} classes together`
      issues.push({
        severity: 'critical',
        message:
          `${sName(c.subjectId)} (${where}): short by ${short} period${short > 1 ? 's' : ''} ` +
          `(${placed.size}/${c.periodsPerWeek}).`,
        subjectId: c.subjectId,
        homeroomId: c.members[0]?.homeroomId,
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

  // Teacher idle gaps are deliberately NOT scored. A free period between two
  // lessons is not a defect: teachers read it as breathing room, not as a hole
  // to be closed, and flagging it buried the problems that do matter under a
  // list of names with nothing wrong with them. The solver agrees — it prefers
  // a spread-out day and prices long unbroken runs instead; see
  // teacherDayPenalty in generator.ts.

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
  // Measured as the AVERAGE deviation of a class-day from that class's own
  // daily average — not the total of every deviation in the school.
  //
  // The total was what this used to be, and it made the component useless at
  // any real size: 34 classes over 5 days, each day off its average by a
  // single period, summed to 170, and `100 - 170 * 2` is 0 however good the
  // week is. Every school with more than a dozen classes scored exactly 0.
  const hrDay = new Map<string, number>()
  for (const e of entries) {
    const k = `${e.homeroomId}|${e.day}`
    hrDay.set(k, (hrDay.get(k) ?? 0) + 1)
  }
  const scheduled = new Set(entries.map((e) => e.homeroomId))
  let deviation = 0
  let classDays = 0
  for (const hr of scheduled) {
    // Each class is levelled against the length of its own week, and against
    // every day of it: a class with one completely empty day is exactly the
    // imbalance this is looking for, and skipping the days with no lessons on
    // them hid it.
    const days = weekDays(hr)
    if (days.length === 0) continue
    const loads = days.map((d) => hrDay.get(`${hr}|${d}`) ?? 0)
    const avg = loads.reduce((a, b) => a + b, 0) / days.length
    for (const l of loads) deviation += Math.abs(l - avg)
    classDays += days.length
  }
  /** Periods a day, on average, that a class's load sits off its own mean. */
  const imbalance = classDays === 0 ? 0 : deviation / classDays
  // Half a period of drift is a tidy week; four is a week with empty days in
  // it. 25 a period puts the band where those two land either side of it.
  const balanceScore = clamp(100 - imbalance * 25)

  // ── Weighted total ───────────────────────────────────────────
  const components: HealthComponent[] = [
    {
      key: 'coverage', label: 'Coverage', score: coverageScore, weight: 0.34,
      help: 'How many of the periods your requirements ask for actually made it onto the timetable.',
      lever: 'A shortfall is usually arithmetic: the class has fewer free periods in its week than its subjects add up to.',
    },
    {
      key: 'clash', label: 'Clash-free', score: clashScore, weight: 0.28,
      help: 'Whether anything is double-booked — a teacher in two classes at once, two lessons in one class, or a lesson sitting in a period marked off.',
      lever: 'Every clash is a blocker: the score cannot reach the green band while one remains.',
    },
    {
      key: 'constraints', label: 'Constraints met', score: constraintScore, weight: 0.22,
      help: 'Your own rules — per-day and per-week minimums and maximums, and class-teacher pins — being honoured.',
      lever: 'A minimum the week has no room for can never be met; check it against what the class is really taught.',
    },
    {
      key: 'spread', label: 'Subject spread', score: spreadScore, weight: 0.09,
      help: 'Whether a subject is spread across the week rather than bunched into the same day. Deliberate doubles are not counted against it.',
      lever: 'Lowering max / day on a requirement forces the solver to spread that subject out.',
    },
    {
      key: 'balance', label: 'Daily balance', score: balanceScore, weight: 0.07,
      help: 'How evenly each class’s lessons fall across its days, so no day is far longer than the rest.',
      lever: 'Uneven days usually follow from time off on some days, or periods that do not divide evenly into the week.',
    },
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
    input, sched, index, missing, required, hard, clusters, imbalance,
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
/**
 * A lesson that no timetable can contain, and why.
 *
 * Separate from the capacity arithmetic above because the cause is different
 * in kind: these are not weeks that are too full, they are lessons whose time
 * off leaves them nowhere legal to sit at all. The solver can only report them
 * afterwards, as "could not fit", which sends the admin looking for a clash
 * that does not exist — the periods were never available to begin with.
 */
export interface ImpossibleLesson {
  subjectId: string
  homeroomIds: string[]
  /** Periods asked for per week. */
  wanted: number
  /** Periods per consecutive block; 1 for ordinary single periods. */
  size: number
  /** Periods of this subject the class may have in one day. */
  maxPerDay: number
  /** Cells the time-off rules leave open to this lesson. */
  open: number
  /** Days on which it has at least one open cell. */
  openDays: number
  /** The longest back-to-back run among those cells. */
  longestRun: number
  reason:
    | 'none_open'
    | 'no_run_long_enough'
    | 'fewer_cells_than_periods'
    | 'fewer_days_than_periods'
}

/**
 * The cells a lesson is permitted to use, and the longest unbroken run of them
 * on any one day. Counts only the rules that are fixed before the solve —
 * subject, class and teacher time off — so the answer is "where could this
 * EVER go", not "where is it free right now".
 */
function openCells(
  geo: SlotGeometry,
  index: ReturnType<typeof buildConstraintIndex>,
  subjectId: string,
  homeroomIds: string[],
  teacherIds: string[],
): { open: number; openDays: number; longestRun: number } {
  let open = 0
  let openDays = 0
  let longestRun = 0
  for (const day of geo.days) {
    let run = 0
    let openHere = 0
    for (let i = 0; i < geo.slotIds.length; i++) {
      const key = cellKey(day, geo.slotIds[i])
      const blocked =
        timeOffBlocked(index.subjectTimeOff, subjectId, key) ||
        homeroomIds.some((h) => timeOffBlocked(index.homeroomTimeOff, h, key)) ||
        (teacherIds.length === 0
          ? timeOffBlocked(index.teacherTimeOff, null, key)
          : teacherIds.some((t) => timeOffBlocked(index.teacherTimeOff, t, key)))
      if (blocked) {
        run = 0
        continue
      }
      open++
      openHere++
      // A run only continues through periods that are actually consecutive —
      // a break between them makes the next cell the start of a new run.
      run = i > 0 && geo.adjacentNext[i - 1] ? run + 1 : 1
      if (run > longestRun) longestRun = run
    }
    if (openHere > 0) openDays++
  }
  return { open, openDays, longestRun }
}

export function impossibleLessons(
  input: HealthInput,
  sched: ReturnType<typeof buildSchedules>,
  index: ReturnType<typeof buildConstraintIndex>,
): ImpossibleLesson[] {
  const out: ImpossibleLesson[] = []

  const check = (
    subjectId: string,
    homeroomIds: string[],
    teacherIds: string[],
    wanted: number,
    size: number,
    maxPerDay: number,
  ) => {
    if (homeroomIds.length === 0 || wanted <= 0) return
    const geo = scheduleFor(sched, homeroomIds[0])
    if (geo.slotIds.length === 0 || geo.days.length === 0) return // reported separately
    const { open, openDays, longestRun } = openCells(
      geo, index, subjectId, homeroomIds, teacherIds,
    )
    const reason: ImpossibleLesson['reason'] | null =
      open === 0 ? 'none_open'
      : size > 1 && longestRun < size ? 'no_run_long_enough'
      : open < wanted ? 'fewer_cells_than_periods'
      // A per-day cap turns the question from "are there enough periods" into
      // "are there enough DAYS". A subject wanted six times a week at one a
      // day needs six usable days, and a class with a day entirely marked off
      // has five — which the cell count alone never notices.
      : wanted > openDays * Math.max(1, maxPerDay) ? 'fewer_days_than_periods'
      : null
    if (reason) {
      out.push({
        subjectId, homeroomIds, wanted, size,
        maxPerDay: Math.max(1, maxPerDay), open, openDays, longestRun, reason,
      })
    }
  }

  for (const r of input.requirements) {
    check(
      r.subject_id, [r.homeroom_id], teacherIdsOf(r), r.periods_per_week,
      Math.max(1, r.min_block ?? 1), r.max_per_day,
    )
  }
  for (const c of input.combined ?? []) {
    check(
      c.subjectId,
      c.members.map((m) => m.homeroomId),
      c.teacherIds?.length ? c.teacherIds : c.teacherId ? [c.teacherId] : [],
      c.periodsPerWeek,
      Math.max(1, c.minBlock ?? 1),
      c.maxPerDay ?? 1,
    )
  }
  return out
}

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

function buildSuggestions({
  input, sched, index, missing, required, hard, clusters, imbalance, components,
}: {
  input: HealthInput
  sched: ReturnType<typeof buildSchedules>
  index: ReturnType<typeof buildConstraintIndex>
  missing: number
  required: number
  hard: GeneratorConflict[]
  clusters: number
  imbalance: number
  components: HealthComponent[]
}): HealthSuggestion[] {
  const out: HealthSuggestion[] = []
  const hrName = input.homeroomName ?? ((id: string) => id.slice(0, 8))
  const tName = input.teacherName ?? ((id: string) => id.slice(0, 8))
  const sName = input.subjectName ?? ((id: string) => id.slice(0, 8))

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

  // ── Lessons time off has left nowhere to sit.
  // Deliberately NOT gated on `missing`: these are knowable before a single
  // period is placed, and the solver can only ever report them afterwards as
  // "could not fit", which reads as bad luck and sends the admin to Generate
  // again. Said here, the admin is told the one thing that would fix it.
  const impossible = impossibleLessons(input, sched, index)
  if (impossible.length > 0) {
    const where = (l: ImpossibleLesson) =>
      l.homeroomIds.length === 1
        ? hrName(l.homeroomIds[0])
        : `${hrName(l.homeroomIds[0])} and ${l.homeroomIds.length - 1} other ${
            l.homeroomIds.length === 2 ? 'class' : 'classes'
          }`
    const line = (l: ImpossibleLesson) => {
      const who = `${sName(l.subjectId)} for ${where(l)}`
      if (l.reason === 'none_open') {
        return `${who} is marked time off in every period of the week, so none of its ` +
          `${plural(l.wanted, 'period')} can be placed`
      }
      if (l.reason === 'no_run_long_enough') {
        return `${who} is set to run as ${l.size} back-to-back periods, but time off leaves it ` +
          `only ${plural(l.open, 'period')} in the week and never more than ${l.longestRun} ` +
          'of them in a row'
      }
      if (l.reason === 'fewer_days_than_periods') {
        return `${who} asks for ${plural(l.wanted, 'period')} at no more than ` +
          `${plural(l.maxPerDay, 'a day', 'a day')}, but time off leaves it only ` +
          `${plural(l.openDays, 'day')} it can use`
      }
      return `${who} asks for ${plural(l.wanted, 'period')} but time off leaves it only ` +
        `${l.open} to use`
    }
    out.push({
      title: 'Give these lessons a period they are allowed to use',
      detail:
        `${plural(impossible.length, 'lesson')} can never be placed, whatever the solver does: ` +
        impossible.slice(0, 3).map(line).join('; ') +
        (impossible.length > 3 ? `, and ${impossible.length - 3} more` : '') +
        '. Clear time off for them, or ask for fewer periods — a double can also be entered as ' +
        'two single periods.',
      where: 'Subject → Time off, Homeroom → Time off, Teacher → Time off',
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

    // The same calculator the requirement form warns with, so the numbers
    // here match the ones shown when the assignment was made.
    const stretched = overloadedTeachers(teacherWorkloads({
      config: input.config,
      slots: input.slots,
      requirements: input.requirements,
      constraints: input.constraints,
      combined: input.combined,
      slotGroups: input.slotGroups,
      homeroomGroupIds: input.homeroomGroupIds,
    }))
    if (stretched.length > 0) {
      out.push({
        title: 'Spread the load of over-booked teachers',
        detail:
          `${plural(stretched.length, 'teacher')} ${stretched.length === 1 ? 'is' : 'are'} assigned more periods than their week has: ` +
          stretched.slice(0, 3).map((t) => `${tName(t.teacherId)} ${t.assigned}/${t.capacity}`).join(', ') +
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
          // An empty draft is short of every period it needs, which is not the
          // same thing as a solve that failed to place them. Saying "1287 of
          // 1287 could not be placed" before a generate was advice about a run
          // that never happened.
          (input.entries.length === 0
            ? `${plural(missing, 'period')} of ${required} is still to be placed, and the totals fit, `
            : `${plural(missing, 'period')} of ${required} could not be placed even though the totals fit, `) +
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
    if (scoreOf('balance') < 80) {
      out.push({
        title: 'Even out the long and short days',
        detail:
          `A class's day sits about ${imbalance.toFixed(1)} period(s) off its own daily average. ` +
          'That usually follows from time off on some days, or from a class whose periods do not divide evenly into its days.',
        where: 'Homeroom → Time off, Configuration → Period slots',
      })
    }
  }

  return out.slice(0, 5)
}
