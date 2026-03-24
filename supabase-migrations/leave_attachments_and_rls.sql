-- ============================================================
-- Migration: Leave system – attachments + RLS hardening
-- Run this in the Supabase SQL Editor
-- ============================================================

-- 1. Add attachment columns to leave_applications
ALTER TABLE leave_applications
  ADD COLUMN IF NOT EXISTS attachment_url  TEXT,
  ADD COLUMN IF NOT EXISTS attachment_name TEXT;

-- 2. Add attachment columns to leave_approvals (for reviewer's decision note)
ALTER TABLE leave_approvals
  ADD COLUMN IF NOT EXISTS attachment_url  TEXT,
  ADD COLUMN IF NOT EXISTS attachment_name TEXT;

-- ============================================================
-- 3. RLS for leave_applications
-- ============================================================

ALTER TABLE leave_applications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Students/staff can insert own leave" ON leave_applications;
DROP POLICY IF EXISTS "Applicants can view own leave"       ON leave_applications;
DROP POLICY IF EXISTS "Staff can view assigned leave"       ON leave_applications;
DROP POLICY IF EXISTS "Admins can view all leave"           ON leave_applications;

-- Any authenticated user can submit a leave application for themselves
CREATE POLICY "Students/staff can insert own leave"
  ON leave_applications FOR INSERT
  WITH CHECK (applicant_id = auth.uid());

-- Applicant always sees their own applications
CREATE POLICY "Applicants can view own leave"
  ON leave_applications FOR SELECT
  USING (applicant_id = auth.uid());

-- Staff/admins see applications where they are the approver
CREATE POLICY "Staff can view assigned leave"
  ON leave_applications FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM leave_approvals la
      WHERE la.leave_application_id = leave_applications.id
        AND la.approver_id = auth.uid()
    )
  );

-- Principal / admin see ALL applications
CREATE POLICY "Admins can view all leave"
  ON leave_applications FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('principal', 'admin')
    )
  );

-- ============================================================
-- 4. RLS for leave_approvals
-- ============================================================

ALTER TABLE leave_approvals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Applicant inserts approvals"        ON leave_approvals;
DROP POLICY IF EXISTS "Applicant views own approvals"      ON leave_approvals;
DROP POLICY IF EXISTS "Approver views assigned approvals"  ON leave_approvals;
DROP POLICY IF EXISTS "Approver updates own approvals"     ON leave_approvals;
DROP POLICY IF EXISTS "Admins manage all approvals"        ON leave_approvals;

-- The applicant creates approval rows when submitting
CREATE POLICY "Applicant inserts approvals"
  ON leave_approvals FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM leave_applications la
      WHERE la.id = leave_approvals.leave_application_id
        AND la.applicant_id = auth.uid()
    )
  );

-- Applicant sees approvals for their own applications
CREATE POLICY "Applicant views own approvals"
  ON leave_approvals FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM leave_applications la
      WHERE la.id = leave_approvals.leave_application_id
        AND la.applicant_id = auth.uid()
    )
  );

-- Approver sees approvals assigned to them
CREATE POLICY "Approver views assigned approvals"
  ON leave_approvals FOR SELECT
  USING (approver_id = auth.uid());

-- Approver can update their own approval row
CREATE POLICY "Approver updates own approvals"
  ON leave_approvals FOR UPDATE
  USING (approver_id = auth.uid())
  WITH CHECK (approver_id = auth.uid());

-- Principal / admin full access
CREATE POLICY "Admins manage all approvals"
  ON leave_approvals FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('principal', 'admin')
    )
  );

-- ============================================================
-- Done.
-- New columns:
--   leave_applications.attachment_url  TEXT  (public URL or storage path)
--   leave_applications.attachment_name TEXT
--   leave_approvals.attachment_url     TEXT
--   leave_approvals.attachment_name    TEXT
-- ============================================================
