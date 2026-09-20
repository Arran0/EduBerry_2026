-- ─────────────────────────────────────────────────────────────────────────────
-- SECURITY FIX — privilege escalation through fee_requires().
--
-- Every authenticated user, holding no fee permissions at all, could call any
-- fee RPC gated on `fee_requires()`. Proven against the live database: an
-- account with `my_fee_permissions() = []` called `fee_collect` and was issued
-- a real, sealed, QR-verifiable receipt for ₹99,999.
--
-- The cause is two lines apart in fee_r1_permissions.sql:
--
--   CREATE FUNCTION fee_is_service_context() ... LANGUAGE sql STABLE AS $$
--     SELECT current_user IN ('service_role', 'postgres', 'supabase_admin');
--   $$;
--
--   CREATE FUNCTION fee_requires(p_key TEXT) ... SECURITY DEFINER AS $$
--     SELECT fee_is_service_context() OR has_fee_permission(p_key);
--   $$;
--
-- `fee_requires` is SECURITY DEFINER and owned by `postgres`, so inside it
-- `current_user` is already `postgres` — not the caller. The service-context
-- test therefore answers "yes, this is the service role" for everybody, the
-- OR short-circuits, and `has_fee_permission` is never reached.
--
-- Called directly the helper behaves: a teacher sees
-- `fee_is_service_context() = false`. It only lies when called from inside a
-- SECURITY DEFINER function, which is the only place it is ever used.
--
-- The fix is `session_user`. SECURITY DEFINER changes `current_user` — that is
-- its whole purpose — but it never changes `session_user`, which stays the
-- role the connection authenticated as: `authenticated`, `anon` or
-- `service_role`. That is exactly the question being asked.
--
-- Affected: every RPC gated on fee_requires() — fee_collect,
-- fee_generate_invoices, fee_create_profiles, fee_clone_year,
-- fee_import_bus_ledger, fee_sync_transport_heads, fee_carry_forward,
-- fee_save_setting and the late-fee sweep. Not affected: anything gated on
-- fee_actor_can(), which asks a different question and answered correctly
-- throughout.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.fee_is_service_context()
RETURNS BOOLEAN
LANGUAGE sql STABLE
SET search_path = public
AS $$
  -- session_user, not current_user: this is asked from inside SECURITY
  -- DEFINER functions, where current_user is the owner and the answer would
  -- be "yes" for every caller.
  SELECT session_user IN ('service_role', 'postgres', 'supabase_admin');
$$;

-- Belt and braces: make the service-role test explicit at the one call site
-- too, so a future edit to the helper cannot quietly reopen this.
CREATE OR REPLACE FUNCTION public.fee_requires(p_key TEXT)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT (session_user IN ('service_role', 'postgres', 'supabase_admin'))
      OR public.has_fee_permission(p_key);
$$;

REVOKE ALL ON FUNCTION public.fee_is_service_context() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fee_requires(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fee_is_service_context() TO authenticated;
GRANT EXECUTE ON FUNCTION public.fee_requires(TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
