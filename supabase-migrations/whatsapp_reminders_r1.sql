-- ============================================================================
-- whatsapp_reminders_r1 — absence, announcement and bus reminders on WhatsApp
-- ============================================================================
-- Three places a school can message a family, by hand or on a timer:
--
--   attendance_absent   "{{student}} has not arrived at school as of {{time}}"
--   announcement        a reminder about one announcement, to its audience
--   bus_not_arrived     "{{student}} has not arrived for the school bus"
--
-- No new messaging stack. Messages go on the existing notification_outbox
-- under module = 'wa_reminders', the copy and Meta's approved template names
-- live in message_templates, and contacts resolve through fee_r3_messaging's
-- normalize_msisdn / fee_contact_msisdn / whatsapp_numbers (STOP ledger).
--
-- Multi-tenant by isolation: everything a school changes — credentials,
-- template names, send times, the drain address — is a row in its own
-- database, edited from the app. Nothing here names a school, a domain or a
-- time zone; the zone is attendance_timezone(), the name is branding.
--
-- One message per student per fact, enforced by notification_outbox's unique
-- dedupe_key rather than by anyone remembering to check:
--
--   wa:attendance:<date>:<student>      once a day, however many times Remind
--                                        is pressed or the timer fires
--   wa:announcement:<id>:<student>      once per announcement
--   wa:bus:<run>:<student>              once per trip
--
-- Keyed on the student, not the number, on purpose: siblings who share a
-- parent's phone each get their own message, naming them.
--
-- Prereqs: transport_r3_a…e (outbox, templates, notify_claim_batch),
--          fee_r3_messaging.sql, fee_fix_actor_forgery.sql,
--          fee_fix_service_context_jwt_claim.sql, gps_attendance_rebuild.sql.
-- Safe to re-run. Run in the Supabase SQL Editor.
-- ============================================================================

-- ── Automatic send times ────────────────────────────────────────────────
-- One row per timer. last_run_on is the whole of the "has it run today"
-- state, so the tick is idempotent and safe to run every minute.
CREATE TABLE IF NOT EXISTS public.wa_reminder_schedules (
  kind        TEXT PRIMARY KEY
              CHECK (kind IN ('attendance_absent', 'bus_inbound', 'bus_outbound')),
  enabled     BOOLEAN NOT NULL DEFAULT false,
  send_at     TIME NOT NULL,
  -- 0 = Sunday. Most schools here run Monday to Saturday.
  days        INT[] NOT NULL DEFAULT ARRAY[1, 2, 3, 4, 5, 6],
  last_run_on DATE,
  updated_by  UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.wa_reminder_schedules (kind, send_at) VALUES
  ('attendance_absent', '09:30'),
  ('bus_inbound',       '08:00'),
  ('bus_outbound',      '15:45')
ON CONFLICT (kind) DO NOTHING;

-- ── The reminder log — the last seven days only ─────────────────────────
-- What was sent, to which number, by whom or by the timer, and what WhatsApp
-- did with it. Purged nightly after a week; the outbox's dedupe key (kept 90
-- days) is what actually prevents a repeat, so the purge loses nothing that
-- matters for "never twice".
CREATE TABLE IF NOT EXISTS public.wa_reminder_log (
  id           BIGSERIAL PRIMARY KEY,
  kind         TEXT NOT NULL CHECK (kind IN ('attendance_absent', 'announcement', 'bus_not_arrived')),
  student_id   UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- The announcement or the trip run. NULL for attendance.
  subject_id   UUID,
  -- The school-local day the message was about.
  service_date DATE NOT NULL,
  trigger      TEXT NOT NULL DEFAULT 'manual' CHECK (trigger IN ('manual', 'scheduled')),
  template_key TEXT,
  outbox_id    UUID REFERENCES public.notification_outbox(id) ON DELETE SET NULL,
  msisdn       TEXT,
  sent_by      UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  sent_at      TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  read_at      TIMESTAMPTZ,
  failed_at    TIMESTAMPTZ,
  -- Queued, then made pointless before it went (the child turned up).
  skipped_at   TIMESTAMPTZ,
  error        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wa_reminder_log_kind_day ON public.wa_reminder_log (kind, service_date DESC);
CREATE INDEX IF NOT EXISTS idx_wa_reminder_log_subject  ON public.wa_reminder_log (subject_id);
CREATE INDEX IF NOT EXISTS idx_wa_reminder_log_outbox   ON public.wa_reminder_log (outbox_id);
CREATE INDEX IF NOT EXISTS idx_wa_reminder_log_created  ON public.wa_reminder_log (created_at);
CREATE INDEX IF NOT EXISTS idx_wa_reminder_log_student  ON public.wa_reminder_log (student_id);

-- ── Where the drain lives ───────────────────────────────────────────────
-- Written by the app itself (/api/whatsapp/reminders/status) the first time a
-- member of staff opens a reminder popup: the URL from the request, a secret
-- minted server-side. A school never pastes either anywhere. No RLS policy —
-- the service role only.
CREATE TABLE IF NOT EXISTS public.wa_runtime_config (
  key        TEXT PRIMARY KEY,
  value      TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Small helpers ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.wa_local_now()
RETURNS TIMESTAMP LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT NOW() AT TIME ZONE public.attendance_timezone();
$$;

CREATE OR REPLACE FUNCTION public.wa_today()
RETURNS DATE LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT (NOW() AT TIME ZONE public.attendance_timezone())::DATE;
$$;

CREATE OR REPLACE FUNCTION public.wa_school_name()
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT NULLIF(btrim(value ->> 'schoolName'), '') FROM public.site_settings WHERE key = 'branding'),
    'your school');
$$;

CREATE OR REPLACE FUNCTION public.wa_role(p_user UUID)
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT role::TEXT FROM public.profiles WHERE id = p_user;
$$;

/** Last four digits only: lists are read by more people than profiles are. */
CREATE OR REPLACE FUNCTION public.wa_mask(p_msisdn TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN p_msisdn IS NULL THEN NULL ELSE '••••' || right(p_msisdn, 4) END;
$$;

/** One line, single spaces: Meta rejects a parameter with a newline, a tab or
 *  four spaces in a row. */
CREATE OR REPLACE FUNCTION public.wa_flatten(p_text TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT btrim(regexp_replace(COALESCE(p_text, ''), '\s+', ' ', 'g'));
$$;

CREATE OR REPLACE FUNCTION public.wa_bump(p_obj JSONB, p_key TEXT)
RETURNS JSONB LANGUAGE sql IMMUTABLE AS $$
  SELECT p_obj || jsonb_build_object(p_key, COALESCE((p_obj ->> p_key)::INT, 0) + 1);
$$;

/**
 * The number to message about a student, or NULL when there is none or the
 * family has opted out.
 *
 * Guardian before student (fee_contact_msisdn's rule — the parent is who is
 * being told). For the bus, the route assignment's own guardian number wins,
 * because that is who waits at the stop. STOP is honoured per number: a
 * family that opted out hears nothing about any of its children.
 */
CREATE OR REPLACE FUNCTION public.wa_contact(p_student UUID, p_bus BOOLEAN DEFAULT false)
RETURNS TEXT LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
DECLARE v TEXT;
BEGIN
  IF p_bus THEN
    SELECT public.normalize_msisdn(a.guardian_phone) INTO v
      FROM public.transport_student_assignments a
     WHERE a.student_id = p_student AND a.ended_on IS NULL AND a.guardian_phone IS NOT NULL
     LIMIT 1;
  END IF;
  v := COALESCE(v, public.fee_contact_msisdn(p_student));
  IF v IS NULL OR length(v) < 10 THEN RETURN NULL; END IF;
  IF EXISTS (SELECT 1 FROM public.whatsapp_numbers w
              WHERE w.msisdn = v AND w.opt_out_at IS NOT NULL) THEN
    RETURN NULL;
  END IF;
  RETURN v;
END $fn$;

/** The students an announcement reaches — the same rules the feed uses. */
CREATE OR REPLACE FUNCTION public.wa_announcement_audience(p_announcement UUID)
RETURNS SETOF UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.id FROM public.profiles p
   WHERE p.role = 'student'
     AND EXISTS (
       SELECT 1 FROM public.announcement_audiences a
        WHERE a.announcement_id = p_announcement
          AND (a.all_students
               OR a.user_id = p.id
               OR (a.grade IS NOT NULL AND a.grade = p.grade
                   AND (a.section IS NULL OR a.section = p.section))));
$$;

/** The announcer, or a principal / admin — the people who may pin it. */
CREATE OR REPLACE FUNCTION public.wa_may_remind_announcement(p_user UUID, p_announcement UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(public.wa_role(p_user), '') IN ('principal', 'admin')
      OR (COALESCE(public.wa_role(p_user), '') IN ('coordinator', 'teacher')
          AND EXISTS (SELECT 1 FROM public.announcements a
                       WHERE a.id = p_announcement AND a.created_by = p_user));
$$;

-- ── Queueing one message ────────────────────────────────────────────────
-- Everything about "never twice" is this INSERT. A key that already exists
-- means the family has been told (or is about to be); the only rows that may
-- be queued again are ones that never reached anybody — failed, skipped,
-- cancelled, or expired unsent.
CREATE OR REPLACE FUNCTION public.wa_enqueue(
  p_kind TEXT, p_student UUID, p_subject UUID, p_date DATE, p_template TEXT,
  p_variables JSONB, p_dedupe TEXT, p_msisdn TEXT, p_trigger TEXT, p_actor UUID,
  p_ttl INTERVAL)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE v_id UUID;
BEGIN
  INSERT INTO public.notification_outbox AS o (
    module, event_type, channel, recipient_user_id, recipient_address, subject_ref,
    template_key, variables, dedupe_key, not_before, expires_at, priority)
  VALUES (
    'wa_reminders', p_template, 'whatsapp', p_student, p_msisdn,
    jsonb_build_object('kind', p_kind, 'subject_id', p_subject, 'date', p_date),
    p_template, p_variables, p_dedupe, NOW(), NOW() + p_ttl, 3)
  ON CONFLICT (dedupe_key) DO UPDATE
     SET status = 'queued', attempts = 0, last_error = NULL, failed_at = NULL,
         sent_at = NULL, delivered_at = NULL, provider_message_id = NULL,
         not_before = NOW(), expires_at = EXCLUDED.expires_at,
         recipient_address = EXCLUDED.recipient_address,
         variables = EXCLUDED.variables, template_key = EXCLUDED.template_key,
         event_type = EXCLUDED.event_type, updated_at = NOW()
   WHERE o.status IN ('failed', 'skipped', 'cancelled')
      OR (o.status = 'queued' AND o.expires_at IS NOT NULL AND o.expires_at < NOW())
  RETURNING o.id INTO v_id;

  IF v_id IS NULL THEN RETURN false; END IF;

  INSERT INTO public.wa_reminder_log (
    kind, student_id, subject_id, service_date, trigger, template_key, outbox_id, msisdn, sent_by)
  VALUES (p_kind, p_student, p_subject, p_date, p_trigger, p_template, v_id, p_msisdn, p_actor);
  RETURN true;
END $fn$;

-- ── Absence ─────────────────────────────────────────────────────────────
-- "Absent" here means marked absent today with no leave behind it: no leave
-- linked to the record and no pending or approved application covering the
-- day. A family that has already told the school is not asked where the
-- child is.
CREATE OR REPLACE FUNCTION public.wa_queue_attendance_internal(
  p_students UUID[], p_trigger TEXT, p_actor UUID, p_teacher UUID DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_date   DATE := public.wa_today();
  v_time   TEXT := to_char(public.wa_local_now(), 'FMHH12:MI AM');
  v_school TEXT := public.wa_school_name();
  v_sid    UUID;
  v_name   TEXT;
  v_hr     UUID;
  v_to     TEXT;
  v_queued INT := 0;
  v_seen   INT := 0;
  v_skip   JSONB := '{}'::jsonb;
BEGIN
  FOR v_sid IN SELECT DISTINCT unnest(COALESCE(p_students, ARRAY[]::UUID[])) LOOP
    v_seen := v_seen + 1;

    SELECT p.full_name, ar.homeroom_id INTO v_name, v_hr
      FROM public.attendance_records ar
      JOIN public.profiles p ON p.id = ar.student_id
     WHERE ar.student_id = v_sid AND ar.date = v_date
       AND ar.status = 'absent' AND ar.leave_application_id IS NULL
     LIMIT 1;
    IF NOT FOUND THEN v_skip := public.wa_bump(v_skip, 'not_absent'); CONTINUE; END IF;

    IF p_teacher IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM public.homerooms h WHERE h.id = v_hr AND h.class_teacher_id = p_teacher) THEN
      v_skip := public.wa_bump(v_skip, 'not_your_class'); CONTINUE;
    END IF;

    IF EXISTS (SELECT 1 FROM public.leave_applications la
                WHERE la.applicant_id = v_sid AND la.status IN ('pending', 'approved')
                  AND v_date BETWEEN la.start_date AND la.end_date) THEN
      v_skip := public.wa_bump(v_skip, 'on_leave'); CONTINUE;
    END IF;

    v_to := public.wa_contact(v_sid, false);
    IF v_to IS NULL THEN v_skip := public.wa_bump(v_skip, 'no_contact_or_opted_out'); CONTINUE; END IF;

    IF public.wa_enqueue(
         'attendance_absent', v_sid, NULL, v_date, 'attendance.absent_not_arrived',
         jsonb_build_object('school', v_school, 'student', v_name, 'time', v_time),
         format('wa:attendance:%s:%s', v_date, v_sid), v_to, p_trigger, p_actor,
         -- "Has not arrived as of 9:30" read at two in the afternoon is wrong.
         INTERVAL '3 hours') THEN
      v_queued := v_queued + 1;
    ELSE
      v_skip := public.wa_bump(v_skip, 'already_reminded');
    END IF;
  END LOOP;

  RETURN jsonb_build_object('queued', v_queued, 'considered', v_seen, 'skipped', v_skip);
END $fn$;

CREATE OR REPLACE FUNCTION public.wa_queue_attendance(p_students UUID[], p_actor UUID DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_actor UUID := public.fee_actor(p_actor);
  v_role  TEXT := COALESCE(public.wa_role(public.fee_actor(p_actor)), '');
BEGIN
  IF v_role NOT IN ('admin', 'principal', 'coordinator', 'teacher') THEN
    RAISE EXCEPTION 'You do not have permission to send absence reminders';
  END IF;
  IF COALESCE(array_length(p_students, 1), 0) > 1000 THEN
    RAISE EXCEPTION 'Too many at once — send up to 1000 reminders per run';
  END IF;
  -- A class teacher reaches their own homerooms only; the database, not the
  -- screen, is what holds that line.
  RETURN public.wa_queue_attendance_internal(
    p_students, 'manual', v_actor, CASE WHEN v_role = 'teacher' THEN v_actor END);
END $fn$;

-- ── Announcements ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.wa_queue_announcement_internal(
  p_announcement UUID, p_students UUID[], p_template TEXT, p_actor UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_date    DATE := public.wa_today();
  v_school  TEXT := public.wa_school_name();
  v_title   TEXT;
  v_summary TEXT;
  v_aud     UUID[];
  v_sid     UUID;
  v_name    TEXT;
  v_to      TEXT;
  v_queued  INT := 0;
  v_seen    INT := 0;
  v_skip    JSONB := '{}'::jsonb;
BEGIN
  SELECT public.wa_flatten(a.title), public.wa_flatten(a.content)
    INTO v_title, v_summary
    FROM public.announcements a WHERE a.id = p_announcement;
  IF NOT FOUND THEN RAISE EXCEPTION 'No such announcement'; END IF;

  v_title := left(v_title, 120);
  IF length(v_summary) > 280 THEN v_summary := rtrim(left(v_summary, 277)) || '…'; END IF;
  -- Meta rejects an empty parameter.
  IF v_summary = '' THEN v_summary := v_title; END IF;

  v_aud := ARRAY(SELECT public.wa_announcement_audience(p_announcement));

  FOR v_sid IN SELECT DISTINCT unnest(COALESCE(p_students, ARRAY[]::UUID[])) LOOP
    v_seen := v_seen + 1;
    IF NOT (v_sid = ANY(v_aud)) THEN v_skip := public.wa_bump(v_skip, 'not_in_audience'); CONTINUE; END IF;

    SELECT full_name INTO v_name FROM public.profiles WHERE id = v_sid;
    v_to := public.wa_contact(v_sid, false);
    IF v_to IS NULL THEN v_skip := public.wa_bump(v_skip, 'no_contact_or_opted_out'); CONTINUE; END IF;

    IF public.wa_enqueue(
         'announcement', v_sid, p_announcement, v_date, p_template,
         jsonb_build_object('school', v_school, 'title', v_title, 'student', v_name, 'summary', v_summary),
         format('wa:announcement:%s:%s', p_announcement, v_sid), v_to, 'manual', p_actor,
         INTERVAL '2 days') THEN
      v_queued := v_queued + 1;
    ELSE
      v_skip := public.wa_bump(v_skip, 'already_reminded');
    END IF;
  END LOOP;

  RETURN jsonb_build_object('queued', v_queued, 'considered', v_seen, 'skipped', v_skip);
END $fn$;

CREATE OR REPLACE FUNCTION public.wa_queue_announcement(
  p_announcement UUID, p_students UUID[],
  p_template TEXT DEFAULT 'announcement.reminder', p_actor UUID DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE v_actor UUID := public.fee_actor(p_actor);
BEGIN
  IF NOT public.wa_may_remind_announcement(v_actor, p_announcement) THEN
    RAISE EXCEPTION 'Only the announcer, a principal or an admin can send reminders for this announcement';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.message_templates
                  WHERE key = p_template AND channel = 'whatsapp' AND active
                    AND key LIKE 'announcement.%') THEN
    RAISE EXCEPTION 'That announcement template is not set up';
  END IF;
  IF COALESCE(array_length(p_students, 1), 0) > 2000 THEN
    RAISE EXCEPTION 'Too many at once — send up to 2000 reminders per run';
  END IF;
  RETURN public.wa_queue_announcement_internal(p_announcement, p_students, p_template, v_actor);
END $fn$;

-- ── Bus ─────────────────────────────────────────────────────────────────
-- "Not arrived for the bus" is a passenger on today's trip still expected,
-- or marked absent / no-show by the crew. Boarded, dropped and excused
-- (school already knows) are never messaged.
CREATE OR REPLACE FUNCTION public.wa_queue_bus_internal(
  p_run UUID, p_students UUID[], p_trigger TEXT, p_actor UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_run    RECORD;
  v_time   TEXT := to_char(public.wa_local_now(), 'FMHH12:MI AM');
  v_school TEXT := public.wa_school_name();
  v_sid    UUID;
  v_name   TEXT;
  v_to     TEXT;
  v_queued INT := 0;
  v_seen   INT := 0;
  v_skip   JSONB := '{}'::jsonb;
BEGIN
  SELECT r.id, r.service_date, r.status::TEXT AS status,
         COALESCE(NULLIF(concat_ws(' · ', rt.code, rt.name), ''), 'the school route') AS route
    INTO v_run
    FROM public.transport_trip_runs r
    JOIN public.transport_routes rt ON rt.id = r.route_id
   WHERE r.id = p_run;
  IF NOT FOUND THEN RAISE EXCEPTION 'No such trip'; END IF;
  IF v_run.service_date <> public.wa_today() THEN
    RAISE EXCEPTION 'Bus reminders are only sent for today''s trips';
  END IF;
  IF v_run.status IN ('cancelled', 'missed', 'abandoned') THEN
    RETURN jsonb_build_object('queued', 0,
      'considered', COALESCE(array_length(p_students, 1), 0),
      'skipped', jsonb_build_object('trip_not_running', COALESCE(array_length(p_students, 1), 0)));
  END IF;

  FOR v_sid IN SELECT DISTINCT unnest(COALESCE(p_students, ARRAY[]::UUID[])) LOOP
    v_seen := v_seen + 1;

    SELECT p.full_name INTO v_name
      FROM public.transport_run_passengers rp
      JOIN public.profiles p ON p.id = rp.student_id
     WHERE rp.run_id = p_run AND rp.student_id = v_sid
       AND rp.state::TEXT IN ('expected', 'absent', 'no_show');
    IF NOT FOUND THEN v_skip := public.wa_bump(v_skip, 'boarded_or_excused'); CONTINUE; END IF;

    v_to := public.wa_contact(v_sid, true);
    IF v_to IS NULL THEN v_skip := public.wa_bump(v_skip, 'no_contact_or_opted_out'); CONTINUE; END IF;

    IF public.wa_enqueue(
         'bus_not_arrived', v_sid, p_run, v_run.service_date, 'transport.bus_not_arrived',
         jsonb_build_object('school', v_school, 'student', v_name, 'route', v_run.route, 'time', v_time),
         format('wa:bus:%s:%s', p_run, v_sid), v_to, p_trigger, p_actor,
         INTERVAL '2 hours') THEN
      v_queued := v_queued + 1;
    ELSE
      v_skip := public.wa_bump(v_skip, 'already_reminded');
    END IF;
  END LOOP;

  RETURN jsonb_build_object('queued', v_queued, 'considered', v_seen, 'skipped', v_skip);
END $fn$;

CREATE OR REPLACE FUNCTION public.wa_queue_bus(p_run UUID, p_students UUID[], p_actor UUID DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE v_actor UUID := public.fee_actor(p_actor);
BEGIN
  -- Transport is run by the admin, the same as every other bus RLS policy.
  IF COALESCE(public.wa_role(v_actor), '') <> 'admin' THEN
    RAISE EXCEPTION 'Only an admin can send bus reminders';
  END IF;
  IF COALESCE(array_length(p_students, 1), 0) > 500 THEN
    RAISE EXCEPTION 'Too many at once for one trip';
  END IF;
  RETURN public.wa_queue_bus_internal(p_run, p_students, 'manual', v_actor);
END $fn$;

-- ── What the popups list ────────────────────────────────────────────────
-- Each row says whether the family can be reached and what has already gone
-- to them about this fact, read straight off the outbox by its dedupe key —
-- so the list and the "never twice" rule can never disagree.

CREATE OR REPLACE FUNCTION public.wa_attendance_absentees()
RETURNS TABLE (
  student_id UUID, full_name TEXT, homeroom_id UUID, homeroom_name TEXT,
  grade INT, section TEXT, contactable BOOLEAN, masked TEXT,
  reminded_at TIMESTAMPTZ, delivery TEXT, last_error TEXT)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
#variable_conflict use_column
DECLARE
  v_uid  UUID := auth.uid();
  v_role TEXT := COALESCE(public.wa_role(auth.uid()), '');
  v_date DATE := public.wa_today();
BEGIN
  IF v_role NOT IN ('admin', 'principal', 'coordinator', 'teacher') THEN
    RAISE EXCEPTION 'You cannot see absence reminders';
  END IF;

  RETURN QUERY
  WITH a AS (
    SELECT DISTINCT ON (ar.student_id) ar.student_id, ar.homeroom_id, h.name AS homeroom_name
      FROM public.attendance_records ar
      JOIN public.homerooms h ON h.id = ar.homeroom_id
     WHERE ar.date = v_date AND ar.status = 'absent' AND ar.leave_application_id IS NULL
       AND (v_role <> 'teacher' OR h.class_teacher_id = v_uid)
       AND NOT EXISTS (
         SELECT 1 FROM public.leave_applications la
          WHERE la.applicant_id = ar.student_id AND la.status IN ('pending', 'approved')
            AND v_date BETWEEN la.start_date AND la.end_date)
     ORDER BY ar.student_id, h.name)
  SELECT a.student_id, p.full_name, a.homeroom_id, a.homeroom_name,
         p.grade::INT, p.section, c.msisdn IS NOT NULL, public.wa_mask(c.msisdn),
         o.created_at, o.status::TEXT, o.last_error
    FROM a
    JOIN public.profiles p ON p.id = a.student_id
    CROSS JOIN LATERAL (SELECT public.wa_contact(a.student_id, false) AS msisdn) c
    LEFT JOIN public.notification_outbox o
           ON o.dedupe_key = format('wa:attendance:%s:%s', v_date, a.student_id)
   ORDER BY a.homeroom_name, p.full_name;
END $fn$;

CREATE OR REPLACE FUNCTION public.wa_announcement_recipients(p_announcement UUID)
RETURNS TABLE (
  student_id UUID, full_name TEXT, grade INT, section TEXT, contactable BOOLEAN,
  masked TEXT, reminded_at TIMESTAMPTZ, delivery TEXT, last_error TEXT)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
#variable_conflict use_column
BEGIN
  IF NOT public.wa_may_remind_announcement(auth.uid(), p_announcement) THEN
    RAISE EXCEPTION 'Only the announcer, a principal or an admin can send reminders for this announcement';
  END IF;

  RETURN QUERY
  SELECT p.id, p.full_name, p.grade::INT, p.section, c.msisdn IS NOT NULL,
         public.wa_mask(c.msisdn), o.created_at, o.status::TEXT, o.last_error
    FROM public.wa_announcement_audience(p_announcement) aud(id)
    JOIN public.profiles p ON p.id = aud.id
    CROSS JOIN LATERAL (SELECT public.wa_contact(p.id, false) AS msisdn) c
    LEFT JOIN public.notification_outbox o
           ON o.dedupe_key = format('wa:announcement:%s:%s', p_announcement, p.id)
   ORDER BY p.grade NULLS LAST, p.section NULLS LAST, p.full_name;
END $fn$;

CREATE OR REPLACE FUNCTION public.wa_bus_candidates()
RETURNS TABLE (
  run_id UUID, route_id UUID, route_name TEXT, direction TEXT, run_status TEXT,
  scheduled_start_at TIMESTAMPTZ, boarded INT, waiting INT,
  student_id UUID, full_name TEXT, grade INT, section TEXT, state TEXT, stop_name TEXT,
  contactable BOOLEAN, masked TEXT, reminded_at TIMESTAMPTZ, delivery TEXT, last_error TEXT)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
#variable_conflict use_column
DECLARE v_date DATE := public.wa_today();
BEGIN
  IF COALESCE(public.wa_role(auth.uid()), '') <> 'admin' THEN
    RAISE EXCEPTION 'Only an admin can send bus reminders';
  END IF;

  RETURN QUERY
  WITH runs AS (
    SELECT r.id, r.route_id,
           COALESCE(NULLIF(concat_ws(' · ', rt.code, rt.name), ''), 'Route') AS route_name,
           r.direction::TEXT AS direction, r.status::TEXT AS run_status, r.scheduled_start_at,
           (SELECT count(*) FROM public.transport_run_passengers x
             WHERE x.run_id = r.id AND x.state::TEXT IN ('boarded', 'dropped'))::INT AS boarded
      FROM public.transport_trip_runs r
      JOIN public.transport_routes rt ON rt.id = r.route_id
     WHERE r.service_date = v_date AND r.status::TEXT NOT IN ('cancelled', 'missed', 'abandoned'))
  SELECT runs.id, runs.route_id, runs.route_name, runs.direction, runs.run_status,
         runs.scheduled_start_at, runs.boarded,
         (count(*) OVER (PARTITION BY runs.id))::INT,
         rp.student_id, p.full_name, p.grade::INT, p.section, rp.state::TEXT, s.name,
         c.msisdn IS NOT NULL, public.wa_mask(c.msisdn), o.created_at, o.status::TEXT, o.last_error
    FROM runs
    JOIN public.transport_run_passengers rp
      ON rp.run_id = runs.id AND rp.state::TEXT IN ('expected', 'absent', 'no_show')
    JOIN public.profiles p ON p.id = rp.student_id
    LEFT JOIN public.transport_route_stops s
      ON s.id = CASE WHEN runs.direction = 'inbound' THEN rp.board_stop_id ELSE rp.alight_stop_id END
    CROSS JOIN LATERAL (SELECT public.wa_contact(rp.student_id, true) AS msisdn) c
    LEFT JOIN public.notification_outbox o
           ON o.dedupe_key = format('wa:bus:%s:%s', runs.id, rp.student_id)
   ORDER BY runs.scheduled_start_at, runs.route_name, p.full_name;
END $fn$;

CREATE OR REPLACE FUNCTION public.wa_reminder_log_recent(p_kind TEXT, p_subject UUID DEFAULT NULL)
RETURNS TABLE (
  id BIGINT, student_id UUID, full_name TEXT, subject_id UUID, service_date DATE,
  trigger TEXT, masked TEXT, sent_by_name TEXT, created_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ, delivered_at TIMESTAMPTZ, read_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ, skipped_at TIMESTAMPTZ, error TEXT)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
#variable_conflict use_column
DECLARE
  v_uid  UUID := auth.uid();
  v_role TEXT := COALESCE(public.wa_role(auth.uid()), '');
BEGIN
  IF p_kind = 'attendance_absent' THEN
    IF v_role NOT IN ('admin', 'principal', 'coordinator', 'teacher') THEN
      RAISE EXCEPTION 'You cannot see the absence reminder log';
    END IF;
  ELSIF p_kind = 'announcement' THEN
    IF p_subject IS NULL OR NOT public.wa_may_remind_announcement(v_uid, p_subject) THEN
      RAISE EXCEPTION 'You cannot see reminders for this announcement';
    END IF;
  ELSIF p_kind = 'bus_not_arrived' THEN
    IF v_role <> 'admin' THEN RAISE EXCEPTION 'Only an admin can see bus reminders'; END IF;
  ELSE
    RAISE EXCEPTION 'Unknown reminder kind';
  END IF;

  RETURN QUERY
  SELECT l.id, l.student_id, p.full_name, l.subject_id, l.service_date, l.trigger,
         public.wa_mask(l.msisdn), sb.full_name, l.created_at, l.sent_at, l.delivered_at,
         l.read_at, l.failed_at, l.skipped_at, l.error
    FROM public.wa_reminder_log l
    JOIN public.profiles p ON p.id = l.student_id
    LEFT JOIN public.profiles sb ON sb.id = l.sent_by
   WHERE l.kind = p_kind
     AND (p_subject IS NULL OR l.subject_id = p_subject)
     AND l.created_at >= NOW() - INTERVAL '7 days'
     -- A class teacher reads the log for their own homerooms.
     AND (p_kind <> 'attendance_absent' OR v_role <> 'teacher' OR EXISTS (
           SELECT 1 FROM public.attendance_records ar
             JOIN public.homerooms h ON h.id = ar.homeroom_id
            WHERE ar.student_id = l.student_id AND ar.date = l.service_date
              AND h.class_teacher_id = v_uid))
   ORDER BY l.created_at DESC
   LIMIT 500;
END $fn$;

-- ── Editing the timers and the template names ───────────────────────────
CREATE OR REPLACE FUNCTION public.wa_save_schedule(
  p_kind TEXT, p_enabled BOOLEAN, p_send_at TIME, p_days INT[])
RETURNS public.wa_reminder_schedules
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_role TEXT := COALESCE(public.wa_role(auth.uid()), '');
  v_now  TIMESTAMP := public.wa_local_now();
  v_row  public.wa_reminder_schedules;
BEGIN
  IF p_kind = 'attendance_absent' THEN
    IF v_role NOT IN ('admin', 'principal') THEN
      RAISE EXCEPTION 'Only an admin or the principal can change automatic absence reminders';
    END IF;
  ELSIF p_kind IN ('bus_inbound', 'bus_outbound') THEN
    IF v_role <> 'admin' THEN RAISE EXCEPTION 'Only an admin can change automatic bus reminders'; END IF;
  ELSE
    RAISE EXCEPTION 'Unknown schedule';
  END IF;

  IF p_send_at IS NULL THEN RAISE EXCEPTION 'Pick a time'; END IF;
  IF EXISTS (SELECT 1 FROM unnest(COALESCE(p_days, ARRAY[]::INT[])) d WHERE d < 0 OR d > 6) THEN
    RAISE EXCEPTION 'Days are 0 (Sunday) to 6 (Saturday)';
  END IF;

  UPDATE public.wa_reminder_schedules s
     SET enabled = p_enabled, send_at = p_send_at,
         days = COALESCE(p_days, ARRAY[]::INT[]),
         updated_by = auth.uid(), updated_at = NOW(),
         -- Switching on, or moving the time, to a moment already gone today
         -- must not fire the moment Save is pressed. The first run is the
         -- next time the clock actually reaches it.
         last_run_on = CASE
           WHEN p_enabled AND v_now >= v_now::DATE + p_send_at
                AND (s.last_run_on IS NULL OR s.last_run_on < v_now::DATE)
             THEN v_now::DATE
           ELSE s.last_run_on
         END
   WHERE s.kind = p_kind
  RETURNING s.* INTO v_row;

  RETURN v_row;
END $fn$;

CREATE OR REPLACE FUNCTION public.wa_templates(p_prefix TEXT)
RETURNS TABLE (
  key TEXT, provider_template_name TEXT, provider_template_lang TEXT,
  variable_order TEXT[], title_template TEXT, body_template TEXT, active BOOLEAN)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
#variable_conflict use_column
BEGIN
  IF COALESCE(public.wa_role(auth.uid()), '') NOT IN ('admin', 'principal', 'coordinator', 'teacher') THEN
    RAISE EXCEPTION 'Staff only';
  END IF;
  IF p_prefix NOT IN ('attendance.absent_not_arrived', 'announcement.', 'transport.bus_not_arrived') THEN
    RAISE EXCEPTION 'Unknown template group';
  END IF;

  RETURN QUERY
  SELECT t.key, t.provider_template_name, t.provider_template_lang, t.variable_order,
         t.title_template, t.body_template, t.active
    FROM public.message_templates t
   WHERE t.channel = 'whatsapp' AND t.locale = 'en' AND t.key LIKE p_prefix || '%'
   ORDER BY t.key = 'announcement.reminder' DESC, t.key;
END $fn$;

/**
 * Map one of our keys to the name Meta approved, or add another announcement
 * type. A school does this from the popup; nobody edits a file.
 */
CREATE OR REPLACE FUNCTION public.wa_save_template(
  p_key TEXT, p_name TEXT, p_lang TEXT, p_active BOOLEAN,
  p_title TEXT DEFAULT NULL, p_body TEXT DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE v_order TEXT[];
BEGIN
  IF COALESCE(public.wa_role(auth.uid()), '') <> 'admin' THEN
    RAISE EXCEPTION 'Only an admin can change WhatsApp templates';
  END IF;
  IF p_key NOT IN ('attendance.absent_not_arrived', 'transport.bus_not_arrived')
     AND p_key !~ '^announcement\.[a-z0-9_]{1,40}$' THEN
    RAISE EXCEPTION 'Not a reminder template';
  END IF;
  -- Meta's own rule for template names.
  -- (Length checked apart: Postgres caps a regex repetition count at 255.)
  IF p_name IS NULL OR p_name !~ '^[a-z0-9_]+$' OR length(p_name) > 512 THEN
    RAISE EXCEPTION 'A WhatsApp template name is lower-case letters, digits and underscores';
  END IF;

  v_order := CASE
    WHEN p_key = 'attendance.absent_not_arrived' THEN ARRAY['school', 'student', 'time']
    WHEN p_key = 'transport.bus_not_arrived'     THEN ARRAY['school', 'student', 'route', 'time']
    ELSE ARRAY['school', 'title', 'student', 'summary']
  END;

  INSERT INTO public.message_templates AS t (
    key, channel, locale, provider_template_name, provider_template_lang,
    variable_order, title_template, body_template, active)
  VALUES (
    p_key, 'whatsapp', 'en', p_name, COALESCE(NULLIF(btrim(p_lang), ''), 'en'),
    v_order, COALESCE(NULLIF(btrim(p_title), ''), 'Announcement reminder'),
    COALESCE(NULLIF(btrim(p_body), ''),
      'Dear Parent, this is {{school}}. A reminder about "{{title}}" for {{student}}: {{summary}} Please open the school app for the full announcement.'),
    COALESCE(p_active, true))
  ON CONFLICT (key, channel, locale) DO UPDATE
     SET provider_template_name = EXCLUDED.provider_template_name,
         provider_template_lang = EXCLUDED.provider_template_lang,
         active = EXCLUDED.active,
         title_template = COALESCE(NULLIF(btrim(p_title), ''), t.title_template),
         body_template  = COALESCE(NULLIF(btrim(p_body), ''), t.body_template),
         updated_at = NOW();
END $fn$;

-- ── The timer ───────────────────────────────────────────────────────────
-- Runs every minute. A schedule fires once per school-local day, within two
-- hours of its time — a database that was down at 09:30 does not send
-- "has not arrived as of 2:10 PM" when it comes back.
CREATE OR REPLACE FUNCTION public.wa_reminders_tick()
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_now   TIMESTAMP := public.wa_local_now();
  v_today DATE := (public.wa_local_now())::DATE;
  v_s     RECORD;
  v_r     RECORD;
  v_ids   UUID[];
  v_out   JSONB := '{}'::jsonb;
BEGIN
  FOR v_s IN
    SELECT * FROM public.wa_reminder_schedules
     WHERE enabled
       AND (last_run_on IS NULL OR last_run_on < v_today)
       AND EXTRACT(DOW FROM v_today)::INT = ANY(days)
       AND v_now >= v_today + send_at
       AND v_now <  v_today + send_at + INTERVAL '2 hours'
     FOR UPDATE SKIP LOCKED
  LOOP
    -- Claim the day before doing the work, so an overlapping tick walks past
    -- it. The outbox dedupe covers anything the claim could miss.
    UPDATE public.wa_reminder_schedules SET last_run_on = v_today WHERE kind = v_s.kind;

    IF v_s.kind = 'attendance_absent' THEN
      -- A school-wide holiday, dated or on a recurring weekday: the same
      -- match as attendance_day_off_kind() and transport_materialise_runs().
      -- (attendance_holidays has no `date` column any more; it became
      -- scope_date when weekday holidays were added.)
      CONTINUE WHEN EXISTS (
        SELECT 1 FROM public.attendance_holidays h
         WHERE h.is_default
           AND ((h.scope_type = 'date'    AND h.scope_date    = v_today)
             OR (h.scope_type = 'weekday' AND h.scope_weekday = EXTRACT(DOW FROM v_today)::INT)));
      v_ids := ARRAY(
        SELECT DISTINCT ar.student_id FROM public.attendance_records ar
         WHERE ar.date = v_today AND ar.status = 'absent' AND ar.leave_application_id IS NULL);
      v_out := v_out || jsonb_build_object(
        v_s.kind, public.wa_queue_attendance_internal(v_ids, 'scheduled', NULL, NULL));
    ELSE
      FOR v_r IN
        SELECT r.id FROM public.transport_trip_runs r
         WHERE r.service_date = v_today
           AND r.direction::TEXT = CASE v_s.kind WHEN 'bus_inbound' THEN 'inbound' ELSE 'outbound' END
           AND r.status::TEXT NOT IN ('cancelled', 'missed', 'abandoned')
      LOOP
        -- Nobody on this route marked aboard means the route is not running
        -- today — a holiday for it — so no family is told their child is
        -- missing from a bus that never came.
        CONTINUE WHEN NOT EXISTS (
          SELECT 1 FROM public.transport_run_passengers rp
           WHERE rp.run_id = v_r.id AND rp.state::TEXT IN ('boarded', 'dropped'));

        v_ids := ARRAY(
          SELECT rp.student_id FROM public.transport_run_passengers rp
           WHERE rp.run_id = v_r.id AND rp.state::TEXT IN ('expected', 'absent', 'no_show'));
        v_out := v_out || jsonb_build_object(
          v_r.id::TEXT, public.wa_queue_bus_internal(v_r.id, v_ids, 'scheduled', NULL));
      END LOOP;
    END IF;
  END LOOP;

  RETURN v_out;
END $fn$;

-- ── The drain ───────────────────────────────────────────────────────────
-- Claim a batch for /api/whatsapp/reminders/drain. Before claiming, drop
-- what has stopped being true while it waited — a child marked present, a
-- child who has since boarded — and what is now too late to be useful.
-- "Has not arrived" must never reach a parent whose child is in class.
CREATE OR REPLACE FUNCTION public.wa_claim_outbox(p_limit INT DEFAULT 50)
RETURNS SETOF public.notification_outbox
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
BEGIN
  WITH gone AS (
    UPDATE public.notification_outbox o
       SET status = 'skipped', last_error = 'Arrived before the message went', updated_at = NOW()
     WHERE o.module = 'wa_reminders' AND o.status = 'queued'
       AND (
         (o.subject_ref ->> 'kind' = 'attendance_absent' AND NOT EXISTS (
            SELECT 1 FROM public.attendance_records ar
             WHERE ar.student_id = o.recipient_user_id
               AND ar.date = (o.subject_ref ->> 'date')::DATE
               AND ar.status = 'absent'))
         OR
         (o.subject_ref ->> 'kind' = 'bus_not_arrived' AND NOT EXISTS (
            SELECT 1 FROM public.transport_run_passengers rp
             WHERE rp.run_id = (o.subject_ref ->> 'subject_id')::UUID
               AND rp.student_id = o.recipient_user_id
               AND rp.state::TEXT IN ('expected', 'absent', 'no_show'))))
    RETURNING o.id)
  UPDATE public.wa_reminder_log l
     SET skipped_at = NOW(), error = 'Arrived before the message went'
    FROM gone WHERE l.outbox_id = gone.id;

  WITH stale AS (
    UPDATE public.notification_outbox o
       SET status = 'skipped', last_error = 'Too late to be useful', updated_at = NOW()
     WHERE o.module = 'wa_reminders' AND o.status = 'queued'
       AND o.expires_at IS NOT NULL AND o.expires_at <= NOW()
    RETURNING o.id)
  UPDATE public.wa_reminder_log l
     SET skipped_at = NOW(), error = 'Too late to be useful'
    FROM stale WHERE l.outbox_id = stale.id;

  -- FOR UPDATE SKIP LOCKED: two drains overlapping take different rows, so
  -- the cron kick and the send route's own pass can never double-send.
  RETURN QUERY
  WITH picked AS (
    SELECT id FROM public.notification_outbox
     WHERE module = 'wa_reminders' AND not_before <= NOW()
       AND (expires_at IS NULL OR expires_at > NOW())
       AND (status = 'queued'
            OR (status = 'sending' AND updated_at < NOW() - INTERVAL '5 minutes'))
     ORDER BY priority, not_before
     LIMIT GREATEST(1, LEAST(p_limit, 200))
     FOR UPDATE SKIP LOCKED)
  UPDATE public.notification_outbox o
     SET status = 'sending', attempts = o.attempts + 1, updated_at = NOW()
    FROM picked
   WHERE o.id = picked.id
  RETURNING o.*;
END $fn$;

-- Counting first means a quiet minute costs a COUNT, not an HTTP request.
CREATE OR REPLACE FUNCTION public.wa_kick_drain()
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, net AS $fn$
DECLARE
  v_url     TEXT;
  v_secret  TEXT;
  v_pending INT;
BEGIN
  SELECT value INTO v_url    FROM public.wa_runtime_config WHERE key = 'drain_url';
  SELECT value INTO v_secret FROM public.wa_runtime_config WHERE key = 'cron_secret';
  IF v_url IS NULL OR v_secret IS NULL THEN RETURN; END IF;

  SELECT count(*) INTO v_pending
    FROM public.notification_outbox
   WHERE module = 'wa_reminders' AND status IN ('queued', 'sending') AND not_before <= NOW();
  IF v_pending = 0 THEN RETURN; END IF;

  PERFORM net.http_post(
    url := v_url,
    body := jsonb_build_object('limit', 50),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret));
END $fn$;

CREATE OR REPLACE FUNCTION public.wa_purge_reminder_log()
RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  DELETE FROM public.wa_reminder_log WHERE created_at < NOW() - INTERVAL '7 days';
$$;

-- ── Keep the transport drain off these rows ─────────────────────────────
-- notify_claim_batch claimed every module's queued rows, so with the
-- transport drain configured it would take a reminder, send it with
-- transport's credentials and never update the reminder log. Same function,
-- one line more: it leaves 'wa_reminders' to its own drain. Fee rows are
-- untouched by this change.
CREATE OR REPLACE FUNCTION public.notify_claim_batch(p_limit INTEGER DEFAULT 50)
RETURNS SETOF public.notification_outbox
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
BEGIN
  RETURN QUERY
  WITH picked AS (
    SELECT id
      FROM public.notification_outbox
     WHERE not_before <= NOW()
       AND module <> 'wa_reminders'
       AND (expires_at IS NULL OR expires_at > NOW())
       AND (
         status = 'queued'
         OR (status = 'sending' AND updated_at < NOW() - INTERVAL '5 minutes')
       )
     ORDER BY priority ASC, not_before ASC
     LIMIT GREATEST(1, LEAST(p_limit, 200))
     FOR UPDATE SKIP LOCKED
  )
  UPDATE public.notification_outbox o
     SET status = 'sending', updated_at = NOW()
    FROM picked
   WHERE o.id = picked.id
  RETURNING o.*;
END $fn$;

-- ── Copy, seeded so the three templates can be submitted to Meta as-is ──
-- variable_order is the contract with WhatsApp Manager: {{1}} is its first
-- entry, {{2}} its second. Each body starts and ends with fixed text, which
-- Meta requires. ON CONFLICT DO NOTHING so a re-run never undoes a school's
-- edits.
INSERT INTO public.message_templates (
  key, channel, locale, provider_template_name, provider_template_lang,
  variable_order, title_template, body_template, active)
VALUES
  ('attendance.absent_not_arrived', 'whatsapp', 'en', 'attendance_absent_not_arrived', 'en',
   ARRAY['school', 'student', 'time'],
   'Not arrived at school',
   'Dear Parent, this is {{school}}. {{student}} has not arrived at school as of {{time}} today. If you were not expecting this, please contact the school office.',
   true),
  ('announcement.reminder', 'whatsapp', 'en', 'announcement_reminder', 'en',
   ARRAY['school', 'title', 'student', 'summary'],
   'Announcement reminder',
   'Dear Parent, this is {{school}}. A reminder about "{{title}}" for {{student}}: {{summary}} Please open the school app for the full announcement.',
   true),
  ('transport.bus_not_arrived', 'whatsapp', 'en', 'bus_not_arrived', 'en',
   ARRAY['school', 'student', 'route', 'time'],
   'Not at the bus',
   'Dear Parent, this is {{school}}. {{student}} has not arrived for the school bus on {{route}} as of {{time}} today. If your child is not travelling today, please ignore this message.',
   true)
ON CONFLICT (key, channel, locale) DO NOTHING;

-- ── Schedules ───────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobname) FROM cron.job
     WHERE jobname IN ('wa-reminders-tick', 'wa-reminders-drain', 'wa-reminders-log-purge');
    PERFORM cron.schedule('wa-reminders-tick',      '* * * * *',  'SELECT public.wa_reminders_tick();');
    PERFORM cron.schedule('wa-reminders-drain',     '* * * * *',  'SELECT public.wa_kick_drain();');
    PERFORM cron.schedule('wa-reminders-log-purge', '25 3 * * *', 'SELECT public.wa_purge_reminder_log();');
  END IF;
END $$;

-- ── RLS ─────────────────────────────────────────────────────────────────
ALTER TABLE public.wa_reminder_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wa_reminder_log       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wa_runtime_config     ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff read reminder schedules" ON public.wa_reminder_schedules;
CREATE POLICY "Staff read reminder schedules" ON public.wa_reminder_schedules
  FOR SELECT TO authenticated
  USING ((SELECT public.get_user_role()) IN ('admin', 'principal', 'coordinator', 'teacher'));

-- Everyone else reads the log through wa_reminder_log_recent, which masks the
-- number and scopes the rows.
DROP POLICY IF EXISTS "Admin reads reminder log" ON public.wa_reminder_log;
CREATE POLICY "Admin reads reminder log" ON public.wa_reminder_log
  FOR SELECT TO authenticated
  USING ((SELECT public.get_user_role()) = 'admin');

-- wa_runtime_config: no policy at all. The service role only.
REVOKE ALL ON public.wa_runtime_config FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.wa_reminder_schedules, public.wa_reminder_log FROM anon, authenticated;
GRANT SELECT ON public.wa_reminder_schedules, public.wa_reminder_log TO authenticated;

DO $$
DECLARE fn TEXT;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'wa_local_now()', 'wa_today()', 'wa_school_name()', 'wa_role(uuid)', 'wa_mask(text)',
    'wa_flatten(text)', 'wa_bump(jsonb,text)', 'wa_contact(uuid,boolean)',
    'wa_announcement_audience(uuid)', 'wa_may_remind_announcement(uuid,uuid)',
    'wa_enqueue(text,uuid,uuid,date,text,jsonb,text,text,text,uuid,interval)',
    'wa_queue_attendance_internal(uuid[],text,uuid,uuid)', 'wa_queue_attendance(uuid[],uuid)',
    'wa_queue_announcement_internal(uuid,uuid[],text,uuid)', 'wa_queue_announcement(uuid,uuid[],text,uuid)',
    'wa_queue_bus_internal(uuid,uuid[],text,uuid)', 'wa_queue_bus(uuid,uuid[],uuid)',
    'wa_attendance_absentees()', 'wa_announcement_recipients(uuid)', 'wa_bus_candidates()',
    'wa_reminder_log_recent(text,uuid)', 'wa_save_schedule(text,boolean,time,integer[])',
    'wa_templates(text)', 'wa_save_template(text,text,text,boolean,text,text)',
    'wa_reminders_tick()', 'wa_claim_outbox(integer)', 'wa_kick_drain()', 'wa_purge_reminder_log()'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', fn);
  END LOOP;

  -- What a signed-in member of staff may call. Each checks who they are.
  FOREACH fn IN ARRAY ARRAY[
    'wa_queue_attendance(uuid[],uuid)', 'wa_queue_announcement(uuid,uuid[],text,uuid)',
    'wa_queue_bus(uuid,uuid[],uuid)', 'wa_attendance_absentees()',
    'wa_announcement_recipients(uuid)', 'wa_bus_candidates()',
    'wa_reminder_log_recent(text,uuid)', 'wa_save_schedule(text,boolean,time,integer[])',
    'wa_templates(text)', 'wa_save_template(text,text,text,boolean,text,text)'
  ] LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', fn);
  END LOOP;

  EXECUTE 'REVOKE ALL ON FUNCTION public.notify_claim_batch(integer) FROM PUBLIC, anon, authenticated';
END $$;

NOTIFY pgrst, 'reload schema';
