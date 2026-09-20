-- The home notifications box lists the announcements this user hasn't read.
--
-- Sibling of get_announcement_feed / count_unread_announcements (see
-- add_announcement_feed_rpcs.sql): SECURITY INVOKER, so the RLS SELECT policy
-- on `announcements` remains the single source of truth for who may see what,
-- and the reader's own markers in announcement_reads (RLS'd to themselves)
-- decide what has been read.
--
-- The box shows headlines only, so this returns three columns rather than the
-- feed's audiences/creator/like-state payload.
--
-- p_since is the caller's localStorage "everything before this was seen" mark,
-- kept so accounts that were already caught up before read markers existed
-- don't open to the school's back catalogue. NULL means no floor.
--
-- Applied to the live project on 2026-09-14.
CREATE OR REPLACE FUNCTION public.get_unread_announcements(
  p_since timestamptz DEFAULT NULL,
  p_limit integer     DEFAULT 5
)
RETURNS TABLE (
  id         uuid,
  title      text,
  created_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT a.id, a.title, a.created_at
  FROM public.announcements a
  WHERE a.created_by IS DISTINCT FROM (SELECT auth.uid())
    AND (p_since IS NULL OR a.created_at > p_since)
    AND NOT EXISTS (
      SELECT 1
      FROM public.announcement_reads r
      WHERE r.announcement_id = a.id
        AND r.user_id = (SELECT auth.uid())
    )
  ORDER BY a.created_at DESC
  LIMIT GREATEST(p_limit, 0);
$$;

GRANT EXECUTE ON FUNCTION public.get_unread_announcements(timestamptz, integer) TO authenticated;
