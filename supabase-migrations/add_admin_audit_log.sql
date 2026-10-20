-- ── admin_audit_log ─────────────────────────────────────────────────────
-- Who changed whose role, reset whose password, banned or deleted whom, and
-- who started a salary or driver payout. Until now these left nothing behind
-- but a console line, so a compromised or careless admin account could not be
-- traced. The fee module already keeps fee_audit_log for money movements inside
-- fees; this covers the user-management and payout routes under
-- src/app/api/admin/* and */payout/initiate.
--
-- Same rules as fee_audit_log: append-only, and nobody — the service role
-- included — can edit an entry. Rows are written only by the server routes
-- (service role); admins can read them.
CREATE TABLE IF NOT EXISTS public.admin_audit_log (
  id          BIGSERIAL PRIMARY KEY,
  actor_id    UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  action      TEXT NOT NULL,       -- 'user.create', 'user.ban', 'payout.salary.initiate', ...
  target_id   UUID,                -- no FK: the target may be the user just deleted
  details     JSONB,
  ip          TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_created ON public.admin_audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_target  ON public.admin_audit_log(target_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_actor   ON public.admin_audit_log(actor_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.admin_audit_append_only()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'The admin activity log is append-only and cannot be edited or deleted from';
END $$;

DROP TRIGGER IF EXISTS admin_audit_no_update ON public.admin_audit_log;
CREATE TRIGGER admin_audit_no_update BEFORE UPDATE OR DELETE ON public.admin_audit_log
  FOR EACH ROW EXECUTE FUNCTION public.admin_audit_append_only();

ALTER TABLE public.admin_audit_log ENABLE ROW LEVEL SECURITY;

-- Read-only for admins. No INSERT policy: only the service role writes.
DROP POLICY IF EXISTS "Admins read admin audit log" ON public.admin_audit_log;
CREATE POLICY "Admins read admin audit log"
  ON public.admin_audit_log FOR SELECT
  TO authenticated
  USING ((SELECT public.get_user_role()) = 'admin');

REVOKE ALL ON public.admin_audit_log FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.admin_audit_log FROM authenticated;
