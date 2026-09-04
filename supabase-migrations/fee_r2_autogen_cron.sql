-- ============================================================================
-- fee_r2_autogen_cron — the nightly jobs
-- ============================================================================
-- Round 2 of docs/fee-upgrade-plan.md. Run after fee_r2_generate.sql.
-- Safe to re-run.
--
-- Two things have to happen while nobody is looking:
--
--   fee_autogen_tick   generate the bills for installments whose window has
--                      opened, including for a student who joined yesterday
--   fee_overdue_tick   move bills past their grace period to overdue, since
--                      that transition is caused by the calendar and nothing
--                      else would trigger it
--
-- Both run in the database rather than through an HTTP endpoint. The transport
-- module's drain has to call out because sending a message needs the app; this
-- does not, and a job that cannot fail because a deployment is mid-rollout is
-- better than one that can. `/api/fees/cron/autogen` still exists for a manual
-- kick and for the preview the generation screen uses.

CREATE OR REPLACE FUNCTION public.fee_autogen_tick()
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inst    RECORD;
  v_result  JSONB;
  v_total   INT := 0;
  v_runs    INT := 0;
BEGIN
  FOR v_inst IN
    SELECT i.id, i.name, i.due_date
      FROM public.fee_installments i
      JOIN public.fee_structures s ON s.id = i.structure_id
      JOIN public.academic_years y ON y.id = s.academic_year_id
     WHERE i.autogen_enabled
       AND s.status = 'published'
       -- The window opens `autogen_days_before` days ahead of the due date and
       -- never closes: a student admitted in October still needs April's bill.
       AND CURRENT_DATE >= i.due_date - i.autogen_days_before
       -- Bounded by the session, so a closed year stops billing itself.
       AND y.status <> 'closed'
  LOOP
    v_result := public.fee_generate_invoices(v_inst.id, true, true);
    v_total := v_total + COALESCE((v_result ->> 'will_create')::INT, 0);
    v_runs := v_runs + 1;
  END LOOP;

  RETURN jsonb_build_object('installments_checked', v_runs, 'invoices_created', v_total);
END $$;

CREATE OR REPLACE FUNCTION public.fee_overdue_tick()
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_count INT;
BEGIN
  v_count := public.fee_mark_overdue();
  RETURN jsonb_build_object('marked_overdue', v_count);
END $$;

-- 02:00 and 02:30 IST. pg_cron runs in UTC, so that is 20:30 and 21:00 the
-- previous day — the same offset the transport jobs already use.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('fee-autogen')  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'fee-autogen');
    PERFORM cron.unschedule('fee-overdue')  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'fee-overdue');
    PERFORM cron.schedule('fee-autogen', '30 20 * * *', 'SELECT public.fee_autogen_tick();');
    PERFORM cron.schedule('fee-overdue', '0 21 * * *',  'SELECT public.fee_overdue_tick();');
  END IF;
END$$;

-- Cron-only. Neither is meant to be reachable over PostgREST, matching the
-- convention every other scheduled function in this database follows.
REVOKE EXECUTE ON FUNCTION public.fee_autogen_tick() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fee_overdue_tick() FROM anon, authenticated;

NOTIFY pgrst, 'reload schema';
