-- ============================================================
-- Migration: Bus Driver Payroll — Bank Payouts
-- Brings the driver payroll module up to parity with the staff
-- Salary Manager's bank-disbursement flow:
--   • admin-managed driver bank accounts (driver reads own)
--   • payout_status / payout_reference on driver_payroll so a
--     payout provider's webhook can reconcile a transfer
-- The app never moves money itself — the payout/initiate route
-- calls the SAME site-wide payout provider (site_settings
-- key='payout_config') used by the Salary Manager, via
-- src/lib/payoutProvider.ts. Follows add_salary_manager.sql.
-- Run this in the Supabase SQL Editor.
-- ============================================================

-- ── driver_payroll: provider reconciliation columns ──────────
-- payout_status: null | 'initiated' | 'processed' | 'failed'
-- payout_reference: provider payout id

ALTER TABLE public.driver_payroll
  ADD COLUMN IF NOT EXISTS payout_status TEXT,
  ADD COLUMN IF NOT EXISTS payout_reference TEXT;

-- ── driver_bank_accounts ─────────────────────────────────────
-- Admin-managed. A driver may read their own row but never write it.
-- Mirrors public.staff_bank_accounts.

CREATE TABLE IF NOT EXISTS public.driver_bank_accounts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  driver_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL UNIQUE,
  account_holder_name TEXT NOT NULL,
  account_number TEXT NOT NULL,
  ifsc TEXT NOT NULL,
  bank_name TEXT,
  payout_fund_account_id TEXT,  -- provider-side handle (e.g. RazorpayX fund_account); set by integration
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.driver_bank_accounts ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_driver_bank_accounts_driver ON public.driver_bank_accounts(driver_id);

DROP TRIGGER IF EXISTS driver_bank_accounts_updated_at ON public.driver_bank_accounts;
CREATE TRIGGER driver_bank_accounts_updated_at
  BEFORE UPDATE ON public.driver_bank_accounts
  FOR EACH ROW EXECUTE FUNCTION update_task_updated_at();

-- Dropped first so the whole migration can be re-run. Without this a second
-- run stops on "policy already exists", which is how a half-applied migration
-- happens: the table is there, the grants at the bottom never ran.
DROP POLICY IF EXISTS "Admin manage driver bank accounts" ON public.driver_bank_accounts;
CREATE POLICY "Admin manage driver bank accounts"
  ON public.driver_bank_accounts FOR ALL
  USING (public.get_user_role() = 'admin')
  WITH CHECK (public.get_user_role() = 'admin');

DROP POLICY IF EXISTS "Driver views own bank account" ON public.driver_bank_accounts;
CREATE POLICY "Driver views own bank account"
  ON public.driver_bank_accounts FOR SELECT
  USING (driver_id = auth.uid());

-- ── Grant access ─────────────────────────────────────────────

GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL ROUTINES IN SCHEMA public TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
