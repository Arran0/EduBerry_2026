import { ExamQuestion, ExamAnswer } from './exam'

// ============================================================
// Exam App — score aggregation helpers
//
// Pure, side-effect-free functions that roll per-answer marks into a
// submission total and decide when a submission is fully graded. The
// actual per-question scoring rules (exam modes, strategies, partial
// credit) live in ./examScoring.
//
//   - Auto-graded kinds: mcq, true_false, integer  (scored at submit time)
//   - Manual kinds:      objective, subjective       (graded by a human)
// ============================================================

export interface SubmissionScores {
  autoScore: number
  manualScore: number
  totalScore: number
  maxScore: number
}

/** Round to 2 decimals to avoid floating-point noise from partial marking. */
function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/** Objective short-answer and subjective questions are graded by a human. */
export function isManualQuestion(q: Pick<ExamQuestion, 'type'>): boolean {
  return q.type === 'objective' || q.type === 'subjective'
}

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
