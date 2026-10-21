-- ============================================================
-- Tasks: grade + section labels, and numbered periods.
--
-- 1. tasks.classes holds the classes a task is for ("7B", "LKG A"); the Task
--    Manager shows them after the task name.
-- 2. tasks.period / tasks.period_end replace clock times as the way a task
--    sits in a period. The Timetable app numbers its periods instead of timing
--    them, so that a teacher can work across period groups (period 3 of every
--    group is one period; see buildSchedules in lib/timetable/generator.ts).
--    tasks.timing / tasks.end_time stay for tasks given a custom time.
-- 3. Existing tasks are moved onto their period number by matching their
--    start time to the active timetable's periods, BEFORE those times go.
-- 4. The period slots' clock times are cleared. A copy is kept in
--    timetable_period_slot_times_backup (no API access) in case one is needed.
-- ============================================================

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS classes text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS period smallint,
  ADD COLUMN IF NOT EXISTS period_end smallint;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tasks_period_check') THEN
    ALTER TABLE public.tasks ADD CONSTRAINT tasks_period_check
      CHECK (period IS NULL OR period BETWEEN 1 AND 30);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tasks_period_end_check') THEN
    ALTER TABLE public.tasks ADD CONSTRAINT tasks_period_end_check
      CHECK (period_end IS NULL OR (period IS NOT NULL AND period_end > period AND period_end <= 30));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tasks_classes_check') THEN
    ALTER TABLE public.tasks ADD CONSTRAINT tasks_classes_check
      CHECK (cardinality(classes) <= 40);
  END IF;
END $$;

-- ── Backup of the clock times ────────────────────────────────
CREATE TABLE IF NOT EXISTS public.timetable_period_slot_times_backup (
  slot_id uuid PRIMARY KEY,
  config_id uuid NOT NULL,
  group_id uuid,
  start_time time,
  end_time time,
  saved_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.timetable_period_slot_times_backup ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.timetable_period_slot_times_backup FROM anon, authenticated;

INSERT INTO public.timetable_period_slot_times_backup (slot_id, config_id, group_id, start_time, end_time)
SELECT id, config_id, group_id, start_time, end_time
FROM public.timetable_period_slots
WHERE start_time IS NOT NULL OR end_time IS NOT NULL
ON CONFLICT (slot_id) DO NOTHING;

-- ── Tasks onto period numbers ────────────────────────────────
-- Period N is the Nth teaching slot of the active config's base schedule,
-- breaks skipped — the same numbering the calendar's rows use.
WITH numbered AS (
  SELECT s.config_id, s.start_time, s.end_time,
         row_number() OVER (PARTITION BY s.config_id ORDER BY s.position) AS n
  FROM public.timetable_period_slots s
  JOIN public.timetable_configs c ON c.id = s.config_id AND c.is_active
  WHERE s.group_id IS NULL AND NOT s.is_break
),
starts AS (
  SELECT DISTINCT ON (to_char(start_time, 'HH24:MI')) to_char(start_time, 'HH24:MI') AS hhmm, n
  FROM numbered WHERE start_time IS NOT NULL
  ORDER BY to_char(start_time, 'HH24:MI'), n
)
UPDATE public.tasks t
SET period = st.n
FROM starts st
WHERE t.period IS NULL
  AND t.timing IS NOT NULL
  AND left(t.timing, 5) = st.hhmm;

WITH numbered AS (
  SELECT s.config_id, s.end_time,
         row_number() OVER (PARTITION BY s.config_id ORDER BY s.position) AS n
  FROM public.timetable_period_slots s
  JOIN public.timetable_configs c ON c.id = s.config_id AND c.is_active
  WHERE s.group_id IS NULL AND NOT s.is_break
),
ends AS (
  SELECT DISTINCT ON (to_char(end_time, 'HH24:MI')) to_char(end_time, 'HH24:MI') AS hhmm, n
  FROM numbered WHERE end_time IS NOT NULL
  ORDER BY to_char(end_time, 'HH24:MI'), n
)
UPDATE public.tasks t
SET period_end = en.n
FROM ends en
WHERE t.period IS NOT NULL
  AND t.period_end IS NULL
  AND t.end_time IS NOT NULL
  AND left(t.end_time, 5) = en.hhmm
  AND en.n > t.period;

-- ── Periods are numbered, not timed ──────────────────────────
UPDATE public.timetable_period_slots
SET start_time = NULL, end_time = NULL
WHERE start_time IS NOT NULL OR end_time IS NOT NULL;
