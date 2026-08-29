-- ============================================================================
-- payroll_v2_seed — the salary-head catalogue and statutory rule sets (v1)
-- ============================================================================
-- Run after payroll_v2_rules.sql. Safe to re-run — every insert is keyed and
-- does nothing on conflict, so an edited catalogue is never clobbered.
--
-- The rule values here are seeded to match what the app already applies
-- (DEFAULT_PAYROLL_CALIBRATION in src/lib/payroll.ts and DEFAULT_STATUTORY_CONFIG
-- in src/lib/statutory.ts), so turning the new engine on changes no numbers
-- until somebody deliberately publishes a new version.
--
-- Jurisdiction defaults are Tamil Nadu, matching the TNMAS establishment format
-- the statutory module documents. A school in another state publishes its own
-- PT and LWF rule sets; nothing in the engine assumes TN.

-- ── Salary heads ────────────────────────────────────────────────────────
INSERT INTO public.payroll_components
  (code, name, kind, calc_type, percent_of, sequence, rounding, is_taxable,
   counts_for_pf, counts_for_esi, counts_for_pt, lop_applicable, prorate_on_join_exit, is_system)
VALUES
  ('BASIC',    'Basic',                 'earning', 'fixed',      NULL,    10, 'nearest_rupee', true,  true,  true,  true,  true,  true,  false),
  ('DA',       'Dearness Allowance',    'earning', 'percent_of', 'BASIC', 20, 'nearest_rupee', true,  true,  true,  true,  true,  true,  false),
  ('HRA',      'House Rent Allowance',  'earning', 'percent_of', 'BASIC', 30, 'nearest_rupee', true,  false, true,  true,  true,  true,  false),
  ('CONV',     'Conveyance Allowance',  'earning', 'fixed',      NULL,    40, 'nearest_rupee', true,  false, true,  true,  true,  true,  false),
  ('MED',      'Medical Allowance',     'earning', 'fixed',      NULL,    50, 'nearest_rupee', true,  false, true,  true,  true,  true,  false),
  -- School-specific heads. These are the ones an ERP built for offices does not
  -- have, and the reason a school ends up keeping a parallel spreadsheet.
  ('CHARGE',   'Additional Charge Allowance', 'earning', 'fixed', NULL,   60, 'nearest_rupee', true,  false, true,  true,  true,  true,  false),
  ('EXAM',     'Examination Duty Allowance',  'earning', 'fixed', NULL,   61, 'nearest_rupee', true,  false, true,  true,  false, false, false),
  ('TRANSPORT','Transport Duty Allowance',    'earning', 'fixed', NULL,   62, 'nearest_rupee', true,  false, true,  true,  true,  true,  false),
  ('HOSTEL',   'Hostel Warden Allowance',     'earning', 'fixed', NULL,   63, 'nearest_rupee', true,  false, true,  true,  true,  true,  false),
  ('SPORTS',   'Sports / Coaching Allowance', 'earning', 'fixed', NULL,   64, 'nearest_rupee', true,  false, true,  true,  true,  true,  false),
  ('SPL',      'Special Allowance',     'earning', 'balance',    NULL,    90, 'nearest_rupee', true,  false, true,  true,  true,  true,  false),
  -- System heads: emitted by the engine, never placed in a structure by hand.
  ('LOP',      'Loss of pay',           'informational',        'fixed', NULL, 899, 'nearest_rupee', false, false, false, false, false, false, true),
  ('PF',       'Provident Fund',        'deduction',            'fixed', NULL, 910, 'nearest_rupee', false, false, false, false, false, false, true),
  ('ESI',      'ESI',                   'deduction',            'fixed', NULL, 911, 'up_rupee',      false, false, false, false, false, false, true),
  ('PT',       'Professional Tax',      'deduction',            'fixed', NULL, 912, 'nearest_rupee', false, false, false, false, false, false, true),
  ('LWF',      'Labour Welfare Fund',   'deduction',            'fixed', NULL, 913, 'nearest_rupee', false, false, false, false, false, false, true),
  ('TDS',      'Income tax (TDS)',      'deduction',            'fixed', NULL, 914, 'nearest_rupee', false, false, false, false, false, false, true),
  ('ARREARS',  'Arrears',               'earning',              'fixed', NULL, 810, 'nearest_rupee', true,  false, false, false, false, false, true),
  ('LEAVE_ENCASH','Leave encashment',   'earning',              'fixed', NULL, 800, 'nearest_rupee', true,  false, false, false, false, false, true),
  ('GRATUITY', 'Gratuity',              'earning',              'fixed', NULL, 801, 'nearest_rupee', false, false, false, false, false, false, true),
  ('STAT_BONUS','Statutory bonus',      'earning',              'fixed', NULL, 802, 'nearest_rupee', true,  false, false, false, false, false, true),
  ('NOTICE_RECOVERY','Notice period recovery','deduction',      'fixed', NULL, 920, 'nearest_rupee', false, false, false, false, false, false, true),
  ('LOAN_EMI', 'Loan EMI',              'deduction',            'fixed', NULL, 940, 'nearest_rupee', false, false, false, false, false, false, true),
  ('ADV_RECOVERY','Advance recovery',   'deduction',            'fixed', NULL, 941, 'nearest_rupee', false, false, false, false, false, false, true),
  ('PF_ER',    'Employer PF',           'employer_contribution','fixed', NULL, 960, 'nearest_rupee', false, false, false, false, false, false, true),
  ('EPS_ER',   'Employer pension (EPS)','employer_contribution','fixed', NULL, 961, 'nearest_rupee', false, false, false, false, false, false, true),
  ('EDLI_ER',  'EDLI',                  'employer_contribution','fixed', NULL, 962, 'nearest_rupee', false, false, false, false, false, false, true),
  ('PF_ADMIN_ER','PF administrative charges','employer_contribution','fixed', NULL, 963, 'nearest_rupee', false, false, false, false, false, false, true),
  ('ESI_ER',   'Employer ESI',          'employer_contribution','fixed', NULL, 964, 'up_rupee',      false, false, false, false, false, false, true),
  ('LWF_ER',   'Employer LWF',          'employer_contribution','fixed', NULL, 965, 'nearest_rupee', false, false, false, false, false, false, true)
ON CONFLICT (code) DO NOTHING;

-- ── Statutory rule sets, version 1 ──────────────────────────────────────
INSERT INTO public.payroll_rule_sets (domain, jurisdiction, version, effective_from, status, source_note, rules)
VALUES
('pf', 'IN', 1, '2026-04-01', 'published',
 'EPF & MP Act 1952. Rates carried forward from DEFAULT_STATUTORY_CONFIG so the engine changeover moves no numbers.',
 '{"employeeRate":0.12,"employerRate":0.12,"epsRate":0.0833,"epsWageCeiling":15000,
   "edliRate":0.005,"edliWageCeiling":15000,"adminRate":0.005,"adminMinimum":500,
   "capPfWages":false,"pfWageCeiling":15000,"exemptionWageAtJoining":15000}'::jsonb),

('esi', 'IN', 1, '2026-04-01', 'published',
 'ESI Act 1948. Contribution periods drive the continuity rule that keeps a member covered after crossing the ceiling.',
 '{"employeeRate":0.0075,"employerRate":0.0325,"wageCeiling":21000,
   "contributionPeriods":[{"startMonth":4,"endMonth":9,"label":"April–September"},
                          {"startMonth":10,"endMonth":3,"label":"October–March"}]}'::jsonb),

('pt', 'IN-TN', 1, '2026-04-01', 'published',
 'Tamil Nadu Panchayats/Municipalities professional tax, levied half-yearly. Deducted in August and February.',
 '{"frequency":"half_yearly","deductionMonths":[8,2],"annualMaximum":2500,
   "slabs":[{"upTo":21000,"amount":0},{"upTo":30000,"amount":135},{"upTo":45000,"amount":315},
            {"upTo":60000,"amount":690},{"upTo":75000,"amount":1025},{"upTo":null,"amount":1250}]}'::jsonb),

('lwf', 'IN-TN', 1, '2026-04-01', 'published',
 'Tamil Nadu Labour Welfare Fund. Collected annually with the December payroll.',
 '{"frequency":"annual","deductionMonths":[12],"employeeAmount":20,"employerAmount":40,"wageCeiling":0}'::jsonb),

('tds', 'IN', 1, '2026-04-01', 'published',
 'Income tax slabs for FY 2026-27, both regimes. Verify against the Finance Act before the first live run.',
 '{"financialYear":"2026-27","defaultRegime":"new",
   "regimes":[
     {"name":"new",
      "slabs":[{"upTo":400000,"rate":0},{"upTo":800000,"rate":0.05},{"upTo":1200000,"rate":0.10},
               {"upTo":1600000,"rate":0.15},{"upTo":2000000,"rate":0.20},{"upTo":2400000,"rate":0.25},
               {"upTo":null,"rate":0.30}],
      "standardDeduction":75000,"rebateLimit":1200000,"rebateMax":60000,"cessRate":0.04,
      "surcharge":[{"above":5000000,"rate":0.10},{"above":10000000,"rate":0.15}],
      "allowedDeductions":["80CCD(2)"]},
     {"name":"old",
      "slabs":[{"upTo":250000,"rate":0},{"upTo":500000,"rate":0.05},
               {"upTo":1000000,"rate":0.20},{"upTo":null,"rate":0.30}],
      "standardDeduction":50000,"rebateLimit":500000,"rebateMax":12500,"cessRate":0.04,
      "surcharge":[{"above":5000000,"rate":0.10},{"above":10000000,"rate":0.15}],
      "allowedDeductions":["80C","80D","80CCD(1B)","80CCD(2)","80TTA","80TTB","24(b)","16(iii)","80G","80E","80U","80DD"]}
   ]}'::jsonb),

('gratuity', 'IN', 1, '2026-04-01', 'published',
 'Payment of Gratuity Act 1972. The 4-years-240-days reading of the five-year qualifying period is applied.',
 '{"daysPerYear":15,"monthDays":26,"minimumYears":5,"qualifyingDaysInFinalYear":240,
   "maximumAmount":2000000,"wageBasis":"basic_plus_da"}'::jsonb),

('bonus', 'IN', 1, '2026-04-01', 'published',
 'Payment of Bonus Act 1965. Eligibility at ₹21,000/month, calculation ceiling ₹7,000/month.',
 '{"minimumRate":0.0833,"maximumRate":0.20,"eligibilityWageCeiling":21000,
   "calculationWageCeiling":7000,"minimumWorkingDays":30}'::jsonb)
ON CONFLICT (domain, jurisdiction, version) DO NOTHING;

-- ── The school-wide default policy group and calendar ────────────────────
-- Seeded to reproduce DEFAULT_PAYROLL_CALIBRATION exactly, so a school that
-- configures nothing gets today's behaviour from the new engine.
INSERT INTO public.payroll_policy_groups (id, name, is_default, priority, effective_from, policy)
SELECT gen_random_uuid(), 'Everyone', true, 0, '2000-01-01',
 '{"lop":{"late":{"freeCount":3,"tiers":[{"count":null,"lopDaysEach":0.5}]},
          "leave":{"freeCount":1,"tiers":[{"count":null,"lopDaysEach":1}]},
          "halfDay":{"freeCount":0,"tiers":[{"count":null,"lopDaysEach":0.5}]}},
   "leaveTreatment":{"casual":"paid","medical":"paid","on_duty":"paid","half_day":"half","unapproved":"lop"},
   "lopBasis":"calendar_days","fixedDays":30,"halfDayFraction":0.5,"lateGraceMinutes":0,
   "roundLopTo":0.5,"encashment":{"rateBasis":"basic","maxDays":30,"enabled":false},
   "noticePeriodDays":30,"netRounding":"nearest_rupee"}'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM public.payroll_policy_groups WHERE is_default AND effective_to IS NULL);

INSERT INTO public.payroll_calendars (id, name, is_default, priority, effective_from, basis, fixed_days, week_pattern, nth_weekday_rules)
SELECT gen_random_uuid(), 'School calendar', true, 0, '2000-01-01', 'calendar_days', 30,
  '["off","full","full","full","full","full","full"]'::jsonb, '[]'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM public.payroll_calendars WHERE is_default AND effective_to IS NULL);

NOTIFY pgrst, 'reload schema';
