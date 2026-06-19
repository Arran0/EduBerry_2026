import {
  ExamQuestion,
  ExamAnswer,
  GradingMethod,
  AnswerResponse,
} from './exam'

// ============================================================
// Exam App — grading engine (Round 2)
//
// Pure, side-effect-free functions. No DB calls here so the logic
// stays unit-testable. Used at submission time to auto-grade MCQ +
// True/False questions, and by the teacher grader to roll manual
// marks into a final score.
//
// Rules (locked product decisions):
//   - Auto-graded: mcq, true_false. Manual: objective, subjective.
//   - Negative marking ratio per exam: none=0, neet=0.25, jee=0.25,
//     custom=teacher-set. Penalty for a wrong objective answer =
//     ratio * question.marks. A blank answer is always 0 (no penalty).
//   - Multiple-select MCQ uses PARTIAL marking.
// ============================================================

/** Subset of an ExamQuestion needed to grade it. */
type GradableQuestion = Pick<
  ExamQuestion,
  'type' | 'marks' | 'options' | 'correct_answer' | 'multiple_select'
>

export interface AutoGradeResult {
  /** Marks awarded for this question (may be negative). */
  awardedMarks: number
  /** true/false once attempted; null when left blank. */
  isCorrect: boolean | null
}

export interface SubmissionScores {
  autoScore: number
  manualScore: number
  totalScore: number
  maxScore: number
}

// ── helpers ──────────────────────────────────────────────────

/** Round to 2 decimals to avoid floating-point noise from partial marking. */
function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/** Objective short-answer and subjective questions are graded by a human. */
export function isManualQuestion(q: Pick<ExamQuestion, 'type'>): boolean {
  return q.type === 'objective' || q.type === 'subjective'
}

/** Resolve the configured negative-marking ratio for a grading method. */
export function methodRatio(method: GradingMethod, customRatio?: number | null): number {
  switch (method) {
    case 'neet':
    case 'jee':
      return 0.25
    case 'custom':
      return Math.max(0, Math.min(1, customRatio ?? 0))
    case 'none':
    default:
      return 0
  }
}

/** Selected option ids from an MCQ response, normalised to a string[]. */
function selectedIds(response: AnswerResponse): string[] {
  if (Array.isArray(response)) return response.filter((v): v is string => typeof v === 'string')
  if (typeof response === 'string' && response) return [response]
  return []
}

// ── auto-grading (mcq + true_false only) ─────────────────────

/**
 * Auto-grade a single MCQ or True/False answer.
 *
 * Examples (marks = 4):
 *   NEET/JEE (ratio 0.25): correct → +4; wrong → −1; blank → 0.
 *   No negative (ratio 0): correct → +4; wrong → 0; blank → 0.
 *   Multi-select partial, correct = [a,b], 4 options, ratio 0.25:
 *     [a]    → +2   (half correct, none wrong)
 *     [a,b]  → +4   (fully correct)
 *     [a,c]  → +2 −0.5 = +1.5 (one correct, one wrong)
 *     [c,d]  → −1   (floored at −ratio*marks)
 *     []     → 0    (blank)
 *
 * @throws if called for a manual (objective/subjective) question.
 */
export function gradeObjectiveAuto(
  question: GradableQuestion,
  response: AnswerResponse,
  ratio: number,
): AutoGradeResult {
  if (isManualQuestion(question)) {
    throw new Error(`gradeObjectiveAuto called for manual question type: ${question.type}`)
  }

  const marks = question.marks
  const penalty = ratio * marks

  // ── True / False ──
  if (question.type === 'true_false') {
    if (typeof response !== 'boolean') return { awardedMarks: 0, isCorrect: null }
    const correct = response === question.correct_answer
    return { awardedMarks: correct ? marks : round2(-penalty), isCorrect: correct }
  }

  // ── MCQ ──
  const correctIds = Array.isArray(question.correct_answer)
    ? (question.correct_answer as string[])
    : []
  const selected = selectedIds(response)

  if (selected.length === 0) return { awardedMarks: 0, isCorrect: null }

  // Single-answer MCQ: exact-match the one correct option.
  if (!question.multiple_select) {
    const correct = selected.length === 1 && correctIds.includes(selected[0])
    return { awardedMarks: correct ? marks : round2(-penalty), isCorrect: correct }
  }

  // Multiple-select MCQ: partial marking.
  const numCorrect = correctIds.length
  const totalOptions = question.options?.length ?? 0
  const numWrongOptions = Math.max(0, totalOptions - numCorrect)

  let award = 0
  for (const id of selected) {
    if (correctIds.includes(id)) {
      if (numCorrect > 0) award += marks / numCorrect
    } else if (numWrongOptions > 0) {
      award -= penalty / numWrongOptions
    }
  }

  // Never below a single wrong-answer penalty, never above full marks.
  award = Math.min(marks, Math.max(award, -penalty))

  const correctSet = new Set(correctIds)
  const selectedSet = new Set(selected)
  const fullyCorrect =
    correctSet.size === selectedSet.size && [...selectedSet].every(id => correctSet.has(id))

  return { awardedMarks: round2(award), isCorrect: fullyCorrect }
}

// ── score aggregation ────────────────────────────────────────

/**
 * Roll per-answer marks into submission totals.
 *   maxScore     = sum of every question's marks
 *   autoScore    = sum of awarded marks on auto-graded questions
 *   manualScore  = sum of awarded marks on manual questions (null = ungraded = 0)
 *   totalScore   = autoScore + manualScore
 */
export function computeSubmissionScores(
  questions: Pick<ExamQuestion, 'id' | 'type' | 'marks'>[],
  answers: Pick<ExamAnswer, 'question_id' | 'awarded_marks'>[],
): SubmissionScores {
  const answerByQ = new Map(answers.map(a => [a.question_id, a]))

  let autoScore = 0
  let manualScore = 0
  let maxScore = 0

  for (const q of questions) {
    maxScore += q.marks
    const awarded = answerByQ.get(q.id)?.awarded_marks
    if (awarded == null) continue
    if (isManualQuestion(q)) manualScore += awarded
    else autoScore += awarded
  }

  return {
    autoScore: round2(autoScore),
    manualScore: round2(manualScore),
    totalScore: round2(autoScore + manualScore),
    maxScore: round2(maxScore),
  }
}

/**
 * True when every manual question has been given a mark (non-null
 * awarded_marks). Auto questions are graded at submission time, so this
 * is what gates a submission moving to status 'graded'.
 */
export function allManualGraded(
  questions: Pick<ExamQuestion, 'id' | 'type'>[],
  answers: Pick<ExamAnswer, 'question_id' | 'awarded_marks'>[],
): boolean {
  const awardedByQ = new Map(answers.map(a => [a.question_id, a.awarded_marks]))
  return questions
    .filter(isManualQuestion)
    .every(q => awardedByQ.get(q.id) != null)
}

// ============================================================
// Dev-only self-test. Not imported by the app; call from a REPL or
// a throwaway script to sanity-check the rules above.
// ============================================================

export function examGradingSelfTest(): void {
  const assert = (cond: boolean, msg: string) => {
    if (!cond) throw new Error(`examGradingSelfTest failed: ${msg}`)
  }

  // ratios
  assert(methodRatio('none') === 0, 'none ratio')
  assert(methodRatio('neet') === 0.25, 'neet ratio')
  assert(methodRatio('jee') === 0.25, 'jee ratio')
  assert(methodRatio('custom', 0.33) === 0.33, 'custom ratio')
  assert(methodRatio('custom', 5) === 1, 'custom ratio clamped to 1')

  const neet = methodRatio('neet')

  // single MCQ, NEET marking (+4 / -1 / 0)
  const single: GradableQuestion = {
    type: 'mcq', marks: 4, multiple_select: false,
    options: [{ id: 'a', text: '' }, { id: 'b', text: '' }, { id: 'c', text: '' }, { id: 'd', text: '' }],
    correct_answer: ['b'],
  }
  assert(gradeObjectiveAuto(single, ['b'], neet).awardedMarks === 4, 'single correct +4')
  assert(gradeObjectiveAuto(single, ['a'], neet).awardedMarks === -1, 'single wrong -1')
  assert(gradeObjectiveAuto(single, [], neet).awardedMarks === 0, 'single blank 0')
  assert(gradeObjectiveAuto(single, [], neet).isCorrect === null, 'single blank null')

  // no negative marking
  assert(gradeObjectiveAuto(single, ['a'], 0).awardedMarks === 0, 'single wrong no-negative 0')

  // true/false
  const tf: GradableQuestion = {
    type: 'true_false', marks: 2, multiple_select: false, options: null, correct_answer: true,
  }
  assert(gradeObjectiveAuto(tf, true, neet).awardedMarks === 2, 'tf correct +2')
  assert(gradeObjectiveAuto(tf, false, neet).awardedMarks === -0.5, 'tf wrong -0.5')
  assert(gradeObjectiveAuto(tf, null, neet).awardedMarks === 0, 'tf blank 0')

  // multi-select partial: correct = [a,b], 4 options, ratio 0.25, marks 4
  const multi: GradableQuestion = {
    type: 'mcq', marks: 4, multiple_select: true,
    options: [{ id: 'a', text: '' }, { id: 'b', text: '' }, { id: 'c', text: '' }, { id: 'd', text: '' }],
    correct_answer: ['a', 'b'],
  }
  assert(gradeObjectiveAuto(multi, ['a'], neet).awardedMarks === 2, 'multi half +2')
  assert(gradeObjectiveAuto(multi, ['a', 'b'], neet).awardedMarks === 4, 'multi full +4')
  assert(gradeObjectiveAuto(multi, ['a', 'b'], neet).isCorrect === true, 'multi full correct')
  assert(gradeObjectiveAuto(multi, ['a', 'c'], neet).awardedMarks === 1.5, 'multi one-right-one-wrong +1.5')
  assert(gradeObjectiveAuto(multi, ['c', 'd'], neet).awardedMarks === -1, 'multi both-wrong floored -1')
  assert(gradeObjectiveAuto(multi, [], neet).awardedMarks === 0, 'multi blank 0')

  // aggregation
  const questions = [
    { id: 'q1', type: 'mcq' as const, marks: 4 },
    { id: 'q2', type: 'subjective' as const, marks: 6 },
  ]
  const answers = [
    { question_id: 'q1', awarded_marks: 4 },
    { question_id: 'q2', awarded_marks: null },
  ]
  const scores = computeSubmissionScores(questions, answers)
  assert(scores.maxScore === 10, 'max 10')
  assert(scores.autoScore === 4, 'auto 4')
  assert(scores.manualScore === 0, 'manual ungraded 0')
  assert(allManualGraded(questions, answers) === false, 'not all manual graded')
  assert(
    allManualGraded(questions, [...answers.slice(0, 1), { question_id: 'q2', awarded_marks: 5 }]) === true,
    'all manual graded once q2 marked',
  )
}
