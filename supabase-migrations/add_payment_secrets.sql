-- ============================================================
-- Migration: Payment Secrets (multi-tenant, UI-configurable)
-- Lets each school client configure its own payment/payout
-- credentials from the in-app settings screens instead of
-- server env vars — essential for a multi-tenant product.
--
-- These are SECRETS (gateway key secrets, webhook HMAC secrets,
-- provider API keys, the payout account number), so unlike
-- site_settings (which is world-readable) this table is
-- admin-only: no public SELECT policy exists, so non-admin
-- users cannot read it. Server routes read it with the service
-- role (which bypasses RLS) and fall back to env vars when a
-- field is blank, so existing single-tenant deployments keep
-- working.
--
-- Scopes (key column):
--   'razorpay'      → { key_secret, webhook_secret }
--   'smart_collect' → { base_url, api_key, webhook_secret }
--   'payout'        → { key_secret, account_number, webhook_secret }
-- The matching PUBLIC config (key_id, vpa, provider, enabled …)
-- stays in site_settings, which the client reads to render
-- checkout.
--
-- Run this in the Supabase SQL Editor.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.payment_secrets (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.payment_secrets ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS payment_secrets_updated_at ON public.payment_secrets;
CREATE TRIGGER payment_secrets_updated_at
  BEFORE UPDATE ON public.payment_secrets
  FOR EACH ROW EXECUTE FUNCTION update_task_updated_at();

-- Admin-only: read AND write. There is deliberately NO public SELECT
-- policy, so students / staff / drivers can never read these secrets.
-- The service role used by API routes bypasses RLS entirely.
CREATE POLICY "Admin manage payment secrets"
  ON public.payment_secrets FOR ALL
  USING (public.get_user_role() = 'admin')
  WITH CHECK (public.get_user_role() = 'admin');

GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL ROUTINES IN SCHEMA public TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
