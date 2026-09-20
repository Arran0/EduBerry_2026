-- The homerooms UPDATE policy lets a smart board account write its own homeroom
-- row so it can save its banner — but RLS has no column granularity, so that
-- account could also rename the class, clear class_teacher_id (which the
-- timetable's pin_class_teacher constraint is built on), or hand its
-- smartboard_id to another account. Pin every column but the banner to its old
-- value for any non-admin writer. Admins and the service role are unaffected.
CREATE OR REPLACE FUNCTION public.restrict_smartboard_homeroom_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  -- Service-role / trusted server code has no auth.uid(); admins may write freely.
  IF auth.uid() IS NULL OR (SELECT get_user_role()) = 'admin' THEN
    RETURN NEW;
  END IF;
  NEW.name             := OLD.name;
  NEW.grade            := OLD.grade;
  NEW.section          := OLD.section;
  NEW.academic_year    := OLD.academic_year;
  NEW.academic_year_id := OLD.academic_year_id;
  NEW.expiry_date      := OLD.expiry_date;
  NEW.class_teacher_id := OLD.class_teacher_id;
  NEW.smartboard_id    := OLD.smartboard_id;
  NEW.created_by       := OLD.created_by;
  NEW.created_at       := OLD.created_at;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.restrict_smartboard_homeroom_update() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS restrict_smartboard_homeroom_update ON public.homerooms;
CREATE TRIGGER restrict_smartboard_homeroom_update
  BEFORE UPDATE ON public.homerooms
  FOR EACH ROW EXECUTE FUNCTION public.restrict_smartboard_homeroom_update();
