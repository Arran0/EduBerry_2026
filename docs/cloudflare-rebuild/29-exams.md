# Exams

As of 27 Oct 2026. Part of the [Cloudflare rebuild docs](README.md).

## 1. Summary

Online exams: staff build an exam (questions of five kinds, images, Excel import, templates and previous-year papers), choose an audience (homerooms or named students) and graders, set the window (start, due, end, duration, auto-close) and an exam mode with its scoring rules (school, NEET, JEE Main, JEE Advanced, custom). Students take it in the browser with a timer; objective questions are auto-graded on submit, subjective ones in a grading queue; results can be immediate or published later, reviewed by students, exported, and linked into a classroom assessment for report cards.

Live: 15 exams, 59 questions, 217 submissions, 430 answers, 6 templates.

What changes: the security that today relies on two `SECURITY DEFINER` routes and two guard triggers (students must never see correct answers before release; a submitted attempt can never change) becomes the exam module's own rules; scoring stays in the existing data-driven TypeScript engine (`examScoring.ts`), now run inside the object; timing uses the server clock.

## 2. Users and screens

| Route | Who | Purpose |
| --- | --- | --- |
| `/more/exam` (449 lines) | Staff; students | Exam list: mine to take, mine to grade, drafts, closed |
| `/more/exam/create`, `/more/exam/[examId]/edit` | Staff | `ExamBuilder`, `ExamSettingsForm`, `AudienceEditor`, `GradersEditor`, `ExcelQuestionImportModal` |
| `/more/exam/[examId]` (240 lines) | Staff | Exam home: sheet, grading tab, results tab |
| `/more/exam/[examId]/take` (548 lines) | Students | Timed attempt; answers saved as they go |
| `/more/exam/[examId]/grade/[studentId]` (264 lines) | Graders | Grade one student's subjective answers |
| `/more/exam/[examId]/review` (167 lines) | Students | Review after results are released |
| `/more/exam/pyq` (135 lines) | Staff, students | Previous-year question papers (`is_pyq`) |

Code: `src/lib/exam.ts` (1,507 lines), `examScoring.ts` (371, the scoring engine), `examGrading.ts`, `examExport.ts`; 15 components under `src/components/exam`; routes `/api/exam/create`, `/api/exam/submit`.

## 3. How it works today

1. **Create.** `/api/exam/create` (service role, after checking the caller is staff) inserts the exam and audience; questions are then added from the builder (`exam_questions`: type `subjective`, `objective`, `mcq`, `true_false`, `integer`; options, correct answer, marks, scoring strategy and parameters, image).
2. **Access.** A student may load questions (`get_exam_questions_for_student`, which never returns `correct_answer`) only if they are in the audience and the window is open (`start_at` ≤ now ≤ min(`due_at`, `end_at`)), or once review is allowed (`student_can_review_exam`).
3. **Attempt.** The student creates a submission (`not_started`/`in_progress`) and saves answers. `exam_submissions_guard` and `exam_answers_guard` stop a student setting scores, changing anything after submission, or writing answers to a closed attempt.
4. **Submit.** `/api/exam/submit` verifies ownership, marks the attempt `submitted`, auto-grades objective questions with the service role (because students cannot read correct answers), and on an immediate-results exam (every question auto-gradable) finalises the score and status `graded`.
5. **Grade.** Graders (`exam_graders`, plus the owner) score subjective answers; totals are recomputed (`examGrading.ts`).
6. **Close and publish.** `is_closed` (manual or `auto_close_at`), `results_published`; absent students marked `is_absent`.
7. **Link to report cards.** `exam_result_links` copies results into a classroom assessment ([30](30-grades-and-report-cards.md)).
8. **Templates.** `exam_templates` stores a question set (JSON) to reuse.

## 4. Data

| Table | Rows | Purpose |
| --- | --- | --- |
| `exams` | 15 | Title, subject, grade, window, duration, total marks, mode, flags (pyq, closed, results published, immediate results, auto close) |
| `exam_questions` | 59 | Type, prompt, marks, options, correct answer, scoring strategy and params, image, position |
| `exam_audiences` | 18 | Exam ↔ homeroom or user |
| `exam_graders` | 3 | Exam ↔ teacher |
| `exam_submissions` | 217 | Attempt: status, times, absent, auto/manual/total/max score, grader |
| `exam_answers` | 430 | Answer per question: response, awarded marks, correct flag, remark, grader |
| `exam_templates` | 6 | Reusable question sets |
| `exam_result_links` | 1 | Exam → classroom assessment |

## 5. Logic in the database

| Function | Target |
| --- | --- |
| `can_manage_exam`, `is_exam_owner`, `is_exam_student`, `submission_exam_id`, `student_can_review_exam` | Relationship helpers in the exam module |
| `get_exam_questions_for_student` | `exams.questionsForStudent(examId)`: strips `correct_answer` and checks the window against `ctx.now` |
| `exam_submissions_guard`, `exam_answers_guard` (triggers) | The only student write methods are `exams.start`, `exams.saveAnswer`, `exams.submit`; each enforces the same rules |
| `exam_set_created_by` (trigger) | Set from the session |
| `reorder_exam_questions` | `exams.reorderQuestions` |
| `exam_debug_whoami` | Dropped (debug helper) |

## 6. Server routes and integrations

| Route | Target |
| --- | --- |
| `/api/exam/create` | `exams.create` |
| `/api/exam/submit` | `exams.submit` (auto-grading inside the object, which can read correct answers; the student never can) |

## 7. Jobs, files and live updates

- **Files:** question images under `exams/<examId>/questions/`, readable by staff, and by students only while the exam is open or in review.
- **Jobs:** `auto_close_at` handled by a job (today it is checked when read); optional "mark non-attempters absent" at close.
- **Live updates:** none required; the take screen's timer uses the server clock offset like `useSchoolClock`.

## 8. Single-tenant assumptions

None.

## 9. Target design

### Tables

Carried over. Marks and scores are `REAL` rounded to 2 decimals ([13](13-data-layer.md)). Indexes: `exam_audiences (homeroom_id)`, `(user_id)`; `exam_submissions (exam_id, student_id)` unique; `exam_answers (submission_id, question_id)` unique.

### Methods

| Method | Permission |
| --- | --- |
| `exams.list` (to take, to grade, mine) | signed in |
| `exams.create`, `update`, `delete`, `questions.*`, `audience.*`, `graders.*`, `importQuestions`, `templates.*` | `exams.author` (staff); edits by owner or `exams.manage` |
| `exams.questionsForStudent`, `exams.start`, `exams.saveAnswer`, `exams.submit` | audience student within the window |
| `exams.gradeAnswer`, `exams.markAbsent`, `exams.close`, `exams.publish` | owner, graders, `exams.manage` |
| `exams.results`, `exams.export` | owner, graders, `exams.manage` |
| `exams.review` | the student after release |
| `exams.linkToAssessment` | owner with classroom staff rights |

`saveAnswer` is called often during an attempt (each answer change). It is a single small write; for a 40-student class finishing together that is a short burst well within one object's capacity, but the take screen should debounce saves (for example every few seconds or on question change).

## 10. Moving existing data

Straight copy; question image URLs → R2 keys.

## 11. Parity checklist

- [ ] A student can never receive `correct_answer` before review is allowed (test every read path).
- [ ] A submitted attempt cannot be changed by the student; scores cannot be set by students.
- [ ] Every scoring strategy in `examScoring.ts` produces the same marks for the same answers (port its tests).
- [ ] Immediate-results exams show the score at submission.
- [ ] The window is enforced with the server clock, not the device's.
- [ ] Linking to an assessment produces the same marks as today.

## 12. Open questions

- [ ] Should answers be autosaved offline (IndexedDB) for poor connections during an exam?
