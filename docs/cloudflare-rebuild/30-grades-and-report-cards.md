# Assessments, Marks and Report Cards

As of 27 Oct 2026. Part of the [Cloudflare rebuild docs](README.md).

## 1. Summary

Teachers record assessments inside each classroom (tests, assignments; "main" or "other"), optionally split into components (for example Theory 60 + Practical 40), enter marks per student (with absent), and tag each assessment with a report-card title ("Term 1", "Half Yearly"...). Class teachers see class-wise marks across subjects for their grade-section, write remarks, and publish report cards for a class and title. Students and staff open report cards and the full academic record per year; marks print with CBSE-style letter bands.

Live: 252 assessments, 697 components, 6,213 assessment marks, 17,587 component marks, 10 report-card titles; no publications or remarks yet.

What changes: the component-to-total recompute trigger becomes explicit code in the mark-saving method; publication becomes the gate for students reading marks of a report-card title (today students can read their own raw marks whenever they like, even before a class is published); class-wise marks and trends read from indexed queries inside the object.

## 2. Users and screens

| Route | Who | Purpose |
| --- | --- | --- |
| Classroom → Assessments tab (`AssessmentsTab`, 1,967 lines) | Classroom staff | Create and edit assessments and components, marks grid, absent, conversion total, report-card title, import a marksheet, link exam results |
| Academics → Report cards (`ReportCardsSection`, 1,889 lines) | Students; class teachers; coordinators, principal, admin | Report cards per title and year; class marks view; publish and unpublish; remarks |
| `/academic-record/[studentId]` (469 lines) | The student; staff | Full-page academic record with school branding, printable |
| `/academics/grades` | — | Redirect |

Code: report-card and marks functions in `src/lib/classrooms.ts`, `classwiseMarks.ts`, `reportCardGrading.ts` (letter bands, rounding, rescaling), `reportCardPublication.ts`, `reportCardVisits.ts`; components `AssessmentBreakdown`, `PublishedPill`, `RemarksPanel`, `ReportCardTitlePicker`.

## 3. How it works today

1. **Assessment.** `classroom_assessments`: title, date, tag (`main`/`other`), max marks, optional `conversion_total` (rescale for the report card), `report_card_title`.
2. **Components.** If an assessment has components, marks are entered per component (`classroom_assessment_component_marks`); the trigger `tg_component_mark_recompute` calls `recompute_assessment_component_totals`, which rewrites the student's total in `classroom_assessment_marks` (absent only if absent in every component). `tg_component_sync_assessment` keeps the assessment's max marks equal to the sum of component maxima.
3. **Class-wise marks.** `fetchClasswiseMarks` gathers every classroom of a grade-section and their assessments for a title into one grid.
4. **Publication.** Publishing is per grade + section + title (`report_card_publications`); `can_publish_report_cards` allows admins, principals and the class teacher of that grade-section. Students see a report card only when its class is published.
5. **Remarks.** Per student per title (`report_card_remarks`), by staff.
6. **Trend.** `get_classroom_assessment_trend` for the analysis tab.
7. **Exam links.** Exam results can fill an assessment ([29](29-exams.md)).

## 4. Data

| Table | Rows | Purpose |
| --- | --- | --- |
| `classroom_assessments` | 252 | Assessment header |
| `classroom_assessment_components` | 697 | Components with max marks and order |
| `classroom_assessment_component_marks` | 17,587 | Student marks per component |
| `classroom_assessment_marks` | 6,213 | Student total per assessment |
| `report_card_titles` | 10 | Allowed titles |
| `report_card_publications` | 0 | Grade + section + title published |
| `report_card_remarks` | 0 | Student + title remark |

## 5. Logic in the database

| Function | Target |
| --- | --- |
| `tg_component_mark_recompute` → `recompute_assessment_component_totals` | `grades.saveComponentMarks` recomputes the affected students' totals in the same call |
| `tg_component_sync_assessment` | `grades.saveComponents` sets the assessment max |
| `can_publish_report_cards` | Relationship helper (class teacher of that grade-section, principal, admin) |
| `get_classroom_assessment_trend` | `grades.trend(classroomId, studentId?)` |

## 6. Server routes and integrations

None (browser queries). PDF and print rendering stay in the browser.

## 7. Jobs, files and live updates

None. Year-end archive moves a closed year's marks with the year ([13](13-data-layer.md)); the academic record reads archived years through the archive object.

## 8. Single-tenant assumptions

| Assumption | Fix |
| --- | --- |
| CBSE-style grade bands hard-coded in `reportCardGrading.ts` | Keep as the default; a per-school grading scale setting if a non-CBSE school joins |
| Section matching with `upper(btrim(...))` | Normalise sections on write |

## 9. Target design

### Tables

Carried over. Marks as `REAL` (2 decimals). Indexes: `classroom_assessments (classroom_id, report_card_title)`; marks `(assessment_id, student_id)` unique and `(student_id)`; component marks `(component_id, student_id)` unique; publications `(grade, section, report_card_title)` unique; remarks `(student_id, report_card_title)`.

### Rules

- A student reads marks for an assessment only if it has no report-card title, or its title is published for the student's grade-section. (Tightens today's behaviour; confirm with the school.)
- Staff read marks of classrooms they teach; class teachers read their grade-section; coordinators, principal and admin read all.

### Methods

| Method | Permission |
| --- | --- |
| `grades.assessments(classroomId)`, `grades.marks(assessmentId)` | classroom staff |
| `grades.saveAssessment`, `grades.deleteAssessment`, `grades.saveComponents` | classroom staff |
| `grades.saveMarks`, `grades.saveComponentMarks`, `grades.importMarksheet` | classroom staff |
| `grades.classwise(grade, section, title)` | class teacher of that grade-section; coordinator, principal, admin |
| `grades.publish`, `grades.unpublish` | class teacher of that grade-section; principal, admin |
| `grades.remarks.save` / `delete` | staff |
| `grades.reportCards(studentId, year)`, `grades.academicRecord(studentId)` | the student (published only); staff |
| `grades.titles.list` / `create` | staff / `grades.titles.manage` |
| `grades.trend` | classroom staff; the student for own trend |

## 10. Moving existing data

Straight copy. After import, recompute every assessment that has components and compare with the imported totals; any difference points to a total that was edited directly and needs a decision.

## 11. Parity checklist

- [ ] Totals from components match today, including all-absent and partly-absent students.
- [ ] Conversion totals and letter bands print the same numbers and letters.
- [ ] Class-wise marks grid matches today for every grade-section and title.
- [ ] Publishing and unpublishing a class shows and hides report cards for all its students at once.
- [ ] The printable academic record matches today's layout with the school's branding.

## 12. Open questions

- [ ] Should students be blocked from seeing raw marks of a report-card title before publication? (Recommended; today they are not.)
- [ ] Is a configurable grading scale needed for non-CBSE schools?
