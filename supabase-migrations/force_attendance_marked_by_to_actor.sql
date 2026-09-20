-- `marked_by` was whatever the browser said it was.
--
-- adminMarkStaffAttendance, bulkMarkAttendance and the support-staff writer all
-- pass the marker's id as an ordinary column value, so an authorised writer
-- could attribute a mark to a colleague. RLS decides *whether* you may write a
-- row; it says nothing about whose name ends up on it. Since attendance rows
-- are what payroll is argued from, the attribution should be the session's, not
-- the payload's.
--
-- The trigger overwrites a non-null marked_by with auth.uid() rather than
-- raising, so no existing call site has to change. Two deliberate passes:
--   * `app.attendance_write = 'on'` — the same escape hatch
--     guard_attendance_location_columns uses, set by staff_attendance_punch;
--   * auth.uid() IS NULL — a service-role or server-side job, which has no
--     session identity to substitute.
-- A null marked_by is left alone: a self check-in and the leave sync both leave
-- it blank on purpose, and StaffCheckIn reads "someone else marked you" off
-- exactly that (marked_by non-null and != your own id).

CREATE OR REPLACE FUNCTION public.force_attendance_marked_by()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
BEGIN
  IF COALESCE(current_setting('app.attendance_write', true), '') = 'on' THEN
    RETURN NEW;
  END IF;
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.marked_by IS NOT NULL THEN
      NEW.marked_by := auth.uid();
    END IF;
  ELSIF NEW.marked_by IS NOT NULL AND NEW.marked_by IS DISTINCT FROM OLD.marked_by THEN
    NEW.marked_by := auth.uid();
  END IF;

  RETURN NEW;
END;
$fn$;

CREATE TRIGGER force_marked_by
  BEFORE INSERT OR UPDATE ON public.staff_attendance_records
  FOR EACH ROW EXECUTE FUNCTION public.force_attendance_marked_by();

CREATE TRIGGER force_marked_by
  BEFORE INSERT OR UPDATE ON public.attendance_records
  FOR EACH ROW EXECUTE FUNCTION public.force_attendance_marked_by();

CREATE TRIGGER force_marked_by
  BEFORE INSERT OR UPDATE ON public.support_staff_attendance
  FOR EACH ROW EXECUTE FUNCTION public.force_attendance_marked_by();
