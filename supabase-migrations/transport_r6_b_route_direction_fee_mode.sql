-- ============================================================================
-- transport_r6_b_route_direction_fee_mode — one direction per route, one way
-- to price it
-- ============================================================================
-- Safe to re-run. Run after transport_r6_a_fee_grid.sql.
--
-- A route is now either a to-school route or a from-school route, never both.
-- A child who rides in the morning and home in the evening is on two routes.
-- That makes the rest simple: a to-school route asks each rider for a pickup
-- stop, a from-school route for a drop stop, and the route has exactly one
-- schedule, in its own direction.
--
-- Pricing is chosen per route: by stop (every rider pays their stop's price)
-- or by student (every rider has their own amount). fee_mode is NULL until
-- the admin chooses, and no bills are raised for a route until they do.
--
-- With the direction fixed, a stop has one price rather than a round-trip and
-- a one-way price, so the grid column is renamed and the second one dropped.
-- ============================================================================

ALTER TABLE public.transport_routes
  ADD COLUMN IF NOT EXISTS direction public.transport_direction NOT NULL DEFAULT 'inbound',
  ADD COLUMN IF NOT EXISTS fee_mode TEXT CHECK (fee_mode IS NULL OR fee_mode IN ('stop', 'student'));

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'transport_stop_fees' AND column_name = 'amount_round') THEN
    ALTER TABLE public.transport_stop_fees RENAME COLUMN amount_round TO amount;
  END IF;
END $$;

ALTER TABLE public.transport_stop_fees DROP COLUMN IF EXISTS amount_one_way;

-- Riders ride their route's one direction. The app keeps this in step when a
-- route's direction is changed (src/lib/transport/routes.ts).
UPDATE public.transport_student_assignments a
   SET rides_inbound  = (r.direction = 'inbound'),
       rides_outbound = (r.direction = 'outbound')
  FROM public.transport_routes r
 WHERE r.id = a.route_id
   AND (a.rides_inbound IS DISTINCT FROM (r.direction = 'inbound')
     OR a.rides_outbound IS DISTINCT FROM (r.direction = 'outbound'));
