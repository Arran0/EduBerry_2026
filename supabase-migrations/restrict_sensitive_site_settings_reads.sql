-- site_settings had a single SELECT policy: USING (true) granted to `public`,
-- which includes `anon`. The anon key ships inside the browser bundle, so every
-- row was world-readable — including fee_runtime, which holds cron_secret and
-- drain_url. Nothing in src/ reads fee_runtime from the browser; it is consumed
-- server-side (service_role and postgres both bypass RLS), so narrowing the
-- client-facing read breaks nothing.
--
-- The rest of the table is genuinely public config (branding, page icons,
-- themes, banner images) and is read before sign-in on the login screen, so it
-- must stay readable by anon.
--
-- NOTE: this is a denylist, which means a future secret-bearing key is exposed
-- by default until it is added here. Secrets belong in environment variables
-- rather than a world-readable settings table; this migration closes the
-- immediate leak, it does not make the table a safe place for secrets.

CREATE OR REPLACE FUNCTION public.is_sensitive_site_setting(p_key text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT p_key = ANY (ARRAY[
    'fee_runtime'   -- cron_secret, drain_url
  ]);
$$;

DROP POLICY IF EXISTS "Read site_settings" ON public.site_settings;

CREATE POLICY "Read site_settings" ON public.site_settings
FOR SELECT
TO public
USING (
  NOT public.is_sensitive_site_setting(key)
  OR (SELECT public.get_user_role()) = 'admin'
);

GRANT EXECUTE ON FUNCTION public.is_sensitive_site_setting(text) TO anon, authenticated;
