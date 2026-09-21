-- ─────────────────────────────────────────────────────────────────────────
-- SECURITY FIX — privilege escalation through the p_actor parameter.
--
-- Proven against the live database as a student holding no fee permissions:
--
--   fee_actor_can(NULL, 'fees.discount.approve')        → false   (correct)
--   fee_actor_can('<an admin uuid>', 'fees.discount.approve') → TRUE
--
-- Round 3 threaded an explicit `p_actor` through every fee write so the API
-- routes — which hold a service-role client and therefore no auth.uid() —
-- could still record who did the work. The actor resolver took it from
-- whoever passed it:
--
--   fee_actor(p_actor) := COALESCE(p_actor, auth.uid())
--
-- and the approval gates ask `fee_actor_can(v_actor, …)`. Those RPCs are
-- EXECUTE-granted to `authenticated`, so the parameter is caller-controlled:
-- any signed-in account could name an administrator and inherit their
-- permissions for the length of the call.
--
-- Fully exploitable, gated on nothing else:
--   fee_decide_concession   approve a concession — money off a bill
--   fee_decide_refund       approve a refund
--   fee_pay_refund          mark a refund paid out
-- and each one records the named administrator as the approver, so the audit
-- trail reads as though they did it. The same call bypasses "you raised this,
-- so somebody else has to approve it", which compares against the actor.
--
-- Partially exploitable, behind the caller's own fee_requires() check — a
-- clerk who may apply a concession could self-approve past the threshold:
--   fee_apply_concession, fee_collect, fee_record_rte, fee_request_refund
--
-- The fix is one line, at the one choke point: `p_actor` is honoured only
-- when the caller is the service role (an API route that has already
-- authenticated the human and checked the permission) or a database session
-- with no JWT at all (pg_cron, a migration). For everybody else the actor is
-- auth.uid() — who they actually are — and naming somebody else is ignored
-- rather than rejected, so no legitimate caller changes behaviour.
--
-- Depends on fee_fix_service_context_jwt_claim.sql being applied first.
-- ─────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.fee_actor(p_actor UUID DEFAULT NULL)
RETURNS UUID
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN public.fee_is_service_context() THEN COALESCE(p_actor, (SELECT auth.uid()))
    ELSE (SELECT auth.uid())
  END;
$$;

NOTIFY pgrst, 'reload schema';
