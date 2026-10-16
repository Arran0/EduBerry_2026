-- ============================================================================
-- transport_r6_a_fee_grid — a fee grid per trip, and monthly bills per trip
-- ============================================================================
-- Safe to re-run. Additive only: one new table, one new nullable column, one
-- partial unique index.
--
-- How a rider's bus fee is decided now:
--
--   1. A custom amount on the student's assignment (transport_student_assignments
--      .fee_amount) wins outright. That column already existed; it is the
--      "this child pays something different" override.
--   2. Otherwise the route's fee grid: each stop carries a round-trip amount and,
--      optionally, a one-way amount. A child who rides both ways pays the
--      round-trip rate of the dearer of their pickup and drop stops; a child on
--      one direction only pays that stop's one-way rate (falling back to the
--      round-trip rate when no one-way rate is set).
--
-- A child on two trips (morning on route 2, evening on route 10) holds two
-- assignments and so receives two bills — one per route per month.
--
-- bus_fees.billing_period ('YYYY-MM') is what lets a monthly run be repeated
-- safely: the partial unique index refuses a second live bill for the same
-- child, route and month, while a cancelled bill frees the slot for a re-issue.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.transport_stop_fees (
  stop_id        UUID PRIMARY KEY REFERENCES public.transport_route_stops(id) ON DELETE CASCADE,
  route_id       UUID NOT NULL REFERENCES public.transport_routes(id) ON DELETE CASCADE,
  amount_round   NUMERIC(10, 2) CHECK (amount_round IS NULL OR amount_round >= 0),
  amount_one_way NUMERIC(10, 2) CHECK (amount_one_way IS NULL OR amount_one_way >= 0),
  updated_by     UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_transport_stop_fees_route ON public.transport_stop_fees (route_id);
CREATE INDEX IF NOT EXISTS idx_transport_stop_fees_updated_by ON public.transport_stop_fees (updated_by);

ALTER TABLE public.transport_stop_fees ENABLE ROW LEVEL SECURITY;

-- Prices are an office matter: admins read and write them, nobody else sees
-- them. Riders learn their amount from the bill itself.
DROP POLICY IF EXISTS "Admin reads stop fees" ON public.transport_stop_fees;
DROP POLICY IF EXISTS "Admin writes stop fees" ON public.transport_stop_fees;
DROP POLICY IF EXISTS "Admin updates stop fees" ON public.transport_stop_fees;
DROP POLICY IF EXISTS "Admin deletes stop fees" ON public.transport_stop_fees;

CREATE POLICY "Admin reads stop fees" ON public.transport_stop_fees
  FOR SELECT TO authenticated USING ((select public.get_user_role()) = 'admin');
CREATE POLICY "Admin writes stop fees" ON public.transport_stop_fees
  FOR INSERT TO authenticated WITH CHECK ((select public.get_user_role()) = 'admin');
CREATE POLICY "Admin updates stop fees" ON public.transport_stop_fees
  FOR UPDATE TO authenticated
  USING ((select public.get_user_role()) = 'admin')
  WITH CHECK ((select public.get_user_role()) = 'admin');
CREATE POLICY "Admin deletes stop fees" ON public.transport_stop_fees
  FOR DELETE TO authenticated USING ((select public.get_user_role()) = 'admin');

-- ── Monthly bills ────────────────────────────────────────────────────────
ALTER TABLE public.bus_fees ADD COLUMN IF NOT EXISTS billing_period TEXT
  CHECK (billing_period IS NULL OR billing_period ~ '^\d{4}-(0[1-9]|1[0-2])$');

CREATE UNIQUE INDEX IF NOT EXISTS uq_bus_fees_route_period
  ON public.bus_fees (route_id, passenger_id, billing_period)
  WHERE billing_period IS NOT NULL AND status <> 'cancelled';
