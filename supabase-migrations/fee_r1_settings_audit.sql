-- ============================================================================
-- fee_r1_settings_audit — versioned fee settings, and an append-only audit log
-- ============================================================================
-- Round 1 of docs/fee-upgrade-plan.md. Run after fee_r1_config.sql.
-- Safe to re-run.
--
-- Settings are versioned rows rather than a JSON blob in `site_settings`.
-- The reason is narrow and important: if a school turns "partial payments
-- allowed" off in October, a receipt printed in September must still be able to
-- say what the rules were when it was issued. A blob that is overwritten in
-- place silently rewrites history; effective-dated rows do not. This is the
-- same lesson `payroll_rule_sets` learned, and the freeze trigger below is that
-- table's `freeze_published` trigger applied here.
--
-- Secrets never come here. `site_settings` is world-readable and this table is
-- permission-readable, so bank and WhatsApp credentials stay in the admin-only
-- `payment_secrets` / `integration_secrets` tables, exactly as
-- src/lib/bankConfig.ts already documents.

-- ── fee_settings ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.fee_settings (
  id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  -- NULL = applies to every year. A row naming a year overrides the global one.
  academic_year_id UUID REFERENCES public.academic_years(id) ON DELETE CASCADE,
  key              TEXT NOT NULL,
  value            JSONB NOT NULL,
  effective_from   DATE NOT NULL DEFAULT CURRENT_DATE,
  effective_to     DATE,
  version          INT  NOT NULL DEFAULT 1,
  status           TEXT NOT NULL DEFAULT 'published'
                   CHECK (status IN ('draft', 'published', 'superseded')),
  notes            TEXT,
  created_by       UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  published_by     UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  published_at     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

CREATE INDEX IF NOT EXISTS idx_fee_settings_key  ON public.fee_settings(key, status);
CREATE INDEX IF NOT EXISTS idx_fee_settings_year ON public.fee_settings(academic_year_id);

-- At most one live published row per (scope, key). Two would make
-- fee_setting() ambiguous, and an ambiguous rule is worse than no rule.
CREATE UNIQUE INDEX IF NOT EXISTS idx_fee_settings_one_live_global
  ON public.fee_settings(key)
  WHERE status = 'published' AND effective_to IS NULL AND academic_year_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_fee_settings_one_live_year
  ON public.fee_settings(academic_year_id, key)
  WHERE status = 'published' AND effective_to IS NULL AND academic_year_id IS NOT NULL;

-- A published row is history. Only closing it off (effective_to) or marking it
-- superseded is allowed; the value itself is frozen.
CREATE OR REPLACE FUNCTION public.fee_settings_freeze_published()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF OLD.status = 'published' THEN
    IF NEW.value IS DISTINCT FROM OLD.value
       OR NEW.key IS DISTINCT FROM OLD.key
       OR NEW.academic_year_id IS DISTINCT FROM OLD.academic_year_id
       OR NEW.effective_from IS DISTINCT FROM OLD.effective_from THEN
      RAISE EXCEPTION
        'A published fee setting cannot be edited. Save a new version instead.';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS fee_settings_freeze ON public.fee_settings;
CREATE TRIGGER fee_settings_freeze BEFORE UPDATE ON public.fee_settings
  FOR EACH ROW EXECUTE FUNCTION public.fee_settings_freeze_published();

-- ── Resolution ──────────────────────────────────────────────────────────
-- Year-specific beats global; live beats closed. Returns the JSONB value or
-- NULL, so callers coalesce to their own default rather than the database
-- inventing one.
CREATE OR REPLACE FUNCTION public.fee_setting(
  p_key TEXT,
  p_year UUID DEFAULT NULL,
  p_on   DATE DEFAULT NULL
)
RETURNS JSONB
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT s.value
    FROM public.fee_settings s
   WHERE s.key = p_key
     AND s.status = 'published'
     AND s.effective_from <= COALESCE(p_on, CURRENT_DATE)
     AND (s.effective_to IS NULL OR s.effective_to >= COALESCE(p_on, CURRENT_DATE))
     AND (s.academic_year_id IS NULL OR s.academic_year_id = COALESCE(p_year, public.current_academic_year_id()))
   -- Ordering, most significant first: a year-specific row beats the global
   -- one; a later effective_from beats an earlier one; and when a value was
   -- replaced on the same day both rows cover today, so the still-live row and
   -- then the higher version win. Without those last two the resolver returns
   -- whichever row the planner happened to reach first.
   ORDER BY (s.academic_year_id IS NOT NULL) DESC,
            s.effective_from DESC,
            (s.effective_to IS NULL) DESC,
            s.version DESC
   LIMIT 1;
$$;

-- Saving closes the current version and opens a new one the same day, so the
-- old value stays readable with an as-of date.
CREATE OR REPLACE FUNCTION public.fee_save_setting(
  p_key TEXT,
  p_value JSONB,
  p_year UUID DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prev    public.fee_settings%ROWTYPE;
  v_version INT := 1;
  v_id      UUID;
BEGIN
  IF NOT public.fee_requires('fees.settings.manage') THEN
    RAISE EXCEPTION 'You do not have permission to change fee settings';
  END IF;

  SELECT * INTO v_prev
    FROM public.fee_settings
   WHERE key = p_key
     AND academic_year_id IS NOT DISTINCT FROM p_year
     AND status = 'published' AND effective_to IS NULL;

  IF FOUND THEN
    -- Nothing changed: don't churn a new version for a no-op save.
    IF v_prev.value = p_value THEN RETURN v_prev.id; END IF;

    v_version := v_prev.version + 1;
    UPDATE public.fee_settings
       SET status = 'superseded',
           effective_to = GREATEST(effective_from, CURRENT_DATE - 1)
     WHERE id = v_prev.id;
  END IF;

  INSERT INTO public.fee_settings (academic_year_id, key, value, version, status,
                                   notes, created_by, published_by, published_at)
  VALUES (p_year, p_key, p_value, v_version, 'published',
          p_notes, (SELECT auth.uid()), (SELECT auth.uid()), NOW())
  RETURNING id INTO v_id;

  RETURN v_id;
END $$;

-- ── Defaults ────────────────────────────────────────────────────────────
INSERT INTO public.fee_settings (academic_year_id, key, value, status, notes)
SELECT NULL, d.key, d.value, 'published', 'Shipped default'
  FROM (VALUES
    ('numbering', jsonb_build_object(
        'school_code', 'MPS',
        'separator',   '/',
        'invoice', jsonb_build_object('prefix', 'INV', 'width', 4, 'include_year', true, 'reset', 'year'),
        'receipt', jsonb_build_object('prefix', 'RCP', 'width', 4, 'include_year', true, 'reset', 'year'))),

    -- Partial payments are allowed by default because refusing them is what
    -- pushes families into paying nothing at all.
    ('payment_rules', jsonb_build_object(
        'partial_allowed',            true,
        'min_partial_amount',         0,
        'allow_overpayment',          true,
        'overpayment_becomes_credit', true,
        'allocation_order',           'oldest_due_first',
        'allow_backdated_days',       30)),

    ('grace', jsonb_build_object('days', 0)),

    ('approval_thresholds', jsonb_build_object(
        'discount', 5000, 'waiver', 0, 'refund', 0)),

    -- Off by default, and Round 3 only ever starts counting from the day it is
    -- switched on. Nothing here reaches backwards.
    ('reminders', jsonb_build_object(
        'enabled',      false,
        'send_at',      '10:00',
        'offsets',      jsonb_build_array(-3, 0, 7, 14),
        'channels',     jsonb_build_array('whatsapp'),
        'skip_if_paid', true,
        'quiet_days',   jsonb_build_array())),

    -- Non-secret mirror only. The token, app secret and verify token live in
    -- integration_secrets, which is admin-only and never world-readable.
    ('whatsapp', jsonb_build_object(
        'enabled',           false,
        'phone_number_id',   '',
        'waba_id',           '',
        'display_number',    '',
        'credentials_saved', false,
        'webhook_verified',  false)),

    ('masking', jsonb_build_object('enabled', true))
  ) AS d(key, value)
 WHERE NOT EXISTS (
   SELECT 1 FROM public.fee_settings s
    WHERE s.key = d.key AND s.academic_year_id IS NULL AND s.status = 'published');

-- ── fee_audit_log ───────────────────────────────────────────────────────
-- Append-only. There is no UPDATE or DELETE policy, and the trigger refuses
-- both even to a service-role caller, so "who reversed that payment, and what
-- did it say before?" always has an answer. This is as much protection for a
-- clerk accused of pocketing counter cash as it is for the school.
CREATE TABLE IF NOT EXISTS public.fee_audit_log (
  id               BIGSERIAL PRIMARY KEY,
  actor_id         UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  action           TEXT NOT NULL,            -- 'payment.reverse', 'discount.apply', ...
  entity           TEXT NOT NULL,            -- table name the action landed on
  entity_id        UUID,
  student_id       UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  academic_year_id UUID REFERENCES public.academic_years(id) ON DELETE SET NULL,
  before           JSONB,
  after            JSONB,
  reason           TEXT,
  amount           NUMERIC(12,2),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fee_audit_created ON public.fee_audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_fee_audit_student ON public.fee_audit_log(student_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_fee_audit_entity  ON public.fee_audit_log(entity, entity_id);
CREATE INDEX IF NOT EXISTS idx_fee_audit_actor   ON public.fee_audit_log(actor_id, created_at DESC);

-- An entry is never editable, by anyone, including a service-role caller: an
-- audit trail that can be corrected is not one. Deletion is allowed in exactly
-- one case — a maintenance job pruning entries past the seven-year statutory
-- retention window — because "keep forever" is a promise the disk eventually
-- breaks, and a rule with a stated exception is safer than one people work
-- around by disabling the trigger.
CREATE OR REPLACE FUNCTION public.fee_audit_append_only()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'The fee activity log is append-only and cannot be edited';
  END IF;

  IF NOT public.fee_is_service_context() THEN
    RAISE EXCEPTION 'The fee activity log cannot be deleted from';
  END IF;

  IF OLD.created_at > NOW() - INTERVAL '7 years' THEN
    RAISE EXCEPTION
      'Fee activity entries are kept for seven years; this one is from %',
      OLD.created_at::DATE;
  END IF;

  RETURN OLD;
END $$;

DROP TRIGGER IF EXISTS fee_audit_no_update ON public.fee_audit_log;
CREATE TRIGGER fee_audit_no_update BEFORE UPDATE OR DELETE ON public.fee_audit_log
  FOR EACH ROW EXECUTE FUNCTION public.fee_audit_append_only();

-- The one way anything writes to the log. Every fee RPC from Round 2 onward
-- calls this rather than inserting directly, so the shape stays consistent.
CREATE OR REPLACE FUNCTION public.fee_log(
  p_action  TEXT,
  p_entity  TEXT,
  p_entity_id UUID DEFAULT NULL,
  p_student UUID DEFAULT NULL,
  p_year    UUID DEFAULT NULL,
  p_before  JSONB DEFAULT NULL,
  p_after   JSONB DEFAULT NULL,
  p_reason  TEXT DEFAULT NULL,
  p_amount  NUMERIC DEFAULT NULL
)
RETURNS BIGINT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_id BIGINT;
BEGIN
  INSERT INTO public.fee_audit_log (actor_id, action, entity, entity_id, student_id,
                                    academic_year_id, before, after, reason, amount)
  VALUES ((SELECT auth.uid()), p_action, p_entity, p_entity_id, p_student,
          COALESCE(p_year, public.current_academic_year_id()),
          p_before, p_after, p_reason, p_amount)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- ── RLS ─────────────────────────────────────────────────────────────────
ALTER TABLE public.fee_settings  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fee_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read fee settings" ON public.fee_settings;
CREATE POLICY "Read fee settings" ON public.fee_settings
  FOR SELECT TO authenticated USING (public.has_fee_permission('fees.view'));

DROP POLICY IF EXISTS "Manage fee settings" ON public.fee_settings;
CREATE POLICY "Manage fee settings" ON public.fee_settings
  FOR ALL TO authenticated
  USING (public.has_fee_permission('fees.settings.manage'))
  WITH CHECK (public.has_fee_permission('fees.settings.manage'));

DROP POLICY IF EXISTS "Read fee audit log" ON public.fee_audit_log;
CREATE POLICY "Read fee audit log" ON public.fee_audit_log
  FOR SELECT TO authenticated USING (public.has_fee_permission('fees.audit.view'));

-- No INSERT policy on purpose: everything writes through fee_log(), which is
-- SECURITY DEFINER. A client cannot forge or backdate an entry.

GRANT SELECT, INSERT, UPDATE, DELETE ON public.fee_settings TO authenticated;
GRANT SELECT ON public.fee_audit_log TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.fee_audit_log_id_seq TO authenticated;

GRANT EXECUTE ON FUNCTION public.fee_setting(TEXT, UUID, DATE)                     TO authenticated;
GRANT EXECUTE ON FUNCTION public.fee_save_setting(TEXT, JSONB, UUID, TEXT)         TO authenticated;
GRANT EXECUTE ON FUNCTION public.fee_log(TEXT, TEXT, UUID, UUID, UUID, JSONB, JSONB, TEXT, NUMERIC) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.fee_setting(TEXT, UUID, DATE)             FROM anon;
REVOKE EXECUTE ON FUNCTION public.fee_save_setting(TEXT, JSONB, UUID, TEXT) FROM anon;
REVOKE EXECUTE ON FUNCTION public.fee_log(TEXT, TEXT, UUID, UUID, UUID, JSONB, JSONB, TEXT, NUMERIC) FROM anon;

NOTIFY pgrst, 'reload schema';
