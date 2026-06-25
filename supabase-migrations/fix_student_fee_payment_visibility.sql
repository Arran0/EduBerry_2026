-- Students must see EVERY verified payment on their own fees — including those
-- recorded at the office by an admin (offline cash/cheque/card/bank/UPI). The
-- original "Payer views own school fee payments" policy only exposed rows where
-- payer_id = auth.uid(), so an admin-recorded partial payment (payer_id = admin)
-- was invisible to the student. The My Fees page then read 0 paid and asked the
-- student to pay the full amount again.
--
-- Add a SELECT policy scoped to the owning fee so a student sees all payments
-- against fees issued to them, regardless of who recorded them.

CREATE POLICY "Student views payments on own fees"
  ON public.school_fee_payments FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.school_fees f
      WHERE f.id = school_fee_payments.fee_id
        AND f.student_id = auth.uid()
    )
  );

NOTIFY pgrst, 'reload schema';
