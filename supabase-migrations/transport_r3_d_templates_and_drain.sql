-- ============================================================================
-- Migration: Transport — Round 3d, message copy and the scheduled drain
--
-- Applied to the live project as: transport_r3_d_templates_and_drain, then transport_r3_d2_fix_drain_net_call.
-- Prereq: transport_r3_c_event_notifications.sql
-- Run this in the Supabase SQL Editor.
-- ============================================================================

-- Transport Round 3d: message copy, and the scheduled drain.
-- Full file: supabase-migrations/transport_r3_d_templates_and_drain.sql

-- pg_net is what lets pg_cron reach an HTTPS endpoint. Sending needs Node (the
-- web-push VAPID signing and Meta's HTTP API cannot happen in Postgres), and
-- the drain must fire with no user present, so a scheduler that can only run
-- SQL is not enough on its own.
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- Where the drain lives and the secret it is called with. A table rather than a
-- GUC, so it is visible and rotatable from the admin UI.
CREATE TABLE IF NOT EXISTS public.transport_runtime_config (
  key        TEXT PRIMARY KEY,
  value      TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.transport_runtime_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admin manages runtime config" ON public.transport_runtime_config;
CREATE POLICY "Admin manages runtime config" ON public.transport_runtime_config FOR ALL TO authenticated
  USING ((select public.get_user_role()) = 'admin')
  WITH CHECK ((select public.get_user_role()) = 'admin');

GRANT ALL ON public.transport_runtime_config TO anon, authenticated;

INSERT INTO public.transport_runtime_config (key, value) VALUES
  ('drain_url', NULL),
  ('cron_secret', NULL)
ON CONFLICT (key) DO NOTHING;

-- ── Copy ────────────────────────────────────────────────────────────────────
-- Seeded so a school has working notifications the day they turn this on, and
-- so the six WhatsApp templates can be submitted to Meta for approval as-is.

INSERT INTO public.message_templates (key, channel, locale, title_template, body_template, url_template)
VALUES
  ('transport.trip_started', 'push', 'en',
   'Bus has started', 'The bus has set off. We will tell you when it is close.', '/more/bus'),
  ('transport.arrived_at_stop', 'push', 'en',
   'Bus has reached {{stop}}', 'Arrived at {{time}}.', '/more/bus'),
  ('transport.child_boarded', 'push', 'en',
   '{{child}} is on the bus', 'Boarded at {{time}}.', '/more/bus'),
  ('transport.child_boarded_return', 'push', 'en',
   '{{child}} is on the bus home', 'Boarded at {{time}}.', '/more/bus'),
  ('transport.arrived_at_school', 'push', 'en',
   '{{child}} has arrived at school', 'Got off the bus at {{time}}.', '/more/bus'),
  ('transport.child_dropped', 'push', 'en',
   '{{child}} has been dropped off', 'At {{time}}.', '/more/bus'),
  ('transport.child_not_boarded', 'push', 'en',
   '{{child}} did not board', 'The bus has left their stop. The school has been told.', '/more/bus'),
  ('transport.child_not_dropped', 'push', 'en',
   '{{child}} has not been dropped off', 'The trip has ended with them still marked on board. The school is looking into it.', '/more/bus'),
  ('transport.trip_delayed', 'push', 'en',
   'Bus is running late', 'About {{minutes}} minutes behind schedule.', '/more/bus'),
  ('transport.emergency', 'push', 'en',
   'Emergency on a bus', '{{type}} reported on {{route}}.', '/more/bus')
ON CONFLICT (key, channel, locale) DO NOTHING;

INSERT INTO public.message_templates
  (key, channel, locale, body_template, variable_order, provider_template_name)
VALUES
  ('transport.child_not_boarded', 'whatsapp', 'en',
   '{{child}} was not on the school bus when it left their stop today. The school has been informed.',
   ARRAY['child'], NULL),
  ('transport.child_not_dropped', 'whatsapp', 'en',
   'The bus trip has ended and {{child}} is still marked as on board. The school is checking now and will call you.',
   ARRAY['child'], NULL),
  ('transport.trip_delayed', 'whatsapp', 'en',
   'The school bus is running about {{minutes}} minutes late today.',
   ARRAY['minutes'], NULL),
  ('transport.route_changed', 'whatsapp', 'en',
   'There is a change to the school bus today: {{change}}.',
   ARRAY['change'], NULL),
  ('transport.trip_cancelled', 'whatsapp', 'en',
   'The school bus is not running today. {{reason}}',
   ARRAY['reason'], NULL),
  ('transport.emergency', 'whatsapp', 'en',
   'Emergency reported on the school bus ({{type}}). The school is responding and will contact you.',
   ARRAY['type'], NULL)
ON CONFLICT (key, channel, locale) DO NOTHING;

-- ── Drain ───────────────────────────────────────────────────────────────────
-- Fire-and-forget: pg_net queues the request and the response lands in
-- net._http_response, so a slow or down endpoint never blocks the tick.
CREATE OR REPLACE FUNCTION public.transport_kick_drain()
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  url TEXT;
  secret TEXT;
  pending INTEGER;
BEGIN
  SELECT value INTO url    FROM public.transport_runtime_config WHERE key = 'drain_url';
  SELECT value INTO secret FROM public.transport_runtime_config WHERE key = 'cron_secret';
  IF url IS NULL OR secret IS NULL THEN RETURN; END IF;

  -- Nothing to send: do not spend an HTTP request finding that out.
  SELECT count(*) INTO pending
    FROM public.notification_outbox
   WHERE status IN ('queued', 'sending') AND not_before <= NOW();
  IF pending = 0 THEN RETURN; END IF;

  PERFORM extensions.net_http_post(
    url := url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', secret),
    body := jsonb_build_object('limit', 50)
  );
END $fn$;

REVOKE EXECUTE ON FUNCTION public.transport_kick_drain() FROM PUBLIC, anon, authenticated;

DO $$ BEGIN PERFORM cron.unschedule('transport-notify-drain'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
SELECT cron.schedule('transport-notify-drain', '* * * * *', $$SELECT public.transport_kick_drain();$$);

-- A queue that is not draining must itself be an alert: a missing notification
-- is indistinguishable from a missing event, which is the worst failure mode
-- this pipeline has.
CREATE OR REPLACE FUNCTION public.transport_watch_outbox()
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE stuck INTEGER;
BEGIN
  SELECT count(*) INTO stuck
    FROM public.notification_outbox
   WHERE status IN ('queued', 'sending')
     AND not_before < NOW() - INTERVAL '15 minutes';

  IF stuck > 0 THEN
    PERFORM public.transport_raise_alert(
      format('outbox_stuck:%s', (EXTRACT(EPOCH FROM NOW())::BIGINT / 3600)),
      'device_offline', 'critical',
      'Notifications are not being sent',
      format('%s message(s) have been waiting more than 15 minutes. Check the drain URL and secret in transport settings.', stuck),
      NULL, NULL, NULL, NULL, NULL,
      jsonb_build_object('stuck', stuck));
  END IF;

  DELETE FROM public.notification_outbox
   WHERE created_at < NOW() - INTERVAL '90 days';
END $fn$;

REVOKE EXECUTE ON FUNCTION public.transport_watch_outbox() FROM PUBLIC, anon, authenticated;

DO $$ BEGIN PERFORM cron.unschedule('transport-watch-outbox'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
SELECT cron.schedule('transport-watch-outbox', '*/15 * * * *', $$SELECT public.transport_watch_outbox();$$);

NOTIFY pgrst, 'reload schema';

-- ── Correction applied as transport_r3_d2_fix_drain_net_call ────────────────
-- pg_net installs its functions into the `net` schema, not `extensions`, so the
-- call had the wrong name. PL/pgSQL resolves function names at runtime, so this
-- would only have surfaced as a silently non-firing drain a minute later --
-- exactly the failure the outbox watchdog exists to catch, but better not to
-- need it.
CREATE OR REPLACE FUNCTION public.transport_kick_drain()
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, net AS $fn$
DECLARE
  url TEXT;
  secret TEXT;
  pending INTEGER;
BEGIN
  SELECT value INTO url    FROM public.transport_runtime_config WHERE key = 'drain_url';
  SELECT value INTO secret FROM public.transport_runtime_config WHERE key = 'cron_secret';
  IF url IS NULL OR secret IS NULL THEN RETURN; END IF;

  -- Nothing to send: do not spend an HTTP request finding that out.
  SELECT count(*) INTO pending
    FROM public.notification_outbox
   WHERE status IN ('queued', 'sending') AND not_before <= NOW();
  IF pending = 0 THEN RETURN; END IF;

  -- Fire-and-forget: pg_net queues the request and the response lands in
  -- net._http_response, so a slow or down endpoint never blocks the tick.
  PERFORM net.http_post(
    url := url,
    body := jsonb_build_object('limit', 50),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', secret)
  );
END $fn$;

REVOKE EXECUTE ON FUNCTION public.transport_kick_drain() FROM PUBLIC, anon, authenticated;

-- pg_net's response log grows forever otherwise.
CREATE OR REPLACE FUNCTION public.cleanup_net_responses()
RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path = public, net AS $fn$
  DELETE FROM net._http_response WHERE created < NOW() - INTERVAL '3 days';
$fn$;
REVOKE EXECUTE ON FUNCTION public.cleanup_net_responses() FROM PUBLIC, anon, authenticated;

DO $$ BEGIN PERFORM cron.unschedule('cleanup-net-responses'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
SELECT cron.schedule('cleanup-net-responses', '20 3 * * *', $$SELECT public.cleanup_net_responses();$$);

NOTIFY pgrst, 'reload schema';
