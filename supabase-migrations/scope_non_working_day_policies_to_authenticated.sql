-- These were the only attendance-config tables whose policies targeted role
-- `public` rather than `authenticated`, and anon holds the table-level SELECT
-- grant, so the school's non-working-day calendar was readable with the anon
-- key. Verified before this migration: with one row inserted, an anon session
-- read it, while the correctly-scoped sibling attendance_holidays returned 0
-- to the same session. The table happens to be empty today, so nothing has
-- actually leaked yet — this closes it before the first row lands.
--
-- Write clauses are carried over verbatim. The SELECT qual was
-- `((SELECT get_user_role()) = 'admin') OR true`, which is just `true` — the
-- admin arm never decided anything — so it is written as `true` here, scoped
-- now to authenticated. Every reader of these tables (the staff attendance
-- report, the staff calendar, the salary and bus payroll cycles) is behind a
-- login already.

DROP POLICY "attendance_non_working_days_select_merged" ON public.attendance_non_working_days;
CREATE POLICY "attendance_non_working_days_select_merged" ON public.attendance_non_working_days
  FOR SELECT TO authenticated USING (true);

DROP POLICY "attendance_non_working_days_insert_merged" ON public.attendance_non_working_days;
CREATE POLICY "attendance_non_working_days_insert_merged" ON public.attendance_non_working_days
  FOR INSERT TO authenticated WITH CHECK ((SELECT get_user_role()) = 'admin'::text);

DROP POLICY "attendance_non_working_days_update_merged" ON public.attendance_non_working_days;
CREATE POLICY "attendance_non_working_days_update_merged" ON public.attendance_non_working_days
  FOR UPDATE TO authenticated
  USING ((SELECT get_user_role()) = 'admin'::text)
  WITH CHECK ((SELECT get_user_role()) = 'admin'::text);

DROP POLICY "attendance_non_working_days_delete_merged" ON public.attendance_non_working_days;
CREATE POLICY "attendance_non_working_days_delete_merged" ON public.attendance_non_working_days
  FOR DELETE TO authenticated USING ((SELECT get_user_role()) = 'admin'::text);

DROP POLICY "attendance_non_working_day_members_select_merged" ON public.attendance_non_working_day_members;
CREATE POLICY "attendance_non_working_day_members_select_merged" ON public.attendance_non_working_day_members
  FOR SELECT TO authenticated USING (true);

DROP POLICY "attendance_non_working_day_members_insert_merged" ON public.attendance_non_working_day_members;
CREATE POLICY "attendance_non_working_day_members_insert_merged" ON public.attendance_non_working_day_members
  FOR INSERT TO authenticated WITH CHECK ((SELECT get_user_role()) = 'admin'::text);

DROP POLICY "attendance_non_working_day_members_update_merged" ON public.attendance_non_working_day_members;
CREATE POLICY "attendance_non_working_day_members_update_merged" ON public.attendance_non_working_day_members
  FOR UPDATE TO authenticated
  USING ((SELECT get_user_role()) = 'admin'::text)
  WITH CHECK ((SELECT get_user_role()) = 'admin'::text);

DROP POLICY "attendance_non_working_day_members_delete_merged" ON public.attendance_non_working_day_members;
CREATE POLICY "attendance_non_working_day_members_delete_merged" ON public.attendance_non_working_day_members
  FOR DELETE TO authenticated USING ((SELECT get_user_role()) = 'admin'::text);
