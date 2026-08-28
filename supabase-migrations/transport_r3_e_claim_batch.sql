-- ============================================================================
-- Migration: Transport — Round 3e, outbox batch claim
--
-- Applied to the live project as: transport_r3_e_claim_batch.
-- Prereq: transport_r3_d_templates_and_drain.sql
-- Run this in the Supabase SQL Editor.
-- ============================================================================

-- Claim a batch of outbox rows for one drain pass.
--
-- FOR UPDATE SKIP LOCKED is the piece that makes overlapping drains safe: a
-- second caller walks past the rows the first is holding rather than sending
-- them again. Without it, the pg_cron drain and a backstop scheduler would
-- double-message every parent.
--
-- Rows stuck in 'sending' for more than five minutes are reclaimed, which is
-- how a crashed drain recovers rather than stranding its batch forever.
CREATE OR REPLACE FUNCTION public.notify_claim_batch(p_limit INTEGER DEFAULT 50)
RETURNS SETOF public.notification_outbox
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
BEGIN
  RETURN QUERY
  WITH picked AS (
    SELECT id
      FROM public.notification_outbox
     WHERE not_before <= NOW()
       AND (expires_at IS NULL OR expires_at > NOW())
       AND (
         status = 'queued'
         OR (status = 'sending' AND updated_at < NOW() - INTERVAL '5 minutes')
       )
     ORDER BY priority ASC, not_before ASC
     LIMIT GREATEST(1, LEAST(p_limit, 200))
     FOR UPDATE SKIP LOCKED
  )
  UPDATE public.notification_outbox o
     SET status = 'sending', updated_at = NOW()
    FROM picked
   WHERE o.id = picked.id
  RETURNING o.*;
END $fn$;

-- Service-role only: this mutates delivery state and must not be reachable
-- over PostgREST by a signed-in user.
REVOKE EXECUTE ON FUNCTION public.notify_claim_batch(INTEGER) FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';
