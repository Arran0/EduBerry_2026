-- ============================================
-- Report Card Titles & Remarks
-- ============================================
-- Adds:
--   1. report_card_title column on classroom_assessments (free-text tag chosen
--      from defaults or any custom title in report_card_titles).
--   2. report_card_titles table for school-wide custom tags created by staff
--      (defaults like "Term 1", "Mid Term", "Monthly Test - January", etc. are
--      hard-coded in the client and don't need rows here).
--   3. report_card_remarks table where staff leave comments on a student's
--      assessments grouped under a particular report card title.

-- 1. Tag column on assessments ------------------------------------------------
ALTER TABLE public.classroom_assessments
  ADD COLUMN IF NOT EXISTS report_card_title TEXT;

CREATE INDEX IF NOT EXISTS idx_assessments_report_card_title
  ON public.classroom_assessments(report_card_title);

-- 2. Custom report card titles ------------------------------------------------
CREATE TABLE IF NOT EXISTS public.report_card_titles (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL UNIQUE,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.report_card_titles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can view report card titles" ON public.report_card_titles;
CREATE POLICY "Anyone can view report card titles"
  ON public.report_card_titles FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "Staff can insert report card titles" ON public.report_card_titles;
CREATE POLICY "Staff can insert report card titles"
  ON public.report_card_titles FOR INSERT
  TO authenticated WITH CHECK (
    (auth.jwt() -> 'user_metadata' ->> 'role') IN ('teacher', 'coordinator', 'principal', 'admin')
  );

DROP POLICY IF EXISTS "Staff can delete report card titles" ON public.report_card_titles;
CREATE POLICY "Staff can delete report card titles"
  ON public.report_card_titles FOR DELETE
  TO authenticated USING (
    (auth.jwt() -> 'user_metadata' ->> 'role') IN ('coordinator', 'principal', 'admin')
  );

-- 3. Remarks ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.report_card_remarks (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  student_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  report_card_title TEXT NOT NULL,
  author_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  remark TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(student_id, report_card_title, author_id)
);

CREATE INDEX IF NOT EXISTS idx_remarks_student
  ON public.report_card_remarks(student_id);
CREATE INDEX IF NOT EXISTS idx_remarks_title
  ON public.report_card_remarks(report_card_title);

ALTER TABLE public.report_card_remarks ENABLE ROW LEVEL SECURITY;

-- Students can read their own remarks; staff can read any remark.
DROP POLICY IF EXISTS "View own or staff view all remarks" ON public.report_card_remarks;
CREATE POLICY "View own or staff view all remarks"
  ON public.report_card_remarks FOR SELECT
  TO authenticated USING (
    student_id = auth.uid()
    OR (auth.jwt() -> 'user_metadata' ->> 'role') IN ('teacher', 'coordinator', 'principal', 'admin')
  );

-- Staff can insert remarks (only as themselves).
DROP POLICY IF EXISTS "Staff can insert own remarks" ON public.report_card_remarks;
CREATE POLICY "Staff can insert own remarks"
  ON public.report_card_remarks FOR INSERT
  TO authenticated WITH CHECK (
    author_id = auth.uid()
    AND (auth.jwt() -> 'user_metadata' ->> 'role') IN ('teacher', 'coordinator', 'principal', 'admin')
  );

-- Staff can update/delete only their own remarks (admin/principal can manage any).
DROP POLICY IF EXISTS "Staff can update own remarks" ON public.report_card_remarks;
CREATE POLICY "Staff can update own remarks"
  ON public.report_card_remarks FOR UPDATE
  TO authenticated USING (
    author_id = auth.uid()
    OR (auth.jwt() -> 'user_metadata' ->> 'role') IN ('principal', 'admin')
  );

DROP POLICY IF EXISTS "Staff can delete own remarks" ON public.report_card_remarks;
CREATE POLICY "Staff can delete own remarks"
  ON public.report_card_remarks FOR DELETE
  TO authenticated USING (
    author_id = auth.uid()
    OR (auth.jwt() -> 'user_metadata' ->> 'role') IN ('principal', 'admin')
  );

DROP TRIGGER IF EXISTS report_card_remarks_updated_at ON public.report_card_remarks;
CREATE TRIGGER report_card_remarks_updated_at
  BEFORE UPDATE ON public.report_card_remarks
  FOR EACH ROW EXECUTE FUNCTION update_task_updated_at();

GRANT ALL ON public.report_card_titles TO anon, authenticated;
GRANT ALL ON public.report_card_remarks TO anon, authenticated;
