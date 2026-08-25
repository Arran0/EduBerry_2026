-- ============================================================
-- WAL cost: leave_applications and leave_approvals were set to
-- REPLICA IDENTITY FULL by add_leave_realtime.sql, which writes the entire
-- OLD row image to WAL on every UPDATE/DELETE. useLeaveRealtime
-- (src/hooks/useLeaveRealtime.ts) only reads NEW.id / NEW.status /
-- NEW.leave_application_id from the realtime payload — it never needs old
-- column values. DEFAULT (primary-key-only) is sufficient and cuts WAL
-- volume on every write to these tables.
-- ============================================================

ALTER TABLE public.leave_applications REPLICA IDENTITY DEFAULT;
ALTER TABLE public.leave_approvals REPLICA IDENTITY DEFAULT;
