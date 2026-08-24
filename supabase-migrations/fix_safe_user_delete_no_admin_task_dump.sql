-- Migration: Stop dumping a deleted/resigned staff member's tasks on admin
--
-- add_safe_user_delete_trigger.sql reassigned tasks.created_by (a NOT NULL
-- column) to a fallback admin so profile deletes wouldn't hit an FK error.
-- In practice that meant every task a resigned/deleted teacher or
-- coordinator had created — including ones awaiting verification or overdue
-- — silently became the admin's: fetchTasksAwaitingVerification() matches on
-- created_by, so the admin's "Awaiting Your Verification" queue absorbed the
-- departed staffer's entire backlog.
--
-- Losing that data is preferable to dumping it on admin, so this migration
-- deletes those tasks outright instead of reassigning them. task_assignees,
-- task_checklist_items and task_comments all reference tasks.id with
-- ON DELETE CASCADE, so deleting the task cleans up its dependents too.
-- Every other table the original trigger touches is unchanged.

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

  -- Tasks the deleted user created are removed rather than handed to admin —
  -- cascades to their task_assignees / task_checklist_items / task_comments.
  DELETE FROM public.tasks WHERE created_by = OLD.id;

  IF fallback_id IS NOT NULL THEN
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

-- Trigger definition is unchanged — CREATE OR REPLACE FUNCTION above is
-- enough since the trigger already points at this function name.

-- Reload PostgREST schema cache.
NOTIFY pgrst, 'reload schema';
