-- ============================================================
-- Migration: Bus Fee Heads
-- Brings the Bus fee module to parity with the School Fee
-- Manager: a reusable catalogue of bus fee types (e.g.
-- "Monthly Bus Fee — Route A") with a default amount the admin
-- can override when issuing. Each issued bus_fees row may link
-- back to the head it was issued from. Mirrors fee_heads in
-- add_fee_manager.sql.
-- Run this in the Supabase SQL Editor.
-- ============================================================

-- ── bus_fee_heads ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.bus_fee_heads (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  default_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.bus_fee_heads ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_bus_fee_heads_active ON public.bus_fee_heads(active);

DROP TRIGGER IF EXISTS bus_fee_heads_updated_at ON public.bus_fee_heads;
CREATE TRIGGER bus_fee_heads_updated_at
  BEFORE UPDATE ON public.bus_fee_heads
  FOR EACH ROW EXECUTE FUNCTION update_task_updated_at();

CREATE POLICY "Admin manage bus fee heads"
  ON public.bus_fee_heads FOR ALL
  USING (public.get_user_role() = 'admin')
  WITH CHECK (public.get_user_role() = 'admin');

-- Any signed-in user may read the catalogue (so passengers see the
-- label on a fee issued to them).
CREATE POLICY "Authenticated read bus fee heads"
  ON public.bus_fee_heads FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- ── bus_fees: link to the catalogue ──────────────────────────

ALTER TABLE public.bus_fees
  ADD COLUMN IF NOT EXISTS fee_head_id UUID REFERENCES public.bus_fee_heads(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_bus_fees_fee_head ON public.bus_fees(fee_head_id);

-- ── Grant access ─────────────────────────────────────────────

GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL ROUTINES IN SCHEMA public TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
