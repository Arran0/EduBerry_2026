-- ============================================================
-- Fix: Circular RLS dependency in leave tables
--
-- Problem: leave_approvals INSERT policy queries leave_applications
-- (SELECT), which has a policy that queries leave_approvals (SELECT),
-- which queries leave_applications (SELECT) → infinite recursion.
--
-- Fix: Use SECURITY DEFINER functions to bypass RLS when doing the
-- ownership check, breaking the cycle.
-- ============================================================

-- 1. SECURITY DEFINER helper: check ownership without triggering RLS
CREATE OR REPLACE FUNCTION public.is_own_leave_application(application_id UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.leave_applications
    WHERE id = application_id AND applicant_id = auth.uid()
  )
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- 2. Fix leave_approvals INSERT – was querying leave_applications directly
--    (triggered circular RLS chain → infinite recursion error on submit)
DROP POLICY IF EXISTS "Applicant inserts approvals" ON public.leave_approvals;
CREATE POLICY "Applicant inserts approvals"
  ON public.leave_approvals FOR INSERT
  WITH CHECK (public.is_own_leave_application(leave_application_id));

-- 3. Fix leave_approvals SELECT – same circular dependency for reads
DROP POLICY IF EXISTS "Applicant views own approvals" ON public.leave_approvals;
CREATE POLICY "Applicant views own approvals"
  ON public.leave_approvals FOR SELECT
  USING (public.is_own_leave_application(leave_application_id));

-- 4. Ensure students can insert leave applications
--    (old "Staff can create leave applications" excluded students)
DROP POLICY IF EXISTS "Staff can create leave applications" ON public.leave_applications;
DROP POLICY IF EXISTS "Students/staff can insert own leave" ON public.leave_applications;
CREATE POLICY "Students/staff can insert own leave"
  ON public.leave_applications FOR INSERT
  WITH CHECK (applicant_id = auth.uid());

-- 5. SECURITY DEFINER function to sync leave_applications status after an approval decision.
--    Called via RPC so it runs with elevated privileges, bypassing the UPDATE RLS policy
--    that currently excludes teachers (only coordinator/principal/admin can UPDATE directly).
CREATE OR REPLACE FUNCTION public.sync_leave_application_status(p_application_id UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE public.leave_applications
  SET
    status = CASE
      WHEN EXISTS (
        SELECT 1 FROM public.leave_approvals
        WHERE leave_application_id = p_application_id AND status = 'rejected'
      ) THEN 'rejected'::public.leave_status
      WHEN NOT EXISTS (
        SELECT 1 FROM public.leave_approvals
        WHERE leave_application_id = p_application_id AND status != 'approved'
      ) THEN 'approved'::public.leave_status
      ELSE 'pending'::public.leave_status
    END,
    updated_at = NOW()
  WHERE id = p_application_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 6. Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';
