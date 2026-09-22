-- ============================================================================
-- fee_r5_latefee_cron — the late-fee sweep, actually scheduled
-- ============================================================================
-- Run after fee_r3_charges.sql. Safe to re-run.
--
-- The late-fee settings screen said, in as many words, "Runs on its own every
-- night", beside a Preview button and a Charge now button. Nothing ran on its
-- own. fee_r2_autogen_cron.sql schedules two jobs — generate bills, mark them
-- overdue — and the sweep was not one of them, so a school that switched a
-- rule on and closed the popup was charged nothing at all until somebody
-- happened to reopen the screen and press the button.
--
-- Two ways out: delete the claim, or make it true. A late fee is a policy the
-- school sets once; having it depend on a clerk pressing a button on the right
-- days is not a feature, it is the bug. So: make it true, and drop the button.
--
--   fee_late_fee_tick   sweep every session that is still open, committing
--
-- It runs at 02:15 IST, between the two jobs that already exist: after the
-- night's bills exist (02:00) and before the overdue pass (02:30), so a bill
-- generated tonight cannot be charged a late fee tonight — its due date is
-- ahead of it — and the sweep sees yesterday's picture settled.
--
-- The sweep is idempotent by construction: fee_late_fee_sweep tops each bill
-- up to what the rule says it should have been charged in total, so running it
-- twice on one day adds nothing the second time. That is also what made the
-- manual button safe, and what makes it unnecessary.

CREATE OR REPLACE FUNCTION public.fee_late_fee_tick()
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_year   RECORD;
  v_result JSONB;
  v_years  INT := 0;
  v_bills  INT := 0;
  v_total  NUMERIC(12,2) := 0;
BEGIN
  FOR v_year IN
    SELECT y.id
      FROM public.academic_years y
     -- A closed session stops charging: its bills are history, and a rule left
     -- switched on from two years ago must not keep growing them.
     WHERE y.status <> 'closed'
       -- Nothing to do for a session with no live rule, and walking every bill
       -- to discover that is the expensive half of the job.
       AND EXISTS (SELECT 1 FROM public.fee_late_fee_rules r
                    WHERE r.academic_year_id = y.id AND r.enabled)
  LOOP
    v_result := public.fee_late_fee_sweep(v_year.id, true, NULL);
    v_years  := v_years + 1;
    v_bills  := v_bills + COALESCE((v_result ->> 'bills')::INT, 0);
    v_total  := v_total + COALESCE((v_result ->> 'total')::NUMERIC, 0);
  END LOOP;

  RETURN jsonb_build_object(
    'sessions_swept', v_years, 'bills_charged', v_bills, 'total', v_total);
END $$;

-- 02:15 IST. pg_cron runs in UTC, so that is 20:45 the previous day — the same
-- offset the autogen and overdue jobs already use.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('fee-latefee')
      WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'fee-latefee');
    PERFORM cron.schedule('fee-latefee', '45 20 * * *', 'SELECT public.fee_late_fee_tick();');
  END IF;
END$$;

-- Cron-only, like every other scheduled function here. fee_late_fee_sweep
-- itself stays reachable over PostgREST for `fees.latefee.manage` holders —
-- the rule builder's preview is a client-side calculation, but a support
-- question about what a rule would charge is still worth being able to ask.
REVOKE EXECUTE ON FUNCTION public.fee_late_fee_tick() FROM anon, authenticated;

NOTIFY pgrst, 'reload schema';
