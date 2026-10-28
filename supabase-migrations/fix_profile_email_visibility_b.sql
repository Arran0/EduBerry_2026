-- Profile emails, part B: hide profiles.email from the API roles.
--
-- Apply AFTER the app that reads addresses through profile_emails,
-- search_profiles and profile_card_email is deployed (see part A). From here a
-- query by a signed-in user that names `email` or `*` on profiles — directly or
-- embedded — is refused by the database, so nothing can read the column around
-- the rule in part A. src/lib/profileColumns.test.ts keeps app code from doing it.
--
-- Column privileges replace the table-wide SELECT grant. A column added to
-- profiles later is NOT readable by the app until it is granted here too — the
-- safe way round for a table holding personal data.
--
-- service_role (the API routes) and the database's own functions are unaffected.
--
-- SAFE TO RE-RUN.

REVOKE SELECT ON public.profiles FROM anon, authenticated;

GRANT SELECT (
  id, full_name, role, avatar_url, created_at, updated_at, grade, section,
  is_banned, banned_at, geofence_exempt, is_non_teaching, attendance_hidden, display_role
) ON public.profiles TO anon, authenticated;
