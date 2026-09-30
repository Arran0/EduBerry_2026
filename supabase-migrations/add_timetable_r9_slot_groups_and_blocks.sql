-- ============================================================
-- Migration: Timetable Round 9 — slot groups + block identity
--
-- 1. timetable_entries.block_key
--    A double/triple period is several rows that must move, pin and
--    stay together. Until now nothing on the row said "these three
--    are one block", so the solver's local search pulled single
--    periods out of blocks and the grids let a drag split them.
--    Every period of one placed block now shares a block_key
--    (NULL = an ordinary single period).
--
-- 2. timetable_slot_groups
--    A school can run more than one bell schedule — e.g. Primary
--    finishes at 14:00 on a 5-day week while Secondary runs 8
--    periods across 6 days. A group owns its own working days and
--    its own period slots; homerooms are assigned to a group.
--    A config with no groups behaves exactly as before: slots with
--    group_id NULL plus timetable_configs.working_days are the
--    "base" schedule every unassigned homeroom follows.
--
-- Run in the Supabase SQL Editor (or via the Supabase connection).
-- ============================================================

-- ── 1. Block identity on entries ─────────────────────────────

ALTER TABLE public.timetable_entries
  ADD COLUMN IF NOT EXISTS block_key TEXT;

CREATE INDEX IF NOT EXISTS idx_entries_block_key
  ON public.timetable_entries(timetable_id, block_key)
  WHERE block_key IS NOT NULL;

-- ── 2. Slot groups ───────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.timetable_slot_groups (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  config_id UUID REFERENCES public.timetable_configs(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  -- Its own week. Falls back to the config's working_days when empty.
  working_days TEXT[] NOT NULL DEFAULT '{monday,tuesday,wednesday,thursday,friday}',
  position SMALLINT NOT NULL DEFAULT 1,
  color TEXT,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.timetable_slot_groups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated can view slot groups" ON public.timetable_slot_groups;
CREATE POLICY "Authenticated can view slot groups"
  ON public.timetable_slot_groups FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Admin can insert slot groups" ON public.timetable_slot_groups;
CREATE POLICY "Admin can insert slot groups"
  ON public.timetable_slot_groups FOR INSERT
  WITH CHECK (public.get_user_role() = 'admin');

DROP POLICY IF EXISTS "Admin can update slot groups" ON public.timetable_slot_groups;
CREATE POLICY "Admin can update slot groups"
  ON public.timetable_slot_groups FOR UPDATE
  USING (public.get_user_role() = 'admin');

DROP POLICY IF EXISTS "Admin can delete slot groups" ON public.timetable_slot_groups;
CREATE POLICY "Admin can delete slot groups"
  ON public.timetable_slot_groups FOR DELETE
  USING (public.get_user_role() = 'admin');

CREATE INDEX IF NOT EXISTS idx_slot_groups_config ON public.timetable_slot_groups(config_id);

DROP TRIGGER IF EXISTS timetable_slot_groups_updated_at ON public.timetable_slot_groups;
CREATE TRIGGER timetable_slot_groups_updated_at
  BEFORE UPDATE ON public.timetable_slot_groups
  FOR EACH ROW EXECUTE FUNCTION update_task_updated_at();

-- ── 3. Period slots belong to a group (NULL = the base schedule) ──

ALTER TABLE public.timetable_period_slots
  ADD COLUMN IF NOT EXISTS group_id UUID
    REFERENCES public.timetable_slot_groups(id) ON DELETE CASCADE;

-- Positions restart at 1 inside every group, so the old
-- UNIQUE(config_id, position) no longer holds.
ALTER TABLE public.timetable_period_slots
  DROP CONSTRAINT IF EXISTS timetable_period_slots_config_id_position_key;

CREATE UNIQUE INDEX IF NOT EXISTS idx_period_slots_config_group_position
  ON public.timetable_period_slots
  (config_id, COALESCE(group_id, '00000000-0000-0000-0000-000000000000'::uuid), position);

CREATE INDEX IF NOT EXISTS idx_period_slots_group ON public.timetable_period_slots(group_id);

-- ── 4. Which homerooms follow which group ────────────────────
-- config_id is carried on the row so "one group per homeroom per
-- config" is a plain unique index rather than a trigger.

CREATE TABLE IF NOT EXISTS public.timetable_slot_group_homerooms (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  config_id UUID REFERENCES public.timetable_configs(id) ON DELETE CASCADE NOT NULL,
  group_id UUID REFERENCES public.timetable_slot_groups(id) ON DELETE CASCADE NOT NULL,
  homeroom_id UUID REFERENCES public.homerooms(id) ON DELETE CASCADE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(config_id, homeroom_id)
);

ALTER TABLE public.timetable_slot_group_homerooms ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated can view slot group homerooms" ON public.timetable_slot_group_homerooms;
CREATE POLICY "Authenticated can view slot group homerooms"
  ON public.timetable_slot_group_homerooms FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Admin can insert slot group homerooms" ON public.timetable_slot_group_homerooms;
CREATE POLICY "Admin can insert slot group homerooms"
  ON public.timetable_slot_group_homerooms FOR INSERT
  WITH CHECK (public.get_user_role() = 'admin');

DROP POLICY IF EXISTS "Admin can update slot group homerooms" ON public.timetable_slot_group_homerooms;
CREATE POLICY "Admin can update slot group homerooms"
  ON public.timetable_slot_group_homerooms FOR UPDATE
  USING (public.get_user_role() = 'admin');

DROP POLICY IF EXISTS "Admin can delete slot group homerooms" ON public.timetable_slot_group_homerooms;
CREATE POLICY "Admin can delete slot group homerooms"
  ON public.timetable_slot_group_homerooms FOR DELETE
  USING (public.get_user_role() = 'admin');

CREATE INDEX IF NOT EXISTS idx_slot_group_homerooms_group
  ON public.timetable_slot_group_homerooms(group_id);
CREATE INDEX IF NOT EXISTS idx_slot_group_homerooms_homeroom
  ON public.timetable_slot_group_homerooms(homeroom_id);

NOTIFY pgrst, 'reload schema';
