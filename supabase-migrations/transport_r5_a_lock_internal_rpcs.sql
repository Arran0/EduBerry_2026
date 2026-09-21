-- ============================================================================
-- Migration: Transport — Round 5a, take the engine's internals off the API
--
-- Four SECURITY DEFINER functions that exist to be called by a trigger or by
-- the minute tick were reachable by any signed-in account over PostgREST,
-- because PostgreSQL grants EXECUTE to PUBLIC on every new function and PUBLIC
-- includes `authenticated`. None of them check who is calling — they were never
-- meant to be called by anyone. Each is a real hole, not a theoretical one:
--
--   transport_student_contact(uuid)
--     Returns the guardian's phone number and WhatsApp opt-in for ANY student
--     id. Student ids are ordinary profile ids and appear throughout the app,
--     so this is every family's phone number in the school, harvestable one id
--     at a time by a parent, a pupil, or anyone else with a login. The worst of
--     the four.
--
--   transport_notify_student(uuid, text, ...)
--     Enqueues a push — and, with one boolean, a WhatsApp message — to any
--     family, with caller-chosen event, subject and variables. The outbox is
--     drained and really sent. That is a message that looks like it came from
--     the school, to any parent, saying anything: "your child did not board the
--     bus" is the obvious abuse, and it is a safety problem before it is a
--     spam one. It also spends the school's WhatsApp balance.
--
--   transport_raise_alert(text, transport_alert_type, ...)
--     Writes any alert, of any type and severity, into the admin exception
--     inbox — including a fabricated emergency.
--
--   transport_clear_alert(text)
--     Resolves any open alert by dedupe_key. The keys are formulaic
--     ('<type>:<run>:<student>'), so a pupil could silence the did-not-board
--     alert raised about them, and anyone could clear the lot. This one turns
--     the safety net off quietly, which makes it the most dangerous of the
--     four operationally even though it reads as the dullest.
--
-- Four more are engine internals with the same exposure and less reach —
-- process_fix, recompute_eta, watch_outbox and kick_drain — and are closed
-- here too, on the same principle: if pg_cron or a trigger is the only
-- intended caller, nobody else should hold EXECUTE.
--
-- Safe for the engine: every trigger that reaches these
-- (transport_apply_fix, transport_notify_alert, transport_notify_boarding,
-- transport_notify_stop_event, transport_notify_run_started) and the cron tick
-- are themselves SECURITY DEFINER owned by `postgres`, so inside them the
-- effective user is the owner, which keeps EXECUTE regardless of what is
-- revoked from `authenticated`. Verified against pg_trigger before writing
-- this, and no client code calls any of the eight.
--
-- The RLS helper predicates (transport_is_crew, transport_run_is_mine,
-- transport_route_is_mine, transport_stop_is_mine, transport_is_transport_staff,
-- transport_route_has_crew) are deliberately NOT touched: policies are
-- evaluated as the calling role, so `authenticated` must keep EXECUTE on them
-- or every transport policy fails closed. They are safe to expose because each
-- answers only about the caller's own auth.uid().
--
-- Run this in the Supabase SQL Editor.
-- ============================================================================

-- Revoke every overload by oid rather than by a hand-typed signature: these
-- have long argument lists with defaults, and a mistyped signature silently
-- revokes nothing while reporting success.
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'transport_student_contact',
        'transport_notify_student',
        'transport_raise_alert',
        'transport_clear_alert',
        'transport_process_fix',
        'transport_recompute_eta',
        'transport_watch_outbox',
        'transport_kick_drain'
      )
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
    RAISE NOTICE 'locked %', r.sig;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
