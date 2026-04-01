-- Fix: students unable to view announcements
--
-- Root cause: the previous "students_view_student_announcements" policy on
-- public.announcements used:
--
--   auth.jwt() -> 'user_metadata' ->> 'role' = 'student'
--
-- Staff accounts are created via the Admin API with user_metadata.role set
-- explicitly, so their JWT contains the role.  Students register through normal
-- Supabase Auth signup where user_metadata.role is never populated, so the JWT
-- check always evaluates to NULL ≠ 'student' and the policy silently returns
-- zero rows — every student sees an empty announcements page.
--
-- Fix: replace the JWT role check with a direct look-up from public.profiles,
-- which is always authoritative regardless of how the account was created.
-- We also ensure the helper function used by other RLS policies exists.

-- ── 1. Ensure get_user_role() helper exists ──────────────────────────────────
-- SECURITY DEFINER so it bypasses profiles RLS when called from other policies.
CREATE OR REPLACE FUNCTION public.get_user_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid();
$$;

-- ── 2. Replace the broken student announcement policy ────────────────────────
DROP POLICY IF EXISTS "students_view_student_announcements" ON public.announcements;

CREATE POLICY "students_view_student_announcements"
  ON public.announcements FOR SELECT
  USING (
    public.get_user_role() = 'student'
    AND type IN ('student', 'both')
    AND EXISTS (
      SELECT 1
      FROM   public.announcement_audiences aa
      JOIN   public.profiles p ON p.id = auth.uid()
      WHERE  aa.announcement_id = announcements.id
      AND (
        aa.all_students = true
        OR (
          aa.grade = p.grade
          AND (aa.section IS NULL OR aa.section = p.section)
        )
      )
    )
  );
