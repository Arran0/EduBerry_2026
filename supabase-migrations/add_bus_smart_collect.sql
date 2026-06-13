-- ============================================================
-- Migration: Bus UPI Smart Collect (bank/PSP auto-reconciliation)
-- Adds provider/reference columns to bus_payments so an incoming-UPI
-- webhook from a bank or PSP can be matched to a fee automatically —
-- the NTU/PayNow model: unique reference (or virtual VPA) per fee,
-- confirmed by a server-to-server notification, never self-declared.
-- Run in the Supabase SQL Editor (after add_bus_manager.sql).
-- ============================================================

ALTER TABLE public.bus_payments
  ADD COLUMN IF NOT EXISTS provider TEXT,              -- e.g. 'smart_collect'
  ADD COLUMN IF NOT EXISTS collect_vpa TEXT,           -- per-fee virtual VPA (vpa mode)
  ADD COLUMN IF NOT EXISTS provider_ref TEXT,          -- unique reference matched by the webhook
  ADD COLUMN IF NOT EXISTS utr TEXT;                   -- bank UTR / RRN from the settlement

CREATE INDEX IF NOT EXISTS idx_bus_payments_provider_ref ON public.bus_payments(provider_ref);
CREATE INDEX IF NOT EXISTS idx_bus_payments_collect_vpa ON public.bus_payments(collect_vpa);
-- Prevent double-crediting the same bank settlement.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_bus_payments_utr ON public.bus_payments(utr) WHERE utr IS NOT NULL;

NOTIFY pgrst, 'reload schema';
