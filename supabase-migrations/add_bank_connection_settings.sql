-- ============================================================
-- Migration: Direct bank connection settings
-- ------------------------------------------------------------
-- EduBerry now talks to each school's OWN bank for fee collection
-- and salary payout, instead of routing through a payment
-- aggregator. No new tables are needed: both configs are JSONB
-- rows in the existing site_settings / payment_secrets stores.
-- This migration only ensures the payment_secrets table exists
-- and records the scopes, so a school can be onboarded by an
-- admin filling in Settings rather than by a redeploy.
--
-- SAFE TO RE-RUN. It creates nothing that add_payment_secrets.sql
-- did not already create, and writes no credentials.
--
-- STORAGE SPLIT — this is the part that matters for security:
--
--   site_settings   is WORLD-READABLE (it carries branding), so it
--                   holds only non-sensitive operational config:
--                     'bank_collect_config' → { enabled, mode,
--                        connection{...}, allocate_path, request_map }
--                     'payout_config'       → { enabled, provider,
--                        transfer_mode, rtgs_min_amount, connection{...},
--                        transfer_path, status_path, batch_size,
--                        request_map, file{...} }
--                   `connection` carries the API base URL, auth mode,
--                   header names, signature encoding and timeout — the
--                   shape of the integration, never its credentials.
--
--   payment_secrets is ADMIN-ONLY (no public SELECT policy), so every
--                   credential lands here:
--                     'bank_collect' → { api_key, client_id,
--                        client_secret, oauth_audience, signing_secret,
--                        webhook_secret, client_cert_pem, client_key_pem,
--                        client_cert_passphrase, corporate_id }
--                     'payout'       → the same, plus
--                        { account_number, account_ifsc }
--                     'razorpay'     → { key_secret, webhook_secret }
--                        (legacy card checkout, still supported)
--                     'smart_collect'→ { base_url, api_key,
--                        webhook_secret } (legacy; read only until a
--                        school switches to a direct bank connection)
--
-- The debit account number and the corporate ID are deliberately in
-- payment_secrets rather than site_settings: they are not passwords,
-- but they must not be world-readable either.
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
DROP POLICY IF EXISTS "Admin manage payment secrets" ON public.payment_secrets;
CREATE POLICY "Admin manage payment secrets"
  ON public.payment_secrets FOR ALL
  USING (public.get_user_role() = 'admin')
  WITH CHECK (public.get_user_role() = 'admin');

-- Seed empty rows for the two bank scopes so the Settings forms have a
-- row to upsert into on first save. No credentials are written here.
INSERT INTO public.payment_secrets (key, value)
VALUES ('bank_collect', '{}'::jsonb), ('payout', '{}'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- ── Existing deployments ────────────────────────────────────
-- A school already using the aggregator payout config keeps working:
-- payout_config rows missing the new fields are filled with defaults on
-- read (normalizePayoutConfig), and a provider of 'razorpayx' /
-- 'cashfree' now fails closed with a message pointing the admin at
-- Settings, so a stale config can never silently skip a transfer.

NOTIFY pgrst, 'reload schema';
