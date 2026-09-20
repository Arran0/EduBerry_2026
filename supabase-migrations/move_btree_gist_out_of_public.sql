-- btree_gist was installed into `public`, dropping ~190 gbt_* support functions
-- into the same namespace the application's own objects live in (Supabase's
-- extension_in_public lint). Anything that resolves an unqualified name through
-- a search_path containing public can collide with them.
--
-- Four exclusion constraints depend on this extension's operator classes —
-- academic_years_no_overlap, payroll_rule_sets_no_overlap,
-- payroll_employee_structures_no_overlap, payroll_location_members_no_overlap.
-- Index and constraint dependencies are recorded by OID, not by name, so the
-- move does not disturb them; verified in a rolled-back transaction by
-- attempting an overlapping insert into academic_years after the move and
-- confirming it still raised exclusion_violation.

CREATE SCHEMA IF NOT EXISTS extensions;
GRANT USAGE ON SCHEMA extensions TO anon, authenticated, service_role;

ALTER EXTENSION btree_gist SET SCHEMA extensions;
