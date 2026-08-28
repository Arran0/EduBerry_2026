-- ============================================================================
-- Migration: Transport — Round 3b, SOS and notification enqueue
--
-- Applied to the live project as: transport_r3_b_sos_enqueue_rls.
-- Prereq: transport_r3_a_notifications_and_safety.sql
-- Run this in the Supabase SQL Editor.
-- ============================================================================

-- Transport Round 3b: SOS, notification enqueue, and RLS.
-- Full file: supabase-migrations/transport_r3_b_sos_enqueue_rls.sql

-- ── Enqueue ─────────────────────────────────────────────────────────────────
-- One place that decides who hears about what. Opt-outs and quiet hours are
-- applied here rather than at send time, so the outbox honestly reflects intent
-- rather than filling with rows that will never go out.
CREATE OR REPLACE FUNCTION public.notify_enqueue(
  p_event      TEXT,
  p_channel    public.notification_channel,
  p_recipient  UUID,
  p_dedupe     TEXT,
  p_variables  JSONB DEFAULT '{}'::jsonb,
  p_subject    JSONB DEFAULT '{}'::jsonb,
  p_priority   SMALLINT DEFAULT 5,
  p_perishable BOOLEAN DEFAULT false,
  p_address    TEXT DEFAULT NULL
)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  cfg JSONB;
  quiet_from TIME;
  quiet_to TIME;
  tz TEXT := public.attendance_timezone();
  local_now TIME;
  in_quiet BOOLEAN := false;
  send_at TIMESTAMPTZ := NOW();
  final_status public.notification_status := 'queued';
BEGIN
  -- Explicit opt-out wins over everything except an emergency.
  IF p_priority > 1 AND EXISTS (
    SELECT 1 FROM public.notification_preferences
     WHERE user_id = p_recipient
       AND channel = p_channel
       AND event_type IN (p_event, '*')
       AND NOT enabled
  ) THEN
    RETURN;
  END IF;

  SELECT value INTO cfg FROM public.site_settings WHERE key = 'transport';
  quiet_from := COALESCE((cfg ->> 'quiet_from')::TIME, '21:00'::TIME);
  quiet_to   := COALESCE((cfg ->> 'quiet_to')::TIME,   '06:00'::TIME);
  local_now  := ((NOW() AT TIME ZONE tz)::TIME);

  -- The window wraps midnight, so "inside" is an OR, not a BETWEEN.
  in_quiet := CASE
    WHEN quiet_from < quiet_to THEN local_now >= quiet_from AND local_now < quiet_to
    ELSE local_now >= quiet_from OR local_now < quiet_to
  END;

  IF in_quiet AND p_priority > 1 THEN
    IF p_perishable THEN
      -- "Arriving in 5 minutes" delivered an hour later is noise, not news.
      final_status := 'skipped';
    ELSE
      send_at := (((NOW() AT TIME ZONE tz)::DATE
                   + CASE WHEN local_now >= quiet_to THEN 1 ELSE 0 END)
                  + quiet_to) AT TIME ZONE tz;
    END IF;
  END IF;

  INSERT INTO public.notification_outbox
    (event_type, channel, recipient_user_id, recipient_address, dedupe_key,
     variables, subject_ref, priority, perishable, not_before, status, template_key)
  VALUES
    (p_event, p_channel, p_recipient, p_address, p_dedupe,
     p_variables, p_subject, p_priority, p_perishable, send_at, final_status, p_event)
  ON CONFLICT (dedupe_key) DO NOTHING;
END $fn$;

-- ── SOS ─────────────────────────────────────────────────────────────────────
-- Freezes crew, vehicle, the onboard roster, the last known position and the
-- trip context at the instant it fires. Those facts must survive later edits to
-- the roster or the route, which is why the snapshot is written once and never
-- recomputed.
CREATE OR REPLACE FUNCTION public.transport_raise_incident(
  p_run         UUID,
  p_type        public.transport_incident_type,
  p_description TEXT DEFAULT NULL,
  p_lat         DOUBLE PRECISION DEFAULT NULL,
  p_lng         DOUBLE PRECISION DEFAULT NULL,
  p_accuracy_m  REAL DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  r RECORD;
  snap JSONB;
  incident_id UUID;
  admin_id UUID;
BEGIN
  SELECT * INTO r FROM public.transport_trip_runs WHERE id = p_run;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'Run not found'); END IF;
  IF NOT (public.transport_is_crew(p_run) OR public.get_user_role() = 'admin') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Not your run');
  END IF;

  SELECT jsonb_build_object(
    'captured_at', NOW(),
    'route', (SELECT jsonb_build_object('id', id, 'name', name, 'code', code)
                FROM public.transport_routes WHERE id = r.route_id),
    'direction', r.direction,
    'service_date', r.service_date,
    'vehicle', (SELECT jsonb_build_object('id', id, 'registration_no', registration_no,
                                          'display_name', display_name, 'capacity', capacity)
                  FROM public.transport_vehicles WHERE id = r.vehicle_id),
    'driver', (SELECT jsonb_build_object('id', p.id, 'name', p.full_name, 'phone', ts.phone,
                                         'licence_no', ts.licence_no)
                 FROM public.profiles p
                 LEFT JOIN public.transport_staff ts ON ts.profile_id = p.id AND ts.kind = 'driver'
                WHERE p.id = r.driver_id),
    'attendant', (SELECT jsonb_build_object('id', p.id, 'name', p.full_name, 'phone', ts.phone)
                    FROM public.profiles p
                    LEFT JOIN public.transport_staff ts ON ts.profile_id = p.id AND ts.kind = 'attendant'
                   WHERE p.id = r.attendant_id),
    'onboard', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'student_id', rp.student_id,
               'name', pr.full_name,
               'grade', pr.grade,
               'section', pr.section,
               'guardian_phone', COALESCE(a.guardian_phone, sd.guardian_phone, sd.phone),
               'state', rp.state)
             ORDER BY pr.full_name)
        FROM public.transport_run_passengers rp
        JOIN public.profiles pr ON pr.id = rp.student_id
        LEFT JOIN public.transport_student_assignments a ON a.id = rp.assignment_id
        LEFT JOIN public.student_details sd ON sd.student_id = rp.student_id
       WHERE rp.run_id = p_run AND rp.state = 'boarded'
    ), '[]'::jsonb),
    'last_fix', jsonb_build_object('lat', r.last_lat, 'lng', r.last_lng, 'at', r.last_fix_at),
    'current_stop', (SELECT jsonb_build_object('id', id, 'name', name)
                       FROM public.transport_route_stops WHERE id = r.current_stop_id),
    'next_stop', (SELECT jsonb_build_object('id', id, 'name', name)
                    FROM public.transport_route_stops WHERE id = r.next_stop_id),
    'delay_seconds', r.delay_seconds
  ) INTO snap;

  INSERT INTO public.transport_incidents
    (run_id, route_id, vehicle_id, type, raised_by, lat, lng, accuracy_m, snapshot, description)
  VALUES
    (p_run, r.route_id, r.vehicle_id, p_type, auth.uid(),
     COALESCE(p_lat, r.last_lat), COALESCE(p_lng, r.last_lng), p_accuracy_m, snap, p_description)
  RETURNING id INTO incident_id;

  INSERT INTO public.transport_incident_updates (incident_id, author_id, kind, body)
  VALUES (incident_id, auth.uid(), 'status_change', format('Raised as %s', p_type));

  -- An emergency also becomes an alert, so it lands at the top of the same
  -- exception rail the admin is already watching.
  PERFORM public.transport_raise_alert(
    format('sos:%s', incident_id), 'sos', 'critical',
    'Emergency reported on a bus',
    COALESCE(p_description, format('%s reported by the crew.', p_type)),
    p_run, r.route_id, r.vehicle_id, NULL, NULL,
    jsonb_build_object('incident_id', incident_id, 'type', p_type));

  -- Priority 1: ignores quiet hours and every opt-out.
  FOR admin_id IN SELECT id FROM public.profiles WHERE role = 'admin' AND is_banned IS NOT TRUE
  LOOP
    PERFORM public.notify_enqueue(
      'transport.emergency', 'push', admin_id,
      format('transport.emergency:push:%s:%s', incident_id, admin_id),
      jsonb_build_object('type', p_type, 'route', (SELECT name FROM public.transport_routes WHERE id = r.route_id)),
      jsonb_build_object('incident_id', incident_id, 'run_id', p_run),
      1::SMALLINT, false);
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'incident_id', incident_id);
END $fn$;

-- ── RLS ─────────────────────────────────────────────────────────────────────

ALTER TABLE public.notification_outbox        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.message_templates          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_preferences   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transport_incidents        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transport_incident_updates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integration_secrets        ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admin manages outbox" ON public.notification_outbox;
CREATE POLICY "Admin manages outbox" ON public.notification_outbox FOR ALL TO authenticated
  USING ((select public.get_user_role()) = 'admin')
  WITH CHECK ((select public.get_user_role()) = 'admin');

DROP POLICY IF EXISTS "Recipient views own notifications" ON public.notification_outbox;
CREATE POLICY "Recipient views own notifications" ON public.notification_outbox FOR SELECT TO authenticated
  USING (recipient_user_id = (select auth.uid()));

DROP POLICY IF EXISTS "Admin manages templates" ON public.message_templates;
CREATE POLICY "Admin manages templates" ON public.message_templates FOR ALL TO authenticated
  USING ((select public.get_user_role()) = 'admin')
  WITH CHECK ((select public.get_user_role()) = 'admin');

DROP POLICY IF EXISTS "Anyone reads templates" ON public.message_templates;
CREATE POLICY "Anyone reads templates" ON public.message_templates FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Own notification preferences" ON public.notification_preferences;
CREATE POLICY "Own notification preferences" ON public.notification_preferences FOR ALL TO authenticated
  USING (user_id = (select auth.uid()) OR (select public.get_user_role()) = 'admin')
  WITH CHECK (user_id = (select auth.uid()) OR (select public.get_user_role()) = 'admin');

DROP POLICY IF EXISTS "Admin manages incidents" ON public.transport_incidents;
CREATE POLICY "Admin manages incidents" ON public.transport_incidents FOR ALL TO authenticated
  USING ((select public.get_user_role()) = 'admin')
  WITH CHECK ((select public.get_user_role()) = 'admin');

DROP POLICY IF EXISTS "Crew views own-run incidents" ON public.transport_incidents;
CREATE POLICY "Crew views own-run incidents" ON public.transport_incidents FOR SELECT TO authenticated
  USING ((select public.transport_is_crew(run_id)));

-- Parents deliberately get NO read on incidents: the snapshot names every other
-- child who was aboard. They receive a notification instead.

DROP POLICY IF EXISTS "Admin manages incident updates" ON public.transport_incident_updates;
CREATE POLICY "Admin manages incident updates" ON public.transport_incident_updates FOR ALL TO authenticated
  USING ((select public.get_user_role()) = 'admin')
  WITH CHECK ((select public.get_user_role()) = 'admin');

DROP POLICY IF EXISTS "Admin manages integration secrets" ON public.integration_secrets;
CREATE POLICY "Admin manages integration secrets" ON public.integration_secrets FOR ALL TO authenticated
  USING ((select public.get_user_role()) = 'admin')
  WITH CHECK ((select public.get_user_role()) = 'admin');

GRANT ALL ON public.notification_outbox,
             public.message_templates,
             public.notification_preferences,
             public.transport_incidents,
             public.transport_incident_updates,
             public.integration_secrets
  TO anon, authenticated;

REVOKE EXECUTE ON FUNCTION
  public.transport_raise_incident(UUID, public.transport_incident_type, TEXT, DOUBLE PRECISION, DOUBLE PRECISION, REAL)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  public.transport_raise_incident(UUID, public.transport_incident_type, TEXT, DOUBLE PRECISION, DOUBLE PRECISION, REAL)
  TO authenticated;

REVOKE EXECUTE ON FUNCTION
  public.notify_enqueue(TEXT, public.notification_channel, UUID, TEXT, JSONB, JSONB, SMALLINT, BOOLEAN, TEXT)
  FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';
