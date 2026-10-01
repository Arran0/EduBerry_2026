-- ============================================================================
-- attendance_r1_whatsapp — bulk and automatic WhatsApp from the student
--                          attendance report
-- ============================================================================
-- Run after fee_r3_messaging.sql. Safe to re-run.
--
-- This adds no messaging stack. The database already has one, built for
-- transport and extended for fees:
--
--   notification_outbox   dedupe_key, not_before, attempts, provider_message_id,
--                         sent_at / delivered_at / failed_at
--   message_templates     channel, provider_template_name, variable_order —
--                         exactly Meta's Cloud API shape
--   whatsapp_numbers      the opt-out ledger an inbound STOP writes to
--   normalize_msisdn()    India-aware E.164 normalisation
--
-- So this migration adds only what attendance needs on top: which message a
-- student's day deserves, who may send it, a schedule that sends the same thing
-- every morning without anyone pressing a button, and a log of what went.
--
-- One deliberate restraint: a parent hears about their own child's day, nothing
-- more. There is no class list, no comparison, no "x of y absent" in any body.

-- ── Which message a student's day deserves ──────────────────────────────
-- Attendance and the leave that explains it are the same errand (the report
-- already treats them that way), so an absence covered by an approved medical
-- leave must not go out as "was absent and we do not know why". The kind is
-- resolved from the attendance status AND the approved leave behind it, and the
-- template follows from the kind — never from the status alone.
CREATE OR REPLACE FUNCTION public.attendance_message_kind(
  p_status TEXT, p_leave_type TEXT, p_leave_status TEXT
)
RETURNS TEXT
LANGUAGE sql IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    -- An approved application wins over the raw mark: the school already knows
    -- why, and the message should say so.
    WHEN p_leave_status = 'approved' AND p_leave_type = 'casual'   THEN 'leave_casual'
    WHEN p_leave_status = 'approved' AND p_leave_type = 'medical'  THEN 'leave_medical'
    WHEN p_leave_status = 'approved' AND p_leave_type = 'on_duty'  THEN 'on_duty'
    WHEN p_leave_status = 'approved' AND p_leave_type = 'late'     THEN 'late_permit'
    WHEN p_leave_status = 'approved' AND p_leave_type = 'half_day' THEN 'half_day_permit'
    WHEN p_status = 'absent'   THEN 'absent'
    WHEN p_status = 'late'     THEN 'late'
    WHEN p_status = 'half_day' THEN 'half_day'
    WHEN p_status = 'on_leave' THEN 'leave'
    WHEN p_status = 'on_duty'  THEN 'on_duty'
    WHEN p_status = 'excused'  THEN 'excused'
    -- 'present' has nothing to tell a parent, and a template for it would only
    -- train families to ignore the channel.
    ELSE NULL
  END;
$$;

CREATE OR REPLACE FUNCTION public.attendance_template_for_kind(p_kind TEXT)
RETURNS TEXT
LANGUAGE sql IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE WHEN p_kind IS NULL THEN NULL ELSE 'attendance_' || p_kind END;
$$;

-- ── Who may send ────────────────────────────────────────────────────────
-- Managers cover the school. A class teacher covers the homerooms they are the
-- class teacher of and nothing else — the report is already scoped that way,
-- and a teacher who can see one class must not be able to message another.
CREATE OR REPLACE FUNCTION public.attendance_may_notify(p_user UUID DEFAULT NULL)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
     WHERE p.id = COALESCE(p_user, auth.uid())
       AND p.role IN ('admin', 'principal', 'coordinator')
  ) OR EXISTS (
    SELECT 1 FROM public.homerooms h
     WHERE h.class_teacher_id = COALESCE(p_user, auth.uid())
  );
$$;

CREATE OR REPLACE FUNCTION public.attendance_notify_is_manager(p_user UUID DEFAULT NULL)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
     WHERE p.id = COALESCE(p_user, auth.uid())
       AND p.role IN ('admin', 'principal', 'coordinator')
  );
$$;

/**
 * Whether `p_user` may message about a student's day in `p_homeroom`.
 *
 * A NULL homeroom means "the student has no homeroom for that date", which only
 * a manager may act on — a class teacher's authority comes from the homeroom.
 */
CREATE OR REPLACE FUNCTION public.attendance_notify_covers(p_user UUID, p_homeroom UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.attendance_notify_is_manager(p_user)
     OR (p_homeroom IS NOT NULL AND EXISTS (
           SELECT 1 FROM public.homerooms h
            WHERE h.id = p_homeroom AND h.class_teacher_id = p_user));
$$;

-- ── Where an attendance message goes ────────────────────────────────────
-- The parent's number, not the student's: a ten-year-old marked absent is
-- exactly the case where the child's phone is the wrong place to send it.
-- whatsapp_numbers wins when a verified number is on file, then the guardian's,
-- and the student's own number is the last resort rather than the first.
CREATE OR REPLACE FUNCTION public.attendance_contact_msisdn(p_student UUID)
RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.normalize_msisdn(COALESCE(
    (SELECT w.msisdn FROM public.whatsapp_numbers w
      WHERE w.student_id = p_student AND w.opt_out_at IS NULL
      ORDER BY w.opt_in_at DESC NULLS LAST LIMIT 1),
    (SELECT d.guardian_phone     FROM public.student_details d WHERE d.student_id = p_student),
    (SELECT d.guardian_phone_alt FROM public.student_details d WHERE d.student_id = p_student),
    (SELECT d.phone              FROM public.student_details d WHERE d.student_id = p_student)));
$$;

-- An inbound STOP is honoured before anything is queued. A family who asked not
-- to be messaged must never be messaged again — that is what they asked for, and
-- Meta scores the number's quality on whether people block it, so one school
-- ignoring a STOP costs every family the channel.
CREATE OR REPLACE FUNCTION public.attendance_may_message(p_student UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.attendance_contact_msisdn(p_student) IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.whatsapp_numbers w
        WHERE w.student_id = p_student
          AND w.opt_out_at IS NOT NULL
          AND w.msisdn = public.attendance_contact_msisdn(p_student));
$$;

-- ── The automatic run ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.attendance_notify_schedules (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name          TEXT NOT NULL,
  enabled       BOOLEAN NOT NULL DEFAULT false,
  -- Attendance statuses to notify about. 'absent' alone is what a school
  -- actually wants every morning; late is the common second.
  statuses      TEXT[] NOT NULL DEFAULT ARRAY['absent'],
  -- Scope. All three NULL (or empty) means every homeroom in the school.
  homeroom_ids  UUID[],
  grades        SMALLINT[],
  sections      TEXT[],
  -- Wall-clock, read in the school's timezone (site_settings.attendance_config
  -- → timezone), not UTC. A school says "10:30", and 10:30 has to mean 10:30
  -- there whatever the server is set to.
  send_at       TIME NOT NULL DEFAULT '10:30',
  -- 0 = Sunday. Sunday is off by default: a school with no Sunday sheet would
  -- otherwise send nothing and still burn a run.
  quiet_days    SMALLINT[] NOT NULL DEFAULT ARRAY[0]::SMALLINT[],
  -- NULL means each student gets the template their own day resolves to, which
  -- is the right default: one run then tells an absent family one thing and a
  -- medical-leave family another. A key here forces that one template instead.
  template_key  TEXT,
  -- Approved leave is already explained, so by default the automatic run leaves
  -- those families alone rather than messaging them about something they
  -- applied for and the school granted.
  skip_approved_leave BOOLEAN NOT NULL DEFAULT true,
  -- Guards against a double run: pg_cron ticks every few minutes, and the
  -- schedule is due for the whole rest of the day once its time has passed.
  last_run_on      DATE,
  last_run_at      TIMESTAMPTZ,
  last_run_summary JSONB,
  created_by    UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── What was sent ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.attendance_message_log (
  id              BIGSERIAL PRIMARY KEY,
  student_id      UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  homeroom_id     UUID REFERENCES public.homerooms(id) ON DELETE SET NULL,
  attendance_date DATE NOT NULL,
  kind            TEXT NOT NULL,
  template_key    TEXT NOT NULL,
  channel         TEXT NOT NULL DEFAULT 'whatsapp',
  outbox_id       UUID REFERENCES public.notification_outbox(id) ON DELETE SET NULL,
  msisdn          TEXT,
  schedule_id     UUID REFERENCES public.attendance_notify_schedules(id) ON DELETE SET NULL,
  sent_at         TIMESTAMPTZ,
  delivered_at    TIMESTAMPTZ,
  read_at         TIMESTAMPTZ,
  failed_at       TIMESTAMPTZ,
  sent_by         UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_attn_msg_log_student
  ON public.attendance_message_log(student_id, attendance_date DESC);
CREATE INDEX IF NOT EXISTS idx_attn_msg_log_date
  ON public.attendance_message_log(attendance_date DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_attn_msg_log_outbox
  ON public.attendance_message_log(outbox_id);
-- "Already messaged today" is asked once per candidate row, so it gets its own
-- index rather than a sequential scan per student.
CREATE INDEX IF NOT EXISTS idx_attn_msg_log_dedupe
  ON public.attendance_message_log(student_id, attendance_date, template_key);

-- Defined here rather than reusing update_task_updated_at / update_updated_at_column:
-- both exist on the live database but neither is created by any migration in
-- this folder, so a fresh environment built from these files alone would fail
-- on the trigger and take the whole migration with it.
CREATE OR REPLACE FUNCTION public.attendance_notify_touch()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS attendance_notify_schedules_touch ON public.attendance_notify_schedules;
CREATE TRIGGER attendance_notify_schedules_touch
  BEFORE UPDATE ON public.attendance_notify_schedules
  FOR EACH ROW EXECUTE FUNCTION public.attendance_notify_touch();

-- ── The bulk list ───────────────────────────────────────────────────────
/**
 * Everyone the popup could message for one date, with the one thing a clerk
 * needs before pressing send: whether the message can actually arrive.
 *
 * This is one round trip instead of the five the browser would otherwise make
 * (records, profiles, homerooms, student_details, whatsapp_numbers) and it is
 * the only place the opt-out ledger, the guardian number and the approved leave
 * behind a mark are reconciled — so the list on screen is the list that will
 * send, rather than an optimistic version of it.
 *
 * Numbers are returned as a four-digit tail only. The office needs to tell two
 * guardians apart; it does not need the roll of every parent's mobile number
 * rendered into a DOM that any screenshot can carry out of the building.
 */
CREATE OR REPLACE FUNCTION public.attendance_message_candidates(
  p_date         DATE,
  p_homeroom_ids UUID[]   DEFAULT NULL,
  p_grades       INT[]    DEFAULT NULL,
  p_sections     TEXT[]   DEFAULT NULL,
  p_statuses     TEXT[]   DEFAULT NULL,
  p_limit        INT      DEFAULT 500
)
RETURNS TABLE (
  student_id   UUID,
  full_name    TEXT,
  email        TEXT,
  avatar_url   TEXT,
  grade        SMALLINT,
  section      TEXT,
  homeroom_id  UUID,
  homeroom_name TEXT,
  status       TEXT,
  kind         TEXT,
  template_key TEXT,
  leave_type   TEXT,
  leave_status TEXT,
  msisdn_tail  TEXT,
  contactable  BOOLEAN,
  opted_out    BOOLEAN,
  already_sent BOOLEAN
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor   UUID := auth.uid();
  v_manager BOOLEAN := public.attendance_notify_is_manager(v_actor);
BEGIN
  IF NOT public.attendance_may_notify(v_actor) THEN
    RAISE EXCEPTION 'You do not have permission to message parents about attendance';
  END IF;

  RETURN QUERY
  SELECT
    p.id, p.full_name::TEXT, p.email::TEXT, p.avatar_url::TEXT,
    p.grade::SMALLINT, p.section::TEXT,
    h.id, h.name::TEXT,
    r.status::TEXT,
    public.attendance_message_kind(r.status::TEXT, la.leave_type::TEXT, la.status::TEXT),
    public.attendance_template_for_kind(
      public.attendance_message_kind(r.status::TEXT, la.leave_type::TEXT, la.status::TEXT)),
    la.leave_type::TEXT, la.status::TEXT,
    RIGHT(m.msisdn, 4),
    m.msisdn IS NOT NULL AND NOT COALESCE(ox.opted_out, false),
    COALESCE(ox.opted_out, false),
    EXISTS (
      SELECT 1 FROM public.attendance_message_log l
       WHERE l.student_id = p.id
         AND l.attendance_date = p_date
         AND l.template_key = public.attendance_template_for_kind(
               public.attendance_message_kind(r.status::TEXT, la.leave_type::TEXT, la.status::TEXT)))
  FROM public.attendance_records r
  JOIN public.profiles  p ON p.id = r.student_id
  JOIN public.homerooms h ON h.id = r.homeroom_id
  LEFT JOIN public.leave_applications la ON la.id = r.leave_application_id
  -- LATERAL so the contact number is resolved once per row rather than three
  -- times (tail, contactable, opted-out) by three separate calls.
  LEFT JOIN LATERAL (
    SELECT public.attendance_contact_msisdn(p.id) AS msisdn) m ON true
  LEFT JOIN LATERAL (
    SELECT EXISTS (
      SELECT 1 FROM public.whatsapp_numbers w
       WHERE w.student_id = p.id AND w.opt_out_at IS NOT NULL
         AND w.msisdn = m.msisdn) AS opted_out) ox ON true
  WHERE r.date = p_date
    AND r.status::TEXT <> 'present'
    AND (p_statuses     IS NULL OR cardinality(p_statuses) = 0     OR r.status::TEXT = ANY(p_statuses))
    AND (p_homeroom_ids IS NULL OR cardinality(p_homeroom_ids) = 0 OR h.id    = ANY(p_homeroom_ids))
    AND (p_grades       IS NULL OR cardinality(p_grades) = 0       OR h.grade = ANY(p_grades))
    AND (p_sections     IS NULL OR cardinality(p_sections) = 0     OR h.section = ANY(p_sections))
    -- A class teacher sees their own homerooms here, the same scope the report
    -- gives them. SECURITY DEFINER means RLS is not doing it for us.
    AND (v_manager OR h.class_teacher_id = v_actor)
  ORDER BY h.grade NULLS LAST, h.section NULLS LAST, p.full_name
  LIMIT GREATEST(LEAST(p_limit, 2000), 1);
END $$;

/**
 * Typeahead over students, for adding one to the bulk list by hand.
 *
 * Returns the same shape as a candidate row so the popup can drop the result
 * straight into the list. A student with no attendance record for the date
 * comes back with a NULL status and kind: that is a real answer — you can look
 * them up, and the popup can then say plainly that there is nothing to tell
 * their parent about today rather than silently omitting them from the search.
 */
CREATE OR REPLACE FUNCTION public.attendance_student_search(
  p_query TEXT,
  p_date  DATE,
  p_limit INT DEFAULT 12
)
RETURNS TABLE (
  student_id   UUID,
  full_name    TEXT,
  email        TEXT,
  avatar_url   TEXT,
  grade        SMALLINT,
  section      TEXT,
  homeroom_id  UUID,
  homeroom_name TEXT,
  status       TEXT,
  kind         TEXT,
  template_key TEXT,
  leave_type   TEXT,
  leave_status TEXT,
  msisdn_tail  TEXT,
  contactable  BOOLEAN,
  opted_out    BOOLEAN,
  already_sent BOOLEAN
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor   UUID := auth.uid();
  v_manager BOOLEAN := public.attendance_notify_is_manager(v_actor);
  v_q       TEXT := '%' || btrim(COALESCE(p_query, '')) || '%';
BEGIN
  IF NOT public.attendance_may_notify(v_actor) THEN
    RAISE EXCEPTION 'You do not have permission to message parents about attendance';
  END IF;
  -- Two characters minimum: a one-letter query matches most of the school and
  -- the answer would be a page of names nobody meant to ask for.
  IF length(btrim(COALESCE(p_query, ''))) < 2 THEN RETURN; END IF;

  RETURN QUERY
  SELECT
    p.id, p.full_name::TEXT, p.email::TEXT, p.avatar_url::TEXT,
    p.grade::SMALLINT, p.section::TEXT,
    h.id, h.name::TEXT,
    r.status::TEXT,
    public.attendance_message_kind(r.status::TEXT, la.leave_type::TEXT, la.status::TEXT),
    public.attendance_template_for_kind(
      public.attendance_message_kind(r.status::TEXT, la.leave_type::TEXT, la.status::TEXT)),
    la.leave_type::TEXT, la.status::TEXT,
    RIGHT(m.msisdn, 4),
    m.msisdn IS NOT NULL AND NOT COALESCE(ox.opted_out, false),
    COALESCE(ox.opted_out, false),
    EXISTS (
      SELECT 1 FROM public.attendance_message_log l
       WHERE l.student_id = p.id AND l.attendance_date = p_date)
  FROM public.profiles p
  LEFT JOIN public.student_details sd ON sd.student_id = p.id
  LEFT JOIN public.attendance_records r ON r.student_id = p.id AND r.date = p_date
  LEFT JOIN public.homerooms h ON h.id = r.homeroom_id
  LEFT JOIN public.leave_applications la ON la.id = r.leave_application_id
  LEFT JOIN LATERAL (
    SELECT public.attendance_contact_msisdn(p.id) AS msisdn) m ON true
  LEFT JOIN LATERAL (
    SELECT EXISTS (
      SELECT 1 FROM public.whatsapp_numbers w
       WHERE w.student_id = p.id AND w.opt_out_at IS NOT NULL
         AND w.msisdn = m.msisdn) AS opted_out) ox ON true
  WHERE p.role = 'student'
    AND COALESCE(p.is_banned, false) = false
    AND (p.full_name ILIKE v_q OR p.email ILIKE v_q OR sd.admission_no ILIKE v_q
         OR sd.roll_no ILIKE v_q)
    -- A class teacher can look up their own students only. Searching the whole
    -- school from a teacher's screen would hand out the roll by name.
    AND (v_manager OR (h.id IS NOT NULL AND h.class_teacher_id = v_actor)
         OR EXISTS (SELECT 1 FROM public.homeroom_members hm
                     JOIN public.homerooms hh ON hh.id = hm.homeroom_id
                    WHERE hm.student_id = p.id AND hh.class_teacher_id = v_actor))
  ORDER BY p.full_name
  LIMIT GREATEST(LEAST(p_limit, 50), 1);
END $$;

-- ── Queueing ────────────────────────────────────────────────────────────
-- Who the message is attributed to. The client's own identity wins over
-- whatever a caller passes, so a request cannot claim to be somebody else; the
-- parameter is there for the service role, where auth.uid() is NULL.
CREATE OR REPLACE FUNCTION public.attendance_actor(p_actor UUID DEFAULT NULL)
RETURNS UUID
LANGUAGE sql STABLE
SET search_path = public
AS $$ SELECT COALESCE(auth.uid(), p_actor); $$;

/**
 * Queue one attendance message. The internal primitive — it does NOT check
 * permissions, which is why EXECUTE is revoked from authenticated at the bottom
 * of this file. Everything a parent-facing send has to get right lives here:
 *
 *   - nothing is sent about a day with nothing to report
 *   - an approved leave picks its own template, not "absent"
 *   - a STOP is honoured before a row is written, not after
 *   - the dedupe key makes a double-click a no-op rather than two messages
 *
 * The dedupe key is per student, per attendance date, per template. Not per day
 * of sending: an absence message in the morning and a medical-leave message
 * once the application is approved in the afternoon are two different things to
 * say about the same day, and a school should be able to say both.
 */
CREATE OR REPLACE FUNCTION public.attendance_queue_message(
  p_student    UUID,
  p_date       DATE,
  p_template   TEXT        DEFAULT NULL,
  p_schedule   UUID        DEFAULT NULL,
  p_actor      UUID        DEFAULT NULL,
  p_not_before TIMESTAMPTZ DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor    UUID := public.attendance_actor(p_actor);
  v_rec      RECORD;
  v_kind     TEXT;
  v_template TEXT;
  v_msisdn   TEXT;
  v_outbox   UUID;
  v_dedupe   TEXT;
  v_class    TEXT;
BEGIN
  SELECT r.status::TEXT       AS status,
         r.homeroom_id        AS homeroom_id,
         h.name               AS homeroom_name,
         h.grade              AS grade,
         h.section            AS section,
         la.leave_type::TEXT  AS leave_type,
         la.status::TEXT      AS leave_status,
         p.full_name          AS full_name
    INTO v_rec
    FROM public.attendance_records r
    JOIN public.profiles p ON p.id = r.student_id
    LEFT JOIN public.homerooms h ON h.id = r.homeroom_id
    LEFT JOIN public.leave_applications la ON la.id = r.leave_application_id
   WHERE r.student_id = p_student AND r.date = p_date
   -- A student can sit in more than one homeroom. Any of their records for the
   -- day names the same absence, so the first is as good as the last.
   ORDER BY r.updated_at DESC NULLS LAST
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('queued', false, 'reason', 'no_attendance_record');
  END IF;

  v_kind := public.attendance_message_kind(v_rec.status, v_rec.leave_type, v_rec.leave_status);
  IF v_kind IS NULL THEN
    RETURN jsonb_build_object('queued', false, 'reason', 'nothing_to_report');
  END IF;

  v_template := COALESCE(p_template, public.attendance_template_for_kind(v_kind));

  -- A template that is not registered and active would be claimed by the drain
  -- and then skipped there, which reads as "sent" on this screen. Refuse now.
  IF NOT EXISTS (
    SELECT 1 FROM public.message_templates t
     WHERE t.key = v_template AND t.channel = 'whatsapp' AND t.active
  ) THEN
    RETURN jsonb_build_object('queued', false, 'reason', 'no_such_template');
  END IF;

  IF NOT public.attendance_may_message(p_student) THEN
    RETURN jsonb_build_object('queued', false, 'reason', 'no_contact_or_opted_out');
  END IF;

  v_msisdn := public.attendance_contact_msisdn(p_student);
  v_class  := COALESCE(
    v_rec.homeroom_name,
    NULLIF(concat_ws(' ', 'Grade', v_rec.grade::TEXT, v_rec.section), 'Grade'),
    'class');

  v_dedupe := format('attn:%s:%s:%s', p_student, p_date, v_template);

  INSERT INTO public.notification_outbox (
    module, event_type, channel, recipient_user_id, recipient_address,
    subject_ref, template_key, variables, dedupe_key, not_before, priority)
  VALUES (
    'attendance', v_template, 'whatsapp', p_student, v_msisdn,
    jsonb_build_object('student_id', p_student, 'date', p_date,
                       'homeroom_id', v_rec.homeroom_id, 'kind', v_kind),
    v_template,
    jsonb_build_object(
      'student', v_rec.full_name,
      'class',   v_class,
      'date',    to_char(p_date, 'DD Mon YYYY')),
    v_dedupe, COALESCE(p_not_before, NOW()), 5)
  ON CONFLICT (dedupe_key) DO NOTHING
  RETURNING id INTO v_outbox;

  IF v_outbox IS NULL THEN
    RETURN jsonb_build_object('queued', false, 'reason', 'already_sent');
  END IF;

  INSERT INTO public.attendance_message_log (
    student_id, homeroom_id, attendance_date, kind, template_key,
    outbox_id, msisdn, schedule_id, sent_by)
  VALUES (p_student, v_rec.homeroom_id, p_date, v_kind, v_template,
          v_outbox, v_msisdn, p_schedule, v_actor);

  RETURN jsonb_build_object(
    'queued', true, 'outbox_id', v_outbox, 'kind', v_kind,
    'template', v_template, 'to', '••••••' || RIGHT(v_msisdn, 4));
END $$;

/**
 * Queue for a whole bulk list in one round trip.
 *
 * The permission boundary for anything a human presses. Every student is
 * checked against the caller's own scope rather than the request's: a class
 * teacher who edits the id list in the request body still cannot message
 * another teacher's class.
 *
 * Returns the counts by reason because "38 queued" without "4 no number on
 * file, 2 opted out" leaves the office wondering who was missed — and the
 * families who were missed are exactly the ones worth chasing by phone.
 */
CREATE OR REPLACE FUNCTION public.attendance_bulk_queue(
  p_students UUID[],
  p_date     DATE,
  p_template TEXT DEFAULT NULL,
  p_schedule UUID DEFAULT NULL,
  p_actor    UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor   UUID := public.attendance_actor(p_actor);
  v_student UUID;
  v_result  JSONB;
  v_queued  INT := 0;
  v_skipped JSONB := '{}'::jsonb;
  v_reason  TEXT;
  v_home    UUID;
BEGIN
  IF NOT public.attendance_may_notify(v_actor) THEN
    RAISE EXCEPTION 'You do not have permission to message parents about attendance';
  END IF;
  IF p_students IS NULL OR cardinality(p_students) = 0 THEN
    RETURN jsonb_build_object('queued', 0, 'skipped', v_skipped, 'considered', 0);
  END IF;
  -- A cap, not a guess: 500 messages is more than any single class list and
  -- small enough that one accidental press cannot message the whole school.
  IF cardinality(p_students) > 500 THEN
    RAISE EXCEPTION 'Too many at once — send to up to 500 students per run';
  END IF;

  FOREACH v_student IN ARRAY p_students LOOP
    SELECT r.homeroom_id INTO v_home
      FROM public.attendance_records r
     WHERE r.student_id = v_student AND r.date = p_date
     ORDER BY r.updated_at DESC NULLS LAST LIMIT 1;

    IF NOT public.attendance_notify_covers(v_actor, v_home) THEN
      v_skipped := jsonb_set(v_skipped, ARRAY['out_of_scope'],
        to_jsonb(COALESCE((v_skipped ->> 'out_of_scope')::INT, 0) + 1), true);
      CONTINUE;
    END IF;

    v_result := public.attendance_queue_message(
      v_student, p_date, p_template, p_schedule, v_actor);

    IF (v_result ->> 'queued')::BOOLEAN THEN
      v_queued := v_queued + 1;
    ELSE
      v_reason := COALESCE(v_result ->> 'reason', 'unknown');
      v_skipped := jsonb_set(v_skipped, ARRAY[v_reason],
        to_jsonb(COALESCE((v_skipped ->> v_reason)::INT, 0) + 1), true);
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'queued', v_queued, 'skipped', v_skipped,
    'considered', cardinality(p_students));
END $$;

-- ── The automatic run ───────────────────────────────────────────────────
-- A schedule enabled at 3pm for a 10:30 send must not fire the moment it is
-- saved: its time for today has passed, and the office means tomorrow. Marking
-- today as already run says that, and the first real run is tomorrow morning.
CREATE OR REPLACE FUNCTION public.attendance_schedule_arm()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tz    TEXT := public.attendance_timezone();
  v_local TIMESTAMP := (NOW() AT TIME ZONE v_tz);
BEGIN
  IF NEW.last_run_on IS NULL AND NEW.send_at <= v_local::TIME THEN
    NEW.last_run_on := v_local::DATE;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS attendance_notify_schedules_arm ON public.attendance_notify_schedules;
CREATE TRIGGER attendance_notify_schedules_arm
  BEFORE INSERT ON public.attendance_notify_schedules
  FOR EACH ROW EXECUTE FUNCTION public.attendance_schedule_arm();

/**
 * Every enabled schedule whose time has come, once per day.
 *
 * Called by pg_cron every five minutes rather than at a fixed hour, because the
 * send time is a per-schedule setting a school changes without a migration. The
 * `last_run_on` guard is what makes a five-minute tick safe: a schedule due at
 * 10:30 is still "due" at 10:35, and without the guard it would send again on
 * every tick for the rest of the day.
 *
 * Wall-clock times are read in the school's timezone, the same one the check-in
 * cutoffs use. A server in UTC must not move a 10:30 message to 4am.
 */
CREATE OR REPLACE FUNCTION public.attendance_notify_tick()
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tz      TEXT := public.attendance_timezone();
  v_local   TIMESTAMP := (NOW() AT TIME ZONE v_tz);
  v_today   DATE := v_local::DATE;
  v_time    TIME := v_local::TIME;
  v_dow     INT  := EXTRACT(DOW FROM v_local)::INT;
  v_s       RECORD;
  v_row     RECORD;
  v_result  JSONB;
  v_queued  INT;
  v_seen    INT;
  v_skipped JSONB;
  v_reason  TEXT;
  v_runs    INT := 0;
  v_total   INT := 0;
BEGIN
  FOR v_s IN
    SELECT * FROM public.attendance_notify_schedules
     WHERE enabled
       AND send_at <= v_time
       AND (last_run_on IS NULL OR last_run_on < v_today)
  LOOP
    IF v_dow::SMALLINT = ANY(COALESCE(v_s.quiet_days, ARRAY[]::SMALLINT[])) THEN
      -- A quiet day is not a missed run: mark it done so the schedule does not
      -- re-examine the same Sunday every five minutes until midnight.
      UPDATE public.attendance_notify_schedules
         SET last_run_on = v_today, last_run_at = NOW(),
             last_run_summary = jsonb_build_object('skipped_reason', 'quiet_day')
       WHERE id = v_s.id;
      CONTINUE;
    END IF;

    v_queued := 0; v_seen := 0; v_skipped := '{}'::jsonb;

    FOR v_row IN
      SELECT r.student_id
        FROM public.attendance_records r
        JOIN public.homerooms h ON h.id = r.homeroom_id
        LEFT JOIN public.leave_applications la ON la.id = r.leave_application_id
       WHERE r.date = v_today
         AND r.status::TEXT = ANY(v_s.statuses)
         AND (v_s.homeroom_ids IS NULL OR cardinality(v_s.homeroom_ids) = 0
              OR h.id = ANY(v_s.homeroom_ids))
         AND (v_s.grades IS NULL OR cardinality(v_s.grades) = 0
              OR h.grade = ANY(v_s.grades))
         AND (v_s.sections IS NULL OR cardinality(v_s.sections) = 0
              OR h.section = ANY(v_s.sections))
         -- A family who applied for leave and had it granted has already been
         -- told. Messaging them anyway is the fastest way to teach a parent
         -- that this channel is noise.
         AND (NOT v_s.skip_approved_leave OR la.id IS NULL OR la.status::TEXT <> 'approved')
       GROUP BY r.student_id
    LOOP
      v_seen := v_seen + 1;
      v_result := public.attendance_queue_message(
        v_row.student_id, v_today, v_s.template_key, v_s.id, v_s.created_by);
      IF (v_result ->> 'queued')::BOOLEAN THEN
        v_queued := v_queued + 1;
      ELSE
        v_reason := COALESCE(v_result ->> 'reason', 'unknown');
        v_skipped := jsonb_set(v_skipped, ARRAY[v_reason],
          to_jsonb(COALESCE((v_skipped ->> v_reason)::INT, 0) + 1), true);
      END IF;
    END LOOP;

    UPDATE public.attendance_notify_schedules
       SET last_run_on = v_today, last_run_at = NOW(),
           last_run_summary = jsonb_build_object(
             'considered', v_seen, 'queued', v_queued, 'skipped', v_skipped)
     WHERE id = v_s.id;

    v_runs := v_runs + 1;
    v_total := v_total + v_queued;
  END LOOP;

  RETURN jsonb_build_object('schedules_run', v_runs, 'queued', v_total, 'on', v_today);
END $$;

-- ── The drain ───────────────────────────────────────────────────────────
-- fee_kick_drain with an attendance module filter. Counting first means a quiet
-- minute costs a COUNT, not an HTTP request that wakes a serverless function.
CREATE OR REPLACE FUNCTION public.attendance_kick_drain()
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, net
AS $$
DECLARE
  v_url     TEXT;
  v_secret  TEXT;
  v_pending INT;
BEGIN
  SELECT value ->> 'drain_url', value ->> 'cron_secret'
    INTO v_url, v_secret
    FROM public.site_settings WHERE key = 'attendance_runtime';
  IF v_url IS NULL OR v_secret IS NULL THEN RETURN; END IF;

  SELECT count(*) INTO v_pending
    FROM public.notification_outbox
   WHERE module = 'attendance' AND status IN ('queued', 'sending') AND not_before <= NOW();
  IF v_pending = 0 THEN RETURN; END IF;

  PERFORM net.http_post(
    url := v_url,
    body := jsonb_build_object('limit', 50),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret));
END $$;

-- FOR UPDATE SKIP LOCKED so two overlapping drains take different messages
-- rather than both taking the same one and sending it twice.
CREATE OR REPLACE FUNCTION public.attendance_claim_outbox(p_limit INT DEFAULT 50)
RETURNS SETOF public.notification_outbox
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH claimed AS (
    SELECT id FROM public.notification_outbox
     WHERE module = 'attendance' AND status = 'queued' AND not_before <= NOW()
       AND (expires_at IS NULL OR expires_at > NOW())
     ORDER BY priority, not_before
     LIMIT p_limit
     FOR UPDATE SKIP LOCKED)
  UPDATE public.notification_outbox o
     SET status = 'sending', attempts = o.attempts + 1, updated_at = NOW()
    FROM claimed
   WHERE o.id = claimed.id
  RETURNING o.*;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('attendance-drain')
      WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'attendance-drain');
    PERFORM cron.unschedule('attendance-notify')
      WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'attendance-notify');
    PERFORM cron.schedule('attendance-drain',  '* * * * *',
      'SELECT public.attendance_kick_drain();');
    -- Every five minutes, not at a fixed hour: the send time is a per-schedule
    -- setting, so the tick has to come round often enough to honour any of them.
    PERFORM cron.schedule('attendance-notify', '*/5 * * * *',
      'SELECT public.attendance_notify_tick();');
  END IF;
END$$;

-- ── Templates ───────────────────────────────────────────────────────────
-- Every one of these takes the same three body parameters in the same order:
-- {{1}} student, {{2}} class, {{3}} date. That uniformity is the point. Meta's
-- template messages are positional, the order here is the contract with what
-- you register in WhatsApp Manager, and ten templates with ten different
-- parameter orders is ten chances to tell a parent the wrong thing.
--
-- Register all of them under category Utility, never Marketing: utility is
-- cheaper in India and is not subject to marketing opt-outs, and an attendance
-- notice genuinely is a utility message about a transaction the parent is party
-- to. Marketing category on these would be both dearer and wrong.
--
-- No template names another child, a class total, or a comparison. A parent is
-- told about their own child's day and nothing else.
INSERT INTO public.message_templates (
  key, channel, locale, provider_template_name, provider_template_lang,
  variable_order, title_template, body_template, url_template, active)
VALUES
  ('attendance_absent', 'whatsapp', 'en', 'attendance_absent', 'en',
   ARRAY['student','class','date'],
   'Absent on {{date}}',
   'Dear Parent, {{student}} of {{class}} was marked absent from school on {{date}}. If this is unexpected, please contact the school office.',
   NULL, true),

  ('attendance_late', 'whatsapp', 'en', 'attendance_late', 'en',
   ARRAY['student','class','date'],
   'Late on {{date}}',
   'Dear Parent, {{student}} of {{class}} reached school late on {{date}}. Please help them arrive before the school day begins.',
   NULL, true),

  ('attendance_half_day', 'whatsapp', 'en', 'attendance_half_day', 'en',
   ARRAY['student','class','date'],
   'Half day on {{date}}',
   'Dear Parent, {{student}} of {{class}} was present for only part of the day on {{date}}. Please contact the school office if you would like the details.',
   NULL, true),

  ('attendance_excused', 'whatsapp', 'en', 'attendance_excused', 'en',
   ARRAY['student','class','date'],
   'Excused on {{date}}',
   'Dear Parent, {{student}} of {{class}} was excused from classes on {{date}} by the school. No attendance will be marked against them for that day.',
   NULL, true),

  ('attendance_leave', 'whatsapp', 'en', 'attendance_leave', 'en',
   ARRAY['student','class','date'],
   'On leave on {{date}}',
   'Dear Parent, {{student}} of {{class}} is recorded as on approved leave on {{date}}. No attendance is marked against them for that day.',
   NULL, true),

  ('attendance_leave_casual', 'whatsapp', 'en', 'attendance_leave_casual', 'en',
   ARRAY['student','class','date'],
   'Casual leave approved',
   'Dear Parent, the casual leave (CL) for {{student}} of {{class}} is approved for {{date}}. They are not expected in school that day and no absence will be marked.',
   NULL, true),

  ('attendance_leave_medical', 'whatsapp', 'en', 'attendance_leave_medical', 'en',
   ARRAY['student','class','date'],
   'Medical leave approved',
   'Dear Parent, the medical leave (ML) for {{student}} of {{class}} is approved for {{date}}. No absence will be marked. We hope they are feeling better soon.',
   NULL, true),

  ('attendance_on_duty', 'whatsapp', 'en', 'attendance_on_duty', 'en',
   ARRAY['student','class','date'],
   'On duty on {{date}}',
   'Dear Parent, {{student}} of {{class}} is marked on duty (OD) for {{date}}, representing the school. This counts as present, not absent.',
   NULL, true),

  ('attendance_late_permit', 'whatsapp', 'en', 'attendance_late_permit', 'en',
   ARRAY['student','class','date'],
   'Late permit approved',
   'Dear Parent, the late permit for {{student}} of {{class}} is approved for {{date}}. Arriving late on that day will not be recorded against them.',
   NULL, true),

  ('attendance_half_day_permit', 'whatsapp', 'en', 'attendance_half_day_permit', 'en',
   ARRAY['student','class','date'],
   'Half day permit approved',
   'Dear Parent, the half day permit for {{student}} of {{class}} is approved for {{date}}. Leaving early on that day will not be recorded against them.',
   NULL, true)
ON CONFLICT (key, channel, locale) DO UPDATE
  SET provider_template_name = EXCLUDED.provider_template_name,
      provider_template_lang = EXCLUDED.provider_template_lang,
      variable_order = EXCLUDED.variable_order,
      title_template = EXCLUDED.title_template,
      body_template  = EXCLUDED.body_template,
      url_template   = EXCLUDED.url_template;

-- ── site_settings.attendance_runtime holds a secret ─────────────────────
-- Same reasoning as fee_runtime: site_settings is readable by anon (the login
-- screen reads branding before sign-in), so a key carrying cron_secret has to
-- be named in the denylist or it ships inside the browser bundle's reach.
CREATE OR REPLACE FUNCTION public.is_sensitive_site_setting(p_key text)
RETURNS boolean
LANGUAGE sql IMMUTABLE
SET search_path = public
AS $$
  SELECT p_key = ANY (ARRAY[
    'fee_runtime',        -- cron_secret, drain_url
    'attendance_runtime'  -- cron_secret, drain_url
  ]);
$$;

GRANT EXECUTE ON FUNCTION public.is_sensitive_site_setting(text) TO anon, authenticated;

-- ── RLS ─────────────────────────────────────────────────────────────────
ALTER TABLE public.attendance_notify_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_message_log      ENABLE ROW LEVEL SECURITY;

-- Anyone who may send can see what the automation is set to do — a class
-- teacher needs to know a message already went out before they phone a parent.
DROP POLICY IF EXISTS "Read attendance notify schedules" ON public.attendance_notify_schedules;
CREATE POLICY "Read attendance notify schedules" ON public.attendance_notify_schedules
  FOR SELECT TO authenticated
  USING (public.attendance_may_notify());

-- Changing what the whole school is messaged automatically is a management
-- decision, not a class teacher's.
DROP POLICY IF EXISTS "Manage attendance notify schedules" ON public.attendance_notify_schedules;
CREATE POLICY "Manage attendance notify schedules" ON public.attendance_notify_schedules
  FOR ALL TO authenticated
  USING (public.attendance_notify_is_manager())
  WITH CHECK (public.attendance_notify_is_manager());

-- A student (and so a parent on their account) can see what was sent about
-- them. Nobody else reads this table without send rights.
DROP POLICY IF EXISTS "Read attendance message log" ON public.attendance_message_log;
CREATE POLICY "Read attendance message log" ON public.attendance_message_log
  FOR SELECT TO authenticated
  USING (student_id = (SELECT auth.uid()) OR public.attendance_may_notify());

-- No INSERT or UPDATE policy on purpose: rows are written by
-- attendance_queue_message and the drain, both SECURITY DEFINER. A client that
-- could write here could claim a message was sent that never was.

GRANT SELECT, INSERT, UPDATE, DELETE ON public.attendance_notify_schedules TO authenticated;
GRANT SELECT ON public.attendance_message_log TO authenticated;

-- ── Function grants ─────────────────────────────────────────────────────
-- Postgres grants EXECUTE to PUBLIC by default, which with a SECURITY DEFINER
-- function means the anon key can call it. Revoke everything, then grant back
-- only what a signed-in staff member actually presses.
DO $$
DECLARE fn TEXT;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'attendance_message_kind(text,text,text)',
    'attendance_template_for_kind(text)',
    'attendance_may_notify(uuid)',
    'attendance_notify_is_manager(uuid)',
    'attendance_notify_covers(uuid,uuid)',
    'attendance_contact_msisdn(uuid)',
    'attendance_may_message(uuid)',
    'attendance_actor(uuid)',
    'attendance_message_candidates(date,uuid[],int[],text[],text[],int)',
    'attendance_student_search(text,date,int)',
    'attendance_queue_message(uuid,date,text,uuid,uuid,timestamptz)',
    'attendance_bulk_queue(uuid[],date,text,uuid,uuid)',
    'attendance_notify_tick()',
    'attendance_kick_drain()',
    'attendance_claim_outbox(int)',
    'attendance_schedule_arm()',
    'attendance_notify_touch()'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', fn);
  END LOOP;

  -- What the popup calls.
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.attendance_message_candidates(date,uuid[],int[],text[],text[],int) TO authenticated';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.attendance_student_search(text,date,int) TO authenticated';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.attendance_bulk_queue(uuid[],date,text,uuid,uuid) TO authenticated';
  -- Whether to show the button at all.
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.attendance_may_notify(uuid) TO authenticated';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.attendance_notify_is_manager(uuid) TO authenticated';
  -- Used inside RLS policies, which run as the querying role.
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.attendance_message_kind(text,text,text) TO authenticated';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.attendance_template_for_kind(text) TO authenticated';

  -- Deliberately NOT granted to authenticated:
  --   attendance_contact_msisdn / attendance_may_message — return or test a
  --     parent's full number; the candidate list hands out four digits instead.
  --   attendance_queue_message — no permission check of its own; reachable only
  --     through attendance_bulk_queue and the tick.
  --   attendance_notify_tick / attendance_kick_drain / attendance_claim_outbox —
  --     cron and the service role.
END$$;

NOTIFY pgrst, 'reload schema';
