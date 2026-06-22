-- ============================================================
-- Migration: Fee Statements, Reports & Academic-Year scoping
-- Builds on add_fee_manager.sql. Adds:
--   1. school_fees.academic_year (so fees/statements scope to a year)
--   2. card / bank / cheque to the fee_payment_method enum (so the
--      office can record offline collections the Collection Report needs)
-- PDF letterheads reuse the existing site_settings 'branding' key
-- (schoolName / logoUrl / tagline) — nothing new stored for that.
--
-- Run this in the Supabase SQL Editor.
-- ============================================================

-- ── Offline payment methods ──────────────────────────────────
-- ALTER TYPE ... ADD VALUE cannot be used in the SAME transaction
-- that later references the new value. These statements add the
-- values only; the rest of the migration does not use them, so it
-- is safe to run the whole file in one batch.

ALTER TYPE public.fee_payment_method ADD VALUE IF NOT EXISTS 'card';
ALTER TYPE public.fee_payment_method ADD VALUE IF NOT EXISTS 'bank';
ALTER TYPE public.fee_payment_method ADD VALUE IF NOT EXISTS 'cheque';

-- ── Academic year on fees ────────────────────────────────────
-- TEXT in the same 'YYYY-YY' shape as homerooms.academic_year and the
-- homeroom_expiry_dates keys (e.g. '2026-27'). New fees are stamped at
-- issue time (from the targeted homeroom's year); existing rows are
-- backfilled below from due_date / created_at using the Apr–Mar
-- Indian academic-year convention.

ALTER TABLE public.school_fees
  ADD COLUMN IF NOT EXISTS academic_year TEXT;

CREATE INDEX IF NOT EXISTS idx_school_fees_academic_year
  ON public.school_fees(academic_year);

-- Backfill: start year = (month >= April ? year : year-1); label = 'SY-(SY+1)%100'.
UPDATE public.school_fees AS f
SET academic_year = ay.label
FROM (
  SELECT id,
    sy::text || '-' || lpad(((sy + 1) % 100)::text, 2, '0') AS label
  FROM (
    SELECT id,
      CASE
        WHEN EXTRACT(MONTH FROM COALESCE(due_date, created_at::date)) >= 4
          THEN EXTRACT(YEAR FROM COALESCE(due_date, created_at::date))::int
        ELSE EXTRACT(YEAR FROM COALESCE(due_date, created_at::date))::int - 1
      END AS sy
    FROM public.school_fees
  ) s
) ay
WHERE f.id = ay.id
  AND f.academic_year IS NULL;

-- ── Reload PostgREST schema cache ────────────────────────────

NOTIFY pgrst, 'reload schema';
