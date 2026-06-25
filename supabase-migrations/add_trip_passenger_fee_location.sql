-- ============================================================
-- Migration: Per-passenger fee + pickup location on trips
-- Admins set a default fee amount and a pickup/drop location for
-- each passenger directly on the trip. When a Bulk Issue is linked
-- to that trip, "Import trip" pulls these details straight into the
-- sheet (amount + note) so the admin doesn't re-key them.
-- Run this in the Supabase SQL Editor.
-- ============================================================

ALTER TABLE public.trip_passengers
  ADD COLUMN IF NOT EXISTS fee_amount NUMERIC(10,2),  -- default monthly bus fee for this passenger on this trip
  ADD COLUMN IF NOT EXISTS location   TEXT;           -- pickup / drop point label

NOTIFY pgrst, 'reload schema';
