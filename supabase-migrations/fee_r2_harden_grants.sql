-- ============================================================================
-- fee_r2_harden_grants — close the PUBLIC execute grant on internal functions
-- ============================================================================
-- Round 2 of docs/fee-upgrade-plan.md. Run last. Safe to re-run.
--
-- A real defect, found by Supabase's own security advisor and confirmed against
-- pg_proc: `REVOKE EXECUTE ... FROM anon, authenticated` does nothing while
-- PostgreSQL's default grant of EXECUTE to PUBLIC is still in place. Every
-- fee function created by Rounds 1 and 2 was therefore reachable over
-- /rest/v1/rpc/... by any signed-in user, and some by an anonymous one.
--
-- That is not cosmetic. `fee_post_ledger` is SECURITY DEFINER with no internal
-- permission check because it is only ever meant to be called from inside
-- fee_collect and its siblings — reachable from the API, it would let anyone
-- forge ledger entries and a running balance. `fee_next_number` would let
-- anyone burn receipt numbers and open gaps in a statutory series.
--
-- The rule this migration establishes, and which every later round must follow:
--
--   REVOKE FROM PUBLIC first, then GRANT to exactly the roles that need it.
--
-- Functions fall into three groups:
--
--   internal   only ever called from another function or a trigger
--   guarded    client-callable, and each checks fee_requires() itself
--   public     fee_verify_document, deliberately reachable without a login so
--              anyone holding a printed receipt can check it
-- ============================================================================

-- ── Internal: no client role may call these at all ──────────────────────
DO $$
DECLARE
  fn TEXT;
  internal TEXT[] := ARRAY[
    'fee_next_number(text,uuid)',
    'fee_post_ledger(uuid,uuid,text,numeric,numeric,text,uuid,text,date)',
    'fee_seal_receipt(uuid)',
    'fee_receipt_payload(uuid)',
    'fee_refresh_invoice(uuid)',
    'fee_mark_overdue()',
    'fee_autogen_tick()',
    'fee_overdue_tick()',
    'fee_log(text,text,uuid,uuid,uuid,jsonb,jsonb,text,numeric)',
    'ensure_academic_year(text,date,date)',
    -- Trigger functions. Nothing outside the trigger should ever invoke them.
    'fee_invoice_lines_refresh()',
    'fee_alloc_refresh()',
    'fee_payment_status_refresh()',
    'fee_payments_immutable()',
    'fee_payments_no_delete()',
    'fee_ledger_append_only()',
    'fee_audit_append_only()',
    'fee_settings_freeze_published()',
    'fee_refresh_structure_total()',
    'fee_guard_permission_lockout()'
  ];
BEGIN
  FOREACH fn IN ARRAY internal LOOP
    IF to_regprocedure('public.' || fn) IS NOT NULL THEN
      EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', fn);
    END IF;
  END LOOP;
END$$;

-- ── Guarded: client-callable, each checks its own permission ────────────
DO $$
DECLARE
  fn TEXT;
  guarded TEXT[] := ARRAY[
    'fee_collect(uuid,uuid,numeric,text,jsonb,date,text,text,jsonb,text)',
    'fee_reverse_payment(uuid,text)',
    'fee_instrument_transition(uuid,text,text,numeric)',
    'fee_create_profiles(uuid,uuid[],uuid,boolean)',
    'fee_generate_invoices(uuid,boolean,boolean,uuid[])',
    'fee_import_bus_ledger(uuid,boolean)',
    'fee_sync_transport_heads(uuid)',
    'fee_clone_year(uuid,uuid)',
    'fee_save_setting(text,jsonb,uuid,text)',
    'apply_fee_permission_preset(uuid,text)',
    'set_active_academic_year(uuid)'
  ];
BEGIN
  FOREACH fn IN ARRAY guarded LOOP
    IF to_regprocedure('public.' || fn) IS NOT NULL THEN
      EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', fn);
      EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', fn);
    END IF;
  END LOOP;
END$$;

-- ── Read-only: safe for any signed-in user to ask about themselves ──────
DO $$
DECLARE
  fn TEXT;
  readable TEXT[] := ARRAY[
    'has_fee_permission(text)',
    'has_fee_permission_for(uuid,text)',
    'my_fee_permissions()',
    'fee_requires(text)',
    'fee_is_service_context()',
    'fee_visible_amount(numeric)',
    'fee_setting(text,uuid,date)'
  ];
BEGIN
  FOREACH fn IN ARRAY readable LOOP
    IF to_regprocedure('public.' || fn) IS NOT NULL THEN
      EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon', fn);
      EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', fn);
    END IF;
  END LOOP;
END$$;

-- ── Date helpers: pure, no data, safe for anyone ────────────────────────
-- They also get a pinned search_path. They are not SECURITY DEFINER, but
-- fee_visible_amount is called inside the masking views, which run as the
-- invoker — an unpinned search_path there would let a caller who can create a
-- function shadow has_fee_permission and unmask every amount.
CREATE OR REPLACE FUNCTION public.fee_visible_amount(p_amount NUMERIC)
RETURNS NUMERIC LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT CASE WHEN public.has_fee_permission('fees.view_amounts') THEN p_amount END;
$$;

CREATE OR REPLACE FUNCTION public.fee_is_service_context()
RETURNS BOOLEAN LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT current_user IN ('service_role', 'postgres', 'supabase_admin');
$$;

CREATE OR REPLACE FUNCTION public.normalize_academic_year_code(p_code TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE
    WHEN p_code IS NULL THEN NULL
    WHEN p_code ~ '^\d{4}-\d{2}$'   THEN p_code
    WHEN p_code ~ '^\d{4}-\d{4}$'   THEN left(p_code, 5) || right(p_code, 2)
    WHEN p_code ~ '^\d{4}$'         THEN p_code || '-' || lpad(((substring(p_code, 1, 4)::INT + 1) % 100)::TEXT, 2, '0')
    ELSE p_code
  END;
$$;

CREATE OR REPLACE FUNCTION public.academic_year_code_for(p_date DATE)
RETURNS TEXT LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE WHEN EXTRACT(MONTH FROM p_date) >= 4
              THEN EXTRACT(YEAR FROM p_date)::INT
              ELSE EXTRACT(YEAR FROM p_date)::INT - 1
         END::TEXT
      || '-'
      || lpad(((CASE WHEN EXTRACT(MONTH FROM p_date) >= 4
                     THEN EXTRACT(YEAR FROM p_date)::INT
                     ELSE EXTRACT(YEAR FROM p_date)::INT - 1
                END + 1) % 100)::TEXT, 2, '0');
$$;

CREATE OR REPLACE FUNCTION public.current_academic_year()
RETURNS TEXT LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT code FROM public.academic_years WHERE is_active LIMIT 1),
    public.academic_year_code_for(CURRENT_DATE));
$$;

CREATE OR REPLACE FUNCTION public.current_academic_year_id()
RETURNS UUID LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT id FROM public.academic_years WHERE is_active LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.academic_year_id_for(p_date DATE)
RETURNS UUID LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT id FROM public.academic_years WHERE p_date BETWEEN starts_on AND ends_on LIMIT 1),
    (SELECT id FROM public.academic_years WHERE code = public.academic_year_code_for(p_date) LIMIT 1));
$$;

DO $$
DECLARE
  fn TEXT;
  pure TEXT[] := ARRAY[
    'normalize_academic_year_code(text)',
    'academic_year_code_for(date)',
    'current_academic_year()',
    'current_academic_year_id()',
    'academic_year_id_for(date)'
  ];
BEGIN
  FOREACH fn IN ARRAY pure LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO anon, authenticated', fn);
  END LOOP;
END$$;

-- ── Public: the receipt QR anyone can scan ──────────────────────────────
REVOKE ALL ON FUNCTION public.fee_verify_document(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fee_verify_document(TEXT) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
