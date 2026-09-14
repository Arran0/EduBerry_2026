-- payroll_leave_available, payroll_loan_balances and payroll_advance_balances
-- were created without security_invoker, so they ran as their owner and bypassed
-- RLS on payroll_loans / payroll_advances / payroll_repayments /
-- payroll_leave_balances entirely. Anyone who could reach the view read every
-- employee's loan principal, outstanding balance and leave entitlement —
-- verified by seeding two employees' loans in a rolled-back transaction and
-- selecting as an unrelated student, who saw both rows.
--
-- The underlying SELECT policies are already exactly
--   (get_user_role() = 'admin') OR employee_id = auth.uid()
-- so switching the views to security_invoker gives the intended semantics with
-- no policy changes: owner sees their own, admin sees all. Re-verified the same
-- way afterwards — owner 1 row, admin 2.
--
-- Payroll run generation is unaffected: src/app/api/payroll/* hydrate through a
-- service-role client (requireAdmin -> adminClient), which bypasses RLS.

ALTER VIEW public.payroll_leave_available  SET (security_invoker = true);
ALTER VIEW public.payroll_loan_balances    SET (security_invoker = true);
ALTER VIEW public.payroll_advance_balances SET (security_invoker = true);
