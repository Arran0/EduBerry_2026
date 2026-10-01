-- ============================================================
-- Migration: Timetable Round 10 — combined lessons schedule like
-- every other lesson
--
-- A combined class (several homerooms in one room with one teacher —
-- assembly, Music for all of grade 10) could only ever be a single
-- period in a classroom, once a day. An assembly is routinely a
-- double in the hall, so the same three controls every ordinary
-- requirement has are added here:
--
--   room_type    which kind of room the solver must find when no
--                specific room is pinned on the lesson
--   max_per_day  how many of its periods may fall on one day
--   min_block /  consecutive-period blocks, exactly as Round 4 did
--   max_block    for timetable_requirements
--
-- The defaults reproduce the old behaviour, so existing combined
-- lessons schedule the same way they did before.
--
-- Run in the Supabase SQL Editor (or via the Supabase connection).
-- ============================================================

ALTER TABLE public.timetable_combined_classes
  ADD COLUMN IF NOT EXISTS room_type public.room_type NOT NULL DEFAULT 'classroom',
  ADD COLUMN IF NOT EXISTS max_per_day SMALLINT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS min_block SMALLINT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS max_block SMALLINT NOT NULL DEFAULT 1;

NOTIFY pgrst, 'reload schema';
