-- ============================================================================
-- Migration: recompute staff attendance when a day's rules change after the fact
--
-- Problem this addresses
-- ----------------------
-- `staff_attendance_records.status` is decided once, at the moment of the
-- punch, by staff_attendance_punch() reading the cutoffs then in force. That is
-- correct for the punch and wrong for everything after it: the rules a day is
-- scored against are editable, and they are routinely edited *after* the day is
-- over. An admin who realises on Monday that Saturday ran on a short timetable
-- adds a checkout cutoff for Saturday — and every staff member who left early
-- that day is still stamped Half Day, because nothing ever revisits the
-- decision. Declaring the day a holiday or a non-working day afterwards does
-- the same thing: the calendar starts calling it a day off while the records on
-- it still carry Late and Half Day.
--
-- The cost is not cosmetic. Payroll reads those statuses: `Half Day` and `Late`
-- are LOP occurrences in computeStaffAttendanceStats(), so a cutoff corrected
-- after the fact leaves real money deducted against a rule that no longer
-- exists, in a figure nobody has any reason to re-check.
--
-- What this adds
-- --------------
--   1. attendance_derived_status() — the punch's own late / half-day / exception
--      ladder, lifted out so it can be evaluated again later against whatever
--      the rules say *now*. It is deliberately the same ladder, in the same
--      order, reading the same attendance_effective_cutoffs() the punch reads,
--      so recomputing a day nothing has changed on is a no-op by construction.
--
--   2. attendance_day_off_kind() — whether a date is a holiday or a non-working
--      day for one staff member, group rules and weekly-recurring rules
--      included. A day off has no cutoffs in force, so a punch on one derives
--      to Present: showing up on a declared holiday cannot make somebody Late,
--      and leaving early on one cannot make them Half Day.
--
--   3. recompute_staff_attendance_dates() — re-derives and writes back, and
--      ONLY for rows the punch itself wrote: a record with a check-in, no
--      `marked_by` (so no admin's hand-set status is overwritten) and no
--      `leave_application_id` (so no approved leave is undone). Rows already
--      holding the derived status are left alone, so the write count is the
--      number of statuses that genuinely moved.
--
--   4. attendance_recompute_queue + triggers — the efficiency half. Recomputing
--      on every page load would be a month of derivations to answer "nothing
--      changed", so nothing recomputes speculatively. Instead every write to a
--      rule table marks the affected scope dirty, and the drain below is a
--      single indexed read of an empty table in the overwhelmingly common case.
--      Rules for dates still in the future are never queued: their punches do
--      not exist yet and will be scored correctly when they do.
--
--   5. attendance_recompute_pending() — claims the queue, resolves the dirty
--      scopes down to the dates that actually carry punches inside the lookback
--      window, recomputes those, and clears what it claimed. This is what the
--      settings screens call after saving, and what the attendance report and
--      the salary pages call before reading.
--
-- What it deliberately does not do
-- --------------------------------
-- A closed pay cycle is not touched. Its PF / ESI / LOP figures are snapshotted
-- onto the salary records when it is locked, and silently moving a disbursed
-- month is not a correction, it is a discrepancy nobody asked for. Open cycles
-- compute those figures live from these statuses, so they pick the change up on
-- their next load with no snapshot to reconcile. A locked month that genuinely
-- needs the new rules applied is reopened, which recomputes it through the
-- existing path.
--
-- Run this in the Supabase SQL Editor, after attendance_device_problem_warning.sql.
-- Safe to re-run.
-- ============================================================================

-- ── 1. Is a date a day off for this staff member? ───────────────────────────
--
-- Mirrors deriveDayStatus()'s precedence: a non-working day outranks a holiday
-- on the same date (the day can only be one or the other, and non-working is
-- the stricter reading). Both scope kinds count — an exact-date rule and a
-- weekly-recurring rule for that weekday — and so do group rules, which apply
-- to their listed members only.

CREATE OR REPLACE FUNCTION public.attendance_day_off_kind(p_staff_id UUID, p_date DATE)
RETURNS TEXT
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  dow INTEGER := EXTRACT(DOW FROM p_date)::INTEGER;
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.attendance_non_working_days d
    WHERE ((d.scope_type = 'date'    AND d.scope_date    = p_date)
        OR (d.scope_type = 'weekday' AND d.scope_weekday = dow))
      AND (d.is_default OR EXISTS (
        SELECT 1 FROM public.attendance_non_working_day_members m
        WHERE m.non_working_day_id = d.id AND m.staff_id = p_staff_id
      ))
  ) THEN
    RETURN 'non_working';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.attendance_holidays h
    WHERE ((h.scope_type = 'date'    AND h.scope_date    = p_date)
        OR (h.scope_type = 'weekday' AND h.scope_weekday = dow))
      AND (h.is_default OR EXISTS (
        SELECT 1 FROM public.attendance_holiday_members m
        WHERE m.holiday_id = h.id AND m.staff_id = p_staff_id
      ))
  ) THEN
    RETURN 'holiday';
  END IF;

  RETURN NULL;
END;
$$;

-- ── 2. The punch's status ladder, evaluated against today's rules ───────────
--
-- Reproduces staff_attendance_punch() exactly, slot by slot:
--   * a second check-in makes the day an Exception, whatever else happened;
--   * a checkout in an earlier minute than the checkout cutoff makes it a Half
--     Day, overriding the check-in's own verdict, as the 'out' slot does;
--   * otherwise the check-in decides — Late in a later minute than the late
--     cutoff, else Present.
-- Whole-minute comparisons throughout, so the cutoff minute itself stays on
-- time: 08:45 means Late from 08:46:00, the same as at the punch.
--
-- Returns NULL for a row with no check-in — there is no punch to re-score, and
-- the caller skips it rather than inventing a status for it.

CREATE OR REPLACE FUNCTION public.attendance_derived_status(
  p_staff_id UUID,
  p_date DATE,
  p_check_in TIMESTAMPTZ,
  p_check_out TIMESTAMPTZ,
  p_check_in_2 TIMESTAMPTZ
) RETURNS public.staff_attendance_status
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  tz TEXT := public.attendance_timezone();
  c RECORD;
BEGIN
  IF p_check_in IS NULL THEN
    RETURN NULL;
  END IF;

  IF p_check_in_2 IS NOT NULL THEN
    RETURN 'e'::public.staff_attendance_status;
  END IF;

  -- A holiday or non-working day has no cutoffs in force. Somebody who came in
  -- anyway is Present; they cannot be Late to a day off, and cannot owe a full
  -- day on one.
  IF public.attendance_day_off_kind(p_staff_id, p_date) IS NOT NULL THEN
    RETURN 'present'::public.staff_attendance_status;
  END IF;

  SELECT * INTO c FROM public.attendance_effective_cutoffs(p_staff_id, p_date);

  IF p_check_out IS NOT NULL
     AND c.checkout_cutoff IS NOT NULL
     AND public.attendance_minute_of_day((p_check_out AT TIME ZONE tz)::TIME)
           < public.attendance_minute_of_day(c.checkout_cutoff) THEN
    RETURN 'half_day'::public.staff_attendance_status;
  END IF;

  IF c.late_cutoff IS NOT NULL
     AND public.attendance_minute_of_day((p_check_in AT TIME ZONE tz)::TIME)
           > public.attendance_minute_of_day(c.late_cutoff) THEN
    RETURN 'late'::public.staff_attendance_status;
  END IF;

  RETURN 'present'::public.staff_attendance_status;
END;
$$;

-- ── 3. Re-derive and write back, for a set of dates ─────────────────────────
--
-- The guards are what make this safe to run over history unattended:
--
--   check_in_time IS NOT NULL     only punch-written rows are re-scored
--   marked_by IS NULL             an admin's hand-set status is theirs, not a
--                                 derivation to be overwritten
--   leave_application_id IS NULL  approved leave is written by the leave sync
--                                 and is not the cutoffs' business
--   status IN (present, late,     the four the punch can produce. `absent`,
--     half_day, e)                `on_leave` and `wfh` reached the row some
--                                 other way and stay as they are.
--
-- Only rows whose derived status actually differs are written, so the returned
-- count is the number of statuses that moved and a repeat run returns 0.

CREATE OR REPLACE FUNCTION public.recompute_staff_attendance_dates(
  p_dates DATE[],
  p_staff_ids UUID[] DEFAULT NULL
) RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_updated INTEGER := 0;
BEGIN
  IF public.get_user_role() NOT IN ('admin', 'principal') THEN
    RAISE EXCEPTION 'Only an admin or principal can recompute attendance statuses';
  END IF;

  IF p_dates IS NULL OR array_length(p_dates, 1) IS NULL THEN
    RETURN 0;
  END IF;

  WITH target AS (
    SELECT
      r.id,
      public.attendance_derived_status(
        r.staff_id, r.date, r.check_in_time, r.check_out_time, r.check_in_time_2
      ) AS derived
    FROM public.staff_attendance_records r
    WHERE r.date = ANY (p_dates)
      AND (p_staff_ids IS NULL OR r.staff_id = ANY (p_staff_ids))
      AND r.check_in_time IS NOT NULL
      AND r.marked_by IS NULL
      AND r.leave_application_id IS NULL
      AND r.status IN ('present', 'late', 'half_day', 'e')
  ), changed AS (
    UPDATE public.staff_attendance_records r
    SET status = t.derived
    FROM target t
    WHERE r.id = t.id
      AND t.derived IS NOT NULL
      AND r.status IS DISTINCT FROM t.derived
    RETURNING 1
  )
  SELECT COUNT(*)::INTEGER INTO v_updated FROM changed;

  RETURN v_updated;
END;
$$;

-- ── 4. The dirty queue ──────────────────────────────────────────────────────
--
-- One row per dirty scope, not per dirty date: a weekly-recurring rule covers
-- an open-ended set of dates and expanding it here would store a list that is
-- wrong the next morning. The drain resolves scopes to dates instead, against
-- the records that actually exist.

CREATE TABLE IF NOT EXISTS public.attendance_recompute_queue (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  -- 'date' / 'weekday' mirror the rule tables. 'all' is the school-wide
  -- attendance_config cutoffs moving, which can affect any day without an
  -- override.
  scope_type TEXT NOT NULL CHECK (scope_type IN ('date', 'weekday', 'all')),
  scope_date DATE,
  scope_weekday SMALLINT CHECK (scope_weekday BETWEEN 0 AND 6),
  -- Which setting dirtied it — diagnostics only, never read by the drain.
  source TEXT NOT NULL,
  queued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT attendance_recompute_queue_scope_check CHECK (
    (scope_type = 'date'    AND scope_date IS NOT NULL AND scope_weekday IS NULL) OR
    (scope_type = 'weekday' AND scope_weekday IS NOT NULL AND scope_date IS NULL) OR
    (scope_type = 'all'     AND scope_date IS NULL AND scope_weekday IS NULL)
  )
);

-- Dedup on the scope alone. Saving one day's cutoffs is a delete-then-insert of
-- several rows plus their members; all of it collapses to the one queue entry.
CREATE UNIQUE INDEX IF NOT EXISTS idx_attendance_recompute_queue_date
  ON public.attendance_recompute_queue(scope_date) WHERE scope_type = 'date';
CREATE UNIQUE INDEX IF NOT EXISTS idx_attendance_recompute_queue_weekday
  ON public.attendance_recompute_queue(scope_weekday) WHERE scope_type = 'weekday';
CREATE UNIQUE INDEX IF NOT EXISTS idx_attendance_recompute_queue_all
  ON public.attendance_recompute_queue((scope_type)) WHERE scope_type = 'all';

ALTER TABLE public.attendance_recompute_queue ENABLE ROW LEVEL SECURITY;

-- Rows are written by the SECURITY DEFINER triggers below, never by a client.
-- The policy exists so an admin can look at what is outstanding.
DROP POLICY IF EXISTS "Admin can view recompute queue" ON public.attendance_recompute_queue;
CREATE POLICY "Admin can view recompute queue"
  ON public.attendance_recompute_queue FOR SELECT
  USING (public.get_user_role() IN ('admin', 'principal'));

-- ── 5. Marking a scope dirty ────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.attendance_queue_recompute(
  p_scope_type TEXT,
  p_scope_date DATE,
  p_scope_weekday SMALLINT,
  p_source TEXT
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- A rule for a day that has not happened yet has nothing to correct: the
  -- punches it would re-score do not exist, and it is already in force by the
  -- time they are made.
  IF p_scope_type = 'date' THEN
    IF p_scope_date IS NULL
       OR p_scope_date > (NOW() AT TIME ZONE public.attendance_timezone())::DATE THEN
      RETURN;
    END IF;
    INSERT INTO public.attendance_recompute_queue (scope_type, scope_date, source)
    VALUES ('date', p_scope_date, p_source)
    ON CONFLICT DO NOTHING;

  ELSIF p_scope_type = 'weekday' THEN
    IF p_scope_weekday IS NULL THEN RETURN; END IF;
    INSERT INTO public.attendance_recompute_queue (scope_type, scope_weekday, source)
    VALUES ('weekday', p_scope_weekday, p_source)
    ON CONFLICT DO NOTHING;

  ELSE
    INSERT INTO public.attendance_recompute_queue (scope_type, source)
    VALUES ('all', p_source)
    ON CONFLICT DO NOTHING;
  END IF;
END;
$$;

-- Rule tables: attendance_day_timings, attendance_holidays,
-- attendance_non_working_days. All three carry the same scope columns, so one
-- trigger function covers them; TG_ARGV[0] is the source label.
CREATE OR REPLACE FUNCTION public.attendance_rule_changed()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r RECORD;
BEGIN
  IF TG_OP = 'DELETE' THEN r := OLD; ELSE r := NEW; END IF;
  PERFORM public.attendance_queue_recompute(r.scope_type, r.scope_date, r.scope_weekday, TG_ARGV[0]);

  -- An edit that moved a rule from one scope to another leaves both stale.
  IF TG_OP = 'UPDATE'
     AND (OLD.scope_type, OLD.scope_date, OLD.scope_weekday)
         IS DISTINCT FROM (NEW.scope_type, NEW.scope_date, NEW.scope_weekday) THEN
    PERFORM public.attendance_queue_recompute(OLD.scope_type, OLD.scope_date, OLD.scope_weekday, TG_ARGV[0]);
  END IF;

  RETURN NULL;
END;
$$;

-- Member tables: who a group rule covers is as much a part of the rule as its
-- cutoffs, so adding or removing a member dirties the parent's scope.
-- TG_ARGV[0] = parent table, TG_ARGV[1] = the FK column, TG_ARGV[2] = source.
CREATE OR REPLACE FUNCTION public.attendance_rule_member_changed()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row JSONB;
  v_rule_id UUID;
  v_scope_type TEXT;
  v_scope_date DATE;
  v_scope_weekday SMALLINT;
BEGIN
  IF TG_OP = 'DELETE' THEN v_row := to_jsonb(OLD); ELSE v_row := to_jsonb(NEW); END IF;
  v_rule_id := (v_row ->> TG_ARGV[1])::UUID;
  IF v_rule_id IS NULL THEN RETURN NULL; END IF;

  EXECUTE format(
    'SELECT scope_type, scope_date, scope_weekday FROM public.%I WHERE id = $1', TG_ARGV[0]
  ) INTO v_scope_type, v_scope_date, v_scope_weekday USING v_rule_id;

  -- No parent row: this is the cascade from deleting the rule itself, and the
  -- rule's own trigger has already queued the scope.
  IF v_scope_type IS NULL THEN RETURN NULL; END IF;

  PERFORM public.attendance_queue_recompute(v_scope_type, v_scope_date, v_scope_weekday, TG_ARGV[2]);
  RETURN NULL;
END;
$$;

-- The school-wide fallback cutoffs live in site_settings. They only need a
-- recompute when one of the values a punch is actually scored against moves —
-- saving the same cutoffs back, or editing an unrelated key, does not.
CREATE OR REPLACE FUNCTION public.attendance_config_changed()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.key IS DISTINCT FROM 'attendance_config' THEN
    RETURN NULL;
  END IF;

  IF TG_OP = 'UPDATE'
     AND COALESCE(OLD.value ->> 'late_cutoff', '')     IS NOT DISTINCT FROM COALESCE(NEW.value ->> 'late_cutoff', '')
     AND COALESCE(OLD.value ->> 'checkout_cutoff', '') IS NOT DISTINCT FROM COALESCE(NEW.value ->> 'checkout_cutoff', '')
     AND COALESCE(OLD.value ->> 'timezone', '')        IS NOT DISTINCT FROM COALESCE(NEW.value ->> 'timezone', '') THEN
    RETURN NULL;
  END IF;

  PERFORM public.attendance_queue_recompute('all', NULL, NULL, 'attendance_config');
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS attendance_day_timings_recompute ON public.attendance_day_timings;
CREATE TRIGGER attendance_day_timings_recompute
  AFTER INSERT OR UPDATE OR DELETE ON public.attendance_day_timings
  FOR EACH ROW EXECUTE FUNCTION public.attendance_rule_changed('day_timing');

DROP TRIGGER IF EXISTS attendance_holidays_recompute ON public.attendance_holidays;
CREATE TRIGGER attendance_holidays_recompute
  AFTER INSERT OR UPDATE OR DELETE ON public.attendance_holidays
  FOR EACH ROW EXECUTE FUNCTION public.attendance_rule_changed('holiday');

DROP TRIGGER IF EXISTS attendance_non_working_days_recompute ON public.attendance_non_working_days;
CREATE TRIGGER attendance_non_working_days_recompute
  AFTER INSERT OR UPDATE OR DELETE ON public.attendance_non_working_days
  FOR EACH ROW EXECUTE FUNCTION public.attendance_rule_changed('non_working_day');

DROP TRIGGER IF EXISTS attendance_day_timing_members_recompute ON public.attendance_day_timing_members;
CREATE TRIGGER attendance_day_timing_members_recompute
  AFTER INSERT OR UPDATE OR DELETE ON public.attendance_day_timing_members
  FOR EACH ROW EXECUTE FUNCTION public.attendance_rule_member_changed(
    'attendance_day_timings', 'timing_id', 'day_timing_member');

DROP TRIGGER IF EXISTS attendance_holiday_members_recompute ON public.attendance_holiday_members;
CREATE TRIGGER attendance_holiday_members_recompute
  AFTER INSERT OR UPDATE OR DELETE ON public.attendance_holiday_members
  FOR EACH ROW EXECUTE FUNCTION public.attendance_rule_member_changed(
    'attendance_holidays', 'holiday_id', 'holiday_member');

DROP TRIGGER IF EXISTS attendance_non_working_day_members_recompute ON public.attendance_non_working_day_members;
CREATE TRIGGER attendance_non_working_day_members_recompute
  AFTER INSERT OR UPDATE OR DELETE ON public.attendance_non_working_day_members
  FOR EACH ROW EXECUTE FUNCTION public.attendance_rule_member_changed(
    'attendance_non_working_days', 'non_working_day_id', 'non_working_day_member');

DROP TRIGGER IF EXISTS site_settings_attendance_config_recompute ON public.site_settings;
CREATE TRIGGER site_settings_attendance_config_recompute
  AFTER INSERT OR UPDATE ON public.site_settings
  FOR EACH ROW EXECUTE FUNCTION public.attendance_config_changed();

-- ── 6. Draining the queue ───────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.attendance_recompute_pending(
  p_lookback_days INTEGER DEFAULT 92
) RETURNS TABLE (dates_processed INTEGER, records_updated INTEGER)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_today DATE := (NOW() AT TIME ZONE public.attendance_timezone())::DATE;
  v_from DATE;
  v_ids UUID[];
  v_dates DATE[];
  v_updated INTEGER := 0;
BEGIN
  -- Every screen that reads attendance calls this, most of them for people who
  -- cannot change the rules in the first place. For them there is nothing to
  -- do and nothing wrong, so this reports no work rather than raising.
  IF public.get_user_role() NOT IN ('admin', 'principal') THEN
    RETURN QUERY SELECT 0::INTEGER, 0::INTEGER;
    RETURN;
  END IF;

  -- How far back a rule change is allowed to reach. A quarter covers the open
  -- pay cycle and the one before it — far enough for a correction that matters,
  -- short of rewriting statuses under payroll that was settled months ago.
  p_lookback_days := LEAST(GREATEST(COALESCE(p_lookback_days, 92), 1), 400);
  v_from := v_today - p_lookback_days;

  -- Claim what is outstanding. SKIP LOCKED so two admins saving at the same
  -- moment each drain their share instead of one blocking on the other.
  SELECT array_agg(q.id) INTO v_ids
  FROM (
    SELECT id FROM public.attendance_recompute_queue
    ORDER BY queued_at
    FOR UPDATE SKIP LOCKED
  ) q;

  IF v_ids IS NULL THEN
    RETURN QUERY SELECT 0::INTEGER, 0::INTEGER;
    RETURN;
  END IF;

  -- Resolve the dirty scopes to the dates that actually carry a punch. This is
  -- what keeps a weekly-recurring rule bounded: it dirties a weekday, not a
  -- calendar, and only the days somebody checked in on cost anything to redo.
  SELECT array_agg(DISTINCT r.date) INTO v_dates
  FROM public.staff_attendance_records r
  WHERE r.date BETWEEN v_from AND v_today
    AND r.check_in_time IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.attendance_recompute_queue q
      WHERE q.id = ANY (v_ids)
        AND (q.scope_type = 'all'
          OR (q.scope_type = 'date'    AND q.scope_date    = r.date)
          OR (q.scope_type = 'weekday' AND q.scope_weekday = EXTRACT(DOW FROM r.date)::INTEGER))
    );

  IF v_dates IS NOT NULL THEN
    v_updated := public.recompute_staff_attendance_dates(v_dates, NULL);
  END IF;

  DELETE FROM public.attendance_recompute_queue WHERE id = ANY (v_ids);

  RETURN QUERY SELECT COALESCE(array_length(v_dates, 1), 0)::INTEGER, v_updated;
END;
$$;

-- ── 7. Correct the drift that already exists ────────────────────────────────
--
-- Every rule edited before this migration existed left its day un-rescored.
-- Queueing one 'all' entry makes the first admin to open the attendance report
-- or a pay cycle put the whole lookback window right, once.

INSERT INTO public.attendance_recompute_queue (scope_type, source)
VALUES ('all', 'migration')
ON CONFLICT DO NOTHING;

-- ── 8. Grants / reload ──────────────────────────────────────────────────────

GRANT EXECUTE ON FUNCTION public.attendance_day_off_kind(UUID, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.attendance_derived_status(UUID, DATE, TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;
GRANT EXECUTE ON FUNCTION public.recompute_staff_attendance_dates(DATE[], UUID[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.attendance_recompute_pending(INTEGER) TO authenticated;

GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
