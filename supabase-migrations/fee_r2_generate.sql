-- ============================================================================
-- fee_r2_generate — bulk profile creation and invoice generation, with preview
-- ============================================================================
-- Round 2 of docs/fee-upgrade-plan.md. Run after fee_r2_ledger.sql.
-- Safe to re-run.
--
-- Both operations here are bulk and both have a preview mode that runs exactly
-- the same query as the commit. That is the invariant: a screen saying "will
-- create 412, skip 44" and a run that then creates a different number is the
-- fastest way to lose a school's trust, so `p_commit = false` walks the same
-- path and simply does not write.
--
-- Generation deliberately does *not* re-resolve the structure. The profile
-- pinned one when it was created; re-resolving would mean publishing a revised
-- structure in November silently re-prices bills already sent in April.

-- ── Bulk profile creation ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fee_create_profiles(
  p_year       UUID,
  p_student_ids UUID[] DEFAULT NULL,   -- null = every active student
  p_group      UUID DEFAULT NULL,      -- null = the year's default group
  p_commit     BOOLEAN DEFAULT false
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_group    UUID;
  v_created  INT := 0;
  v_existing INT := 0;
  v_rte      INT := 0;
  v_no_struct INT := 0;
  v_s        RECORD;
  v_struct   UUID;
  v_source   JSONB;
  v_is_rte   BOOLEAN;
  v_assigned UUID;
  v_prorate  DATE;
BEGIN
  IF NOT public.fee_requires('fees.profile.create') THEN
    RAISE EXCEPTION 'You do not have permission to create fee profiles';
  END IF;

  v_group := COALESCE(p_group,
    (SELECT id FROM public.fee_groups WHERE academic_year_id = p_year AND is_default LIMIT 1));
  IF v_group IS NULL THEN
    RAISE EXCEPTION 'This session has no default fee group. Add one in Fee Configuration first.';
  END IF;

  FOR v_s IN
    SELECT p.id, p.grade, p.full_name
      FROM public.profiles p
     WHERE p.role = 'student'
       AND COALESCE(p.is_banned, false) = false
       AND (p_student_ids IS NULL OR p.id = ANY(p_student_ids))
  LOOP
    IF EXISTS (SELECT 1 FROM public.fee_profiles f
                WHERE f.student_id = v_s.id AND f.academic_year_id = p_year) THEN
      v_existing := v_existing + 1;
      CONTINUE;
    END IF;

    -- An explicit assignment beats the group passed in: a student already put
    -- in RTE or Staff Ward must not be swept into Regular by a bulk run.
    SELECT fee_group_id, is_rte, prorate_from INTO v_assigned, v_is_rte, v_prorate
      FROM public.fee_group_assignments
     WHERE student_id = v_s.id AND academic_year_id = p_year;

    v_assigned := COALESCE(v_assigned, v_group);
    v_is_rte := COALESCE(v_is_rte,
      (SELECT is_rte FROM public.fee_groups WHERE id = v_assigned), false);

    IF v_is_rte THEN
      v_rte := v_rte + 1;
      -- Still gets a profile: the RTE register needs one to hang off, and a
      -- student with no profile is invisible to every screen in the module.
    END IF;

    -- Structure resolution, most specific first, mirroring
    -- src/lib/fees/engine/structure.ts so the two cannot disagree.
    SELECT id, jsonb_build_object('rank', 0, 'why',
        format('Assigned to the %s group, which prices grade %s separately.',
               (SELECT name FROM public.fee_groups WHERE id = v_assigned), v_s.grade))
      INTO v_struct, v_source
      FROM public.fee_structures
     WHERE fee_group_id = v_assigned AND grade = v_s.grade AND status = 'published';

    IF v_struct IS NULL THEN
      SELECT id, jsonb_build_object('rank', 1, 'why',
          format('Assigned to the %s group, which uses one structure for every grade.',
                 (SELECT name FROM public.fee_groups WHERE id = v_assigned)))
        INTO v_struct, v_source
        FROM public.fee_structures
       WHERE fee_group_id = v_assigned AND grade IS NULL AND status = 'published';
    END IF;

    IF v_struct IS NULL AND v_assigned <> v_group THEN
      SELECT id, jsonb_build_object('rank', 2, 'why',
          'That group has no structure, so the default group applies.')
        INTO v_struct, v_source
        FROM public.fee_structures
       WHERE fee_group_id = v_group
         AND (grade = v_s.grade OR grade IS NULL) AND status = 'published'
       ORDER BY (grade IS NOT NULL) DESC LIMIT 1;
    END IF;

    IF v_struct IS NULL AND NOT v_is_rte THEN
      v_no_struct := v_no_struct + 1;
    END IF;

    IF p_commit THEN
      INSERT INTO public.fee_profiles (
        student_id, academic_year_id, fee_group_id, structure_id, structure_source,
        is_rte, prorate_from, created_by)
      VALUES (v_s.id, p_year, v_assigned, v_struct, v_source, v_is_rte, v_prorate,
              (SELECT auth.uid()))
      ON CONFLICT (student_id, academic_year_id) DO NOTHING;
    END IF;

    v_created := v_created + 1;
  END LOOP;

  IF p_commit THEN
    PERFORM public.fee_log('profile.bulk_create', 'fee_profiles', NULL, NULL, p_year,
                           NULL, jsonb_build_object('created', v_created), NULL, NULL);
  END IF;

  RETURN jsonb_build_object(
    'committed', p_commit,
    'created', v_created,
    'skipped_existing', v_existing,
    'rte', v_rte,
    'without_structure', v_no_struct);
END $$;

-- ── Invoice generation ──────────────────────────────────────────────────
-- One installment, every eligible profile. Idempotent through the partial
-- unique index on (profile_id, installment_id): a second run finds the bill
-- already there and skips it rather than billing the family twice.
CREATE OR REPLACE FUNCTION public.fee_generate_invoices(
  p_installment UUID,
  p_commit      BOOLEAN DEFAULT false,
  p_autogen     BOOLEAN DEFAULT false,
  p_profile_ids UUID[] DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inst      public.fee_installments%ROWTYPE;
  v_struct    public.fee_structures%ROWTYPE;
  v_year      UUID;
  v_total     NUMERIC(12,2);
  v_claim     NUMERIC(12,2);
  v_created   INT := 0;
  v_existing  INT := 0;
  v_skipped   INT := 0;
  v_rte       INT := 0;
  v_amount    NUMERIC(12,2) := 0;
  v_p         RECORD;
  v_invoice   UUID;
  v_seq       BIGINT;
  v_number    TEXT;
  v_item      RECORD;
  v_line      NUMERIC(12,2);
  v_allocated NUMERIC(12,2);
  v_explicit  BOOLEAN;
  v_by_group  JSONB := '{}'::JSONB;
  v_gname     TEXT;
BEGIN
  IF NOT public.fee_requires('fees.invoice.generate') THEN
    RAISE EXCEPTION 'You do not have permission to generate bills';
  END IF;

  SELECT * INTO v_inst FROM public.fee_installments WHERE id = p_installment;
  IF NOT FOUND THEN RAISE EXCEPTION 'No such installment'; END IF;

  SELECT * INTO v_struct FROM public.fee_structures WHERE id = v_inst.structure_id;
  v_year := v_struct.academic_year_id;

  IF v_struct.status <> 'published' THEN
    RAISE EXCEPTION 'That structure is a %, and a draft is never billed from', v_struct.status;
  END IF;

  SELECT COALESCE(SUM(amount), 0) INTO v_total
    FROM public.fee_structure_items WHERE structure_id = v_struct.id;

  SELECT EXISTS (SELECT 1 FROM public.fee_installment_items WHERE installment_id = p_installment)
    INTO v_explicit;

  IF v_explicit THEN
    SELECT COALESCE(SUM(amount), 0) INTO v_claim
      FROM public.fee_installment_items WHERE installment_id = p_installment;
  ELSIF v_inst.amount IS NOT NULL THEN
    v_claim := v_inst.amount;
  ELSIF v_inst.percent IS NOT NULL THEN
    v_claim := ROUND(v_total * v_inst.percent / 100, 2);
  ELSE
    -- Equal share of whatever the other installments have not claimed.
    SELECT ROUND((v_total - COALESCE(SUM(
             CASE WHEN i.amount IS NOT NULL THEN i.amount
                  WHEN i.percent IS NOT NULL THEN v_total * i.percent / 100
                  ELSE 0 END), 0))
           / GREATEST(COUNT(*) FILTER (WHERE i.amount IS NULL AND i.percent IS NULL), 1), 2)
      INTO v_claim
      FROM public.fee_installments i WHERE i.structure_id = v_struct.id;
  END IF;

  FOR v_p IN
    SELECT f.id, f.student_id, f.is_rte, f.prorate_from, pr.full_name,
           g.name AS group_name
      FROM public.fee_profiles f
      JOIN public.profiles pr ON pr.id = f.student_id
      LEFT JOIN public.fee_groups g ON g.id = f.fee_group_id
     WHERE f.academic_year_id = v_year
       AND f.structure_id = v_struct.id
       AND f.status = 'active'
       AND (p_profile_ids IS NULL OR f.id = ANY(p_profile_ids))
  LOOP
    v_gname := COALESCE(v_p.group_name, 'Unassigned');

    IF v_p.is_rte THEN
      v_rte := v_rte + 1;
      CONTINUE;
    END IF;

    IF EXISTS (SELECT 1 FROM public.fee_invoices
                WHERE profile_id = v_p.id AND installment_id = p_installment
                  AND status <> 'cancelled') THEN
      v_existing := v_existing + 1;
      CONTINUE;
    END IF;

    -- A joiner whose term ended before they arrived is skipped rather than
    -- billed zero: a ₹0 bill is noise on a statement and on WhatsApp.
    IF v_p.prorate_from IS NOT NULL AND v_p.prorate_from > v_inst.due_date THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    v_amount := v_amount + v_claim;
    v_by_group := jsonb_set(v_by_group, ARRAY[v_gname],
      to_jsonb(COALESCE((v_by_group ->> v_gname)::INT, 0) + 1), true);

    IF p_commit THEN
      SELECT seq, formatted INTO v_seq, v_number FROM public.fee_next_number('invoice', v_year);

      INSERT INTO public.fee_invoices (
        profile_id, student_id, academic_year_id, installment_id,
        number, seq, issue_date, due_date, autogen, created_by, status)
      VALUES (v_p.id, v_p.student_id, v_year, p_installment,
              v_number, v_seq, CURRENT_DATE, v_inst.due_date, p_autogen,
              (SELECT auth.uid()), 'pending')
      RETURNING id INTO v_invoice;

      -- Lines: the named heads if the installment listed any, otherwise the
      -- claim spread across the structure's heads in proportion to their cost,
      -- so a bill is itemised rather than one opaque "Term 1".
      v_allocated := 0;
      IF v_explicit THEN
        FOR v_item IN
          SELECT ii.fee_head_id, ii.amount, h.name, h.tax_rate, h.sort
            FROM public.fee_installment_items ii
            JOIN public.fee_heads h ON h.id = ii.fee_head_id
           WHERE ii.installment_id = p_installment
           ORDER BY h.sort
        LOOP
          INSERT INTO public.fee_invoice_lines (
            invoice_id, kind, fee_head_id, label, amount, tax_rate, sort)
          VALUES (v_invoice, 'fee', v_item.fee_head_id, v_item.name,
                  v_item.amount, v_item.tax_rate, v_item.sort);
        END LOOP;
      ELSE
        FOR v_item IN
          SELECT si.fee_head_id, si.amount, si.sort, h.name, h.tax_rate,
                 ROW_NUMBER() OVER (ORDER BY si.sort) AS rn,
                 COUNT(*) OVER () AS total_rows
            FROM public.fee_structure_items si
            JOIN public.fee_heads h ON h.id = si.fee_head_id
           WHERE si.structure_id = v_struct.id
           ORDER BY si.sort
        LOOP
          -- The last line absorbs the rounding remainder, so the lines always
          -- add up to the claim exactly.
          IF v_item.rn = v_item.total_rows THEN
            v_line := v_claim - v_allocated;
          ELSE
            v_line := ROUND(v_claim * v_item.amount / NULLIF(v_total, 0), 2);
            v_allocated := v_allocated + v_line;
          END IF;

          INSERT INTO public.fee_invoice_lines (
            invoice_id, kind, fee_head_id, label, amount, tax_rate, sort)
          VALUES (v_invoice, 'fee', v_item.fee_head_id, v_item.name,
                  v_line, v_item.tax_rate, v_item.sort);
        END LOOP;
      END IF;

      PERFORM public.fee_post_ledger(
        v_p.student_id, v_year, 'invoice',
        (SELECT COALESCE(SUM(amount), 0) FROM public.fee_invoice_lines WHERE invoice_id = v_invoice),
        0, 'fee_invoices', v_invoice, format('Bill %s — %s', v_number, v_inst.name));
    END IF;

    v_created := v_created + 1;
  END LOOP;

  IF p_commit THEN
    PERFORM public.fee_log(
      CASE WHEN p_autogen THEN 'invoice.autogen' ELSE 'invoice.generate' END,
      'fee_installments', p_installment, NULL, v_year, NULL,
      jsonb_build_object('created', v_created, 'installment', v_inst.name), NULL, v_amount);
  END IF;

  RETURN jsonb_build_object(
    'committed', p_commit,
    'installment', v_inst.name,
    'due_date', v_inst.due_date,
    'per_student', v_claim,
    'will_create', v_created,
    'already_billed', v_existing,
    'skipped_joined_late', v_skipped,
    'skipped_rte', v_rte,
    'total_amount', v_amount,
    'by_group', v_by_group);
END $$;

GRANT EXECUTE ON FUNCTION public.fee_create_profiles(UUID, UUID[], UUID, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fee_generate_invoices(UUID, BOOLEAN, BOOLEAN, UUID[]) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.fee_create_profiles(UUID, UUID[], UUID, BOOLEAN) FROM anon;
REVOKE EXECUTE ON FUNCTION public.fee_generate_invoices(UUID, BOOLEAN, BOOLEAN, UUID[]) FROM anon;

NOTIFY pgrst, 'reload schema';
