-- ============================================================================
-- payroll_v3_seed_states — Professional Tax and LWF rule sets, by state
-- ============================================================================
-- Run after payroll_v3_locations.sql. Safe to re-run.
--
-- READ THIS BEFORE USING ANY OF IT.
--
-- Every state rule set below is seeded as a DRAFT, not as published. The engine
-- only ever reads published sets (`loadRunContext` filters on status), so
-- nothing here changes a single number until a human opens
-- /more/payroll/compliance, checks the slab against the state's current
-- notification, and publishes it.
--
-- That is deliberate. Professional Tax slabs are revised by state finance
-- departments on their own timetable, and a wrong slab is a wrong deduction
-- from somebody's pay. Seeding these as published would trade a known-unknown
-- for a silent error. What the seed is for is saving the typing and recording
-- which notification each figure is supposed to come from.
--
-- Tamil Nadu is already published by payroll_v2_seed.sql and is not touched.
--
-- Two limits of the current PtRules shape, both worth knowing before publishing:
--   • There is no gender dimension. Maharashtra exempts women up to a higher
--     threshold than men; the slab below is the general schedule and will
--     over-deduct for women employees.
--   • There is no month-specific amount. Maharashtra's February instalment
--     differs from the other eleven months. The engine spreads evenly instead.
-- A school operating in Maharashtra needs both handled before going live there.

-- ── States that levy no Professional Tax at all ─────────────────────────
-- These ARE published, because "this state has no PT" is a fact rather than a
-- figure to verify, and because without them an office in Delhi would trip the
-- NO_PT_RULE_FOR_STATE block on every run for no reason.
INSERT INTO public.payroll_rule_sets (domain, jurisdiction, version, effective_from, status, source_note, rules)
VALUES
('pt', 'IN-DL', 1, '2026-04-01', 'published',
 'Delhi levies no Professional Tax. Seeded explicitly so an office here resolves to a rule set rather than to nothing.',
 '{"frequency":"monthly","deductionMonths":[],"annualMaximum":0,"slabs":[{"upTo":null,"amount":0}]}'::jsonb),

('pt', 'IN-HR', 1, '2026-04-01', 'published',
 'Haryana levies no Professional Tax.',
 '{"frequency":"monthly","deductionMonths":[],"annualMaximum":0,"slabs":[{"upTo":null,"amount":0}]}'::jsonb),

('pt', 'IN-UP', 1, '2026-04-01', 'published',
 'Uttar Pradesh levies no Professional Tax.',
 '{"frequency":"monthly","deductionMonths":[],"annualMaximum":0,"slabs":[{"upTo":null,"amount":0}]}'::jsonb),

('pt', 'IN-RJ', 1, '2026-04-01', 'published',
 'Rajasthan levies no Professional Tax.',
 '{"frequency":"monthly","deductionMonths":[],"annualMaximum":0,"slabs":[{"upTo":null,"amount":0}]}'::jsonb)
ON CONFLICT (domain, jurisdiction, version) DO NOTHING;

-- ── Professional Tax — DRAFT, verify each against the state notification ─
INSERT INTO public.payroll_rule_sets (domain, jurisdiction, version, effective_from, status, source_note, rules)
VALUES
('pt', 'IN-KA', 1, '2026-04-01', 'draft',
 'DRAFT — verify against the Karnataka Tax on Professions, Trades, Callings and Employments Act and the current exemption threshold before publishing. Monthly levy, flat above the threshold.',
 '{"frequency":"monthly","deductionMonths":[4,5,6,7,8,9,10,11,12,1,2,3],"annualMaximum":2500,
   "slabs":[{"upTo":25000,"amount":0},{"upTo":null,"amount":200}]}'::jsonb),

('pt', 'IN-MH', 1, '2026-04-01', 'draft',
 'DRAFT — verify against the Maharashtra State Tax on Professions Act. NOTE: this schedule ignores both the higher exemption for women employees and the different February instalment, neither of which the current PtRules shape can express. Do not publish for a Maharashtra office until both are handled.',
 '{"frequency":"monthly","deductionMonths":[4,5,6,7,8,9,10,11,12,1,2,3],"annualMaximum":2500,
   "slabs":[{"upTo":7500,"amount":0},{"upTo":10000,"amount":175},{"upTo":null,"amount":200}]}'::jsonb),

('pt', 'IN-TG', 1, '2026-04-01', 'draft',
 'DRAFT — verify against the Telangana Tax on Professions, Trades, Callings and Employments Act. Monthly levy.',
 '{"frequency":"monthly","deductionMonths":[4,5,6,7,8,9,10,11,12,1,2,3],"annualMaximum":2500,
   "slabs":[{"upTo":15000,"amount":0},{"upTo":20000,"amount":150},{"upTo":null,"amount":200}]}'::jsonb),

('pt', 'IN-AP', 1, '2026-04-01', 'draft',
 'DRAFT — verify against the Andhra Pradesh Tax on Professions, Trades, Callings and Employments Act. Monthly levy.',
 '{"frequency":"monthly","deductionMonths":[4,5,6,7,8,9,10,11,12,1,2,3],"annualMaximum":2500,
   "slabs":[{"upTo":15000,"amount":0},{"upTo":20000,"amount":150},{"upTo":null,"amount":200}]}'::jsonb),

('pt', 'IN-WB', 1, '2026-04-01', 'draft',
 'DRAFT — verify against the West Bengal State Tax on Professions, Trades, Callings and Employments Act. Monthly levy.',
 '{"frequency":"monthly","deductionMonths":[4,5,6,7,8,9,10,11,12,1,2,3],"annualMaximum":2500,
   "slabs":[{"upTo":10000,"amount":0},{"upTo":15000,"amount":110},{"upTo":25000,"amount":130},
            {"upTo":40000,"amount":150},{"upTo":null,"amount":200}]}'::jsonb),

('pt', 'IN-GJ', 1, '2026-04-01', 'draft',
 'DRAFT — verify against the Gujarat State Tax on Professions Act and the current exemption threshold. Monthly levy, flat above the threshold.',
 '{"frequency":"monthly","deductionMonths":[4,5,6,7,8,9,10,11,12,1,2,3],"annualMaximum":2400,
   "slabs":[{"upTo":12000,"amount":0},{"upTo":null,"amount":200}]}'::jsonb)
ON CONFLICT (domain, jurisdiction, version) DO NOTHING;

-- ── Labour Welfare Fund — DRAFT, all of it ──────────────────────────────
-- LWF amounts and collection months differ more widely between states than PT
-- does, and several states revise them without much notice. Every one of these
-- needs checking against the state welfare board's current circular.
INSERT INTO public.payroll_rule_sets (domain, jurisdiction, version, effective_from, status, source_note, rules)
VALUES
('lwf', 'IN-KA', 1, '2026-04-01', 'draft',
 'DRAFT — Karnataka Labour Welfare Fund, collected with the December payroll. Verify the employee and employer amounts against the current circular.',
 '{"frequency":"annual","deductionMonths":[12],"employeeAmount":20,"employerAmount":40,"wageCeiling":0}'::jsonb),

('lwf', 'IN-MH', 1, '2026-04-01', 'draft',
 'DRAFT — Maharashtra Labour Welfare Fund, collected half-yearly in June and December. The Maharashtra scheme varies the amount by wage band; verify the bands before publishing.',
 '{"frequency":"half_yearly","deductionMonths":[6,12],"employeeAmount":12,"employerAmount":36,"wageCeiling":0}'::jsonb),

('lwf', 'IN-TG', 1, '2026-04-01', 'draft',
 'DRAFT — Telangana Labour Welfare Fund, collected with the December payroll.',
 '{"frequency":"annual","deductionMonths":[12],"employeeAmount":2,"employerAmount":5,"wageCeiling":0}'::jsonb),

('lwf', 'IN-AP', 1, '2026-04-01', 'draft',
 'DRAFT — Andhra Pradesh Labour Welfare Fund, collected with the December payroll.',
 '{"frequency":"annual","deductionMonths":[12],"employeeAmount":30,"employerAmount":70,"wageCeiling":0}'::jsonb),

('lwf', 'IN-GJ', 1, '2026-04-01', 'draft',
 'DRAFT — Gujarat Labour Welfare Fund, collected half-yearly in June and December.',
 '{"frequency":"half_yearly","deductionMonths":[6,12],"employeeAmount":6,"employerAmount":12,"wageCeiling":0}'::jsonb),

('lwf', 'IN-WB', 1, '2026-04-01', 'draft',
 'DRAFT — West Bengal Labour Welfare Fund, collected with the December payroll.',
 '{"frequency":"annual","deductionMonths":[12],"employeeAmount":3,"employerAmount":15,"wageCeiling":0}'::jsonb),

-- The states with no PT still have welfare funds, and those are separate levies.
('lwf', 'IN-DL', 1, '2026-04-01', 'draft',
 'DRAFT — Delhi Labour Welfare Fund, collected half-yearly in June and December. Delhi levies no Professional Tax but does run a welfare fund; the two are unrelated.',
 '{"frequency":"half_yearly","deductionMonths":[6,12],"employeeAmount":0.75,"employerAmount":2.25,"wageCeiling":0}'::jsonb),

('lwf', 'IN-HR', 1, '2026-04-01', 'draft',
 'DRAFT — Haryana Labour Welfare Fund, collected monthly. Verify the current employee and employer rates.',
 '{"frequency":"monthly","deductionMonths":[4,5,6,7,8,9,10,11,12,1,2,3],"employeeAmount":31,"employerAmount":62,"wageCeiling":0}'::jsonb)
ON CONFLICT (domain, jurisdiction, version) DO NOTHING;

NOTIFY pgrst, 'reload schema';
