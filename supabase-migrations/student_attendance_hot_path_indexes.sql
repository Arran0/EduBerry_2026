-- Student attendance hot paths were both landing on single-column indexes and
-- filtering the rest in the heap:
--   * the student calendar / academic-year summary / absence streaks all query
--     (student_id, date range) but only student_id was indexed;
--   * the manager report queries (date, status) ordered by student_id but only
--     date was indexed, so every page did a filter + top-N sort.
-- The two composites below cover both shapes; each of the old single-column
-- indexes is a leading prefix of its replacement, so they are pure write
-- overhead once these exist (the student_id FK stays covered by the first).

CREATE INDEX IF NOT EXISTS idx_attendance_records_student_date
  ON public.attendance_records (student_id, date) INCLUDE (status);

CREATE INDEX IF NOT EXISTS idx_attendance_records_date_status_student
  ON public.attendance_records (date, status, student_id);

DROP INDEX IF EXISTS public.idx_attendance_records_student_id;
DROP INDEX IF EXISTS public.idx_attendance_records_date;
