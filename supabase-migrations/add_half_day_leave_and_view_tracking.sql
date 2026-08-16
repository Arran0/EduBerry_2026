-- ============================================================
-- Migration: Half Day Permit leave type + read/seen tracking
-- Run this in the Supabase SQL Editor.
-- ============================================================

-- 1. Add 'half_day' to the leave_type enum (Half Day Permit — staff only).
--    Mirrors the 'half_day' status that attendance already uses for early
--    checkouts, so an approved Half Day Permit can sync straight into it.
ALTER TYPE public.leave_type ADD VALUE IF NOT EXISTS 'half_day';

-- 2. Per-user "last viewed" tracking for leave applications, so either side
--    (applicant or approver) can tell whether the other has seen the
--    application's current state — a fresh submission, or a posted decision.
CREATE TABLE IF NOT EXISTS public.leave_application_views (
  application_id UUID REFERENCES public.leave_applications(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  viewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (application_id, user_id)
);

ALTER TABLE public.leave_application_views ENABLE ROW LEVEL SECURITY;

-- Anyone who can already see the whole application (its applicant, or
-- coordinator/principal/admin — same roles as "Approvers can view all leave
-- applications") can also see who has viewed it.
DROP POLICY IF EXISTS "Can view leave view records for visible applications" ON public.leave_application_views;
CREATE POLICY "Can view leave view records for visible applications"
  ON public.leave_application_views FOR SELECT
  USING (
    public.is_own_leave_application(application_id)
    OR public.get_user_role() IN ('coordinator', 'principal', 'admin')
  );

-- A user can only record their own view — enforced defense-in-depth even
-- though the app calls this through the SECURITY DEFINER RPC below.
DROP POLICY IF EXISTS "Users record their own leave view" ON public.leave_application_views;
CREATE POLICY "Users record their own leave view"
  ON public.leave_application_views FOR INSERT
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users update their own leave view" ON public.leave_application_views;
CREATE POLICY "Users update their own leave view"
  ON public.leave_application_views FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE INDEX IF NOT EXISTS idx_leave_application_views_app ON public.leave_application_views(application_id);

-- 3. Upsert-as-yourself RPC so the client can mark an application "viewed" in
--    one round trip regardless of whether a row already exists.
CREATE OR REPLACE FUNCTION public.mark_leave_application_viewed(p_application_id UUID)
RETURNS VOID AS $$
BEGIN
  INSERT INTO public.leave_application_views (application_id, user_id, viewed_at)
  VALUES (p_application_id, auth.uid(), NOW())
  ON CONFLICT (application_id, user_id) DO UPDATE SET viewed_at = NOW();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

NOTIFY pgrst, 'reload schema';
