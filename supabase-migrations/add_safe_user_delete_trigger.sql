-- Migration: Safe user delete trigger
--
-- Adds a BEFORE DELETE trigger on profiles that clears all foreign-key
-- references before the row is removed.  This lets a profile be deleted
-- through *any* path — the app's admin API, the Supabase Auth dashboard,
-- or a direct SQL statement — without hitting "Database error deleting user"
-- caused by NOT NULL / non-CASCADE FK constraints.
--
-- The trigger is SECURITY DEFINER so it runs with elevated privileges
-- regardless of who initiates the delete.  It mirrors the reassign/nullify
-- logic that the app's delete-user API already performs, acting as an
-- automatic safety net when that API is bypassed.
--
-- Tables covered:
--   Reassign to a fallback admin (NOT NULL columns that cannot go NULL):
--     tasks.created_by, task_comments.user_id, projects.created_by,
--     announcements.created_by, classrooms.created_by,
--     classroom_folders.created_by, classroom_files.created_by,
--     classroom_assessments.created_by
--
--   Nullify (nullable columns with no ON DELETE action):
--     subtasks.assignee_id, subtasks.created_by,
--     teams.coordinator_id, feedbacks.replied_by

CREATE OR REPLACE FUNCTION public.handle_profile_delete()
RETURNS TRIGGER AS $$
DECLARE
  fallback_id UUID;
BEGIN
  -- Pick the oldest admin account (other than the one being deleted) to
  -- receive any records that have a NOT NULL creator / author FK.
  SELECT id INTO fallback_id
  FROM public.profiles
  WHERE role = 'admin' AND id != OLD.id
  ORDER BY created_at
  LIMIT 1;

  IF fallback_id IS NOT NULL THEN
    UPDATE public.tasks             SET created_by = fallback_id WHERE created_by = OLD.id;
    UPDATE public.task_comments     SET user_id    = fallback_id WHERE user_id    = OLD.id;
    UPDATE public.projects          SET created_by = fallback_id WHERE created_by = OLD.id;
    UPDATE public.announcements     SET created_by = fallback_id WHERE created_by = OLD.id;
    UPDATE public.classrooms        SET created_by = fallback_id WHERE created_by = OLD.id;
    UPDATE public.classroom_folders SET created_by = fallback_id WHERE created_by = OLD.id;
    UPDATE public.classroom_files   SET created_by = fallback_id WHERE created_by = OLD.id;
    UPDATE public.classroom_assessments SET created_by = fallback_id WHERE created_by = OLD.id;
  END IF;

  -- Clear nullable FK columns that have no ON DELETE action.
  UPDATE public.subtasks  SET assignee_id  = NULL WHERE assignee_id  = OLD.id;
  UPDATE public.subtasks  SET created_by   = NULL WHERE created_by   = OLD.id;
  UPDATE public.teams     SET coordinator_id = NULL WHERE coordinator_id = OLD.id;
  UPDATE public.feedbacks SET replied_by   = NULL WHERE replied_by   = OLD.id;

  RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS before_profile_delete ON public.profiles;

CREATE TRIGGER before_profile_delete
  BEFORE DELETE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.handle_profile_delete();

-- Reload PostgREST schema cache so the new trigger is visible immediately.
NOTIFY pgrst, 'reload schema';
