-- ============================================================
-- Migration: Admin Settings – upgrade site_settings to JSONB
-- Run this in the Supabase SQL Editor
--
-- Needed by the expanded Admin Settings system (branding,
-- page icons, page themes, login page config, banners).
-- All values are now stored as JSONB objects, not plain text.
-- ============================================================

-- 1. Upgrade site_settings.value from TEXT → JSONB
--    Existing rows may contain plain text (e.g. URLs like "https://...")
--    that are not valid JSON. Wrap those in to_jsonb() so they become
--    JSON strings; rows that are already valid JSON are cast directly.
ALTER TABLE site_settings
  ALTER COLUMN value TYPE jsonb
  USING (
    CASE
      WHEN value IS NULL THEN NULL
      -- Try to cast as-is; if it fails it must be a plain text value
      WHEN value ~ '^(\{|\[|"|true|false|null|-?[0-9])' THEN value::jsonb
      ELSE to_jsonb(value)
    END
  );

-- Allow nullable JSONB (upserts may insert partial objects).
ALTER TABLE site_settings
  ALTER COLUMN value DROP NOT NULL;

-- 2. Drop the old overly-permissive write policy and replace with
--    one that only allows users whose profile role = 'admin'.
DROP POLICY IF EXISTS "Admin write site_settings" ON site_settings;

CREATE POLICY "Admin write site_settings"
  ON site_settings FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role = 'admin'
    )
  );

-- 3. Ensure the public read policy still exists
DROP POLICY IF EXISTS "Read site_settings" ON site_settings;

CREATE POLICY "Read site_settings"
  ON site_settings FOR SELECT
  USING (true);

-- 4. Ensure classroom-files storage bucket exists and is public
--    (run manually in the Supabase Dashboard → Storage if not present)
-- INSERT INTO storage.buckets (id, name, public)
--   VALUES ('classroom-files', 'classroom-files', true)
--   ON CONFLICT (id) DO NOTHING;

-- Done.
-- Keys written by the admin settings page:
--   'page_icons'    – PageIconMap  (icon name + gradient per page)
--   'branding'      – SiteBranding (app title, logo url, colours …)
--   'login_config'  – LoginPageConfig (school name, tagline, bullets …)
--   'page_themes'   – PageThemeMap (colour palette per page)
--   'welcome_banner'– { url: string }  (home page hero banner)
--   'profile_banner'– { url: string }  (profile page hero banner)
