-- ============================================================
-- Maintenance: bus_locations retention
-- bus_locations is an append-only GPS breadcrumb stream — one row every
-- few seconds per active trip — so it grows quickly and only the most
-- recent row per trip is ever read. This keeps it bounded.
--
-- Passengers read the LATEST row (ORDER BY recorded_at DESC LIMIT 1) and
-- live updates come via Realtime, so deleting old breadcrumbs is safe.
--
-- OPTIONAL: run this once to install the cleanup, then schedule it.
-- Run in the Supabase SQL Editor.
-- ============================================================

-- Delete breadcrumbs older than one day.
CREATE OR REPLACE FUNCTION public.cleanup_bus_locations()
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  DELETE FROM public.bus_locations
  WHERE recorded_at < NOW() - INTERVAL '1 day';
$$;

-- Schedule it daily with pg_cron, if the extension is enabled on your project
-- (Supabase Dashboard → Database → Extensions → enable "pg_cron"). Uncomment:
--
--   SELECT cron.schedule(
--     'cleanup-bus-locations',
--     '0 3 * * *',                       -- 03:00 UTC daily
--     $$ SELECT public.cleanup_bus_locations(); $$
--   );
--
-- Without pg_cron you can simply run `SELECT public.cleanup_bus_locations();`
-- manually now and then, or call it from an external scheduler.

NOTIFY pgrst, 'reload schema';
