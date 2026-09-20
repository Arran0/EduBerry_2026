-- ============================================================================
-- Migration: Transport — Round 3f, one permissive SELECT policy per table
--
-- Postgres evaluates EVERY permissive policy for a command, so an admin
-- "FOR ALL" sitting alongside a scoped "FOR SELECT" means two predicates run on
-- every row of every read. optimize_rls_consolidate_duplicate_policies.sql
-- exists in this project to undo exactly that, and the transport module had
-- reintroduced 19 instances of it.
--
-- The shape from here: one SELECT policy that ORs every reader, and separate
-- admin-only INSERT / UPDATE / DELETE policies, which cannot overlap because
-- they are on different commands.
--
-- Also drops "Admin manage whatsapp secrets", an orphan left behind when
-- whatsapp_secrets was renamed to integration_secrets.
--
-- Applied to the live project as: transport_r3_f_consolidate_policies,
-- then transport_r3_f2_message_templates_policies.
-- Run this in the Supabase SQL Editor.
-- ============================================================================

DROP POLICY IF EXISTS "Admin manage whatsapp secrets" ON public.integration_secrets;

DO $$
DECLARE
  t TEXT;
  read_expr TEXT;
  tables TEXT[] := ARRAY[
    'transport_vehicles', 'transport_staff', 'transport_routes', 'transport_route_stops',
    'transport_route_paths', 'transport_route_schedules', 'transport_student_assignments',
    'transport_trip_runs', 'transport_run_stops', 'transport_run_passengers',
    'transport_boarding_events', 'transport_telemetry', 'transport_stop_events',
    'transport_alerts', 'transport_incidents', 'notification_outbox'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    read_expr := CASE t
      WHEN 'transport_vehicles' THEN
        $e$(select public.get_user_role()) IN ('teacher','coordinator','principal','admin')
           OR (select public.transport_is_transport_staff())
           OR EXISTS (SELECT 1 FROM public.transport_routes r
                       WHERE r.default_vehicle_id = transport_vehicles.id
                         AND (select public.transport_route_is_mine(r.id)))$e$
      WHEN 'transport_staff' THEN
        $e$(select public.get_user_role()) = 'admin' OR profile_id = (select auth.uid())$e$
      WHEN 'transport_routes' THEN
        $e$(select public.get_user_role()) = 'admin'
           OR (select public.is_trip_driver(id))
           OR (select public.transport_route_has_crew(id))
           OR (select public.is_trip_passenger(id))$e$
      WHEN 'transport_route_stops' THEN
        $e$(select public.get_user_role()) = 'admin'
           OR (select public.transport_route_is_mine(route_id))
           OR (select public.transport_route_has_crew(route_id))$e$
      WHEN 'transport_route_paths' THEN
        $e$(select public.get_user_role()) = 'admin'
           OR (select public.transport_route_is_mine(route_id))
           OR (select public.transport_route_has_crew(route_id))$e$
      WHEN 'transport_route_schedules' THEN
        $e$(select public.get_user_role()) = 'admin'
           OR (select public.transport_route_is_mine(route_id))
           OR driver_id = (select auth.uid())
           OR attendant_id = (select auth.uid())$e$
      WHEN 'transport_student_assignments' THEN
        $e$(select public.get_user_role()) = 'admin'
           OR (select public.is_trip_driver(route_id))
           OR (select public.transport_route_has_crew(route_id))
           OR student_id = (select auth.uid())$e$
      WHEN 'transport_trip_runs' THEN
        $e$(select public.get_user_role()) = 'admin'
           OR driver_id = (select auth.uid())
           OR attendant_id = (select auth.uid())
           OR (select public.transport_run_is_mine(id))$e$
      WHEN 'transport_run_stops' THEN
        $e$(select public.get_user_role()) = 'admin'
           OR (select public.transport_is_crew(run_id))
           OR (select public.transport_run_is_mine(run_id))$e$
      WHEN 'transport_run_passengers' THEN
        $e$(select public.get_user_role()) = 'admin'
           OR (select public.transport_is_crew(run_id))
           OR student_id = (select auth.uid())$e$
      WHEN 'transport_boarding_events' THEN
        $e$(select public.get_user_role()) = 'admin'
           OR (select public.transport_is_crew(run_id))
           OR student_id = (select auth.uid())$e$
      WHEN 'transport_telemetry' THEN
        $e$(select public.get_user_role()) = 'admin'
           OR (select public.transport_is_crew(run_id))
           OR (select public.transport_run_is_mine(run_id))$e$
      WHEN 'transport_stop_events' THEN
        $e$(select public.get_user_role()) = 'admin'
           OR (select public.transport_is_crew(run_id))
           OR (select public.transport_run_is_mine(run_id))$e$
      WHEN 'transport_alerts' THEN
        -- A parent sees an alert about their own child, or one about the bus
        -- their child is on — never one naming another family.
        $e$(select public.get_user_role()) = 'admin'
           OR (select public.transport_is_crew(run_id))
           OR student_id = (select auth.uid())
           OR (student_id IS NULL AND (select public.transport_run_is_mine(run_id)))$e$
      WHEN 'transport_incidents' THEN
        -- Deliberately no parent read: the snapshot names every other child
        -- who was aboard.
        $e$(select public.get_user_role()) = 'admin'
           OR (select public.transport_is_crew(run_id))$e$
      WHEN 'notification_outbox' THEN
        $e$(select public.get_user_role()) = 'admin'
           OR recipient_user_id = (select auth.uid())$e$
    END;

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'Admin manages ' ||
      CASE t
        WHEN 'transport_vehicles' THEN 'vehicles'
        WHEN 'transport_staff' THEN 'transport staff'
        WHEN 'transport_routes' THEN 'routes'
        WHEN 'transport_route_stops' THEN 'route stops'
        WHEN 'transport_route_paths' THEN 'route paths'
        WHEN 'transport_route_schedules' THEN 'route schedules'
        WHEN 'transport_student_assignments' THEN 'assignments'
        WHEN 'transport_trip_runs' THEN 'trip runs'
        WHEN 'transport_run_stops' THEN 'run stops'
        WHEN 'transport_run_passengers' THEN 'run passengers'
        WHEN 'transport_telemetry' THEN 'telemetry sources'
        WHEN 'transport_alerts' THEN 'alerts'
        WHEN 'transport_incidents' THEN 'incidents'
        WHEN 'notification_outbox' THEN 'outbox'
        ELSE 'x'
      END, t);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'Reads ' || t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'Admin writes ' || t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'Admin updates ' || t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'Admin deletes ' || t, t);

    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (%s)',
      'Reads ' || t, t, read_expr);

    -- Writes stay admin-only, on separate commands so they never overlap the
    -- read policy. transport_telemetry and transport_boarding_events are
    -- excluded on purpose: their INSERT paths are already locked down (the
    -- driver-stream policy and a WITH CHECK (false) respectively), and giving
    -- admin a second INSERT policy would both overlap and undo that.
    IF t NOT IN ('transport_telemetry', 'transport_boarding_events') THEN
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK ((select public.get_user_role()) = ''admin'')',
        'Admin writes ' || t, t);
    END IF;

    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING ((select public.get_user_role()) = ''admin'') WITH CHECK ((select public.get_user_role()) = ''admin'')',
      'Admin updates ' || t, t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING ((select public.get_user_role()) = ''admin'')',
      'Admin deletes ' || t, t);
  END LOOP;
END $$;

-- Named policies the loop does not cover.
DROP POLICY IF EXISTS "Crew views own runs" ON public.transport_trip_runs;
DROP POLICY IF EXISTS "Rider views own runs" ON public.transport_trip_runs;
DROP POLICY IF EXISTS "Riders and staff view vehicles" ON public.transport_vehicles;
DROP POLICY IF EXISTS "Crew views own transport record" ON public.transport_staff;
DROP POLICY IF EXISTS "Crew views assigned routes" ON public.transport_routes;
DROP POLICY IF EXISTS "Rider views own routes" ON public.transport_routes;
DROP POLICY IF EXISTS "Riders and crew view route stops" ON public.transport_route_stops;
DROP POLICY IF EXISTS "Riders and crew view route paths" ON public.transport_route_paths;
DROP POLICY IF EXISTS "Riders and crew view route schedules" ON public.transport_route_schedules;
DROP POLICY IF EXISTS "Crew views roster of assigned routes" ON public.transport_student_assignments;
DROP POLICY IF EXISTS "Rider views own assignment" ON public.transport_student_assignments;
DROP POLICY IF EXISTS "Crew and riders view run stops" ON public.transport_run_stops;
DROP POLICY IF EXISTS "Crew views run roster" ON public.transport_run_passengers;
DROP POLICY IF EXISTS "Rider views own boarding" ON public.transport_run_passengers;
DROP POLICY IF EXISTS "Admin views boarding events" ON public.transport_boarding_events;
DROP POLICY IF EXISTS "Crew views own-run boarding events" ON public.transport_boarding_events;
DROP POLICY IF EXISTS "Rider views own boarding events" ON public.transport_boarding_events;
DROP POLICY IF EXISTS "Admin reads telemetry" ON public.transport_telemetry;
DROP POLICY IF EXISTS "Crew reads own-run telemetry" ON public.transport_telemetry;
DROP POLICY IF EXISTS "Rider reads own-run telemetry" ON public.transport_telemetry;
DROP POLICY IF EXISTS "Admin views stop events" ON public.transport_stop_events;
DROP POLICY IF EXISTS "Crew and riders view stop events" ON public.transport_stop_events;
DROP POLICY IF EXISTS "Crew views own-run alerts" ON public.transport_alerts;
DROP POLICY IF EXISTS "Rider views relevant alerts" ON public.transport_alerts;
DROP POLICY IF EXISTS "Crew views own-run incidents" ON public.transport_incidents;
DROP POLICY IF EXISTS "Recipient views own notifications" ON public.notification_outbox;
DROP POLICY IF EXISTS "Admin manages run stops" ON public.transport_run_stops;
DROP POLICY IF EXISTS "Admin manages stop events" ON public.transport_stop_events;
DROP POLICY IF EXISTS "Admin manages boarding events" ON public.transport_boarding_events;

-- message_templates had the same overlap: an admin FOR ALL against an
-- everyone-reads SELECT. Copy is not secret, so the read stays open.
DROP POLICY IF EXISTS "Admin manages templates" ON public.message_templates;
DROP POLICY IF EXISTS "Anyone reads templates" ON public.message_templates;

CREATE POLICY "Reads message_templates" ON public.message_templates FOR SELECT TO authenticated
  USING (true);
CREATE POLICY "Admin writes message_templates" ON public.message_templates FOR INSERT TO authenticated
  WITH CHECK ((select public.get_user_role()) = 'admin');
CREATE POLICY "Admin updates message_templates" ON public.message_templates FOR UPDATE TO authenticated
  USING ((select public.get_user_role()) = 'admin')
  WITH CHECK ((select public.get_user_role()) = 'admin');
CREATE POLICY "Admin deletes message_templates" ON public.message_templates FOR DELETE TO authenticated
  USING ((select public.get_user_role()) = 'admin');

NOTIFY pgrst, 'reload schema';
