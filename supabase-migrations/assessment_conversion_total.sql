-- Total conversion.
--
-- Marks are entered out of the assessment's own maximum, but a school does not
-- always report them at that scale: an internal test marked out of 120 may
-- count for 50 on the report. `conversion_total` is that second denominator —
-- the maximum the marks are *displayed* against, alongside the real one.
--
-- It is optional and changes nothing when unset: NULL means the marksheet
-- shows no converted column, the export has no converted column, and every
-- existing total stays exactly as it was. Nothing is stored converted — the
-- figure is derived on read, so changing the conversion never rewrites a mark.

ALTER TABLE public.classroom_assessments
  ADD COLUMN IF NOT EXISTS conversion_total numeric;

ALTER TABLE public.classroom_assessments
  DROP CONSTRAINT IF EXISTS classroom_assessments_conversion_total_positive;

ALTER TABLE public.classroom_assessments
  ADD CONSTRAINT classroom_assessments_conversion_total_positive
  CHECK (conversion_total IS NULL OR conversion_total > 0);
