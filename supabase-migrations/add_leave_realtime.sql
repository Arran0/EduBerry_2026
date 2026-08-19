-- ============================================================
-- Realtime for OD / Leave notifications
--
-- Lets the app react the moment an application is filed or decided, instead
-- of only on the next page load: the in-app toast, the browser notification
-- shown while a tab is open, and the live refresh of the Home notification
-- box and its badges all hang off these two streams
-- (see src/hooks/useLeaveRealtime.ts).
--
--   • leave_approvals    INSERT — a reviewer has just been asked for a decision
--   • leave_applications UPDATE — the applicant's application was answered
--                                 (sync_leave_application_status touches the
--                                 row on every decision)
--
-- Row Level Security still applies to Realtime, so a client only ever receives
-- rows it could have read anyway. Web Push is unaffected by this migration —
-- it is sent server-side and keeps working without Realtime; without this the
-- app simply falls back to fetch-on-load.
--
-- Safe to run multiple times.
-- ============================================================

-- Realtime needs the full old row on UPDATE/DELETE to evaluate filters.
ALTER TABLE public.leave_applications REPLICA IDENTITY FULL;
ALTER TABLE public.leave_approvals    REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'leave_applications'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.leave_applications;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'leave_approvals'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.leave_approvals;
  END IF;
END $$;
