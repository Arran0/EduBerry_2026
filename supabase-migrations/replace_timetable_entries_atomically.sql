-- ============================================================
-- Saving a draft timetable has to be all-or-nothing.
--
-- The old client-side save deleted every row of the timetable and then sent a
-- separate insert. Two round trips, no transaction: if the insert failed — or
-- the browser was closed, or the tab lost its connection between the two — the
-- week was already gone and nothing replaced it. A save that reported
-- "Could not save entries" had, by then, destroyed the published timetable.
--
-- This does the whole replace in one statement pair inside one transaction, so
-- the old week only disappears once the new one is in. It also resolves the
-- denormalised teacher names server-side, which is where the authoritative
-- list is, instead of shipping a profiles query to the browser first.
--
-- SECURITY INVOKER: the existing admin-only RLS policies on
-- timetable_entries still decide who may do this. A non-admin's insert raises
-- and the transaction — delete included — rolls back.
-- ============================================================

CREATE OR REPLACE FUNCTION public.replace_timetable_entries(
  p_timetable_id uuid,
  p_rows jsonb
) RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $$
DECLARE
  v_written integer;
BEGIN
  DELETE FROM public.timetable_entries WHERE timetable_id = p_timetable_id;

  INSERT INTO public.timetable_entries (
    timetable_id, homeroom_id, day, slot_id, subject_id,
    teacher_id, teacher_ids, teacher_name, teacher_names,
    room_id, is_locked, group_id, split_key, combined_key, block_key
  )
  SELECT
    p_timetable_id,
    r.homeroom_id,
    r.day,
    r.slot_id,
    r.subject_id,
    r.teacher_ids[1],
    COALESCE(r.teacher_ids, '{}'::uuid[]),
    (SELECT pr.full_name FROM public.profiles pr WHERE pr.id = r.teacher_ids[1]),
    COALESCE((
      SELECT array_agg(pr.full_name ORDER BY t.ord)
      FROM unnest(COALESCE(r.teacher_ids, '{}'::uuid[])) WITH ORDINALITY AS t(id, ord)
      JOIN public.profiles pr ON pr.id = t.id
    ), '{}'::text[]),
    r.room_id,
    COALESCE(r.is_locked, false),
    r.group_id,
    r.split_key,
    r.combined_key,
    r.block_key
  FROM jsonb_to_recordset(COALESCE(p_rows, '[]'::jsonb)) AS r(
    homeroom_id uuid,
    day text,
    slot_id uuid,
    subject_id uuid,
    teacher_ids uuid[],
    room_id uuid,
    is_locked boolean,
    group_id uuid,
    split_key text,
    combined_key text,
    block_key text
  );

  -- Counted from the table rather than from the payload, so the caller is told
  -- what is actually stored and can refuse to believe a save that wrote nothing.
  SELECT count(*) INTO v_written
  FROM public.timetable_entries
  WHERE timetable_id = p_timetable_id;

  RETURN v_written;
END;
$$;

REVOKE ALL ON FUNCTION public.replace_timetable_entries(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.replace_timetable_entries(uuid, jsonb) TO authenticated;
