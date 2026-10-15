-- ============================================================================
-- fee_v2_wipe_fee_records — clear every fee record before the new grid
-- ============================================================================
-- ONE-OFF. Destructive. Run once, after fee_v2_grid.sql, to start the new fee
-- configuration from an empty slate. Do not re-run once the school has started
-- issuing fees from the grid.
--
-- Clears: the price list (old and new), every bill, payment, receipt, ledger
-- line, concession, fine, refund, reminder and the fee audit log, and resets
-- bill/receipt numbering.
--
-- Keeps: who can do what (fee_permissions, fee_role_grants, fee_user_grants),
-- fee settings (fee_settings), the fine kinds (fee_fine_categories) and the
-- academic years. The bus module's own tables are not touched.
--
-- TRUNCATE rather than DELETE: the ledger and audit log are append-only by
-- trigger, and row triggers do not fire on TRUNCATE.

TRUNCATE TABLE
  -- the new grid
  public.fee_issue_cells, public.fee_issues,
  public.fee_other_charge_students, public.fee_other_charges,
  public.fee_rates, public.fee_grade_groups, public.fee_terms,
  -- money and bills
  public.fee_payment_allocations, public.fee_late_fee_charges, public.fee_late_fee_exemptions,
  public.fee_fines, public.fee_concessions, public.fee_refunds, public.fee_credits,
  public.fee_invoice_lines, public.fee_message_links, public.fee_reminder_log,
  public.fee_reminder_schedules, public.fee_payments, public.fee_instruments,
  public.fee_invoices, public.fee_rte_register, public.fee_opening_balances,
  public.fee_ledger_entries, public.fee_audit_log, public.fee_number_series,
  public.fee_profiles,
  -- the old price list
  public.fee_group_assignments, public.fee_installment_items, public.fee_installments,
  public.fee_structure_items, public.fee_structures, public.fee_groups,
  public.fee_heads, public.fee_categories, public.fee_late_fee_rules,
  public.fee_scholarships, public.fee_discount_types,
  -- the original single-fee tables
  public.school_fee_payments, public.school_fees
RESTART IDENTITY;
