-- ─────────────────────────────────────────────────────────────────────────
-- Supersedes fee_fix_service_context_escalation.sql.
--
-- MUST BE APPLIED. The superseded migration is live and the fee API routes
-- are denied until this replaces it.
--
-- The escalation: fee_is_service_context()/fee_requires() tested
--   current_user IN ('service_role', 'postgres', 'supabase_admin')
-- but they are called from inside SECURITY DEFINER functions, where
-- current_user is the function's owner. Every caller looked like the service
-- role, so every permission check passed. A teacher holding no fee
-- permissions could mint a receipt.
--
-- The over-correction: switching to session_user. PostgREST connects to the
-- database as `authenticator` and SET ROLEs per request, so session_user is
-- `authenticator` for ALL API traffic — service-role calls included. The hole
-- closed, and the API routes closed with it.
--
-- The fix: the JWT role claim. PostgREST sets request.jwt.claims from the
-- verified JWT; SECURITY DEFINER does not touch it. It is the one signal here
-- that is both accurate and unforgeable.
-- ─────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.fee_is_service_context()
RETURNS BOOLEAN
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN nullif(current_setting('request.jwt.claims', true), '') IS NOT NULL
      THEN COALESCE(
             nullif(current_setting('request.jwt.claims', true), '')::json ->> 'role',
             '') = 'service_role'
    -- No claims at all means this is not a PostgREST request: pg_cron, a
    -- migration, psql. Those hold a database connection already. The
    -- session_user guard stops an unauthenticated PostgREST request, which
    -- still arrives as `authenticator`, from taking this branch.
    ELSE session_user NOT IN ('authenticator', 'anon', 'authenticated', 'service_role')
  END;
$$;

CREATE OR REPLACE FUNCTION public.fee_requires(p_key TEXT)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  -- The service-role test is spelled out here rather than delegated, so a
  -- future edit to the helper cannot silently make this return true for
  -- everyone. It has done exactly that once.
  SELECT (CASE
    WHEN nullif(current_setting('request.jwt.claims', true), '') IS NOT NULL
      THEN COALESCE(
             nullif(current_setting('request.jwt.claims', true), '')::json ->> 'role',
             '') = 'service_role'
    ELSE session_user NOT IN ('authenticator', 'anon', 'authenticated', 'service_role')
  END)
      OR public.has_fee_permission(p_key);
$$;

REVOKE ALL ON FUNCTION public.fee_is_service_context() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fee_requires(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fee_is_service_context() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fee_requires(TEXT) TO authenticated, service_role;

-- ── Verification ────────────────────────────────────────────────────────
-- Cannot be verified from psql or the MCP connection: neither carries a JWT,
-- so both take the ELSE branch and trivially report "service context". Both
-- halves have to be checked over the REST API, as real callers:
--
--   service-role key  →  rpc('fee_is_service_context') === true
--   signed-in teacher →  rpc('fee_requires', { p_key: 'fees.collect' }) === false
--
-- The second is the one that proves the escalation is closed.
