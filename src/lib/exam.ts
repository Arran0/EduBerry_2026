import { supabase, UserProfile, UserRole } from './supabase'
import { computeSubmissionScores, allManualGraded } from './examGrading'
import type { ExamMode, ScoringStrategyId, ScoringParams } from './examScoring'
import { createAssessment, upsertAssessmentMark, fetchStudentMembers } from './classrooms'

// ============================================================
// Exam App — shared types
//
// Types mirror the columns created by supabase-migrations/add_exam_app.sql
// and add_exam_modes_and_access.sql. Data-access functions live at the
// bottom of this file. The scoring engine (exam modes, question kinds,
// strategies) lives in ./examScoring.
// ============================================================

export type QuestionType = 'subjective' | 'objective' | 'mcq' | 'true_false' | 'integer'

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
 *   - integer    -> number    (the numeric key)
 *   - objective  -> string    (reference answer; manual-graded)
 *   - subjective -> null
 */
export type CorrectAnswer = string[] | boolean | string | number | null

/**
 * Shape of exam_answers.response (jsonb), by question type:
 *   - subjective / objective -> string   (typed answer text)
 *   - mcq                    -> string[] (selected option ids)
 *   - true_false             -> boolean
 *   - integer                -> number   (typed numeric answer)
 */
export type AnswerResponse = string | string[] | boolean | number | null

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
  exam_mode: ExamMode
  total_marks: number
  is_pyq: boolean
  results_published: boolean
  is_closed: boolean
  closed_at: string | null
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
  scoring_strategy: ScoringStrategyId | null
  scoring_params: ScoringParams | null
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
  scoring_strategy?: ScoringStrategyId | null
  scoring_params?: ScoringParams | null
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
  /** Number of distinct participant (audience) students. */
  audienceCount: number
  gradedCount: number
  /** Closed = manually closed, or all participants graded + results published. */
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
  exam_mode?: ExamMode
}

/**
 * Create an exam (and optional participants) via the server route, which runs
 * with the service role after verifying the caller. Done server-side so the
 * insert never depends on client-side RLS/session attachment.
 * `createdBy` is accepted for compatibility but the server uses the token's id.
 */
export async function createExam(
  input: CreateExamInput,
  createdBy?: string,
  audience?: { homeroomIds: string[]; userIds: string[] },
): Promise<Exam | null> {
  void createdBy
  const { data: { session } } = await supabase.auth.getSession()
  const token = session?.access_token
  if (!token) {
    console.error('createExam error: no active session')
    return null
  }
  try {
    const res = await fetch('/api/exam/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ input, audience: audience ?? null }),
    })
    const json = await res.json()
    if (!res.ok || !json.success) {
      console.error('createExam error:', json.error ?? res.status)
      return null
    }
    return json.exam as Exam
  } catch (err) {
    console.error('createExam error:', err)
    return null
  }
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
  const { error } = await supabase.from('exams').update({ ...updates }).eq('id', examId)
  if (error) {
    console.error('updateExam error:', error.message)
    return false
  }
  return true
}

/** Count an exam's participants (audience rows + any submissions). */
export async function countParticipants(examId: string): Promise<number> {
  const [{ count: audienceCount }, { count: submissionCount }] = await Promise.all([
    supabase.from('exam_audiences').select('*', { count: 'exact', head: true }).eq('exam_id', examId),
    supabase.from('exam_submissions').select('*', { count: 'exact', head: true }).eq('exam_id', examId),
  ])
  return (audienceCount ?? 0) + (submissionCount ?? 0)
}

/**
 * Delete an exam — only permitted when it has zero participants (no audience
 * rows and no submissions). Returns an error message when blocked.
 */
export async function deleteExam(examId: string): Promise<{ success: boolean; error?: string }> {
  const participants = await countParticipants(examId)
  if (participants > 0) {
    return { success: false, error: 'Remove all participants before deleting this exam.' }
  }
  const { error } = await supabase.from('exams').delete().eq('id', examId)
  if (error) {
    console.error('deleteExam error:', error.message)
    return { success: false, error: error.message }
  }
  return { success: true }
}

/**
 * Close an exam: locks new/continuing attempts and marks every participant
 * who has not submitted as absent, so grading can be finalised. The exam
 * moves to the Closed list. Owners/managers only (RLS-enforced).
 */
export async function closeExam(examId: string): Promise<boolean> {
  // Mark unattempted participants absent so the exam can be finalised.
  const students = await resolveAudienceStudents(examId)
  const { data: subs } = await supabase
    .from('exam_submissions')
    .select('student_id, status, is_absent')
    .eq('exam_id', examId)
  const done = new Set(
    (subs ?? [])
      .filter(s => s.is_absent || s.status === 'submitted' || s.status === 'graded')
      .map(s => s.student_id as string),
  )
  const absentees = students.filter(s => !done.has(s.id))
  if (absentees.length > 0) {
    await supabase.from('exam_submissions').upsert(
      absentees.map(s => ({ exam_id: examId, student_id: s.id, is_absent: true, status: 'graded' as const })),
      { onConflict: 'exam_id,student_id' },
    )
  }

  const { error } = await supabase
    .from('exams')
    .update({ is_closed: true, closed_at: new Date().toISOString() })
    .eq('id', examId)
  if (error) {
    console.error('closeExam error:', error.message)
    return false
  }
  return true
}

/** Re-open a manually-closed exam. */
export async function reopenExam(examId: string): Promise<boolean> {
  const { error } = await supabase
    .from('exams')
    .update({ is_closed: false, closed_at: null })
    .eq('id', examId)
  if (error) {
    console.error('reopenExam error:', error.message)
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
  scoring_strategy?: ScoringStrategyId | null
  scoring_params?: ScoringParams | null
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
      scoring_strategy: input.scoring_strategy ?? null,
      scoring_params: input.scoring_params ?? null,
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

/** Smart search for students by name or email (for audience pickers). */
export async function searchStudents(query: string, limit = 20): Promise<UserProfile[]> {
  const q = query.trim().replace(/[,()]/g, ' ')
  if (!q) return []
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('role', 'student')
    .or(`full_name.ilike.%${q}%,email.ilike.%${q}%`)
    .order('full_name', { ascending: true })
    .limit(limit)
  if (error) {
    console.error('searchStudents error:', error.message)
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

/**
 * Closed = the creator manually closed it, OR results are published and every
 * participant has a graded/absent submission.
 */
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
  const allGraded = audienceCount > 0 && gradedCount >= audienceCount
  const closed = exam.is_closed || (exam.results_published && allGraded)

  return {
    ...exam,
    isOwner: exam.created_by === ownerId,
    audienceCount,
    gradedCount,
    closed,
  }
}

/**
 * Exams a staff member can manage, split into Active / Closed.
 *   - teacher:     exams they own or grade
 *   - coordinator: the above + exams created by members of their team(s)
 *   - principal / admin: every exam
 * Mirrors the can_manage_exam() RLS rule so the list matches what they can open.
 */
export async function fetchExamsForTeacher(
  userId: string,
  role: UserRole = 'teacher',
): Promise<{ active: ExamTeacherSummary[]; closed: ExamTeacherSummary[] }> {
  const byId = new Map<string, Exam>()

  if (role === 'admin' || role === 'principal') {
    // RLS lets them read every exam.
    const { data } = await supabase.from('exams').select('*')
    for (const e of (data ?? []) as Exam[]) byId.set(e.id, e)
  } else {
    const { data: owned } = await supabase.from('exams').select('*').eq('created_by', userId)
    for (const e of (owned ?? []) as Exam[]) byId.set(e.id, e)

    const { data: graderRows } = await supabase
      .from('exam_graders')
      .select('exam_id')
      .eq('teacher_id', userId)
    const graderIds = (graderRows ?? []).map(r => r.exam_id as string)
    if (graderIds.length > 0) {
      const { data } = await supabase.from('exams').select('*').in('id', graderIds)
      for (const e of (data ?? []) as Exam[]) byId.set(e.id, e)
    }

    if (role === 'coordinator') {
      const creatorIds = await fetchCoordinatorTeamMemberIds(userId)
      if (creatorIds.length > 0) {
        const { data } = await supabase.from('exams').select('*').in('created_by', creatorIds)
        for (const e of (data ?? []) as Exam[]) byId.set(e.id, e)
      }
    }
  }

  const summaries = await Promise.all([...byId.values()].map(e => summariseTeacherExam(e, userId)))
  summaries.sort((a, b) => (a.created_at < b.created_at ? 1 : -1))

  return {
    active: summaries.filter(s => !s.closed),
    closed: summaries.filter(s => s.closed),
  }
}

/** Ids of every member of the teams where `coordinatorId` is the coordinator. */
async function fetchCoordinatorTeamMemberIds(coordinatorId: string): Promise<string[]> {
  const { data: teams } = await supabase.from('teams').select('id').eq('coordinator_id', coordinatorId)
  const teamIds = (teams ?? []).map(t => t.id as string)
  if (teamIds.length === 0) return []
  const { data: members } = await supabase
    .from('team_members')
    .select('user_id')
    .in('team_id', teamIds)
  return [...new Set((members ?? []).map(m => m.user_id as string))]
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

  // Questions and the submission only depend on examId / studentId, so fetch
  // them together rather than one-after-another.
  const [{ data: questions }, { data: submission }] = await Promise.all([
    supabase
      .from('exam_questions')
      .select('*')
      .eq('exam_id', examId)
      .order('position', { ascending: true }),
    supabase
      .from('exam_submissions')
      .select('*')
      .eq('exam_id', examId)
      .eq('student_id', studentId)
      .maybeSingle(),
  ])

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
    scoring_strategy: q.scoring_strategy,
    scoring_params: q.scoring_params,
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
      scoring_strategy: q.scoring_strategy ?? null,
      scoring_params: q.scoring_params ?? null,
      position: position++,
    })
  }
  return exam
}
