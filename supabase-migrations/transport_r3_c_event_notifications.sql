-- ============================================================================
-- Migration: Transport — Round 3c, transport events become notifications
--
-- Applied to the live project as: transport_r3_c_event_notifications.
-- Prereq: transport_r3_b_sos_enqueue_rls.sql
-- Run this in the Supabase SQL Editor.
-- ============================================================================

-- Transport Round 3c: turn transport events into notifications.
-- Full file: supabase-migrations/transport_r3_c_event_notifications.sql
--
-- Channel routing is deliberately mean with WhatsApp. Push is free and
-- unobtrusive; WhatsApp costs money per conversation and, more importantly,
-- spends the parent's attention. It is reserved for the situations where a
-- missed push has real consequence: the child did not board, the child was not
-- dropped off, the bus is badly late, the trip changed, and an emergency.

-- Who to tell about a student, and on which numbers.
CREATE OR REPLACE FUNCTION public.transport_student_contact(p_student UUID)
RETURNS TABLE (user_id UUID, whatsapp TEXT, opted_in BOOLEAN)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  -- The parent shares the student's account, so the recipient IS the student
  -- row. The number resolves assignment override -> guardian -> student phone.
  SELECT p.id,
         COALESCE(a.guardian_phone, sd.guardian_phone, sd.phone),
         sd.whatsapp_opt_in_at IS NOT NULL
    FROM public.profiles p
    LEFT JOIN public.student_details sd ON sd.student_id = p.id
    LEFT JOIN public.transport_student_assignments a
           ON a.student_id = p.id AND a.ended_on IS NULL
   WHERE p.id = p_student
   LIMIT 1;
$fn$;

/**
 * Queue one transport event for a student's family.
 *
 * Always push. WhatsApp only when the caller asks for it AND the family has
 * opted in with a usable number — Meta requires opt-in evidence for
 * business-initiated messages, and sending without it gets the number blocked.
 */
CREATE OR REPLACE FUNCTION public.transport_notify_student(
  p_student    UUID,
  p_event      TEXT,
  p_dedupe     TEXT,
  p_variables  JSONB,
  p_subject    JSONB,
  p_priority   SMALLINT DEFAULT 5,
  p_perishable BOOLEAN DEFAULT false,
  p_whatsapp   BOOLEAN DEFAULT false
)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE c RECORD;
BEGIN
  SELECT * INTO c FROM public.transport_student_contact(p_student);
  IF NOT FOUND THEN RETURN; END IF;

  PERFORM public.notify_enqueue(
    p_event, 'push', c.user_id, format('%s:push:%s', p_dedupe, c.user_id),
    p_variables, p_subject, p_priority, p_perishable);

  IF p_whatsapp AND c.opted_in AND c.whatsapp IS NOT NULL AND length(c.whatsapp) >= 8 THEN
    PERFORM public.notify_enqueue(
      p_event, 'whatsapp', c.user_id, format('%s:wa:%s', p_dedupe, c.user_id),
      p_variables, p_subject, p_priority, p_perishable, c.whatsapp);
  END IF;
END $fn$;

-- Boarding events notify the moment they happen, from the same RPC that records
-- them — so "child boarded" is one atomic, idempotent, notifiable fact.
CREATE OR REPLACE FUNCTION public.transport_notify_boarding()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  r RECORD;
  child TEXT;
  ev TEXT;
BEGIN
  IF NEW.state = OLD.state THEN RETURN NEW; END IF;

  SELECT * INTO r FROM public.transport_trip_runs WHERE id = NEW.run_id;
  IF NOT FOUND THEN RETURN NEW; END IF;
  SELECT full_name INTO child FROM public.profiles WHERE id = NEW.student_id;

  ev := CASE
    WHEN NEW.state = 'boarded' AND r.direction = 'inbound'  THEN 'transport.child_boarded'
    WHEN NEW.state = 'boarded' AND r.direction = 'outbound' THEN 'transport.child_boarded_return'
    WHEN NEW.state = 'dropped' AND r.direction = 'inbound'  THEN 'transport.arrived_at_school'
    WHEN NEW.state = 'dropped' AND r.direction = 'outbound' THEN 'transport.child_dropped'
    ELSE NULL
  END;

  IF ev IS NULL THEN RETURN NEW; END IF;

  PERFORM public.transport_notify_student(
    NEW.student_id, ev,
    format('%s:%s:%s', ev, NEW.run_id, NEW.student_id),
    jsonb_build_object('child', child, 'time', to_char(NOW(), 'HH12:MI AM')),
    jsonb_build_object('run_id', NEW.run_id, 'student_id', NEW.student_id),
    3::SMALLINT, false, false);

  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS transport_run_passengers_notify ON public.transport_run_passengers;
CREATE TRIGGER transport_run_passengers_notify
  AFTER UPDATE ON public.transport_run_passengers
  FOR EACH ROW EXECUTE FUNCTION public.transport_notify_boarding();

-- Stop arrival tells the families waiting at that stop, and only them.
CREATE OR REPLACE FUNCTION public.transport_notify_stop_event()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  r RECORD;
  stop_name TEXT;
  p RECORD;
BEGIN
  IF NEW.event_type <> 'arrival' THEN RETURN NEW; END IF;

  SELECT * INTO r FROM public.transport_trip_runs WHERE id = NEW.run_id;
  IF NOT FOUND THEN RETURN NEW; END IF;
  SELECT name INTO stop_name FROM public.transport_route_stops WHERE id = NEW.stop_id;

  FOR p IN
    SELECT student_id FROM public.transport_run_passengers
     WHERE run_id = NEW.run_id
       AND state <> 'excused'
       AND (CASE WHEN r.direction = 'inbound' THEN board_stop_id ELSE alight_stop_id END) = NEW.stop_id
  LOOP
    PERFORM public.transport_notify_student(
      p.student_id, 'transport.arrived_at_stop',
      format('transport.arrived_at_stop:%s:%s', NEW.run_id, p.student_id),
      jsonb_build_object('stop', stop_name, 'time', to_char(NEW.occurred_at, 'HH12:MI AM')),
      jsonb_build_object('run_id', NEW.run_id, 'stop_id', NEW.stop_id),
      -- Perishable: a "the bus is here" delivered an hour late is worse than
      -- nothing, so quiet hours drop it rather than defer it.
      4::SMALLINT, true, false);
  END LOOP;

  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS transport_stop_events_notify ON public.transport_stop_events;
CREATE TRIGGER transport_stop_events_notify
  AFTER INSERT ON public.transport_stop_events
  FOR EACH ROW EXECUTE FUNCTION public.transport_notify_stop_event();

-- The exceptions worth a WhatsApp. Driven off the alert store, so an alert that
-- is deduped is also a notification that is deduped — one row, one message.
CREATE OR REPLACE FUNCTION public.transport_notify_alert()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  child TEXT;
  p RECORD;
BEGIN
  IF NEW.type = 'student_not_boarded' AND NEW.student_id IS NOT NULL THEN
    SELECT full_name INTO child FROM public.profiles WHERE id = NEW.student_id;
    PERFORM public.transport_notify_student(
      NEW.student_id, 'transport.child_not_boarded',
      format('transport.child_not_boarded:%s', NEW.dedupe_key),
      jsonb_build_object('child', child),
      jsonb_build_object('run_id', NEW.run_id, 'alert_id', NEW.id),
      2::SMALLINT, false, true);

  ELSIF NEW.type = 'student_not_dropped' AND NEW.run_id IS NOT NULL THEN
    FOR p IN
      SELECT student_id FROM public.transport_run_passengers
       WHERE run_id = NEW.run_id AND state = 'boarded'
    LOOP
      SELECT full_name INTO child FROM public.profiles WHERE id = p.student_id;
      PERFORM public.transport_notify_student(
        p.student_id, 'transport.child_not_dropped',
        format('transport.child_not_dropped:%s:%s', NEW.dedupe_key, p.student_id),
        jsonb_build_object('child', child),
        jsonb_build_object('run_id', NEW.run_id, 'alert_id', NEW.id),
        1::SMALLINT, false, true);
    END LOOP;

  ELSIF NEW.type = 'delay' AND NEW.run_id IS NOT NULL THEN
    FOR p IN
      SELECT student_id FROM public.transport_run_passengers
       WHERE run_id = NEW.run_id AND state IN ('expected', 'boarded')
    LOOP
      PERFORM public.transport_notify_student(
        p.student_id, 'transport.trip_delayed',
        format('transport.trip_delayed:%s:%s', NEW.dedupe_key, p.student_id),
        jsonb_build_object('minutes', NEW.metrics ->> 'delay_minutes'),
        jsonb_build_object('run_id', NEW.run_id, 'alert_id', NEW.id),
        3::SMALLINT, false, true);
    END LOOP;
  END IF;

  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS transport_alerts_notify ON public.transport_alerts;
CREATE TRIGGER transport_alerts_notify
  AFTER INSERT ON public.transport_alerts
  FOR EACH ROW EXECUTE FUNCTION public.transport_notify_alert();

-- Trip started: told once, when the run actually goes in_progress.
CREATE OR REPLACE FUNCTION public.transport_notify_run_started()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE p RECORD;
BEGIN
  IF NEW.status <> 'in_progress' OR OLD.status = 'in_progress' THEN RETURN NEW; END IF;

  FOR p IN
    SELECT student_id FROM public.transport_run_passengers
     WHERE run_id = NEW.id AND state <> 'excused'
  LOOP
    PERFORM public.transport_notify_student(
      p.student_id, 'transport.trip_started',
      format('transport.trip_started:%s:%s', NEW.id, p.student_id),
      jsonb_build_object('direction', NEW.direction),
      jsonb_build_object('run_id', NEW.id),
      5::SMALLINT, true, false);
  END LOOP;

  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS transport_trip_runs_notify_started ON public.transport_trip_runs;
CREATE TRIGGER transport_trip_runs_notify_started
  AFTER UPDATE ON public.transport_trip_runs
  FOR EACH ROW EXECUTE FUNCTION public.transport_notify_run_started();

REVOKE EXECUTE ON FUNCTION
  public.transport_student_contact(UUID),
  public.transport_notify_student(UUID, TEXT, TEXT, JSONB, JSONB, SMALLINT, BOOLEAN, BOOLEAN),
  public.transport_notify_boarding(),
  public.transport_notify_stop_event(),
  public.transport_notify_alert(),
  public.transport_notify_run_started()
  FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';
