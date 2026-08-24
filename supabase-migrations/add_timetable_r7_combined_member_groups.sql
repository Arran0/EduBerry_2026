-- Round 7: let a combined lesson pull in just one group of a homeroom
-- (e.g. "Grade 9A Biology group" + "Grade 9B Biology group") instead of
-- always the whole class, while still counting as one combined class that
-- every associated homeroom sees.

ALTER TABLE public.timetable_combined_members
  ADD COLUMN IF NOT EXISTS group_id UUID REFERENCES public.timetable_homeroom_groups(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_combined_members_group ON public.timetable_combined_members(group_id);
