-- ============================================================================
-- Migration: Transport — Round 4e, close the transport_tick() grant
--
-- transport_tick() is the minute cron pass. It is SECURITY DEFINER and it is
-- the thing that opens alerts, marks runs missed and enqueues notifications —
-- everything the absence of movement implies. It was always meant to be
-- callable by pg_cron and by nothing else, and Round 2 said so in a comment,
-- but the REVOKE that would have made it true was never written: PostgreSQL
-- grants EXECUTE to PUBLIC on every new function, and PUBLIC includes
-- `authenticated`, which PostgREST exposes at /rest/v1/rpc/transport_tick.
--
-- So any signed-in account — a parent, a student, a driver — could run the
-- school's alerting pass on demand. The tick is guarded by an advisory lock
-- and is idempotent, so this is not a corruption bug; it is an unprivileged
-- caller driving alert and notification timing, which is bad enough.
--
-- Found by auditing has_function_privilege() after the Round 4 migrations
-- went in, against the list of functions that are supposed to be cron-only.
-- The other four — transport_archive_telemetry, cleanup_transport_archive,
-- cleanup_transport_telemetry and transport_rollup_metrics — each carry their
-- own REVOKE and were already correct.
--
-- Run this in the Supabase SQL Editor.
-- ============================================================================

REVOKE EXECUTE ON FUNCTION public.transport_tick() FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';
