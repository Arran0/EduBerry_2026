-- 28 functions in `public` had no pinned search_path (Supabase's
-- function_search_path_mutable lint). For the SECURITY DEFINER ones among them
-- — get_user_role, handle_new_user, sync_role_to_auth_metadata, the exam and
-- leave helpers — that is a privilege-escalation vector: the caller controls
-- search_path, so an unqualified reference inside the body can be pointed at an
-- attacker-supplied object and then runs as the function owner.
--
-- `search_path = public` matches the 147 functions here that are already pinned.
-- None of the 28 call an extension-schema function (checked for uuid_generate,
-- pgcrypto, http and net), so no extra schema is needed on the path.
--
-- Extension-owned functions (btree_gist ships ~190 gbt_* helpers) are excluded
-- via pg_depend — they belong to the extension, not to us, and altering them
-- would be undone by the next extension upgrade.

DO $do$
DECLARE
  r record;
  n integer := 0;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace ns ON ns.oid = p.pronamespace
    WHERE ns.nspname = 'public'
      AND p.proconfig IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e'
      )
  LOOP
    EXECUTE format('ALTER FUNCTION %s SET search_path = public', r.sig);
    n := n + 1;
  END LOOP;

  RAISE NOTICE 'pinned search_path on % functions', n;
END
$do$;
