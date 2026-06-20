import * as XLSX from 'xlsx'
import {
  ExamQuestion, fetchExamById, fetchQuestions, fetchGradingQueue,
} from './exam'

function answerKey(q: ExamQuestion): string {
  if (q.type === 'true_false') return q.correct_answer === true ? 'True' : q.correct_answer === false ? 'False' : ''
  if (q.type === 'mcq') {
    const ids = Array.isArray(q.correct_answer) ? q.correct_answer : []
    return (q.options ?? []).filter(o => ids.includes(o.id)).map(o => o.text).join('; ')
  }
  if (q.type === 'objective') return typeof q.correct_answer === 'string' ? q.correct_answer : ''
  return ''
}

/** Export an exam's question sheet and per-student scores to an .xlsx file. */
export async function exportExamSheet(examId: string): Promise<boolean> {
  const exam = await fetchExamById(examId)
  if (!exam) return false

  const [questions, queue] = await Promise.all([
    fetchQuestions(examId),
    fetchGradingQueue(examId),
  ])

  const questionRows = questions.map((q, i) => ({
    '#': i + 1,
    Type: q.type,
    Marks: q.marks,
    Question: q.prompt,
    'Answer key': answerKey(q),
  }))

  const scoreRows = queue.map(row => {
    const sub = row.submission
    const status = sub?.is_absent ? 'Absent' : sub?.status ?? 'not_started'
    return {
      Student: row.student.full_name,
      Email: row.student.email,
      Status: status,
      Total: sub?.total_score ?? '',
      Max: sub?.max_score ?? exam.total_marks,
    }
  })

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(questionRows), 'Questions')
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(scoreRows), 'Scores')

  const safe = exam.title.replace(/[^a-z0-9]+/gi, '_').slice(0, 40) || 'exam'
  XLSX.writeFile(wb, `${safe}.xlsx`)
  return true
}
