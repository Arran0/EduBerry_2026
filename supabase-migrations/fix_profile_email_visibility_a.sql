-- Profile emails, part A (additive; apply BEFORE deploying the app that uses it).
--
-- Every signed-in account could read every profile row with its email — the
-- select policy on profiles is `true` — so any student could list the email
-- address of every student in the school. Names, photos, roles and classes are
-- needed all over the app; addresses are not, so the address moves behind its
-- own rule:
--
--   * staff (teacher, coordinator, principal, admin) see every address, as now;
--   * everyone sees the address of a non-student (staff are contactable);
--   * a student sees their own address and no other student's;
--   * the profile card shows the address of whoever it is opened on, to anyone
--     signed in (profile_card_email) — one person at a time, by design.
--
-- Part A adds the pieces; part B (fix_profile_email_visibility_b.sql) then
-- hides profiles.email from signed-in users, once the app reading it through
-- these pieces is live. Applying B first would break every screen that still
-- selects the column.
--
--   profile_emails     one row per profile: the address and whether its owner
--                      is a student, kept in step by a trigger on profiles. Read
--                      it by embedding — `...profile_emails(email)` — so a
--                      profile row comes back with `email` exactly as before,
--                      or null where the reader may not see it.
--   profile_directory  every profile with the address shown where the caller
--                      may see it and null elsewhere — for finding people by
--                      name or address, filters and all.
--   profile_card_email the address for one profile, for the profile card.
--
-- student_roster_facets searched profiles.email as the caller; it now searches
-- addresses only for staff, and runs as its owner so it can.
--
-- SAFE TO RE-RUN.

CREATE TABLE IF NOT EXISTS public.profile_emails (
  id          UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  email       TEXT,
  is_student  BOOLEAN NOT NULL DEFAULT true
);

ALTER TABLE public.profile_emails ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.profile_emails FROM anon, authenticated;
GRANT SELECT ON public.profile_emails TO authenticated;

DROP POLICY IF EXISTS "profile_emails: own, staff's, or any for staff" ON public.profile_emails;
CREATE POLICY "profile_emails: own, staff's, or any for staff"
  ON public.profile_emails FOR SELECT TO authenticated
  USING (
    id = (SELECT auth.uid())
    OR NOT is_student
    OR (SELECT public.get_user_role()) = ANY (ARRAY['teacher', 'coordinator', 'principal', 'admin'])
  );

CREATE OR REPLACE FUNCTION public.sync_profile_email()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profile_emails (id, email, is_student)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.role, 'student') = 'student')
  ON CONFLICT (id) DO UPDATE
    SET email = EXCLUDED.email, is_student = EXCLUDED.is_student;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.sync_profile_email() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS profiles_sync_email ON public.profiles;
CREATE TRIGGER profiles_sync_email
  AFTER INSERT OR UPDATE OF email, role ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.sync_profile_email();

INSERT INTO public.profile_emails (id, email, is_student)
SELECT id, email, COALESCE(role, 'student') = 'student' FROM public.profiles
ON CONFLICT (id) DO UPDATE
  SET email = EXCLUDED.email, is_student = EXCLUDED.is_student;

-- Every profile, with the email shown where the caller may see it and null
-- elsewhere. For finding people by name or address: the app calls it in place of
-- `from('profiles')` and keeps its filters (`email.ilike...`, `.eq('email', …)`),
-- which then match only addresses the caller may see. Joins from other tables
-- still embed profiles, and profile_emails for the address.
CREATE OR REPLACE FUNCTION public.profile_directory()
RETURNS SETOF public.profiles
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH me AS (
    SELECT (SELECT auth.uid()) AS uid,
           public.get_user_role() = ANY (ARRAY['teacher', 'coordinator', 'principal', 'admin']) AS is_staff
  )
  SELECT (jsonb_populate_record(p, jsonb_build_object(
            'email',
            CASE WHEN p.id = me.uid OR me.is_staff OR COALESCE(p.role, 'student') <> 'student'
                 THEN p.email END))).*
    FROM public.profiles p
   CROSS JOIN me
   WHERE me.uid IS NOT NULL;
$$;

REVOKE EXECUTE ON FUNCTION public.profile_directory() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.profile_directory() TO authenticated;

CREATE OR REPLACE FUNCTION public.profile_card_email(p_profile_id UUID)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT email FROM public.profiles
   WHERE id = p_profile_id AND (SELECT auth.uid()) IS NOT NULL;
$$;

REVOKE EXECUTE ON FUNCTION public.profile_card_email(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.profile_card_email(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.student_roster_facets(p_search TEXT DEFAULT ''::TEXT, p_grades INTEGER[] DEFAULT '{}'::INTEGER[])
RETURNS TABLE(facet TEXT, key TEXT, n INTEGER)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH me AS (
    SELECT (SELECT auth.uid()) AS uid,
           public.get_user_role() = ANY (ARRAY['teacher', 'coordinator', 'principal', 'admin']) AS is_staff
  ),
  matched AS (
    SELECT p.grade, p.section
    FROM public.profiles p, me
    WHERE me.uid IS NOT NULL
      AND p.role = 'student'
      AND (
        p_search = ''
        OR p.full_name ILIKE '%' || p_search || '%'
        OR (me.is_staff AND p.email ILIKE '%' || p_search || '%')
        OR coalesce(p.section, '') ILIKE '%' || p_search || '%'
        OR p.grade = ANY(p_grades)
      )
  )
  SELECT 'grade', m.grade::text, count(*)::int
  FROM matched m WHERE m.grade IS NOT NULL GROUP BY m.grade
  UNION ALL
  SELECT 'section', m.section, count(*)::int
  FROM matched m WHERE coalesce(m.section, '') <> '' GROUP BY m.section;
$$;

REVOKE EXECUTE ON FUNCTION public.student_roster_facets(TEXT, INTEGER[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.student_roster_facets(TEXT, INTEGER[]) TO authenticated;
