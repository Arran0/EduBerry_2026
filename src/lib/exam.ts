import { supabase, UserProfile, UserRole } from './supabase'
import { methodRatio, computeSubmissionScores, allManualGraded } from './examGrading'
import { createAssessment, upsertAssessmentMark, fetchStudentMembers } from './classrooms'

// ============================================================
// Exam App — shared types
//
// Types mirror the columns created by
// supabase-migrations/add_exam_app.sql. Data-access functions live at
// the bottom of this file (Round 3).
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

// ── List/summary types ───────────────────────────────────────

/** An exam in a teacher's Active/Closed lists, with grading progress. */
export interface ExamTeacherSummary extends Exam {
  isOwner: boolean
  audienceCount: number
  gradedCount: number
  closed: boolean
}

/** An exam in a student's Active/Closed lists, with their submission. */
export interface ExamStudentSummary extends Exam {
  submission: ExamSubmission | null
}

/** A row in the teacher grading queue: one audience student + their submission. */
export interface GradingQueueRow {
  student: UserProfile
  submission: ExamSubmission | null
}

/** Everything a student needs to review a published exam. */
export interface ExamReview {
  exam: Exam
  questions: ExamQuestion[]
  submission: ExamSubmission | null
  answers: ExamAnswer[]
}

// ============================================================
// Data-access layer (Round 3)
// ============================================================

// ── Exam CRUD ────────────────────────────────────────────────

export interface CreateExamInput {
  title: string
  description?: string | null
  subject?: string | null
  grade?: number | null
  duration_minutes?: number | null
  start_at?: string | null
  end_at?: string | null
  due_at?: string | null
  grading_method?: GradingMethod
  /** Only used when grading_method === 'custom'. */
  negative_ratio?: number | null
}

/** Resolve the stored negative_ratio from a method (+ custom override). */
function resolveNegativeRatio(method: GradingMethod, customRatio?: number | null): number {
  return method === 'custom' ? methodRatio('custom', customRatio) : methodRatio(method)
}

export async function createExam(input: CreateExamInput, createdBy: string): Promise<Exam | null> {
  const method = input.grading_method ?? 'none'
  const { data, error } = await supabase
    .from('exams')
    .insert({
      title: input.title,
      description: input.description ?? null,
      subject: input.subject ?? null,
      grade: input.grade ?? null,
      duration_minutes: input.duration_minutes ?? null,
      start_at: input.start_at ?? null,
      end_at: input.end_at ?? null,
      due_at: input.due_at ?? null,
      grading_method: method,
      negative_ratio: resolveNegativeRatio(method, input.negative_ratio),
      created_by: createdBy,
    })
    .select()
    .single()

  if (error) {
    console.error('createExam error:', error.message)
    return null
  }
  return data as Exam
}

export async function fetchExamById(examId: string): Promise<Exam | null> {
  const { data, error } = await supabase.from('exams').select('*').eq('id', examId).single()
  if (error) {
    console.error('fetchExamById error:', error.message)
    return null
  }
  return data as Exam
}

export async function updateExam(
  examId: string,
  updates: Partial<CreateExamInput>,
): Promise<boolean> {
  const patch: Record<string, unknown> = { ...updates }
  // Keep negative_ratio consistent with the grading method.
  if (updates.grading_method !== undefined) {
    patch.negative_ratio = resolveNegativeRatio(updates.grading_method, updates.negative_ratio)
  }
  const { error } = await supabase.from('exams').update(patch).eq('id', examId)
  if (error) {
    console.error('updateExam error:', error.message)
    return false
  }
  return true
}

export async function deleteExam(examId: string): Promise<boolean> {
  const { error } = await supabase.from('exams').delete().eq('id', examId)
  if (error) {
    console.error('deleteExam error:', error.message)
    return false
  }
  return true
}

/** Recompute and persist exams.total_marks from its questions. */
async function recomputeTotalMarks(examId: string): Promise<void> {
  const { data } = await supabase.from('exam_questions').select('marks').eq('exam_id', examId)
  const total = (data ?? []).reduce((sum, q) => sum + Number(q.marks ?? 0), 0)
  await supabase.from('exams').update({ total_marks: total }).eq('id', examId)
}

// ── Questions ────────────────────────────────────────────────

export async function fetchQuestions(examId: string): Promise<ExamQuestion[]> {
  const { data, error } = await supabase
    .from('exam_questions')
    .select('*')
    .eq('exam_id', examId)
    .order('position', { ascending: true })
  if (error) {
    console.error('fetchQuestions error:', error.message)
    return []
  }
  return (data ?? []) as ExamQuestion[]
}

export interface QuestionInput {
  type: QuestionType
  prompt: string
  marks: number
  options?: QuestionOption[] | null
  correct_answer?: CorrectAnswer
  multiple_select?: boolean
  position?: number
}

export async function addQuestion(examId: string, input: QuestionInput): Promise<ExamQuestion | null> {
  let position = input.position
  if (position == null) {
    const { count } = await supabase
      .from('exam_questions')
      .select('*', { count: 'exact', head: true })
      .eq('exam_id', examId)
    position = count ?? 0
  }

  const { data, error } = await supabase
    .from('exam_questions')
    .insert({
      exam_id: examId,
      position,
      type: input.type,
      prompt: input.prompt,
      marks: input.marks,
      options: input.options ?? null,
      correct_answer: input.correct_answer ?? null,
      multiple_select: input.multiple_select ?? false,
    })
    .select()
    .single()

  if (error) {
    console.error('addQuestion error:', error.message)
    return null
  }
  await recomputeTotalMarks(examId)
  return data as ExamQuestion
}

export async function updateQuestion(
  questionId: string,
  updates: Partial<QuestionInput>,
): Promise<boolean> {
  const { data, error } = await supabase
    .from('exam_questions')
    .update(updates)
    .eq('id', questionId)
    .select('exam_id')
    .single()
  if (error) {
    console.error('updateQuestion error:', error.message)
    return false
  }
  if (data?.exam_id) await recomputeTotalMarks(data.exam_id as string)
  return true
}

export async function deleteQuestion(questionId: string): Promise<boolean> {
  const { data: existing } = await supabase
    .from('exam_questions')
    .select('exam_id')
    .eq('id', questionId)
    .single()
  const { error } = await supabase.from('exam_questions').delete().eq('id', questionId)
  if (error) {
    console.error('deleteQuestion error:', error.message)
    return false
  }
  if (existing?.exam_id) await recomputeTotalMarks(existing.exam_id as string)
  return true
}

/** Persist a new order; orderedIds must be the full set of question ids. */
export async function reorderQuestions(examId: string, orderedIds: string[]): Promise<boolean> {
  const results = await Promise.all(
    orderedIds.map((id, idx) =>
      supabase.from('exam_questions').update({ position: idx }).eq('id', id).eq('exam_id', examId),
    ),
  )
  const failed = results.find(r => r.error)
  if (failed?.error) {
    console.error('reorderQuestions error:', failed.error.message)
    return false
  }
  return true
}

// ── Audience ─────────────────────────────────────────────────

export async function fetchAudience(examId: string): Promise<ExamAudience[]> {
  const { data, error } = await supabase.from('exam_audiences').select('*').eq('exam_id', examId)
  if (error) {
    console.error('fetchAudience error:', error.message)
    return []
  }
  return (data ?? []) as ExamAudience[]
}

/** Replace an exam's audience with the given homerooms and individual students. */
export async function setExamAudience(
  examId: string,
  target: { homeroomIds: string[]; userIds: string[] },
): Promise<boolean> {
  const { error: delErr } = await supabase.from('exam_audiences').delete().eq('exam_id', examId)
  if (delErr) {
    console.error('setExamAudience delete error:', delErr.message)
    return false
  }
  const rows = [
    ...target.homeroomIds.map(homeroom_id => ({ exam_id: examId, homeroom_id })),
    ...target.userIds.map(user_id => ({ exam_id: examId, user_id })),
  ]
  if (rows.length === 0) return true
  const { error } = await supabase.from('exam_audiences').insert(rows)
  if (error) {
    console.error('setExamAudience insert error:', error.message)
    return false
  }
  return true
}

/** Expand an exam's audience (homerooms + individuals) into a deduped student list. */
export async function resolveAudienceStudents(examId: string): Promise<UserProfile[]> {
  const audiences = await fetchAudience(examId)
  const homeroomIds = audiences.map(a => a.homeroom_id).filter((v): v is string => !!v)
  const userIds = audiences.map(a => a.user_id).filter((v): v is string => !!v)

  const byId = new Map<string, UserProfile>()

  if (homeroomIds.length > 0) {
    const { data } = await supabase
      .from('homeroom_members')
      .select('student:profiles!homeroom_members_student_id_fkey(*)')
      .in('homeroom_id', homeroomIds)
    for (const row of data ?? []) {
      const s = (Array.isArray(row.student) ? row.student[0] : row.student) as UserProfile | undefined
      if (s) byId.set(s.id, s)
    }
  }

  if (userIds.length > 0) {
    const { data } = await supabase.from('profiles').select('*').in('id', userIds)
    for (const s of (data ?? []) as UserProfile[]) byId.set(s.id, s)
  }

  return [...byId.values()]
}

// ── Profile lookups (for audience / grader editors) ──────────

export async function fetchProfilesByIds(ids: string[]): Promise<UserProfile[]> {
  if (ids.length === 0) return []
  const { data, error } = await supabase.from('profiles').select('*').in('id', ids)
  if (error) {
    console.error('fetchProfilesByIds error:', error.message)
    return []
  }
  return (data ?? []) as UserProfile[]
}

/** Look up a single user by email, optionally restricted to certain roles. */
export async function findUserByEmail(
  email: string,
  roles?: UserRole[],
): Promise<{ user?: UserProfile; error?: string }> {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('email', email.trim().toLowerCase())
    .maybeSingle()

  if (error) return { error: error.message }
  if (!data) return { error: 'No user found with that email' }
  if (roles && !roles.includes((data as UserProfile).role)) {
    return { error: `That user is not a ${roles.join(' / ')}` }
  }
  return { user: data as UserProfile }
}

// ── Graders ──────────────────────────────────────────────────

export async function fetchGraders(examId: string): Promise<ExamGrader[]> {
  const { data, error } = await supabase
    .from('exam_graders')
    .select('*, teacher:profiles!exam_graders_teacher_id_fkey(*)')
    .eq('exam_id', examId)
  if (error) {
    console.error('fetchGraders error:', error.message)
    return []
  }
  return (data ?? []).map(g => ({
    ...g,
    teacher: Array.isArray(g.teacher) ? g.teacher[0] : g.teacher,
  })) as ExamGrader[]
}

export async function addGrader(examId: string, teacherId: string, addedBy: string): Promise<boolean> {
  const { error } = await supabase
    .from('exam_graders')
    .insert({ exam_id: examId, teacher_id: teacherId, added_by: addedBy })
  if (error) {
    console.error('addGrader error:', error.message)
    return false
  }
  return true
}

export async function removeGrader(examId: string, teacherId: string): Promise<boolean> {
  const { error } = await supabase
    .from('exam_graders')
    .delete()
    .eq('exam_id', examId)
    .eq('teacher_id', teacherId)
  if (error) {
    console.error('removeGrader error:', error.message)
    return false
  }
  return true
}

// ── Exam lists ───────────────────────────────────────────────

/** Closed = every audience student has a graded or absent submission. */
async function summariseTeacherExam(exam: Exam, ownerId: string): Promise<ExamTeacherSummary> {
  const students = await resolveAudienceStudents(exam.id)
  const audienceIds = new Set(students.map(s => s.id))
  const audienceCount = audienceIds.size

  const { data: subs } = await supabase
    .from('exam_submissions')
    .select('student_id, status, is_absent')
    .eq('exam_id', exam.id)

  const doneIds = new Set(
    (subs ?? [])
      .filter(s => s.status === 'graded' || s.is_absent)
      .map(s => s.student_id as string)
      .filter(id => audienceIds.has(id)),
  )
  const gradedCount = doneIds.size
  const closed = audienceCount > 0 && gradedCount >= audienceCount

  return {
    ...exam,
    isOwner: exam.created_by === ownerId,
    audienceCount,
    gradedCount,
    closed,
  }
}

/** Exams a teacher owns or grades, split into Active / Closed. */
export async function fetchExamsForTeacher(
  userId: string,
): Promise<{ active: ExamTeacherSummary[]; closed: ExamTeacherSummary[] }> {
  const { data: owned } = await supabase.from('exams').select('*').eq('created_by', userId)

  const { data: graderRows } = await supabase
    .from('exam_graders')
    .select('exam_id')
    .eq('teacher_id', userId)
  const graderIds = (graderRows ?? []).map(r => r.exam_id as string)

  let gradedExams: Exam[] = []
  if (graderIds.length > 0) {
    const { data } = await supabase.from('exams').select('*').in('id', graderIds)
    gradedExams = (data ?? []) as Exam[]
  }

  const byId = new Map<string, Exam>()
  for (const e of [...((owned ?? []) as Exam[]), ...gradedExams]) byId.set(e.id, e)

  const summaries = await Promise.all([...byId.values()].map(e => summariseTeacherExam(e, userId)))
  summaries.sort((a, b) => (a.created_at < b.created_at ? 1 : -1))

  return {
    active: summaries.filter(s => !s.closed),
    closed: summaries.filter(s => s.closed),
  }
}

/** Exams a student is in the audience for, split into Active / Closed. */
export async function fetchExamsForStudent(
  userId: string,
): Promise<{ active: ExamStudentSummary[]; closed: ExamStudentSummary[] }> {
  // RLS limits a student to exams in their audience.
  const { data: exams } = await supabase
    .from('exams')
    .select('*')
    .order('created_at', { ascending: false })

  const { data: subs } = await supabase
    .from('exam_submissions')
    .select('*')
    .eq('student_id', userId)
  const subByExam = new Map<string, ExamSubmission>()
  for (const s of (subs ?? []) as ExamSubmission[]) subByExam.set(s.exam_id, s)

  const summaries: ExamStudentSummary[] = ((exams ?? []) as Exam[]).map(e => ({
    ...e,
    submission: subByExam.get(e.id) ?? null,
  }))

  return {
    active: summaries.filter(s => !s.results_published),
    closed: summaries.filter(s => s.results_published),
  }
}

// ── Student attempt ──────────────────────────────────────────

/** Student-safe questions (no correct_answer) for taking the exam. */
export async function fetchQuestionsForStudent(examId: string): Promise<StudentExamQuestion[]> {
  const { data, error } = await supabase.rpc('get_exam_questions_for_student', { p_exam_id: examId })
  if (error) {
    console.error('fetchQuestionsForStudent error:', error.message)
    return []
  }
  return (data ?? []) as StudentExamQuestion[]
}

/** Create or resume the student's submission, marking it in progress. */
export async function startAttempt(examId: string, studentId: string): Promise<ExamSubmission | null> {
  const { data: existing } = await supabase
    .from('exam_submissions')
    .select('*')
    .eq('exam_id', examId)
    .eq('student_id', studentId)
    .maybeSingle()

  if (existing) {
    if (existing.status === 'not_started') {
      const { data } = await supabase
        .from('exam_submissions')
        .update({ status: 'in_progress', started_at: new Date().toISOString() })
        .eq('id', existing.id)
        .select()
        .single()
      return (data ?? existing) as ExamSubmission
    }
    return existing as ExamSubmission
  }

  const { data, error } = await supabase
    .from('exam_submissions')
    .insert({
      exam_id: examId,
      student_id: studentId,
      status: 'in_progress',
      started_at: new Date().toISOString(),
    })
    .select()
    .single()
  if (error) {
    console.error('startAttempt error:', error.message)
    return null
  }
  return data as ExamSubmission
}

/** Fetch the answers for a submission (own submission via RLS, or as a manager). */
export async function fetchAnswers(submissionId: string): Promise<ExamAnswer[]> {
  const { data, error } = await supabase
    .from('exam_answers')
    .select('*')
    .eq('submission_id', submissionId)
  if (error) {
    console.error('fetchAnswers error:', error.message)
    return []
  }
  return (data ?? []) as ExamAnswer[]
}

/** Autosave a single answer (does not touch grading fields). */
export async function saveAnswer(
  submissionId: string,
  questionId: string,
  response: AnswerResponse,
): Promise<boolean> {
  const { error } = await supabase
    .from('exam_answers')
    .upsert(
      { submission_id: submissionId, question_id: questionId, response },
      { onConflict: 'submission_id,question_id' },
    )
  if (error) {
    console.error('saveAnswer error:', error.message)
    return false
  }
  return true
}

/**
 * Submit an exam. Auto-grading (which needs the correct answers students
 * cannot read) runs server-side in /api/exam/submit using the service role.
 */
export async function submitExam(
  submissionId: string,
): Promise<{ success: boolean; error?: string }> {
  const { data: { session } } = await supabase.auth.getSession()
  const token = session?.access_token
  if (!token) return { success: false, error: 'Not authenticated' }

  try {
    const res = await fetch('/api/exam/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ submissionId }),
    })
    const json = await res.json()
    if (!res.ok || !json.success) {
      return { success: false, error: json.error ?? 'Submission failed' }
    }
    return { success: true }
  } catch (err) {
    console.error('submitExam error:', err)
    return { success: false, error: 'Network error' }
  }
}

// ── Grading ──────────────────────────────────────────────────

/** Fetch a single student's submission for an exam (manager or owner via RLS). */
export async function fetchSubmissionForStudent(
  examId: string,
  studentId: string,
): Promise<ExamSubmission | null> {
  const { data } = await supabase
    .from('exam_submissions')
    .select('*')
    .eq('exam_id', examId)
    .eq('student_id', studentId)
    .maybeSingle()
  return (data ?? null) as ExamSubmission | null
}

/** Every audience student paired with their submission (if any). */
export async function fetchGradingQueue(examId: string): Promise<GradingQueueRow[]> {
  const students = await resolveAudienceStudents(examId)
  const { data: subs } = await supabase
    .from('exam_submissions')
    .select('*')
    .eq('exam_id', examId)
  const subByStudent = new Map<string, ExamSubmission>()
  for (const s of (subs ?? []) as ExamSubmission[]) subByStudent.set(s.student_id, s)

  return students
    .map((student): GradingQueueRow => ({ student, submission: subByStudent.get(student.id) ?? null }))
    .sort((a, b) => (a.student.full_name || '').localeCompare(b.student.full_name || ''))
}

/** Grade a single answer (upserts so blank manual answers can be marked). */
export async function gradeAnswer(
  submissionId: string,
  questionId: string,
  marks: number,
  remark: string | null,
  gradedBy: string,
): Promise<boolean> {
  const { error } = await supabase
    .from('exam_answers')
    .upsert(
      {
        submission_id: submissionId,
        question_id: questionId,
        awarded_marks: marks,
        remark: remark,
        graded_by: gradedBy,
      },
      { onConflict: 'submission_id,question_id' },
    )
  if (error) {
    console.error('gradeAnswer error:', error.message)
    return false
  }
  return true
}

/** Recompute scores and set status to 'graded' once all manual answers are marked. */
export async function finalizeSubmission(submissionId: string, gradedBy: string): Promise<boolean> {
  const { data: sub } = await supabase
    .from('exam_submissions')
    .select('exam_id')
    .eq('id', submissionId)
    .single()
  if (!sub?.exam_id) return false

  const [{ data: questions }, { data: answers }] = await Promise.all([
    supabase.from('exam_questions').select('id, type, marks').eq('exam_id', sub.exam_id),
    supabase.from('exam_answers').select('question_id, awarded_marks').eq('submission_id', submissionId),
  ])

  const qs = (questions ?? []) as Pick<ExamQuestion, 'id' | 'type' | 'marks'>[]
  const as = (answers ?? []) as Pick<ExamAnswer, 'question_id' | 'awarded_marks'>[]
  const scores = computeSubmissionScores(qs, as)
  const done = allManualGraded(qs, as)

  const { error } = await supabase
    .from('exam_submissions')
    .update({
      auto_score: scores.autoScore,
      manual_score: scores.manualScore,
      total_score: scores.totalScore,
      max_score: scores.maxScore,
      graded_by: gradedBy,
      graded_at: new Date().toISOString(),
      status: done ? 'graded' : 'submitted',
    })
    .eq('id', submissionId)
  if (error) {
    console.error('finalizeSubmission error:', error.message)
    return false
  }
  return true
}

export async function publishResults(examId: string): Promise<boolean> {
  const { error } = await supabase
    .from('exams')
    .update({ results_published: true })
    .eq('id', examId)
  if (error) {
    console.error('publishResults error:', error.message)
    return false
  }
  return true
}

/** Mark a no-show absent so the exam can still reach Closed. */
export async function markAbsent(examId: string, studentId: string): Promise<boolean> {
  const { error } = await supabase
    .from('exam_submissions')
    .upsert(
      { exam_id: examId, student_id: studentId, is_absent: true, status: 'graded' },
      { onConflict: 'exam_id,student_id' },
    )
  if (error) {
    console.error('markAbsent error:', error.message)
    return false
  }
  return true
}

// ── Student review ───────────────────────────────────────────

/** Full review of a published exam: questions, the student's answers, remarks. */
export async function fetchStudentReview(examId: string, studentId: string): Promise<ExamReview | null> {
  const exam = await fetchExamById(examId)
  if (!exam) return null
  if (!exam.results_published) {
    return { exam, questions: [], submission: null, answers: [] }
  }

  const { data: questions } = await supabase
    .from('exam_questions')
    .select('*')
    .eq('exam_id', examId)
    .order('position', { ascending: true })

  const { data: submission } = await supabase
    .from('exam_submissions')
    .select('*')
    .eq('exam_id', examId)
    .eq('student_id', studentId)
    .maybeSingle()

  let answers: ExamAnswer[] = []
  if (submission) {
    const { data } = await supabase
      .from('exam_answers')
      .select('*')
      .eq('submission_id', submission.id)
    answers = (data ?? []) as ExamAnswer[]
  }

  return {
    exam,
    questions: (questions ?? []) as ExamQuestion[],
    submission: (submission ?? null) as ExamSubmission | null,
    answers,
  }
}

// ── Result linking to classroom assessments ──────────────────

export interface LinkResult {
  classrooms: number
  linked: number
}

/**
 * Push graded exam totals into one or more classrooms as a new assessment.
 * Only students who are in BOTH the exam audience and the classroom get a mark.
 */
export async function linkResultsToClassrooms(
  examId: string,
  classroomIds: string[],
  linkedBy: string,
): Promise<LinkResult> {
  const exam = await fetchExamById(examId)
  if (!exam) return { classrooms: 0, linked: 0 }

  // Graded, present submissions with a score, keyed by student.
  const { data: subs } = await supabase
    .from('exam_submissions')
    .select('student_id, total_score, max_score, status, is_absent')
    .eq('exam_id', examId)
  const scoreByStudent = new Map<string, { total: number; max: number }>()
  for (const s of subs ?? []) {
    if (s.status === 'graded' && !s.is_absent && s.total_score != null) {
      scoreByStudent.set(s.student_id as string, {
        total: Number(s.total_score),
        max: Number(s.max_score ?? exam.total_marks),
      })
    }
  }

  let totalLinked = 0
  let classroomsLinked = 0

  for (const classroomId of classroomIds) {
    const members = await fetchStudentMembers(classroomId)
    const matched = members.filter(m => scoreByStudent.has(m.user_id))
    if (matched.length === 0) continue

    const assessment = await createAssessment(
      {
        classroom_id: classroomId,
        title: exam.title,
        description: exam.subject ? `Exam: ${exam.subject}` : 'Linked from exam',
        date: new Date().toISOString().split('T')[0],
        tag: 'other',
      },
      linkedBy,
    )
    if (!assessment) continue

    for (const m of matched) {
      const score = scoreByStudent.get(m.user_id)!
      await upsertAssessmentMark(assessment.id, m.user_id, score.total, score.max)
      totalLinked++
    }

    await supabase.from('exam_result_links').insert({
      exam_id: examId,
      classroom_id: classroomId,
      assessment_id: assessment.id,
      linked_by: linkedBy,
    })
    classroomsLinked++
  }

  return { classrooms: classroomsLinked, linked: totalLinked }
}

export async function fetchResultLinks(examId: string): Promise<ExamResultLink[]> {
  const { data } = await supabase.from('exam_result_links').select('*').eq('exam_id', examId)
  return (data ?? []) as ExamResultLink[]
}

// ── PYQ templates ────────────────────────────────────────────

/** Snapshot an exam's questions into the reusable PYQ library. */
export async function saveAsPyq(examId: string, createdBy: string): Promise<ExamTemplate | null> {
  const exam = await fetchExamById(examId)
  if (!exam) return null
  const questions = await fetchQuestions(examId)

  const snapshot: TemplateQuestion[] = questions.map(q => ({
    type: q.type,
    prompt: q.prompt,
    marks: q.marks,
    options: q.options,
    correct_answer: q.correct_answer,
    multiple_select: q.multiple_select,
  }))

  const { data, error } = await supabase
    .from('exam_templates')
    .insert({
      source_exam_id: examId,
      title: exam.title,
      subject: exam.subject,
      created_by: createdBy,
      questions: snapshot,
    })
    .select()
    .single()

  if (error) {
    console.error('saveAsPyq error:', error.message)
    return null
  }
  return data as ExamTemplate
}

export async function fetchPyqLibrary(): Promise<ExamTemplate[]> {
  const { data, error } = await supabase
    .from('exam_templates')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) {
    console.error('fetchPyqLibrary error:', error.message)
    return []
  }
  return (data ?? []) as ExamTemplate[]
}

export async function deletePyq(templateId: string): Promise<boolean> {
  const { error } = await supabase.from('exam_templates').delete().eq('id', templateId)
  if (error) {
    console.error('deletePyq error:', error.message)
    return false
  }
  return true
}

/** Create a fresh draft exam from a PYQ template (no audience/window). */
export async function createExamFromTemplate(
  templateId: string,
  createdBy: string,
): Promise<Exam | null> {
  const { data: template } = await supabase
    .from('exam_templates')
    .select('*')
    .eq('id', templateId)
    .single()
  if (!template) return null
  const tpl = template as ExamTemplate

  const exam = await createExam({ title: tpl.title, subject: tpl.subject }, createdBy)
  if (!exam) return null

  let position = 0
  for (const q of tpl.questions ?? []) {
    await addQuestion(exam.id, {
      type: q.type,
      prompt: q.prompt,
      marks: q.marks,
      options: q.options,
      correct_answer: q.correct_answer,
      multiple_select: q.multiple_select,
      position: position++,
    })
  }
  return exam
}
