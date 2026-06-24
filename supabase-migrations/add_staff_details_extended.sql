-- ============================================================
-- Migration: Extend staff_details with CBSE-recommended fields
-- ============================================================
-- Run this after add_staff_details.sql has been applied.

ALTER TABLE public.staff_details
  ADD COLUMN IF NOT EXISTS subjects_taught            TEXT,
  ADD COLUMN IF NOT EXISTS employment_type            TEXT,
  ADD COLUMN IF NOT EXISTS date_of_retirement         DATE,
  ADD COLUMN IF NOT EXISTS date_of_confirmation       DATE,
  ADD COLUMN IF NOT EXISTS cbse_reg_no                TEXT,
  ADD COLUMN IF NOT EXISTS ugc_net_qualified          TEXT,
  ADD COLUMN IF NOT EXISTS teaching_diploma           TEXT,
  ADD COLUMN IF NOT EXISTS teaching_experience_years  TEXT,
  ADD COLUMN IF NOT EXISTS nationality                TEXT,
  ADD COLUMN IF NOT EXISTS religion                   TEXT,
  ADD COLUMN IF NOT EXISTS category                   TEXT,
  ADD COLUMN IF NOT EXISTS marital_status             TEXT,
  ADD COLUMN IF NOT EXISTS physically_challenged      TEXT,
  ADD COLUMN IF NOT EXISTS ex_serviceman              TEXT,
  ADD COLUMN IF NOT EXISTS alternate_phone            TEXT,
  ADD COLUMN IF NOT EXISTS emergency_contact_name     TEXT,
  ADD COLUMN IF NOT EXISTS emergency_contact_relation TEXT,
  ADD COLUMN IF NOT EXISTS epf_no                     TEXT,
  ADD COLUMN IF NOT EXISTS nps_no                     TEXT,
  ADD COLUMN IF NOT EXISTS bank_account_no            TEXT,
  ADD COLUMN IF NOT EXISTS bank_name                  TEXT,
  ADD COLUMN IF NOT EXISTS ifsc_code                  TEXT;

COMMENT ON COLUMN public.staff_details.subjects_taught            IS 'Comma-separated list of subjects taught';
COMMENT ON COLUMN public.staff_details.employment_type            IS 'Permanent / Contractual / Adhoc / Deputation';
COMMENT ON COLUMN public.staff_details.date_of_retirement         IS 'Superannuation / retirement date';
COMMENT ON COLUMN public.staff_details.date_of_confirmation       IS 'End of probationary period';
COMMENT ON COLUMN public.staff_details.cbse_reg_no                IS 'CBSE teacher registration / affiliation number';
COMMENT ON COLUMN public.staff_details.ugc_net_qualified          IS 'UGC/NET qualified: Yes / No / NA';
COMMENT ON COLUMN public.staff_details.teaching_diploma           IS 'B.Ed, D.El.Ed, B.P.Ed, M.Ed, etc.';
COMMENT ON COLUMN public.staff_details.teaching_experience_years  IS 'Total teaching experience in years';
COMMENT ON COLUMN public.staff_details.nationality                IS 'Employee nationality';
COMMENT ON COLUMN public.staff_details.religion                   IS 'Employee religion';
COMMENT ON COLUMN public.staff_details.category                   IS 'SC / ST / OBC / General / EWS';
COMMENT ON COLUMN public.staff_details.marital_status             IS 'Single / Married / Divorced / Widowed';
COMMENT ON COLUMN public.staff_details.physically_challenged      IS 'Yes / No';
COMMENT ON COLUMN public.staff_details.ex_serviceman              IS 'Yes / No';
COMMENT ON COLUMN public.staff_details.alternate_phone            IS 'Secondary / alternate phone number';
COMMENT ON COLUMN public.staff_details.emergency_contact_name     IS 'Name of emergency contact person';
COMMENT ON COLUMN public.staff_details.emergency_contact_relation IS 'Relationship to emergency contact';
COMMENT ON COLUMN public.staff_details.epf_no                     IS 'EPF / PF account number';
COMMENT ON COLUMN public.staff_details.nps_no                     IS 'NPS PRAN number';
COMMENT ON COLUMN public.staff_details.bank_account_no            IS 'Salary bank account number';
COMMENT ON COLUMN public.staff_details.bank_name                  IS 'Bank name and branch';
COMMENT ON COLUMN public.staff_details.ifsc_code                  IS 'IFSC code for bank branch';
