-- ============================================================================
-- Migration: Transport — Round 4c, card and QR boarding
--
-- transport_scan_method has carried 'rfid' | 'nfc' | 'qr' since Round 2, on the
-- promise that adding a reader would be a reader and not a schema change. This
-- is that reader.
--
-- What a credential is: a random token on a card, a fob, or a printed QR. The
-- token itself is never stored — only its SHA-256 — for the same reason a
-- password is not stored. A leaked credentials table would otherwise be a
-- working set of keys to every child's boarding record, and the rows are
-- readable by anyone who can read the roster.
--
-- What a scan is NOT: identification. A scan resolves a token to a student and
-- then calls transport_mark_boarding, which is the single place boarding state
-- is written, whatever produced it. A card that somebody else is holding marks
-- that card's owner boarded, which is exactly the failure mode a bus attendant
-- exists to catch — so the attendant still sees the name and photo, and a
-- scan is a faster tap, never an unsupervised one.
--
-- Run this in the Supabase SQL Editor.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.transport_student_credentials (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id  UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  method      public.transport_scan_method NOT NULL,
  -- SHA-256 hex of the token. Unique across every credential, so a scan is one
  -- index lookup with no idea which student it will land on until it lands.
  token_hash  TEXT NOT NULL,
  -- What is written on the card, so an admin can match a physical object to a
  -- row without being able to derive the token from it.
  label       TEXT,
  active      BOOLEAN NOT NULL DEFAULT true,
  issued_by   UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  issued_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at  TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  CONSTRAINT transport_credentials_scannable CHECK (method IN ('rfid', 'nfc', 'qr'))
);
CREATE UNIQUE INDEX IF NOT EXISTS transport_credentials_token_uniq
  ON public.transport_student_credentials (token_hash);
CREATE INDEX IF NOT EXISTS idx_transport_credentials_student
  ON public.transport_student_credentials (student_id) WHERE active;
CREATE INDEX IF NOT EXISTS idx_transport_credentials_issued_by
  ON public.transport_student_credentials (issued_by);

ALTER TABLE public.transport_student_credentials ENABLE ROW LEVEL SECURITY;

-- A family may see that their child has a card and whether it works. Nobody
-- but an admin sees anyone else's, and nobody at all sees a token.
DROP POLICY IF EXISTS "Reads transport_student_credentials" ON public.transport_student_credentials;
CREATE POLICY "Reads transport_student_credentials"
  ON public.transport_student_credentials FOR SELECT TO authenticated
  USING (
    (select public.get_user_role()) = 'admin'
    OR student_id = (select auth.uid())
  );

DROP POLICY IF EXISTS "Admin writes transport_student_credentials" ON public.transport_student_credentials;
CREATE POLICY "Admin writes transport_student_credentials"
  ON public.transport_student_credentials FOR INSERT TO authenticated
  WITH CHECK ((select public.get_user_role()) = 'admin');

DROP POLICY IF EXISTS "Admin updates transport_student_credentials" ON public.transport_student_credentials;
CREATE POLICY "Admin updates transport_student_credentials"
  ON public.transport_student_credentials FOR UPDATE TO authenticated
  USING ((select public.get_user_role()) = 'admin')
  WITH CHECK ((select public.get_user_role()) = 'admin');

DROP POLICY IF EXISTS "Admin deletes transport_student_credentials" ON public.transport_student_credentials;
CREATE POLICY "Admin deletes transport_student_credentials"
  ON public.transport_student_credentials FOR DELETE TO authenticated
  USING ((select public.get_user_role()) = 'admin');

-- ── Issue ───────────────────────────────────────────────────────────────────

/**
 * Mint a credential and return its token exactly once.
 *
 * The token is generated server-side: a client-chosen one is a client-guessable
 * one, and the whole security of a card is that nobody can predict the next.
 * It is a gen_random_uuid() with the hyphens taken out — 122 bits from the
 * platform CSPRNG, and deliberately not gen_random_bytes, which lives in
 * pgcrypto and would put an extension in this function's search path.
 * Thirty-two characters fits a QR a phone camera reads from a metre away.
 */
CREATE OR REPLACE FUNCTION public.transport_issue_credential(
  p_student UUID,
  p_method  public.transport_scan_method DEFAULT 'qr',
  p_label   TEXT DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_token TEXT;
  v_id    UUID;
BEGIN
  IF public.get_user_role() <> 'admin' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Not permitted');
  END IF;
  IF p_method NOT IN ('rfid', 'nfc', 'qr') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Not a scannable credential type');
  END IF;

  v_token := replace(gen_random_uuid()::TEXT, '-', '');

  INSERT INTO public.transport_student_credentials (student_id, method, token_hash, label, issued_by)
  VALUES (p_student, p_method, encode(sha256(v_token::BYTEA), 'hex'), p_label, auth.uid())
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('ok', true, 'id', v_id, 'token', v_token);
END $fn$;
REVOKE EXECUTE ON FUNCTION public.transport_issue_credential(UUID, public.transport_scan_method, TEXT)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transport_issue_credential(UUID, public.transport_scan_method, TEXT)
  TO authenticated;

/**
 * Register a card whose number is fixed by the hardware.
 *
 * An RFID fob arrives with a UID printed on it and no way to change it, so
 * unlike a QR the token cannot be minted here. The UID is hashed on the way in
 * and never stored, same as everything else.
 */
CREATE OR REPLACE FUNCTION public.transport_register_card(
  p_student UUID,
  p_uid     TEXT,
  p_method  public.transport_scan_method DEFAULT 'rfid',
  p_label   TEXT DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_id UUID;
BEGIN
  IF public.get_user_role() <> 'admin' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Not permitted');
  END IF;
  IF p_method NOT IN ('rfid', 'nfc') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Only a card or fob is registered by UID');
  END IF;
  IF COALESCE(length(trim(p_uid)), 0) < 4 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'That does not look like a card number');
  END IF;

  INSERT INTO public.transport_student_credentials (student_id, method, token_hash, label, issued_by)
  VALUES (p_student, p_method, encode(sha256(upper(trim(p_uid))::BYTEA), 'hex'), p_label, auth.uid())
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('ok', true, 'id', v_id);
EXCEPTION WHEN unique_violation THEN
  RETURN jsonb_build_object('ok', false, 'error', 'That card is already registered');
END $fn$;
REVOKE EXECUTE ON FUNCTION public.transport_register_card(UUID, TEXT, public.transport_scan_method, TEXT)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transport_register_card(UUID, TEXT, public.transport_scan_method, TEXT)
  TO authenticated;

-- ── Scan ────────────────────────────────────────────────────────────────────

/**
 * Board or alight whoever holds this token.
 *
 * Direction decides the event without the crew choosing it: on the way to
 * school a scan is boarding, on the way home from school it is alighting once
 * the bus has left the school stop. Getting that wrong would have an attendant
 * tapping a mode selector forty times a trip.
 *
 * Every refusal returns ok:false with a sentence, never an exception — a reader
 * loop that throws on an unknown card is a reader loop that stops reading.
 */
CREATE OR REPLACE FUNCTION public.transport_scan_boarding(
  p_run    UUID,
  p_token  TEXT,
  p_method public.transport_scan_method DEFAULT 'qr',
  p_stop   UUID DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_hash    TEXT;
  v_cred    RECORD;
  v_run     RECORD;
  v_pax     RECORD;
  v_event   public.transport_boarding_event;
  v_result  JSONB;
  v_name    TEXT;
BEGIN
  IF NOT (public.transport_is_crew(p_run) OR public.get_user_role() = 'admin') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Not your trip');
  END IF;

  SELECT id, route_id, direction, status, current_stop_id INTO v_run
  FROM public.transport_trip_runs WHERE id = p_run;
  IF v_run.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'No such trip');
  END IF;
  IF v_run.status NOT IN ('boarding', 'in_progress') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'This trip is not running');
  END IF;

  -- An RFID UID is normalised the same way it was at registration; a QR token
  -- is taken verbatim, because its case is part of it.
  v_hash := CASE WHEN p_method IN ('rfid', 'nfc')
                 THEN encode(sha256(upper(trim(p_token))::BYTEA), 'hex')
                 ELSE encode(sha256(p_token::BYTEA), 'hex') END;

  SELECT c.id, c.student_id, c.active, c.revoked_at INTO v_cred
  FROM public.transport_student_credentials c WHERE c.token_hash = v_hash;

  IF v_cred.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Card not recognised');
  END IF;
  IF NOT v_cred.active OR v_cred.revoked_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'That card has been cancelled');
  END IF;

  SELECT p.student_id, p.state, pr.full_name INTO v_pax
  FROM public.transport_run_passengers p
  JOIN public.profiles pr ON pr.id = p.student_id
  WHERE p.run_id = p_run AND p.student_id = v_cred.student_id;

  IF v_pax.student_id IS NULL THEN
    SELECT full_name INTO v_name FROM public.profiles WHERE id = v_cred.student_id;
    -- Not on this bus is a real answer, and a loud one: it is the wrong-bus
    -- case, which is the whole reason anyone wants a card reader.
    RETURN jsonb_build_object(
      'ok', false, 'error', 'Not on this trip',
      'student_id', v_cred.student_id, 'student_name', v_name, 'wrong_bus', true);
  END IF;

  v_event := CASE
    WHEN v_run.direction = 'inbound' THEN 'board'
    -- Outbound: aboard at the school gate, off at a stop. A child already
    -- marked boarded who scans again at their stop is getting off.
    WHEN v_pax.state IN ('boarded') THEN 'alight'
    ELSE 'board'
  END;

  v_result := public.transport_mark_boarding(
    p_run, v_cred.student_id, v_event, p_stop, p_method, NULL);

  UPDATE public.transport_student_credentials
     SET last_used_at = NOW() WHERE id = v_cred.id;

  RETURN v_result
    || jsonb_build_object(
         'student_id', v_cred.student_id,
         'student_name', v_pax.full_name,
         'event', v_event);
END $fn$;
REVOKE EXECUTE ON FUNCTION public.transport_scan_boarding(UUID, TEXT, public.transport_scan_method, UUID)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transport_scan_boarding(UUID, TEXT, public.transport_scan_method, UUID)
  TO authenticated;

GRANT SELECT ON public.transport_student_credentials TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.transport_student_credentials TO authenticated;

NOTIFY pgrst, 'reload schema';
