-- One round trip for the announcements feed.
--
-- The client used to resolve "which announcements may I see" in the browser:
-- it pulled every matching announcement_audiences row down, then posted the ids
-- back as an `id=in.(...)` filter that grew with the school's whole announcement
-- history — and the database re-applied RLS to that list anyway. Loading the page
-- cost 3-5 requests (audience lookups → feed → likes), and the unread badge
-- repeated the audience lookups a second time.
--
-- These functions are SECURITY INVOKER, so the RLS SELECT policy on `announcements`
-- is the single source of truth for visibility, and audiences, creator and like
-- state come back with the page.

-- `pinned` is ordered by on every feed query; make it non-nullable so
-- (pinned DESC, created_at DESC) is a straight match for the ORDER BY.
UPDATE public.announcements SET pinned = false WHERE pinned IS NULL;
ALTER TABLE public.announcements ALTER COLUMN pinned SET DEFAULT false;
ALTER TABLE public.announcements ALTER COLUMN pinned SET NOT NULL;

-- The SELECT policy probes announcement_audiences once per candidate announcement.
CREATE INDEX IF NOT EXISTS idx_announcement_audiences_ann_grade_section
  ON public.announcement_audiences (announcement_id, grade, section);

CREATE INDEX IF NOT EXISTS idx_announcement_audiences_ann_user
  ON public.announcement_audiences (announcement_id, user_id)
  WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_announcement_audiences_all_students
  ON public.announcement_audiences (announcement_id)
  WHERE all_students = true;

CREATE INDEX IF NOT EXISTS idx_announcement_audiences_all_teams
  ON public.announcement_audiences (announcement_id)
  WHERE all_teams = true;

-- Unread badge counts by recency, excluding the reader's own posts.
CREATE INDEX IF NOT EXISTS idx_announcements_created_at_created_by
  ON public.announcements (created_at DESC, created_by);


CREATE OR REPLACE FUNCTION public.get_announcement_feed(
  p_limit  integer DEFAULT 10,
  p_offset integer DEFAULT 0
)
RETURNS TABLE (
  id           uuid,
  title        text,
  content      text,
  type         text,
  attachments  jsonb,
  created_by   uuid,
  created_at   timestamptz,
  updated_at   timestamptz,
  pinned       boolean,
  pinned_at    timestamptz,
  audiences    jsonb,
  creator      jsonb,
  like_count   integer,
  liked_by_me  boolean
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    a.id, a.title, a.content, a.type, a.attachments, a.created_by,
    a.created_at, a.updated_at, a.pinned, a.pinned_at,
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id',              aa.id,
        'announcement_id', aa.announcement_id,
        'grade',           aa.grade,
        'section',         aa.section,
        'all_students',    aa.all_students,
        'team_id',         aa.team_id,
        'all_teams',       aa.all_teams,
        'user_id',         aa.user_id,
        'team',            CASE WHEN t.id IS NULL THEN NULL
                                ELSE jsonb_build_object('id', t.id, 'name', t.name) END
      ))
      FROM public.announcement_audiences aa
      LEFT JOIN public.teams t ON t.id = aa.team_id
      WHERE aa.announcement_id = a.id
    ), '[]'::jsonb) AS audiences,
    (
      SELECT jsonb_build_object(
        'id', p.id, 'full_name', p.full_name, 'avatar_url', p.avatar_url, 'role', p.role)
      FROM public.profiles p WHERE p.id = a.created_by
    ) AS creator,
    (
      SELECT count(*)::int FROM public.announcement_likes l WHERE l.announcement_id = a.id
    ) AS like_count,
    EXISTS (
      SELECT 1 FROM public.announcement_likes l
      WHERE l.announcement_id = a.id AND l.user_id = auth.uid()
    ) AS liked_by_me
  FROM public.announcements a
  ORDER BY a.pinned DESC, a.created_at DESC
  LIMIT  GREATEST(p_limit, 0)
  OFFSET GREATEST(p_offset, 0);
$$;


-- Smart board / homeroom variant: RLS still decides visibility, the arguments
-- only narrow the result to the homeroom actually on screen.
CREATE OR REPLACE FUNCTION public.get_homeroom_announcement_feed(
  p_grade   integer DEFAULT NULL,
  p_section text    DEFAULT NULL,
  p_limit   integer DEFAULT 3
)
RETURNS TABLE (
  id           uuid,
  title        text,
  content      text,
  type         text,
  attachments  jsonb,
  created_by   uuid,
  created_at   timestamptz,
  updated_at   timestamptz,
  pinned       boolean,
  pinned_at    timestamptz,
  audiences    jsonb,
  creator      jsonb,
  like_count   integer,
  liked_by_me  boolean
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    a.id, a.title, a.content, a.type, a.attachments, a.created_by,
    a.created_at, a.updated_at, a.pinned, a.pinned_at,
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id',              aa2.id,
        'announcement_id', aa2.announcement_id,
        'grade',           aa2.grade,
        'section',         aa2.section,
        'all_students',    aa2.all_students,
        'team_id',         aa2.team_id,
        'all_teams',       aa2.all_teams,
        'user_id',         aa2.user_id,
        'team',            CASE WHEN t.id IS NULL THEN NULL
                                ELSE jsonb_build_object('id', t.id, 'name', t.name) END
      ))
      FROM public.announcement_audiences aa2
      LEFT JOIN public.teams t ON t.id = aa2.team_id
      WHERE aa2.announcement_id = a.id
    ), '[]'::jsonb) AS audiences,
    (
      SELECT jsonb_build_object(
        'id', p.id, 'full_name', p.full_name, 'avatar_url', p.avatar_url, 'role', p.role)
      FROM public.profiles p WHERE p.id = a.created_by
    ) AS creator,
    (SELECT count(*)::int FROM public.announcement_likes l WHERE l.announcement_id = a.id) AS like_count,
    EXISTS (
      SELECT 1 FROM public.announcement_likes l
      WHERE l.announcement_id = a.id AND l.user_id = auth.uid()
    ) AS liked_by_me
  FROM public.announcements a
  WHERE a.type IN ('student', 'both')
    AND EXISTS (
      SELECT 1 FROM public.announcement_audiences aa
      WHERE aa.announcement_id = a.id
        AND (
          aa.all_students = true
          OR (p_grade IS NOT NULL
              AND aa.grade = p_grade
              AND (aa.section IS NULL OR p_section IS NULL OR aa.section = p_section))
        )
    )
  ORDER BY a.pinned DESC, a.created_at DESC
  LIMIT GREATEST(p_limit, 0);
$$;


-- Unread badge: a head count under the same RLS visibility, no id list in flight.
CREATE OR REPLACE FUNCTION public.count_unread_announcements(p_since timestamptz)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT count(*)::int
  FROM public.announcements a
  WHERE a.created_at > p_since
    AND a.created_by IS DISTINCT FROM auth.uid();
$$;


GRANT EXECUTE ON FUNCTION public.get_announcement_feed(integer, integer)               TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_homeroom_announcement_feed(integer, text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.count_unread_announcements(timestamptz)                TO authenticated;
