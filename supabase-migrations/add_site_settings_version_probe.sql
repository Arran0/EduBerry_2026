-- Cache validation for site_settings.
--
-- Every page load re-fetched several settings keys one request at a time
-- (branding, page_icons, page_themes, plus that page's banner), and none of it
-- was cached — so navigating between pages repeated the same handful of round
-- trips. The whole table is 33 rows / ~7KB, so a bulk read is cheaper than two
-- single-key reads.
--
-- This function is the cheap "has anything changed?" probe the client checks
-- before deciding whether to re-fetch (see src/lib/pageConfig.ts). SECURITY
-- INVOKER so the version reflects exactly the rows the caller can see under RLS
-- (an admin sees one more row than anon), keeping each browser's cache
-- consistent with its own visibility.

-- updated_at must move on every write for the probe to be reliable; saveSetting
-- sets it explicitly today, but nothing enforced it for other writers.
CREATE OR REPLACE FUNCTION public.site_settings_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS site_settings_touch_updated_at ON public.site_settings;
CREATE TRIGGER site_settings_touch_updated_at
  BEFORE INSERT OR UPDATE ON public.site_settings
  FOR EACH ROW EXECUTE FUNCTION public.site_settings_touch_updated_at();

-- Row count is part of the version so that a deletion invalidates caches too,
-- which a max(updated_at) alone would miss.
CREATE OR REPLACE FUNCTION public.site_settings_version()
RETURNS text
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT coalesce(extract(epoch FROM max(updated_at))::text, '0') || '.' || count(*)::text
  FROM public.site_settings;
$$;

GRANT EXECUTE ON FUNCTION public.site_settings_version() TO anon, authenticated;
