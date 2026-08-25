-- ============================================================
-- idx_attendance_holidays_date and idx_attendance_holidays_date_lookup are
-- byte-identical btree(date) indexes, created under two different names in
-- two different migrations (upgrade_staff_attendance.sql and
-- upgrade_attendance_holidays_groups.sql — IF NOT EXISTS matches on name,
-- not definition, so both got created). Confirmed via Supabase's
-- duplicate_index performance advisor. Keep the earlier-named one, drop the
-- redundant duplicate.
-- ============================================================

DROP INDEX IF EXISTS public.idx_attendance_holidays_date_lookup;
