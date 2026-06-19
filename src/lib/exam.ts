import { UserProfile } from './supabase'

// ============================================================
// Exam App — shared types
//
// Round 1: types only. Data-access functions are added in a later
// round. These mirror the columns created by
// supabase-migrations/add_exam_app.sql.
// ============================================================

export type QuestionType = 'subjective' | 'objective' | 'mcq' | 'true_false'

export type GradingMethod = 'none' | 'neet' | 'jee' | 'custom'

export type SubmissionStatus = 'not_started' | 'in_progress' | 'submitted' | 'graded'

/** A single selectable choice for an MCQ. Stored in exam_questions.options. */
export interface QuestionOption {
  id: string
  text: string
}

/**
 * Shape of exam_questions.correct_answer (jsonb), by question type:
 *   - mcq        -> string[]  (option ids; one element unless multiple_select)
 *   - true_false -> boolean
 *   - objective  -> string    (reference answer; manual-graded)
 *   - subjective -> null
 */
export type CorrectAnswer = string[] | boolean | string | null

/**
 * Shape of exam_answers.response (jsonb), by question type:
 *   - subjective / objective -> string   (typed answer text)
 *   - mcq                    -> string[] (selected option ids)
 *   - true_false             -> boolean
 */
export type AnswerResponse = string | string[] | boolean | null

export interface Exam {
  id: string
  title: string
  description: string | null
  subject: string | null
  grade: number | null
  created_by: string | null
  duration_minutes: number | null
  start_at: string | null
  end_at: string | null
  due_at: string | null
  grading_method: GradingMethod
  negative_ratio: number
  total_marks: number
  is_pyq: boolean
  results_published: boolean
  created_at: string
  updated_at: string
}

export interface ExamQuestion {
  id: string
  exam_id: string
  position: number
  type: QuestionType
  prompt: string
  marks: number
  options: QuestionOption[] | null
  correct_answer: CorrectAnswer
  multiple_select: boolean
  created_at: string
}

/**
 * Student-safe question (no correct_answer) — the shape returned by the
 * get_exam_questions_for_student RPC used during exam-taking.
 */
export type StudentExamQuestion = Omit<ExamQuestion, 'correct_answer' | 'created_at'>

/** A row in exam_audiences: targets EITHER a homeroom OR an individual. */
export interface ExamAudience {
  id: string
  exam_id: string
  homeroom_id: string | null
  user_id: string | null
  created_at: string
}

export interface ExamGrader {
  id: string
  exam_id: string
  teacher_id: string
  added_by: string | null
  created_at: string
  teacher?: UserProfile
}

export interface ExamSubmission {
  id: string
  exam_id: string
  student_id: string
  started_at: string | null
  submitted_at: string | null
  status: SubmissionStatus
  is_absent: boolean
  auto_score: number | null
  manual_score: number | null
  total_score: number | null
  max_score: number | null
  graded_by: string | null
  graded_at: string | null
  created_at: string
  updated_at: string
  student?: UserProfile
}

export interface ExamAnswer {
  id: string
  submission_id: string
  question_id: string
  response: AnswerResponse
  awarded_marks: number | null
  is_correct: boolean | null
  remark: string | null
  graded_by: string | null
  created_at: string
  updated_at: string
}

/** A snapshot of a question stored inside an exam_templates.questions array. */
export interface TemplateQuestion {
  type: QuestionType
  prompt: string
  marks: number
  options: QuestionOption[] | null
  correct_answer: CorrectAnswer
  multiple_select: boolean
}

export interface ExamTemplate {
  id: string
  source_exam_id: string | null
  title: string
  subject: string | null
  created_by: string | null
  questions: TemplateQuestion[]
  created_at: string
}

export interface ExamResultLink {
  id: string
  exam_id: string
  classroom_id: string
  assessment_id: string | null
  linked_by: string | null
  created_at: string
}
