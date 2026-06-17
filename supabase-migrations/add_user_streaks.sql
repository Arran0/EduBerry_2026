-- ============================================================
-- Migration: User activity streaks
-- Tracks consecutive days a user has opened the app, used to
-- power the gamified "fire streak" on the Academics page.
-- Run this in the Supabase SQL Editor.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.user_activity_streaks (
  user_id        UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  current_streak INTEGER NOT NULL DEFAULT 0,
  longest_streak INTEGER NOT NULL DEFAULT 0,
  last_open_date DATE,
  updated_at     TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.user_activity_streaks ENABLE ROW LEVEL SECURITY;

-- Users may read their own streak row. Writes happen exclusively
-- through the record_app_open() SECURITY DEFINER function below.
DROP POLICY IF EXISTS "view own streak" ON public.user_activity_streaks;
CREATE POLICY "view own streak"
  ON public.user_activity_streaks FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

GRANT SELECT ON public.user_activity_streaks TO authenticated;

-- ── record_app_open ──────────────────────────────────────────
-- Records that the calling user opened the app on p_today (the
-- client's *local* date, to avoid UTC off-by-one). Same day is a
-- no-op; the day immediately after extends the streak; any larger
-- gap resets it to 1. Returns the updated streak row.

CREATE OR REPLACE FUNCTION public.record_app_open(p_today DATE DEFAULT CURRENT_DATE)
RETURNS public.user_activity_streaks
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid  UUID := auth.uid();
  v_row  public.user_activity_streaks;
  v_new  INTEGER;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO v_row FROM public.user_activity_streaks WHERE user_id = v_uid;

  IF NOT FOUND THEN
    INSERT INTO public.user_activity_streaks (user_id, current_streak, longest_streak, last_open_date, updated_at)
    VALUES (v_uid, 1, 1, p_today, NOW())
    RETURNING * INTO v_row;
    RETURN v_row;
  END IF;

  -- Same day — nothing changes.
  IF v_row.last_open_date = p_today THEN
    RETURN v_row;
  END IF;

  IF v_row.last_open_date = p_today - 1 THEN
    v_new := v_row.current_streak + 1;       -- consecutive day
  ELSE
    v_new := 1;                              -- gap (or first open of a new run)
  END IF;

  UPDATE public.user_activity_streaks
    SET current_streak = v_new,
        longest_streak = GREATEST(longest_streak, v_new),
        last_open_date = p_today,
        updated_at = NOW()
    WHERE user_id = v_uid
    RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_app_open(DATE) TO authenticated;

NOTIFY pgrst, 'reload schema';
