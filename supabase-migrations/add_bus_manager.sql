-- ============================================================
-- Migration: Bus Manager
-- Trips, per-date driver overrides, passenger lists, attendance,
-- fees, payments, driver payroll, and live bus locations — all
-- with RLS. Follows the conventions in add_attendance.sql.
-- Prereq: run add_bus_driver_role.sql first.
-- Run this in the Supabase SQL Editor.
-- ============================================================

-- ── Enums ────────────────────────────────────────────────────

CREATE TYPE public.trip_attendance_status AS ENUM ('picked_up', 'dropped', 'absent');
CREATE TYPE public.bus_fee_status         AS ENUM ('unpaid', 'partial', 'paid', 'cancelled');
CREATE TYPE public.bus_payment_method     AS ENUM ('razorpay', 'upi_qr', 'cash');
CREATE TYPE public.bus_payment_status     AS ENUM ('pending', 'verified', 'failed');
CREATE TYPE public.payroll_status         AS ENUM ('draft', 'approved', 'paid');

-- ── bus_trips ────────────────────────────────────────────────

CREATE TABLE public.bus_trips (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  route_description TEXT,
  pickup_time TIME,
  drop_time TIME,
  default_driver_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.bus_trips ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_bus_trips_default_driver ON public.bus_trips(default_driver_id);
CREATE INDEX IF NOT EXISTS idx_bus_trips_active ON public.bus_trips(active);

CREATE TRIGGER bus_trips_updated_at
  BEFORE UPDATE ON public.bus_trips
  FOR EACH ROW EXECUTE FUNCTION update_task_updated_at();

-- ── trip_passengers ──────────────────────────────────────────

CREATE TABLE public.trip_passengers (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  trip_id UUID REFERENCES public.bus_trips(id) ON DELETE CASCADE NOT NULL,
  passenger_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(trip_id, passenger_id)
);

ALTER TABLE public.trip_passengers ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_trip_passengers_trip ON public.trip_passengers(trip_id);
CREATE INDEX IF NOT EXISTS idx_trip_passengers_passenger ON public.trip_passengers(passenger_id);

-- ── trip_driver_overrides ────────────────────────────────────
-- A substitute driver for a particular trip on a particular date.

CREATE TABLE public.trip_driver_overrides (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  trip_id UUID REFERENCES public.bus_trips(id) ON DELETE CASCADE NOT NULL,
  date DATE NOT NULL,
  driver_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  note TEXT,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(trip_id, date)
);

ALTER TABLE public.trip_driver_overrides ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_trip_driver_overrides_trip_date ON public.trip_driver_overrides(trip_id, date);
CREATE INDEX IF NOT EXISTS idx_trip_driver_overrides_driver ON public.trip_driver_overrides(driver_id);

CREATE TRIGGER trip_driver_overrides_updated_at
  BEFORE UPDATE ON public.trip_driver_overrides
  FOR EACH ROW EXECUTE FUNCTION update_task_updated_at();

-- ── Helper functions (SECURITY DEFINER bypasses RLS, avoiding
--    recursive policy evaluation across these tables) ──────────

-- Resolve the driver responsible for a trip on a date:
-- the per-date override if one exists, otherwise the trip's default driver.
CREATE OR REPLACE FUNCTION public.effective_trip_driver(p_trip UUID, p_date DATE)
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT driver_id FROM public.trip_driver_overrides WHERE trip_id = p_trip AND date = p_date),
    (SELECT default_driver_id FROM public.bus_trips WHERE id = p_trip)
  );
$$;

-- Is the current user a driver of this trip at all (default driver, or holds
-- any override for it)? Used to grant a driver read access to the trip + roster.
CREATE OR REPLACE FUNCTION public.is_trip_driver(p_trip UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.bus_trips t
    WHERE t.id = p_trip AND t.default_driver_id = auth.uid()
  ) OR EXISTS (
    SELECT 1 FROM public.trip_driver_overrides o
    WHERE o.trip_id = p_trip AND o.driver_id = auth.uid()
  );
$$;

-- Is the current user a passenger on this trip?
CREATE OR REPLACE FUNCTION public.is_trip_passenger(p_trip UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.trip_passengers p
    WHERE p.trip_id = p_trip AND p.passenger_id = auth.uid()
  );
$$;

-- (payroll_belongs_to_me is defined later, after the driver_payroll table exists.)

-- ── bus_trips policies ───────────────────────────────────────

CREATE POLICY "Admin manage trips"
  ON public.bus_trips FOR ALL
  USING (public.get_user_role() = 'admin')
  WITH CHECK (public.get_user_role() = 'admin');

CREATE POLICY "Driver views assigned trips"
  ON public.bus_trips FOR SELECT
  USING (public.is_trip_driver(id));

CREATE POLICY "Passenger views own trips"
  ON public.bus_trips FOR SELECT
  USING (public.is_trip_passenger(id));

-- ── trip_passengers policies ─────────────────────────────────

CREATE POLICY "Admin manage trip passengers"
  ON public.trip_passengers FOR ALL
  USING (public.get_user_role() = 'admin')
  WITH CHECK (public.get_user_role() = 'admin');

CREATE POLICY "Driver views roster of assigned trips"
  ON public.trip_passengers FOR SELECT
  USING (public.is_trip_driver(trip_id));

CREATE POLICY "Passenger views own trip membership"
  ON public.trip_passengers FOR SELECT
  USING (passenger_id = auth.uid());

-- ── trip_driver_overrides policies ───────────────────────────

CREATE POLICY "Admin manage driver overrides"
  ON public.trip_driver_overrides FOR ALL
  USING (public.get_user_role() = 'admin')
  WITH CHECK (public.get_user_role() = 'admin');

CREATE POLICY "Driver views relevant overrides"
  ON public.trip_driver_overrides FOR SELECT
  USING (driver_id = auth.uid() OR public.is_trip_driver(trip_id));

-- ── trip_attendance ──────────────────────────────────────────

CREATE TABLE public.trip_attendance (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  trip_id UUID REFERENCES public.bus_trips(id) ON DELETE CASCADE NOT NULL,
  passenger_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  date DATE NOT NULL,
  status public.trip_attendance_status NOT NULL DEFAULT 'absent',
  marked_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  picked_up_at TIMESTAMPTZ,
  dropped_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(trip_id, passenger_id, date)
);

ALTER TABLE public.trip_attendance ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_trip_attendance_trip_date ON public.trip_attendance(trip_id, date);
CREATE INDEX IF NOT EXISTS idx_trip_attendance_passenger ON public.trip_attendance(passenger_id);

CREATE TRIGGER trip_attendance_updated_at
  BEFORE UPDATE ON public.trip_attendance
  FOR EACH ROW EXECUTE FUNCTION update_task_updated_at();

CREATE POLICY "Admin manage attendance"
  ON public.trip_attendance FOR ALL
  USING (public.get_user_role() = 'admin')
  WITH CHECK (public.get_user_role() = 'admin');

-- The driver of record for (trip, date) — substitute on the overridden date,
-- else the default driver — may read and mark attendance for that date only.
CREATE POLICY "Driver views own-date attendance"
  ON public.trip_attendance FOR SELECT
  USING (public.effective_trip_driver(trip_id, date) = auth.uid());

CREATE POLICY "Driver inserts own-date attendance"
  ON public.trip_attendance FOR INSERT
  WITH CHECK (public.effective_trip_driver(trip_id, date) = auth.uid());

CREATE POLICY "Driver updates own-date attendance"
  ON public.trip_attendance FOR UPDATE
  USING (public.effective_trip_driver(trip_id, date) = auth.uid())
  WITH CHECK (public.effective_trip_driver(trip_id, date) = auth.uid());

CREATE POLICY "Passenger views own attendance"
  ON public.trip_attendance FOR SELECT
  USING (passenger_id = auth.uid());

-- ── bus_fees ─────────────────────────────────────────────────

CREATE TABLE public.bus_fees (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  trip_id UUID REFERENCES public.bus_trips(id) ON DELETE SET NULL,
  passenger_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  amount NUMERIC(10,2) NOT NULL,
  description TEXT,
  due_date DATE,
  status public.bus_fee_status NOT NULL DEFAULT 'unpaid',
  -- Unique token embedded in the UPI note (tn=...) so manual reconciliation
  -- of a UPI-QR payment is unambiguous. Defaulted per row.
  upi_reference TEXT NOT NULL DEFAULT ('BUSFEE-' || replace(gen_random_uuid()::text, '-', '')),
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.bus_fees ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_bus_fees_passenger ON public.bus_fees(passenger_id);
CREATE INDEX IF NOT EXISTS idx_bus_fees_trip ON public.bus_fees(trip_id);
CREATE INDEX IF NOT EXISTS idx_bus_fees_status ON public.bus_fees(status);

CREATE TRIGGER bus_fees_updated_at
  BEFORE UPDATE ON public.bus_fees
  FOR EACH ROW EXECUTE FUNCTION update_task_updated_at();

CREATE POLICY "Admin manage fees"
  ON public.bus_fees FOR ALL
  USING (public.get_user_role() = 'admin')
  WITH CHECK (public.get_user_role() = 'admin');

CREATE POLICY "Passenger views own fees"
  ON public.bus_fees FOR SELECT
  USING (passenger_id = auth.uid());

-- ── bus_payments ─────────────────────────────────────────────

CREATE TABLE public.bus_payments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  fee_id UUID REFERENCES public.bus_fees(id) ON DELETE CASCADE NOT NULL,
  payer_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  method public.bus_payment_method NOT NULL,
  amount NUMERIC(10,2) NOT NULL,
  status public.bus_payment_status NOT NULL DEFAULT 'pending',
  razorpay_order_id TEXT,
  razorpay_payment_id TEXT,
  razorpay_signature TEXT,
  upi_txn_ref TEXT,
  verified_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.bus_payments ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_bus_payments_fee ON public.bus_payments(fee_id);
CREATE INDEX IF NOT EXISTS idx_bus_payments_order ON public.bus_payments(razorpay_order_id);

CREATE TRIGGER bus_payments_updated_at
  BEFORE UPDATE ON public.bus_payments
  FOR EACH ROW EXECUTE FUNCTION update_task_updated_at();

CREATE POLICY "Admin manage payments"
  ON public.bus_payments FOR ALL
  USING (public.get_user_role() = 'admin')
  WITH CHECK (public.get_user_role() = 'admin');

CREATE POLICY "Payer views own payments"
  ON public.bus_payments FOR SELECT
  USING (payer_id = auth.uid());

-- Passengers may LOG a payment intent/claim for their own fee. Verification
-- (status -> verified) is done server-side via the service role (Razorpay
-- webhook) or by an admin — there is deliberately no passenger UPDATE policy.
CREATE POLICY "Payer records own payment"
  ON public.bus_payments FOR INSERT
  WITH CHECK (payer_id = auth.uid());

-- ── driver_payroll ───────────────────────────────────────────

CREATE TABLE public.driver_payroll (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  driver_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  base_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  status public.payroll_status NOT NULL DEFAULT 'draft',
  notes TEXT,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(driver_id, period_start, period_end)
);

ALTER TABLE public.driver_payroll ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_driver_payroll_driver ON public.driver_payroll(driver_id);

CREATE TRIGGER driver_payroll_updated_at
  BEFORE UPDATE ON public.driver_payroll
  FOR EACH ROW EXECUTE FUNCTION update_task_updated_at();

CREATE POLICY "Admin manage payroll"
  ON public.driver_payroll FOR ALL
  USING (public.get_user_role() = 'admin')
  WITH CHECK (public.get_user_role() = 'admin');

CREATE POLICY "Driver views own payroll"
  ON public.driver_payroll FOR SELECT
  USING (driver_id = auth.uid());

-- Does this payroll row belong to the current user (driver)? Defined here,
-- after driver_payroll exists, so the SQL function body validates.
CREATE OR REPLACE FUNCTION public.payroll_belongs_to_me(p_payroll UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.driver_payroll dp
    WHERE dp.id = p_payroll AND dp.driver_id = auth.uid()
  );
$$;

-- ── driver_payroll_items ─────────────────────────────────────
-- Positive amount = earning, negative = deduction.

CREATE TABLE public.driver_payroll_items (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  payroll_id UUID REFERENCES public.driver_payroll(id) ON DELETE CASCADE NOT NULL,
  label TEXT NOT NULL,
  amount NUMERIC(10,2) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.driver_payroll_items ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_driver_payroll_items_payroll ON public.driver_payroll_items(payroll_id);

CREATE POLICY "Admin manage payroll items"
  ON public.driver_payroll_items FOR ALL
  USING (public.get_user_role() = 'admin')
  WITH CHECK (public.get_user_role() = 'admin');

CREATE POLICY "Driver views own payroll items"
  ON public.driver_payroll_items FOR SELECT
  USING (public.payroll_belongs_to_me(payroll_id));

-- ── bus_locations ────────────────────────────────────────────
-- Live GPS breadcrumb stream. Persisted so late-joining passengers get the
-- last known position; broadcast via Supabase Realtime for live updates.

CREATE TABLE public.bus_locations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  trip_id UUID REFERENCES public.bus_trips(id) ON DELETE CASCADE NOT NULL,
  driver_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  lat DECIMAL(9,6) NOT NULL,
  lng DECIMAL(9,6) NOT NULL,
  heading REAL,
  speed REAL,
  accuracy REAL,
  recorded_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.bus_locations ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_bus_locations_trip_recorded ON public.bus_locations(trip_id, recorded_at DESC);

CREATE POLICY "Admin views locations"
  ON public.bus_locations FOR SELECT
  USING (public.get_user_role() = 'admin');

-- Only the driver of record for (trip, today) may stream location.
CREATE POLICY "Driver streams own-trip location"
  ON public.bus_locations FOR INSERT
  WITH CHECK (public.effective_trip_driver(trip_id, CURRENT_DATE) = auth.uid());

CREATE POLICY "Passenger views own-trip location"
  ON public.bus_locations FOR SELECT
  USING (public.is_trip_passenger(trip_id));

-- Live push to passengers via Realtime.
ALTER PUBLICATION supabase_realtime ADD TABLE public.bus_locations;

-- ── Grant access ─────────────────────────────────────────────

GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL ROUTINES IN SCHEMA public TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
