-- ============================================================
-- Migration: Bus Monthly Fee Drafts
-- Admins can create titled monthly fee drafts, optionally linked
-- to a trip to import its passenger list. A single "Issue All"
-- click creates bus_fees rows for every student in the draft.
-- Run this in the Supabase SQL Editor.
-- ============================================================

-- ── bus_fee_drafts ───────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.bus_fee_drafts (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  title       TEXT NOT NULL,
  month       TEXT NOT NULL,                   -- YYYY-MM
  trip_id     UUID REFERENCES public.bus_trips(id) ON DELETE SET NULL,
  fee_head_id UUID REFERENCES public.bus_fee_heads(id) ON DELETE SET NULL,
  amount      NUMERIC(10,2) NOT NULL DEFAULT 0,
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

CREATE TABLE IF NOT EXISTS public.bus_fee_draft_passengers (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  draft_id     UUID NOT NULL REFERENCES public.bus_fee_drafts(id) ON DELETE CASCADE,
  passenger_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
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

-- ── Grant access ─────────────────────────────────────────────

GRANT ALL ON ALL TABLES     IN SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL SEQUENCES  IN SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL ROUTINES   IN SCHEMA public TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
