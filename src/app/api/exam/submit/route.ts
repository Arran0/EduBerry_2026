import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { gradeQuestionAuto } from '@/lib/examScoring'
import type { ExamQuestion, ExamAnswer, AnswerResponse } from '@/lib/exam'

// Submits a student's exam and auto-grades the MCQ + True/False questions.
//
// Auto-grading needs the questions' correct_answer, which students must NOT be
// able to read (RLS hides it pre-publish). So grading runs here with the
// service-role client, after verifying the caller actually owns the submission.
// Requires SUPABASE_SERVICE_ROLE_KEY in the environment.

export async function POST(request: NextRequest) {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL

  if (!serviceRoleKey || !supabaseUrl) {
    return NextResponse.json(
      { success: false, error: 'Server configuration error: SUPABASE_SERVICE_ROLE_KEY not set' },
      { status: 500 },
    )
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  // Authenticate the caller.
  const authHeader = request.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }
  const { data: { user: caller }, error: authError } = await admin.auth.getUser(authHeader.slice(7))
  if (authError || !caller) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }

  const { submissionId } = await request.json().catch(() => ({}))
  if (!submissionId) {
    return NextResponse.json({ success: false, error: 'submissionId is required' }, { status: 400 })
  }

  // Load the submission and verify ownership.
  const { data: submission } = await admin
    .from('exam_submissions')
    .select('id, exam_id, student_id, status')
    .eq('id', submissionId)
    .single()
  if (!submission) {
    return NextResponse.json({ success: false, error: 'Submission not found' }, { status: 404 })
  }
  if (submission.student_id !== caller.id) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 })
  }
  if (submission.status === 'submitted' || submission.status === 'graded') {
    return NextResponse.json({ success: false, error: 'Already submitted' }, { status: 409 })
  }

  // Load questions (with correct answers + per-question scoring) and saved answers.
  const [{ data: exam }, { data: questionRows }, { data: answerRows }] = await Promise.all([
    admin.from('exams').select('id').eq('id', submission.exam_id).single(),
    admin.from('exam_questions').select('*').eq('exam_id', submission.exam_id),
    admin.from('exam_answers').select('*').eq('submission_id', submissionId),
  ])

  if (!exam) {
    return NextResponse.json({ success: false, error: 'Exam not found' }, { status: 404 })
  }

  const questions = (questionRows ?? []) as ExamQuestion[]
  const answers = (answerRows ?? []) as ExamAnswer[]
  const answerByQ = new Map(answers.map(a => [a.question_id, a]))

  let autoScore = 0
  let maxScore = 0
  const autoUpserts: Array<Record<string, unknown>> = []

  // Auto-grade every non-manual question using the scoring strategy stored on
  // the question itself (mode-aware; manual kinds are skipped here).
  for (const q of questions) {
    maxScore += Number(q.marks ?? 0)
    if (q.type === 'objective' || q.type === 'subjective') continue

    const response: AnswerResponse = answerByQ.get(q.id)?.response ?? null
    const { awardedMarks, isCorrect } = gradeQuestionAuto(q, response)
    autoScore += awardedMarks
    autoUpserts.push({
      submission_id: submissionId,
      question_id: q.id,
      awarded_marks: awardedMarks,
      is_correct: isCorrect,
    })
  }

  if (autoUpserts.length > 0) {
    const { error: upErr } = await admin
      .from('exam_answers')
      .upsert(autoUpserts, { onConflict: 'submission_id,question_id' })
    if (upErr) {
      return NextResponse.json({ success: false, error: upErr.message }, { status: 500 })
    }
  }

  const { error: subErr } = await admin
    .from('exam_submissions')
    .update({
      status: 'submitted',
      submitted_at: new Date().toISOString(),
      auto_score: Math.round(autoScore * 100) / 100,
      max_score: Math.round(maxScore * 100) / 100,
    })
    .eq('id', submissionId)
  if (subErr) {
    return NextResponse.json({ success: false, error: subErr.message }, { status: 500 })
  }

  return NextResponse.json({
    success: true,
    autoScore: Math.round(autoScore * 100) / 100,
    maxScore: Math.round(maxScore * 100) / 100,
  })
}
