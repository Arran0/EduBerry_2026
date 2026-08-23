-- ============================================================
-- Migration: Server-side "read" tracking for the forgotten-checkout warning
-- Run this in the Supabase SQL Editor.
-- ============================================================

-- The forgotten-checkout popup previously tracked "read" purely in the
-- browser's localStorage, so dismissing a case on one device/browser did
-- nothing for any other device or browser the same staff member used —
-- the case would reappear there even though it had already been marked read
-- elsewhere. Moving the marker onto the row itself makes it follow the staff
-- member everywhere, like every other read/seen marker in the app.
ALTER TABLE public.staff_attendance_records
  ADD COLUMN IF NOT EXISTS forgotten_checkout_ack_at TIMESTAMPTZ;

-- Staff cannot UPDATE this table directly (see "Principal and admin can
-- update staff attendance" — the only UPDATE policy on this table), so
-- acknowledging a warning goes through this SECURITY DEFINER RPC instead,
-- scoped to the caller's own rows.
CREATE OR REPLACE FUNCTION public.ack_forgotten_checkout(p_record_ids UUID[])
RETURNS VOID AS $$
BEGIN
  UPDATE public.staff_attendance_records
  SET forgotten_checkout_ack_at = NOW()
  WHERE id = ANY(p_record_ids)
    AND staff_id = auth.uid();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION public.ack_forgotten_checkout(UUID[]) TO authenticated;
