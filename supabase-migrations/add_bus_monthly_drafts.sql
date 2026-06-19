-- ============================================================
-- Migration: Bus Monthly Fee Drafts
-- Admins create titled monthly fee drafts, then open the draft
-- to assign a unique fee amount per student (e.g. different
-- amounts for different pickup/drop points). A single "Issue All"
-- click creates individual bus_fees rows for every student.
-- Run this in the Supabase SQL Editor.
-- If you ran an earlier version of this migration, run the
-- patch block at the bottom to update the schema.
-- ============================================================

-- ── bus_fee_drafts ───────────────────────────────────────────
-- No single amount at draft level — each student has their own.

CREATE TABLE IF NOT EXISTS public.bus_fee_drafts (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  title       TEXT NOT NULL,
  month       TEXT NOT NULL,                   -- YYYY-MM
  trip_id     UUID REFERENCES public.bus_trips(id) ON DELETE SET NULL,
  fee_head_id UUID REFERENCES public.bus_fee_heads(id) ON DELETE SET NULL,
  description TEXT,
  due_date    DATE,
  status      TEXT NOT NULL DEFAULT 'draft',
  issued_at   TIMESTAMPTZ,
  created_by  UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT bus_fee_drafts_status_check CHECK (status IN ('draft', 'issued'))
);

ALTER TABLE public.bus_fee_drafts ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_bus_fee_drafts_month  ON public.bus_fee_drafts(month);
CREATE INDEX IF NOT EXISTS idx_bus_fee_drafts_status ON public.bus_fee_drafts(status);
CREATE INDEX IF NOT EXISTS idx_bus_fee_drafts_trip   ON public.bus_fee_drafts(trip_id);

DROP TRIGGER IF EXISTS bus_fee_drafts_updated_at ON public.bus_fee_drafts;
CREATE TRIGGER bus_fee_drafts_updated_at
  BEFORE UPDATE ON public.bus_fee_drafts
  FOR EACH ROW EXECUTE FUNCTION update_task_updated_at();

CREATE POLICY "Admin manage bus fee drafts"
  ON public.bus_fee_drafts FOR ALL
  USING  (public.get_user_role() = 'admin')
  WITH CHECK (public.get_user_role() = 'admin');

-- ── bus_fee_draft_passengers ─────────────────────────────────
-- Per-student fee amount and optional note (e.g. pickup point).

CREATE TABLE IF NOT EXISTS public.bus_fee_draft_passengers (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  draft_id     UUID NOT NULL REFERENCES public.bus_fee_drafts(id) ON DELETE CASCADE,
  passenger_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  amount       NUMERIC(10,2),     -- admin sets individually; null until filled
  description  TEXT,              -- per-student note / pickup-point label
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(draft_id, passenger_id)
);

ALTER TABLE public.bus_fee_draft_passengers ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_bus_fee_draft_pass_draft     ON public.bus_fee_draft_passengers(draft_id);
CREATE INDEX IF NOT EXISTS idx_bus_fee_draft_pass_passenger ON public.bus_fee_draft_passengers(passenger_id);

CREATE POLICY "Admin manage bus fee draft passengers"
  ON public.bus_fee_draft_passengers FOR ALL
  USING  (public.get_user_role() = 'admin')
  WITH CHECK (public.get_user_role() = 'admin');

-- ── Patch (run if you applied the v1 migration) ───────────────
-- ALTER TABLE public.bus_fee_drafts DROP COLUMN IF EXISTS amount;
-- ALTER TABLE public.bus_fee_draft_passengers ADD COLUMN IF NOT EXISTS amount NUMERIC(10,2);
-- ALTER TABLE public.bus_fee_draft_passengers ADD COLUMN IF NOT EXISTS description TEXT;

-- ── Grant access ─────────────────────────────────────────────

GRANT ALL ON ALL TABLES     IN SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL SEQUENCES  IN SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL ROUTINES   IN SCHEMA public TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
