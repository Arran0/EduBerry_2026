import type {
  QuestionType,
  QuestionOption,
  CorrectAnswer,
  AnswerResponse,
} from './exam'

// ============================================================
// Exam App — Exam Mode & Scoring Engine
//
// This is the single source of truth for how exams score questions.
// It is deliberately data-driven so new exams (CUET, GATE, CAT,
// Olympiads, university entrance, …) can be added by declaring a new
// ExamModeConfig — WITHOUT touching question-creation or grading code.
//
//   Exam Mode  →  Allowed Question Kinds  →  Default Scoring Strategy
//                                          →  Question { kind, strategy, params }
//
// Every question persists its own questionType, scoringStrategy and
// scoringParameters (see exam_questions.scoring_strategy / scoring_params),
// so grading never has to re-derive rules from the exam — it just runs the
// strategy stored on the question. That keeps old exams stable even if the
// mode's defaults change later.
// ============================================================

// ── Exam modes ───────────────────────────────────────────────

export type ExamMode = 'school' | 'neet' | 'jee_main' | 'jee_advanced' | 'custom'

// ── Question kinds (the mode-facing concept) ─────────────────
// A "kind" is the teacher-facing question type. It maps onto the stored
// DB columns (type + multiple_select) via QUESTION_KINDS below.

export type QuestionKind =
  | 'single_correct'    // single-correct MCQ
  | 'multiple_correct'  // multiple-correct MCQ
  | 'integer'           // integer / numerical answer
  | 'true_false'        // true / false
  | 'short_answer'      // objective short answer (manual)
  | 'subjective'        // long-form subjective (manual)

// ── Scoring strategies ───────────────────────────────────────
// Each strategy is a named, parameterised grading rule. Adding a new
// multiple-correct rule (say a proportional JEE-Advanced 2023 model) is
// just a new id + a case in gradeWithStrategy — nothing else changes.

export type ScoringStrategyId =
  | 'mcq_single'                  // exact single-option match
  | 'mcq_multiple_jee'            // JEE-Advanced fixed partial (+4/+2/−2/0)
  | 'mcq_multiple_proportional'   // per-option proportional partial
  | 'integer_exact'               // numeric exact match
  | 'true_false'                  // boolean match
  | 'manual'                      // graded by a human (no auto score)

/**
 * Scoring parameters for a question. `correct` is always the question's max
 * (== exam_questions.marks). `wrong` is ≤ 0 (a penalty). `partial` is only
 * meaningful for partial multiple-correct strategies.
 */
export interface ScoringParams {
  correct: number
  wrong: number
  blank: number
  partial?: number
}

// ── Question-kind metadata ───────────────────────────────────

export interface QuestionKindMeta {
  label: string
  /** How the kind is stored in exam_questions. */
  type: QuestionType
  multiple_select: boolean
  /** Manual = graded by a human (objective / subjective). */
  manual: boolean
}

export const QUESTION_KINDS: Record<QuestionKind, QuestionKindMeta> = {
  single_correct:   { label: 'Single Correct MCQ',   type: 'mcq',        multiple_select: false, manual: false },
  multiple_correct: { label: 'Multiple Correct MCQ', type: 'mcq',        multiple_select: true,  manual: false },
  integer:          { label: 'Integer / Numerical',  type: 'integer',    multiple_select: false, manual: false },
  true_false:       { label: 'True / False',         type: 'true_false', multiple_select: false, manual: false },
  short_answer:     { label: 'Short Answer',         type: 'objective',  multiple_select: false, manual: true  },
  subjective:       { label: 'Subjective',           type: 'subjective', multiple_select: false, manual: true  },
}

export function isManualKind(kind: QuestionKind): boolean {
  return QUESTION_KINDS[kind].manual
}

/** Recover the teacher-facing kind from the stored DB columns. */
export function kindFromQuestion(type: QuestionType, multipleSelect: boolean): QuestionKind {
  switch (type) {
    case 'mcq':        return multipleSelect ? 'multiple_correct' : 'single_correct'
    case 'integer':    return 'integer'
    case 'true_false': return 'true_false'
    case 'objective':  return 'short_answer'
    case 'subjective': return 'subjective'
    default:           return 'single_correct'
  }
}

// ── Exam-mode configuration ──────────────────────────────────

export interface ModeKindDefault {
  strategy: ScoringStrategyId
  params: ScoringParams
}

export interface ExamModeConfig {
  id: ExamMode
  label: string
  /** One-line description shown under the Exam Mode dropdown. */
  description: string
  allowedKinds: QuestionKind[]
  /** Default strategy + params applied to a newly-created question of each kind. */
  defaults: Partial<Record<QuestionKind, ModeKindDefault>>
  /** School / Custom let the teacher edit marks & penalties per question. */
  scoringEditable: boolean
}

const manualDefault: ModeKindDefault = { strategy: 'manual', params: { correct: 1, wrong: 0, blank: 0 } }

// All six kinds, scored with no negative marking (the School/Custom baseline).
const baselineDefaults: Record<QuestionKind, ModeKindDefault> = {
  single_correct:   { strategy: 'mcq_single',                params: { correct: 1, wrong: 0, blank: 0 } },
  multiple_correct: { strategy: 'mcq_multiple_proportional', params: { correct: 1, wrong: 0, blank: 0 } },
  integer:          { strategy: 'integer_exact',             params: { correct: 1, wrong: 0, blank: 0 } },
  true_false:       { strategy: 'true_false',                params: { correct: 1, wrong: 0, blank: 0 } },
  short_answer:     manualDefault,
  subjective:       manualDefault,
}

export const EXAM_MODES: Record<ExamMode, ExamModeConfig> = {
  school: {
    id: 'school',
    label: 'School (Default)',
    description: 'Any question type. No negative marking unless you set it per question.',
    allowedKinds: ['single_correct', 'multiple_correct', 'integer', 'true_false', 'short_answer', 'subjective'],
    defaults: baselineDefaults,
    scoringEditable: true,
  },
  neet: {
    id: 'neet',
    label: 'NEET',
    description: 'Single Correct MCQ only · +4 correct, −1 wrong, 0 blank.',
    allowedKinds: ['single_correct'],
    defaults: {
      single_correct: { strategy: 'mcq_single', params: { correct: 4, wrong: -1, blank: 0 } },
    },
    scoringEditable: false,
  },
  jee_main: {
    id: 'jee_main',
    label: 'JEE Main',
    description: 'Single Correct (+4/−1/0) and Integer (+4/0/0).',
    allowedKinds: ['single_correct', 'integer'],
    defaults: {
      single_correct: { strategy: 'mcq_single',    params: { correct: 4, wrong: -1, blank: 0 } },
      integer:        { strategy: 'integer_exact', params: { correct: 4, wrong: 0,  blank: 0 } },
    },
    scoringEditable: false,
  },
  jee_advanced: {
    id: 'jee_advanced',
    label: 'JEE Advanced',
    description: 'Single (+3/−1/0), Multiple Correct partial (+4/+2/−2/0) and Integer (+4/0/0).',
    allowedKinds: ['single_correct', 'multiple_correct', 'integer'],
    defaults: {
      single_correct:   { strategy: 'mcq_single',     params: { correct: 3, wrong: -1, blank: 0 } },
      multiple_correct: { strategy: 'mcq_multiple_jee', params: { correct: 4, wrong: -2, blank: 0, partial: 2 } },
      integer:          { strategy: 'integer_exact',  params: { correct: 4, wrong: 0,  blank: 0 } },
    },
    scoringEditable: false,
  },
  custom: {
    id: 'custom',
    label: 'Custom',
    description: 'Pick any question types and set your own marks, penalties and partial credit.',
    allowedKinds: ['single_correct', 'multiple_correct', 'integer', 'true_false', 'short_answer', 'subjective'],
    defaults: baselineDefaults,
    scoringEditable: true,
  },
}

export function getExamMode(mode: ExamMode | string | null | undefined): ExamModeConfig {
  return EXAM_MODES[(mode as ExamMode)] ?? EXAM_MODES.school
}

export function listExamModes(): ExamModeConfig[] {
  return ['school', 'neet', 'jee_main', 'jee_advanced', 'custom'].map(m => EXAM_MODES[m as ExamMode])
}

/** The default scoring (strategy + params) for a kind under a mode. */
export function defaultScoring(mode: ExamMode, kind: QuestionKind): ModeKindDefault {
  const cfg = getExamMode(mode)
  return cfg.defaults[kind] ?? baselineDefaults[kind]
}

/**
 * Everything needed to insert a new question of `kind` under `mode`.
 * For editable modes (school/custom) the caller may pass a previous marks
 * value to preserve; otherwise the mode's fixed marks are used.
 */
export interface NewQuestionDefaults {
  type: QuestionType
  multiple_select: boolean
  marks: number
  scoring_strategy: ScoringStrategyId
  scoring_params: ScoringParams
}

export function newQuestionDefaults(
  mode: ExamMode,
  kind: QuestionKind,
  prevMarks?: number,
): NewQuestionDefaults {
  const meta = QUESTION_KINDS[kind]
  const cfg = getExamMode(mode)
  const def = defaultScoring(mode, kind)
  // Editable modes keep the teacher's marks; fixed modes pin the mode's marks.
  const correct = cfg.scoringEditable && prevMarks != null ? prevMarks : def.params.correct
  const params: ScoringParams = { ...def.params, correct }
  return {
    type: meta.type,
    multiple_select: meta.multiple_select,
    marks: correct,
    scoring_strategy: def.strategy,
    scoring_params: params,
  }
}

// ── Human-readable scoring summary (for editor + settings hints) ──

function fmt(n: number): string {
  if (n > 0) return `+${n}`
  return String(n)
}

export function scoringSummary(strategy: ScoringStrategyId, params: ScoringParams): string {
  if (strategy === 'manual') return 'Graded manually'
  if (strategy === 'mcq_multiple_jee') {
    return `${fmt(params.correct)} all correct · ${fmt(params.partial ?? 0)} partial · ${fmt(params.wrong)} wrong · ${params.blank} blank`
  }
  return `${fmt(params.correct)} correct · ${fmt(params.wrong)} wrong · ${params.blank} blank`
}

// ============================================================
// Grading
// ============================================================

export interface AutoGradeResult {
  /** Marks awarded for this question (may be negative). */
  awardedMarks: number
  /** true/false once attempted; null when left blank. */
  isCorrect: boolean | null
}

/** Subset of a question needed to grade it. */
export interface GradableQuestion {
  type: QuestionType
  marks: number
  options: QuestionOption[] | null
  correct_answer: CorrectAnswer
  multiple_select: boolean
  scoring_strategy?: ScoringStrategyId | null
  scoring_params?: ScoringParams | null
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/**
 * Resolve the strategy + params to grade a question with. Prefers the values
 * stored on the question (the future-proof path); falls back to a safe
 * no-negative scoring derived from the question's type for legacy rows.
 */
export function resolveScoring(q: GradableQuestion): { strategy: ScoringStrategyId; params: ScoringParams } {
  if (q.scoring_strategy && q.scoring_params) {
    return { strategy: q.scoring_strategy, params: q.scoring_params }
  }
  const kind = kindFromQuestion(q.type, q.multiple_select)
  const base = baselineDefaults[kind]
  return { strategy: base.strategy, params: { ...base.params, correct: q.marks } }
}

function selectedIds(response: AnswerResponse): string[] {
  if (Array.isArray(response)) return response.filter((v): v is string => typeof v === 'string')
  if (typeof response === 'string' && response) return [response]
  return []
}

function toNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) return Number(v)
  return null
}

/** Auto-grade a single question. Manual kinds return 0 / null (skip). */
export function gradeQuestionAuto(q: GradableQuestion, response: AnswerResponse): AutoGradeResult {
  const { strategy, params } = resolveScoring(q)
  return gradeWithStrategy(strategy, params, q, response)
}

export function gradeWithStrategy(
  strategy: ScoringStrategyId,
  params: ScoringParams,
  q: GradableQuestion,
  response: AnswerResponse,
): AutoGradeResult {
  switch (strategy) {
    case 'manual':
      return { awardedMarks: 0, isCorrect: null }

    case 'true_false': {
      if (typeof response !== 'boolean') return { awardedMarks: params.blank, isCorrect: null }
      const correct = response === q.correct_answer
      return { awardedMarks: correct ? params.correct : round2(params.wrong), isCorrect: correct }
    }

    case 'integer_exact': {
      const ans = toNumber(response)
      if (ans == null) return { awardedMarks: params.blank, isCorrect: null }
      const key = toNumber(q.correct_answer)
      const correct = key != null && ans === key
      return { awardedMarks: correct ? params.correct : round2(params.wrong), isCorrect: correct }
    }

    case 'mcq_single': {
      const correctIds = Array.isArray(q.correct_answer) ? (q.correct_answer as string[]) : []
      const selected = selectedIds(response)
      if (selected.length === 0) return { awardedMarks: params.blank, isCorrect: null }
      const correct = selected.length === 1 && correctIds.includes(selected[0])
      return { awardedMarks: correct ? params.correct : round2(params.wrong), isCorrect: correct }
    }

    case 'mcq_multiple_jee': {
      const correctIds = Array.isArray(q.correct_answer) ? (q.correct_answer as string[]) : []
      const selected = selectedIds(response)
      if (selected.length === 0) return { awardedMarks: params.blank, isCorrect: null }
      const anyWrong = selected.some(id => !correctIds.includes(id))
      if (anyWrong) return { awardedMarks: round2(params.wrong), isCorrect: false }
      const all = correctIds.length === selected.length && correctIds.every(id => selected.includes(id))
      if (all) return { awardedMarks: params.correct, isCorrect: true }
      return { awardedMarks: round2(params.partial ?? 0), isCorrect: false }
    }

    case 'mcq_multiple_proportional': {
      const correctIds = Array.isArray(q.correct_answer) ? (q.correct_answer as string[]) : []
      const selected = selectedIds(response)
      if (selected.length === 0) return { awardedMarks: params.blank, isCorrect: null }
      const numCorrect = correctIds.length
      const totalOptions = q.options?.length ?? 0
      const numWrongOptions = Math.max(0, totalOptions - numCorrect)
      const penalty = Math.abs(params.wrong) // total penalty pool, spread over wrong options
      let award = 0
      for (const id of selected) {
        if (correctIds.includes(id)) {
          if (numCorrect > 0) award += params.correct / numCorrect
        } else if (numWrongOptions > 0) {
          award -= penalty / numWrongOptions
        }
      }
      award = Math.min(params.correct, Math.max(award, params.wrong))
      const fullyCorrect =
        numCorrect === selected.length && correctIds.every(id => selected.includes(id))
      return { awardedMarks: round2(award), isCorrect: fullyCorrect }
    }

    default:
      return { awardedMarks: 0, isCorrect: null }
  }
}
