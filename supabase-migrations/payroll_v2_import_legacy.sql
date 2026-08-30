-- ============================================================================
-- payroll_v2_import_legacy — bring salary_* and driver_payroll_* into payroll_v2
-- ============================================================================
-- Run last, after every other payroll_v2_* migration. Safe to re-run: it skips
-- any period already imported.
--
-- What this does and does not do:
--   • It does NOT drop or alter the legacy tables. They stay readable so the old
--     screens keep opening while the new ones are rolled out.
--   • Each legacy cycle becomes one LOCKED payroll_run. Staff and drivers for
--     the same month land in the SAME run — that is the unification, and it is
--     why the unique index allows only one regular run per month.
--   • Line items are mapped to real components where the label is recognised.
--     Anything else goes to IMPORTED_ADJUSTMENT rather than being guessed at.
--     A label like 'Task bonus (June 2026) · 4 pts' carries its period in the
--     text and cannot be parsed reliably, so it is preserved verbatim in the
--     component name and its money is kept whole.
--   • No assignments are created. An imported line is a historical snapshot; it
--     already carries its own numbers, and inventing effective-dated assignments
--     for periods nobody will recalculate would only risk overlapping the real
--     ones a school enters afterwards.
--
-- Reconcile before retiring the old screens:
--   SELECT * FROM public.payroll_import_reconciliation;

-- ── Employee category backfill ──────────────────────────────────────────
-- profiles.role plus the cosmetic is_non_teaching flag is everything the app
-- currently knows about what kind of employee someone is.
INSERT INTO public.staff_details (staff_id, employee_category)
SELECT p.id,
       CASE
         WHEN p.role = 'driver' THEN 'transport'
         WHEN p.is_non_teaching THEN 'non_teaching'
         WHEN p.role IN ('teacher', 'coordinator', 'principal') THEN 'teaching'
         ELSE 'support'
       END
FROM public.profiles p
WHERE p.role IN ('teacher', 'coordinator', 'principal', 'driver', 'admin')
ON CONFLICT (staff_id) DO UPDATE
  SET employee_category = COALESCE(public.staff_details.employee_category, EXCLUDED.employee_category);

-- ── Statutory identity, moved off the legacy base tables ────────────────
INSERT INTO public.payroll_employee_statutory
  (employee_id, pf_applicable, eps_applicable, pf_wage_override, esi_override, uan, esi_ip_number, pan)
SELECT b.staff_id, b.pf_applicable, COALESCE(b.eps_applicable, true), b.pf_basic, b.esi_override,
       b.uan, b.esi_ip_number, d.pan_no
FROM public.staff_salary_base b
LEFT JOIN public.staff_details d ON d.staff_id = b.staff_id
ON CONFLICT (employee_id) DO NOTHING;

INSERT INTO public.payroll_employee_statutory
  (employee_id, pf_applicable, eps_applicable, pf_wage_override, esi_override, uan, esi_ip_number, pan)
SELECT b.driver_id, b.pf_applicable, COALESCE(b.eps_applicable, true), b.pf_basic, b.esi_override,
       b.uan, b.esi_ip_number, d.pan_no
FROM public.driver_payroll_base b
LEFT JOIN public.staff_details d ON d.staff_id = b.driver_id
ON CONFLICT (employee_id) DO NOTHING;

-- ── A structure to hang imported lines from ─────────────────────────────
-- One head, absorbing whatever the legacy base_amount was. It exists so an
-- imported line can name a structure at all; nothing recalculates against it.
INSERT INTO public.payroll_structures (code, name, version, status, effective_from, notes)
SELECT 'LEGACY', 'Imported from the legacy Salary Manager', 1, 'archived', '2000-01-01',
       'Synthetic. Imported cycles carry their own stored amounts and are never recalculated.'
WHERE NOT EXISTS (SELECT 1 FROM public.payroll_structures WHERE code = 'LEGACY');

INSERT INTO public.payroll_structure_components (structure_id, component_id, calc_type, value, sequence)
SELECT s.id, c.id, 'balance', NULL, 10
FROM public.payroll_structures s, public.payroll_components c
WHERE s.code = 'LEGACY' AND c.code = 'BASIC'
ON CONFLICT (structure_id, component_id) DO NOTHING;

INSERT INTO public.payroll_components (code, name, kind, calc_type, sequence, is_system, is_taxable, counts_for_esi, counts_for_pt, lop_applicable, prorate_on_join_exit)
VALUES ('IMPORTED_ADJUSTMENT', 'Imported adjustment', 'earning', 'fixed', 850, true, true, false, false, false, false)
ON CONFLICT (code) DO NOTHING;

-- ── The import ──────────────────────────────────────────────────────────
DO $$
DECLARE
  v_period RECORD;
  v_run UUID;
  v_struct UUID;
  v_hash TEXT;
BEGIN
  SELECT id INTO v_struct FROM public.payroll_structures WHERE code = 'LEGACY';

  FOR v_period IN
    SELECT period_year, period_month, MIN(created_at) AS created_at
    FROM (
      SELECT period_year, period_month, created_at FROM public.salary_cycles
      UNION ALL
      SELECT period_year, period_month, created_at FROM public.driver_payroll_cycles
    ) c
    GROUP BY period_year, period_month
    ORDER BY period_year, period_month
  LOOP
    -- Already imported? Leave it entirely alone.
    CONTINUE WHEN EXISTS (
      SELECT 1 FROM public.payroll_runs
      WHERE period_year = v_period.period_year AND period_month = v_period.period_month AND run_type = 'regular'
    );

    INSERT INTO public.payroll_runs
      (period_month, period_year, period_from, period_to, run_type, status, label, notes, created_at)
    VALUES (
      v_period.period_month, v_period.period_year,
      make_date(v_period.period_year, v_period.period_month, 1),
      (make_date(v_period.period_year, v_period.period_month, 1) + INTERVAL '1 month - 1 day')::date,
      'regular', 'draft',
      to_char(make_date(v_period.period_year, v_period.period_month, 1), 'FMMonth YYYY'),
      'Imported from the legacy Salary Manager. Figures are as they were paid; nothing was recalculated.',
      v_period.created_at
    )
    RETURNING id INTO v_run;

    -- Staff lines.
    INSERT INTO public.payroll_run_lines
      (run_id, employee_id, structure_id, gross_earnings, total_deductions, net_pay,
       payable_days, paid_days, lop_days, payout_status, payout_reference, inputs)
    SELECT
      v_run, r.staff_id, v_struct,
      r.base_amount + COALESCE(pos.total, 0),
      COALESCE(neg.total, 0),
      r.base_amount + COALESCE(pos.total, 0) - COALESCE(neg.total, 0),
      COALESCE(r.working_days_override, EXTRACT(DAY FROM (make_date(v_period.period_year, v_period.period_month, 1) + INTERVAL '1 month - 1 day'))),
      0, COALESCE(r.leave_override, 0) + COALESCE(r.late_override, 0),
      r.payout_status, r.payout_reference,
      jsonb_build_object('imported_from', 'salary_records', 'legacy_record_id', r.id, 'legacy_status', r.status)
    FROM public.salary_records r
    JOIN public.salary_cycles cy ON cy.id = r.cycle_id
    LEFT JOIN LATERAL (SELECT SUM(amount) AS total FROM public.salary_record_items i WHERE i.record_id = r.id AND i.amount > 0) pos ON true
    LEFT JOIN LATERAL (SELECT SUM(-amount) AS total FROM public.salary_record_items i WHERE i.record_id = r.id AND i.amount < 0) neg ON true
    WHERE cy.period_year = v_period.period_year AND cy.period_month = v_period.period_month
    ON CONFLICT (run_id, employee_id) DO NOTHING;

    -- Driver lines, into the same run.
    INSERT INTO public.payroll_run_lines
      (run_id, employee_id, structure_id, gross_earnings, total_deductions, net_pay,
       payable_days, paid_days, lop_days, payout_status, payout_reference, inputs)
    SELECT
      v_run, r.driver_id, v_struct,
      r.base_amount + COALESCE(pos.total, 0),
      COALESCE(neg.total, 0),
      r.base_amount + COALESCE(pos.total, 0) - COALESCE(neg.total, 0),
      COALESCE(r.working_days_override, EXTRACT(DAY FROM (make_date(v_period.period_year, v_period.period_month, 1) + INTERVAL '1 month - 1 day'))),
      0, COALESCE(r.leave_override, 0) + COALESCE(r.late_override, 0),
      r.payout_status, r.payout_reference,
      jsonb_build_object('imported_from', 'driver_payroll_records', 'legacy_record_id', r.id, 'legacy_status', r.status)
    FROM public.driver_payroll_records r
    JOIN public.driver_payroll_cycles cy ON cy.id = r.cycle_id
    LEFT JOIN LATERAL (SELECT SUM(amount) AS total FROM public.driver_payroll_record_items i WHERE i.record_id = r.id AND i.amount > 0) pos ON true
    LEFT JOIN LATERAL (SELECT SUM(-amount) AS total FROM public.driver_payroll_record_items i WHERE i.record_id = r.id AND i.amount < 0) neg ON true
    WHERE cy.period_year = v_period.period_year AND cy.period_month = v_period.period_month
    ON CONFLICT (run_id, employee_id) DO NOTHING;

    -- The base salary itself, as a BASIC component.
    INSERT INTO public.payroll_line_components (line_id, run_id, component_code, name, kind, amount, full_amount, sequence, computed_from)
    SELECT l.id, v_run, 'BASIC', 'Basic (imported)', 'earning',
           COALESCE((r.base_amount)::numeric, 0), COALESCE((r.base_amount)::numeric, 0), 10,
           jsonb_build_object('note', 'The legacy single base_amount, carried across unchanged.')
    FROM public.payroll_run_lines l
    JOIN public.salary_records r ON r.id = (l.inputs->>'legacy_record_id')::uuid
    WHERE l.run_id = v_run AND l.inputs->>'imported_from' = 'salary_records';

    INSERT INTO public.payroll_line_components (line_id, run_id, component_code, name, kind, amount, full_amount, sequence, computed_from)
    SELECT l.id, v_run, 'BASIC', 'Basic (imported)', 'earning',
           COALESCE((r.base_amount)::numeric, 0), COALESCE((r.base_amount)::numeric, 0), 10,
           jsonb_build_object('note', 'The legacy single base_amount, carried across unchanged.')
    FROM public.payroll_run_lines l
    JOIN public.driver_payroll_records r ON r.id = (l.inputs->>'legacy_record_id')::uuid
    WHERE l.run_id = v_run AND l.inputs->>'imported_from' = 'driver_payroll_records';

    -- Line items. Known labels map to real heads; everything else keeps its own
    -- name under IMPORTED_ADJUSTMENT so no money is lost and none is invented.
    INSERT INTO public.payroll_line_components (line_id, run_id, component_code, name, kind, amount, full_amount, sequence, computed_from)
    SELECT
      l.id, v_run,
      CASE i.label
        WHEN 'PF' THEN 'PF' WHEN 'ESI' THEN 'ESI'
        WHEN 'LOP — Late' THEN 'LOP' WHEN 'LOP — Leave' THEN 'LOP'
        WHEN 'Task Bonus' THEN 'IMPORTED_ADJUSTMENT'
        ELSE 'IMPORTED_ADJUSTMENT'
      END,
      i.label,
      CASE WHEN i.amount < 0 THEN 'deduction' ELSE 'earning' END,
      ABS(i.amount), ABS(i.amount),
      CASE i.label WHEN 'PF' THEN 910 WHEN 'ESI' THEN 911 ELSE 850 END,
      jsonb_build_object('imported_label', i.label, 'legacy_item_id', i.id)
    FROM public.payroll_run_lines l
    JOIN public.salary_record_items i ON i.record_id = (l.inputs->>'legacy_record_id')::uuid
    WHERE l.run_id = v_run AND l.inputs->>'imported_from' = 'salary_records';

    INSERT INTO public.payroll_line_components (line_id, run_id, component_code, name, kind, amount, full_amount, sequence, computed_from)
    SELECT
      l.id, v_run,
      CASE i.label WHEN 'PF' THEN 'PF' WHEN 'ESI' THEN 'ESI'
        WHEN 'LOP — Late' THEN 'LOP' WHEN 'LOP — Leave' THEN 'LOP'
        ELSE 'IMPORTED_ADJUSTMENT' END,
      i.label,
      CASE WHEN i.amount < 0 THEN 'deduction' ELSE 'earning' END,
      ABS(i.amount), ABS(i.amount),
      CASE i.label WHEN 'PF' THEN 910 WHEN 'ESI' THEN 911 ELSE 850 END,
      jsonb_build_object('imported_label', i.label, 'legacy_item_id', i.id)
    FROM public.payroll_run_lines l
    JOIN public.driver_payroll_record_items i ON i.record_id = (l.inputs->>'legacy_record_id')::uuid
    WHERE l.run_id = v_run AND l.inputs->>'imported_from' = 'driver_payroll_records';

    -- Lock it, with the same tamper-evident hash a live run gets.
    SELECT encode(digest(string_agg(t, '|' ORDER BY t), 'sha256'), 'hex') INTO v_hash
    FROM (
      SELECT employee_id::TEXT || ':' || gross_earnings::TEXT || ':' ||
             total_deductions::TEXT || ':' || net_pay::TEXT AS t
      FROM public.payroll_run_lines WHERE run_id = v_run
    ) s;

    UPDATE public.payroll_runs
       SET status = 'locked', calculated_at = v_period.created_at, locked_at = NOW(), locked_hash = v_hash
     WHERE id = v_run;

    INSERT INTO public.payroll_run_events (run_id, from_status, to_status, note)
    VALUES (v_run, 'draft', 'locked', 'Imported from the legacy Salary Manager and locked as historical.');
  END LOOP;
END $$;

-- ── Reconciliation ──────────────────────────────────────────────────────
-- Compare every imported period against the legacy tables it came from. The
-- old screens should not be retired until this returns zero differences.
CREATE OR REPLACE VIEW public.payroll_import_reconciliation AS
WITH legacy AS (
  SELECT cy.period_year, cy.period_month,
         SUM(r.base_amount + COALESCE((SELECT SUM(amount) FROM public.salary_record_items i WHERE i.record_id = r.id), 0)) AS legacy_net,
         COUNT(*) AS legacy_lines
  FROM public.salary_records r JOIN public.salary_cycles cy ON cy.id = r.cycle_id
  GROUP BY 1, 2
  UNION ALL
  SELECT cy.period_year, cy.period_month,
         SUM(r.base_amount + COALESCE((SELECT SUM(amount) FROM public.driver_payroll_record_items i WHERE i.record_id = r.id), 0)),
         COUNT(*)
  FROM public.driver_payroll_records r JOIN public.driver_payroll_cycles cy ON cy.id = r.cycle_id
  GROUP BY 1, 2
), legacy_total AS (
  SELECT period_year, period_month, SUM(legacy_net) AS legacy_net, SUM(legacy_lines) AS legacy_lines
  FROM legacy GROUP BY 1, 2
), imported AS (
  SELECT r.period_year, r.period_month, SUM(l.net_pay) AS imported_net, COUNT(*) AS imported_lines
  FROM public.payroll_runs r JOIN public.payroll_run_lines l ON l.run_id = r.id
  WHERE r.run_type = 'regular'
  GROUP BY 1, 2
)
SELECT
  COALESCE(lt.period_year, i.period_year)   AS period_year,
  COALESCE(lt.period_month, i.period_month) AS period_month,
  COALESCE(lt.legacy_net, 0)     AS legacy_net,
  COALESCE(i.imported_net, 0)    AS imported_net,
  COALESCE(i.imported_net, 0) - COALESCE(lt.legacy_net, 0) AS net_difference,
  COALESCE(lt.legacy_lines, 0)   AS legacy_lines,
  COALESCE(i.imported_lines, 0)  AS imported_lines,
  (COALESCE(i.imported_net, 0) = COALESCE(lt.legacy_net, 0)
   AND COALESCE(i.imported_lines, 0) = COALESCE(lt.legacy_lines, 0)) AS reconciled
FROM legacy_total lt
FULL OUTER JOIN imported i ON i.period_year = lt.period_year AND i.period_month = lt.period_month
ORDER BY 1 DESC, 2 DESC;

GRANT SELECT ON public.payroll_import_reconciliation TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
