-- The login page, and any visitor before they sign in, renders using
-- site_settings (branding colours, login-page theme, page icons/themes,
-- banners). The existing "Read site_settings" policy only granted SELECT to
-- the `authenticated` role; with RLS's default-deny, an anonymous request —
-- a fresh/incognito visit, a preview deployment, or anyone on the login page
-- who hasn't signed in yet — was silently blocked from reading it entirely,
-- always falling back to the neutral placeholder defaults. Broaden it to
-- `public` (matches the "Anyone reads" intent documented in src/lib/pageConfig.ts).
alter policy "Read site_settings" on public.site_settings to public;
