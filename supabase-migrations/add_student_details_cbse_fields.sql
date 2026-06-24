-- ============================================
-- Extend student_details with CBSE-recommended fields
-- ============================================
-- Adds columns required for CBSE affiliation compliance and standard
-- school management: identification numbers, personal details, family/
-- socio-economic data, and transfer records.

ALTER TABLE public.student_details
  -- Identification
  ADD COLUMN IF NOT EXISTS pen_no TEXT,
  ADD COLUMN IF NOT EXISTS cbse_reg_no TEXT,
  ADD COLUMN IF NOT EXISTS udise_student_code TEXT,

  -- Personal
  ADD COLUMN IF NOT EXISTS gender TEXT,
  ADD COLUMN IF NOT EXISTS place_of_birth TEXT,
  ADD COLUMN IF NOT EXISTS differently_abled TEXT,
  ADD COLUMN IF NOT EXISTS single_girl_child TEXT,

  -- Family
  ADD COLUMN IF NOT EXISTS father_qualification TEXT,
  ADD COLUMN IF NOT EXISTS father_occupation TEXT,
  ADD COLUMN IF NOT EXISTS mother_qualification TEXT,
  ADD COLUMN IF NOT EXISTS mother_occupation TEXT,
  ADD COLUMN IF NOT EXISTS annual_income TEXT,

  -- Socio-economic
  ADD COLUMN IF NOT EXISTS minority TEXT,
  ADD COLUMN IF NOT EXISTS bpl_card_no TEXT,
  ADD COLUMN IF NOT EXISTS ews_certificate_no TEXT,

  -- Admission & transfer
  ADD COLUMN IF NOT EXISTS previous_school TEXT,
  ADD COLUMN IF NOT EXISTS tc_no TEXT,
  ADD COLUMN IF NOT EXISTS tc_date DATE;
