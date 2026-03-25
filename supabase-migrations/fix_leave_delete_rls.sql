-- ============================================================
-- Fix: Missing DELETE RLS policies for leave tables
--
-- Problem: No DELETE policy exists on leave_applications or
-- leave_approvals, so Supabase blocks all DELETE operations
-- even for principal/admin users.
--
-- Fix: Add DELETE policies allowing principal/admin to delete
-- leave approvals and leave applications.
-- ============================================================

-- 1. Allow principal/admin to delete leave approvals
CREATE POLICY "Principal/admin can delete leave approvals"
  ON public.leave_approvals FOR DELETE
  USING (public.get_user_role() IN ('principal', 'admin'));

-- 2. Allow principal/admin to delete leave applications
CREATE POLICY "Principal/admin can delete leave applications"
  ON public.leave_applications FOR DELETE
  USING (public.get_user_role() IN ('principal', 'admin'));

-- 3. Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';
