-- ============================================================
-- Disk retention: enable pg_cron (confirmed NOT installed — meaning the
-- bus_locations cleanup function written in bus_locations_retention.sql had
-- never run, even manually, since its schedule was commented out) and
-- schedule three cleanup jobs for the tables in this schema that grow
-- forever with no pruning.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pg_cron;

-- bus_locations: GPS breadcrumb stream, highest write rate in the schema.
-- cleanup_bus_locations() already existed (bus_locations_retention.sql) but
-- its cron schedule was left commented out and pg_cron was never installed.
-- Schedule it now, daily at 03:00 UTC.
SELECT cron.schedule(
  'cleanup-bus-locations',
  '0 3 * * *',
  $$ SELECT public.cleanup_bus_locations(); $$
);

-- attendance_location_attempts: per-punch GPS diagnostic log (including
-- rejected attempts), written on every check-in/out. Exists to tune accuracy
-- thresholds against real data — a diagnostic purpose that doesn't need
-- history beyond 90 days.
CREATE OR REPLACE FUNCTION public.cleanup_attendance_location_attempts()
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  DELETE FROM public.attendance_location_attempts
  WHERE created_at < NOW() - INTERVAL '90 days';
$$;

SELECT cron.schedule(
  'cleanup-attendance-location-attempts',
  '0 4 * * *',
  $$ SELECT public.cleanup_attendance_location_attempts(); $$
);

-- push_subscriptions: rows inserted per device, never pruned on expiry.
-- Dead browser push endpoints (uninstalled app, cleared site data) return
-- 410 Gone permanently; without pruning, sends keep retrying them forever.
CREATE OR REPLACE FUNCTION public.cleanup_stale_push_subscriptions()
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  DELETE FROM public.push_subscriptions
  WHERE last_used_at < NOW() - INTERVAL '180 days'
     OR (last_used_at IS NULL AND created_at < NOW() - INTERVAL '30 days');
$$;

SELECT cron.schedule(
  'cleanup-stale-push-subscriptions',
  '0 5 * * *',
  $$ SELECT public.cleanup_stale_push_subscriptions(); $$
);

-- These cleanup functions are only meant to run via the pg_cron schedule
-- above (which executes as the `postgres` role, unaffected by the revokes
-- below). New functions on this project pick up default anon+authenticated
-- EXECUTE grants (confirmed via information_schema.routine_privileges) —
-- without this, any signed-in (or even unauthenticated) user could call
-- /rest/v1/rpc/cleanup_bus_locations directly and force a premature mass
-- delete.
REVOKE EXECUTE ON FUNCTION public.cleanup_bus_locations() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cleanup_attendance_location_attempts() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cleanup_stale_push_subscriptions() FROM anon, authenticated;

NOTIFY pgrst, 'reload schema';
