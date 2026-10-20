-- fee_v4_hardening — fee app performance and security pass
-- ============================================================================
-- 1. The five grid config tables each had a FOR ALL "Manage" policy and a FOR
--    SELECT "Read" policy, so every read evaluated both. Split into one policy
--    per command (same rules: read = view OR manage; writes = manage), with the
--    permission check hoisted into an InitPlan so it runs once per statement.
-- 2. fee_issue_blockers listed other students' names and receipt amounts to
--    any signed-in user who had an issue id. It now answers only to people who
--    can issue or undo fees.
-- 3. fee_norm_gender gets a fixed search_path.
-- 4. Indexes on the foreign keys the grid and issue screens join on.
-- Safe to re-run.
--
-- Applied to the live project 2026-10-20 except the DROP POLICY lines: the
-- database tool there needs an interactive confirmation for drops. fee_terms
-- has its four new policies alongside the old two (same access either way);
-- the other four tables are untouched. Run this whole file from the SQL
-- editor to finish. On the live DB the old fee_terms ALL policy is named
-- "zz_old_manage_fee_terms".
DROP POLICY IF EXISTS "zz_old_manage_fee_terms" ON public.fee_terms;


DROP POLICY IF EXISTS "Manage fee_grade_groups" ON public.fee_grade_groups;
DROP POLICY IF EXISTS "Read fee_grade_groups" ON public.fee_grade_groups;
DROP POLICY IF EXISTS "fee_grade_groups select" ON public.fee_grade_groups;
DROP POLICY IF EXISTS "fee_grade_groups insert" ON public.fee_grade_groups;
DROP POLICY IF EXISTS "fee_grade_groups update" ON public.fee_grade_groups;
DROP POLICY IF EXISTS "fee_grade_groups delete" ON public.fee_grade_groups;
CREATE POLICY "fee_grade_groups select" ON public.fee_grade_groups FOR SELECT TO authenticated USING ((SELECT public.has_fee_permission('fees.config.manage')) OR (SELECT public.has_fee_permission('fees.view')));
CREATE POLICY "fee_grade_groups insert" ON public.fee_grade_groups FOR INSERT TO authenticated WITH CHECK ((SELECT public.has_fee_permission('fees.config.manage')));
CREATE POLICY "fee_grade_groups update" ON public.fee_grade_groups FOR UPDATE TO authenticated USING ((SELECT public.has_fee_permission('fees.config.manage'))) WITH CHECK ((SELECT public.has_fee_permission('fees.config.manage')));
CREATE POLICY "fee_grade_groups delete" ON public.fee_grade_groups FOR DELETE TO authenticated USING ((SELECT public.has_fee_permission('fees.config.manage')));

DROP POLICY IF EXISTS "Manage fee_months" ON public.fee_months;
DROP POLICY IF EXISTS "Read fee_months" ON public.fee_months;
DROP POLICY IF EXISTS "fee_months select" ON public.fee_months;
DROP POLICY IF EXISTS "fee_months insert" ON public.fee_months;
DROP POLICY IF EXISTS "fee_months update" ON public.fee_months;
DROP POLICY IF EXISTS "fee_months delete" ON public.fee_months;
CREATE POLICY "fee_months select" ON public.fee_months FOR SELECT TO authenticated USING ((SELECT public.has_fee_permission('fees.config.manage')) OR (SELECT public.has_fee_permission('fees.view')));
CREATE POLICY "fee_months insert" ON public.fee_months FOR INSERT TO authenticated WITH CHECK ((SELECT public.has_fee_permission('fees.config.manage')));
CREATE POLICY "fee_months update" ON public.fee_months FOR UPDATE TO authenticated USING ((SELECT public.has_fee_permission('fees.config.manage'))) WITH CHECK ((SELECT public.has_fee_permission('fees.config.manage')));
CREATE POLICY "fee_months delete" ON public.fee_months FOR DELETE TO authenticated USING ((SELECT public.has_fee_permission('fees.config.manage')));

DROP POLICY IF EXISTS "Manage fee_optins" ON public.fee_optins;
DROP POLICY IF EXISTS "Read fee_optins" ON public.fee_optins;
DROP POLICY IF EXISTS "fee_optins select" ON public.fee_optins;
DROP POLICY IF EXISTS "fee_optins insert" ON public.fee_optins;
DROP POLICY IF EXISTS "fee_optins update" ON public.fee_optins;
DROP POLICY IF EXISTS "fee_optins delete" ON public.fee_optins;
CREATE POLICY "fee_optins select" ON public.fee_optins FOR SELECT TO authenticated USING ((SELECT public.has_fee_permission('fees.config.manage')) OR (SELECT public.has_fee_permission('fees.view')));
CREATE POLICY "fee_optins insert" ON public.fee_optins FOR INSERT TO authenticated WITH CHECK ((SELECT public.has_fee_permission('fees.config.manage')));
CREATE POLICY "fee_optins update" ON public.fee_optins FOR UPDATE TO authenticated USING ((SELECT public.has_fee_permission('fees.config.manage'))) WITH CHECK ((SELECT public.has_fee_permission('fees.config.manage')));
CREATE POLICY "fee_optins delete" ON public.fee_optins FOR DELETE TO authenticated USING ((SELECT public.has_fee_permission('fees.config.manage')));

DROP POLICY IF EXISTS "Manage fee_rates" ON public.fee_rates;
DROP POLICY IF EXISTS "Read fee_rates" ON public.fee_rates;
DROP POLICY IF EXISTS "fee_rates select" ON public.fee_rates;
DROP POLICY IF EXISTS "fee_rates insert" ON public.fee_rates;
DROP POLICY IF EXISTS "fee_rates update" ON public.fee_rates;
DROP POLICY IF EXISTS "fee_rates delete" ON public.fee_rates;
CREATE POLICY "fee_rates select" ON public.fee_rates FOR SELECT TO authenticated USING ((SELECT public.has_fee_permission('fees.config.manage')) OR (SELECT public.has_fee_permission('fees.view')));
CREATE POLICY "fee_rates insert" ON public.fee_rates FOR INSERT TO authenticated WITH CHECK ((SELECT public.has_fee_permission('fees.config.manage')));
CREATE POLICY "fee_rates update" ON public.fee_rates FOR UPDATE TO authenticated USING ((SELECT public.has_fee_permission('fees.config.manage'))) WITH CHECK ((SELECT public.has_fee_permission('fees.config.manage')));
CREATE POLICY "fee_rates delete" ON public.fee_rates FOR DELETE TO authenticated USING ((SELECT public.has_fee_permission('fees.config.manage')));

DROP POLICY IF EXISTS "Manage fee_terms" ON public.fee_terms;
DROP POLICY IF EXISTS "Read fee_terms" ON public.fee_terms;
DROP POLICY IF EXISTS "fee_terms select" ON public.fee_terms;
DROP POLICY IF EXISTS "fee_terms insert" ON public.fee_terms;
DROP POLICY IF EXISTS "fee_terms update" ON public.fee_terms;
DROP POLICY IF EXISTS "fee_terms delete" ON public.fee_terms;
CREATE POLICY "fee_terms select" ON public.fee_terms FOR SELECT TO authenticated USING ((SELECT public.has_fee_permission('fees.config.manage')) OR (SELECT public.has_fee_permission('fees.view')));
CREATE POLICY "fee_terms insert" ON public.fee_terms FOR INSERT TO authenticated WITH CHECK ((SELECT public.has_fee_permission('fees.config.manage')));
CREATE POLICY "fee_terms update" ON public.fee_terms FOR UPDATE TO authenticated USING ((SELECT public.has_fee_permission('fees.config.manage'))) WITH CHECK ((SELECT public.has_fee_permission('fees.config.manage')));
CREATE POLICY "fee_terms delete" ON public.fee_terms FOR DELETE TO authenticated USING ((SELECT public.has_fee_permission('fees.config.manage')));

CREATE OR REPLACE FUNCTION public.fee_issue_blockers(p_issue uuid)
RETURNS TABLE(payment_id uuid, student_id uuid, student_name text, receipt_no text, status text, allocated numeric, refunded numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.id, p.student_id, pr.full_name, p.receipt_no, p.status,
         SUM(a.amount),
         COALESCE((SELECT SUM(r.amount) FROM public.fee_refunds r
                    WHERE r.source_payment_id = p.id AND r.status = 'paid_out'), 0)
    FROM public.fee_invoices i
    JOIN public.fee_payment_allocations a ON a.invoice_id = i.id
    JOIN public.fee_payments p ON p.id = a.payment_id
    JOIN public.profiles pr ON pr.id = p.student_id
   WHERE i.issue_id = p_issue
     AND p.status IN ('pending', 'verified')
     AND (public.fee_is_service_context()
          OR public.has_fee_permission('fees.invoice.cancel')
          OR public.has_fee_permission('fees.invoice.generate'))
   GROUP BY p.id, p.student_id, pr.full_name, p.receipt_no, p.status
  HAVING COALESCE((SELECT SUM(r.amount) FROM public.fee_refunds r
                    WHERE r.source_payment_id = p.id AND r.status = 'paid_out'), 0) < SUM(a.amount)
$$;

ALTER FUNCTION public.fee_norm_gender SET search_path = public;

CREATE INDEX IF NOT EXISTS idx_fee_issue_cells_group ON public.fee_issue_cells(group_id);
CREATE INDEX IF NOT EXISTS idx_fee_issue_cells_head ON public.fee_issue_cells(head_id);
CREATE INDEX IF NOT EXISTS idx_fee_issue_cells_term ON public.fee_issue_cells(term_id);
CREATE INDEX IF NOT EXISTS idx_fee_issues_term ON public.fee_issues(term_id);
CREATE INDEX IF NOT EXISTS idx_fee_optins_student ON public.fee_optins(student_id);
CREATE INDEX IF NOT EXISTS idx_fee_other_charges_fine_category ON public.fee_other_charges(fine_category_id);
CREATE INDEX IF NOT EXISTS idx_fee_rates_group ON public.fee_rates(group_id);
CREATE INDEX IF NOT EXISTS idx_fee_rates_term ON public.fee_rates(term_id);
