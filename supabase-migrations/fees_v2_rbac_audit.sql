-- ============================================================================
-- fees_v2_rbac_audit — capabilities, approvals, audit triggers, retention
-- ============================================================================
-- Run after fees_v2_refunds_audit.sql. Safe to re-run.
--
-- ── What RBAC already exists ────────────────────────────────────────────────
-- profiles.role, five values (student, teacher, coordinator, principal, admin),
-- read by public.get_user_role() and used in every RLS policy in the schema.
-- There is no permissions table anywhere. So this EXTENDS that rather than
-- replacing it: the role stays the identity, and a capability table says what
-- each role may do in the fee module specifically.
--
-- The reason for a table rather than more hardcoded role checks: a school
-- office has an accountant who may record payments but must not approve
-- refunds, and a principal who may approve refunds but never touches the
-- counter. Encoding that in code means a deploy every time a school
-- reorganises, and every incumbent product in this market gets it wrong the
-- same way.
--
-- ── Approvals ───────────────────────────────────────────────────────────────
-- Maker–checker on the four things that move money or reduce demand. The rule
-- that the requester cannot approve is already enforced by triggers on
-- fee_concessions and fee_refunds; this generalises it to structures and
-- cancellations and gives the office a single queue to work.

-- ── fee_permissions ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.fee_permissions (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  role       TEXT NOT NULL,
  capability TEXT NOT NULL CHECK (capability IN (
               'issue_fee', 'record_payment', 'verify_payment',
               'cancel_fee', 'cancel_receipt',
               'request_concession', 'approve_concession',
               'request_refund', 'approve_refund',
               'publish_structure', 'run_demand',
               'view_reports', 'export_accounting')),
  granted_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (role, capability)
);

ALTER TABLE public.fee_permissions ENABLE ROW LEVEL SECURITY;

-- Everyone signed in may READ the grid — a clerk should be able to see why a
-- button is disabled rather than filing a support ticket about it. Only an
-- admin may change it.
DROP POLICY IF EXISTS "Authenticated read fee permissions" ON public.fee_permissions;
CREATE POLICY "Authenticated read fee permissions"
  ON public.fee_permissions FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Admin manage fee permissions" ON public.fee_permissions;
CREATE POLICY "Admin manage fee permissions" ON public.fee_permissions FOR ALL
  USING (public.get_user_role() = 'admin') WITH CHECK (public.get_user_role() = 'admin');

-- Seed: reproduce today's behaviour exactly, so running this migration changes
-- nobody's access. Admin gets everything; principal gets oversight and the
-- approval half of maker–checker but NOT the request half, which is the
-- separation the whole design rests on.
INSERT INTO public.fee_permissions (role, capability)
SELECT r.role, c.capability
FROM (VALUES ('admin')) AS r(role)
CROSS JOIN (VALUES
  ('issue_fee'), ('record_payment'), ('verify_payment'),
  ('cancel_fee'), ('cancel_receipt'),
  ('request_concession'), ('approve_concession'),
  ('request_refund'), ('approve_refund'),
  ('publish_structure'), ('run_demand'),
  ('view_reports'), ('export_accounting')
) AS c(capability)
ON CONFLICT (role, capability) DO NOTHING;

INSERT INTO public.fee_permissions (role, capability)
SELECT r.role, c.capability
FROM (VALUES ('principal')) AS r(role)
CROSS JOIN (VALUES
  ('approve_concession'), ('approve_refund'), ('publish_structure'),
  ('view_reports'), ('export_accounting')
) AS c(capability)
ON CONFLICT (role, capability) DO NOTHING;

-- ── fee_approvals ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.fee_approvals (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  entity_type   TEXT NOT NULL CHECK (entity_type IN
                  ('fee_structure', 'fee_concession', 'fee_refund', 'fee_cancellation', 'fee_receipt')),
  entity_id     UUID NOT NULL,
  action        TEXT NOT NULL,
  /* What is being asked for, in the words the approver needs. */
  summary       TEXT NOT NULL,
  amount        NUMERIC(10,2),
  student_id    UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  payload       JSONB,

  requested_by  UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  requested_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  /* Which role may decide this. Checked against fee_permissions at decision time. */
  approver_role TEXT,

  status        TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'approved', 'rejected', 'withdrawn')),
  decided_by    UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  decided_at    TIMESTAMPTZ,
  note          TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (entity_type, entity_id, action, status) DEFERRABLE INITIALLY DEFERRED
);

CREATE INDEX IF NOT EXISTS idx_fee_approvals_pending
  ON public.fee_approvals(requested_at DESC) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_fee_approvals_entity
  ON public.fee_approvals(entity_type, entity_id);

-- Maker–checker, generalised. Already enforced on concessions and refunds by
-- their own triggers; this covers structures and cancellations too, so there is
-- one rule rather than three implementations of it.
CREATE OR REPLACE FUNCTION public.fee_approvals_check()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IN ('approved', 'rejected') AND OLD.status = 'pending' THEN
    IF NEW.decided_by IS NULL THEN
      RAISE EXCEPTION 'A decided request must record who decided it.';
    END IF;
    IF NEW.decided_by = NEW.requested_by THEN
      RAISE EXCEPTION 'A request cannot be decided by the person who raised it.';
    END IF;
    NEW.decided_at := COALESCE(NEW.decided_at, NOW());
  END IF;
  IF OLD.status <> 'pending' AND NEW.status <> OLD.status THEN
    RAISE EXCEPTION 'This request is already %; it cannot be decided again.', OLD.status;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS fee_approvals_check_trg ON public.fee_approvals;
CREATE TRIGGER fee_approvals_check_trg
  BEFORE UPDATE ON public.fee_approvals
  FOR EACH ROW EXECUTE FUNCTION public.fee_approvals_check();

ALTER TABLE public.fee_approvals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff read fee approvals" ON public.fee_approvals;
CREATE POLICY "Staff read fee approvals" ON public.fee_approvals FOR SELECT
  USING (public.get_user_role() IN ('admin', 'principal', 'coordinator'));

DROP POLICY IF EXISTS "Requester reads own approvals" ON public.fee_approvals;
CREATE POLICY "Requester reads own approvals" ON public.fee_approvals FOR SELECT
  USING (requested_by = auth.uid());

-- Writes go through guarded routes with the service role. A person editing
-- their own approval row directly is exactly what maker–checker is against.

-- ── Audit triggers ──────────────────────────────────────────────────────────
-- The API routes already write fee_audit_log for the actions they carry out.
-- These triggers are the backstop for everything else: a direct SQL correction,
-- a Supabase-dashboard edit, a code path added later that forgets. An audit
-- trail that only records what the application remembered to tell it is not
-- one.
--
-- auth.uid() is NULL under the service role, which is correct and deliberate:
-- it records "changed outside a user session" rather than inventing an actor.
-- The routes supply the real actor for everything they do.

CREATE OR REPLACE FUNCTION public.fee_audit_trigger()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  entity  TEXT := TG_ARGV[0];
  student UUID;
  changed JSONB;
BEGIN
  IF TG_OP = 'DELETE' THEN
    INSERT INTO public.fee_audit_log (actor_id, action, entity_type, entity_id, summary, before)
    VALUES (auth.uid(), entity || '.delete', entity, OLD.id, 'Row deleted', to_jsonb(OLD));
    RETURN OLD;
  END IF;

  BEGIN student := (to_jsonb(NEW) ->> 'student_id')::uuid; EXCEPTION WHEN OTHERS THEN student := NULL; END;

  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.fee_audit_log (actor_id, action, entity_type, entity_id, student_id, summary, after)
    VALUES (auth.uid(), entity || '.insert', entity, NEW.id, student, 'Row created', to_jsonb(NEW));
    RETURN NEW;
  END IF;

  -- Only the changed keys. Copying every column of every write turns the audit
  -- log into a second, less-protected copy of the student database, which under
  -- DPDP is the wrong shape as well as the expensive one.
  SELECT jsonb_object_agg(key, value) INTO changed
  FROM jsonb_each(to_jsonb(NEW))
  WHERE to_jsonb(NEW) -> key IS DISTINCT FROM to_jsonb(OLD) -> key
    AND key <> 'updated_at';

  IF changed IS NULL OR changed = '{}'::jsonb THEN RETURN NEW; END IF;

  INSERT INTO public.fee_audit_log (actor_id, action, entity_type, entity_id, student_id, summary, before, after)
  VALUES (
    auth.uid(), entity || '.update', entity, NEW.id, student,
    'Changed: ' || (SELECT string_agg(k, ', ' ORDER BY k) FROM jsonb_object_keys(changed) AS k),
    (SELECT jsonb_object_agg(k, to_jsonb(OLD) -> k) FROM jsonb_object_keys(changed) AS k),
    changed
  );
  RETURN NEW;
END $$;

DO $$
DECLARE
  t RECORD;
BEGIN
  FOR t IN SELECT * FROM (VALUES
    ('school_fees', 'fee'),
    ('fee_heads', 'fee_head'),
    ('fee_structures', 'fee_structure'),
    ('fee_structure_items', 'fee_structure_item'),
    ('fee_concessions', 'fee_concession'),
    ('fee_structure_assignments', 'fee_assignment'),
    ('fee_refunds', 'fee_refund'),
    ('fee_receipts', 'fee_receipt'),
    ('fee_permissions', 'fee_permission')
  ) AS v(tbl, entity) LOOP
    IF to_regclass('public.' || t.tbl) IS NOT NULL THEN
      EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', t.tbl || '_audit', t.tbl);
      EXECUTE format(
        'CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON public.%I
           FOR EACH ROW EXECUTE FUNCTION public.fee_audit_trigger(%L)',
        t.tbl || '_audit', t.tbl, t.entity);
    END IF;
  END LOOP;
END $$;

-- ── Retention ───────────────────────────────────────────────────────────────
-- CERT-In's direction on log retention is 180 days, so that is what the fee
-- audit log keeps. Two things are deliberately NOT covered by it:
--
--   • fee_transactions — the money ledger is financial record, not a log, and
--     is governed by the Income Tax Act's much longer retention. It is never
--     pruned by anything here.
--   • fee_refund_events, fee_approvals — the story of a decision about money.
--     Same reasoning.
--
-- What ages out is the change log: who edited which field, when. 180 days of
-- that is what the guidance asks for and what a security review will look for.
--
-- fee_webhook_events is pruned at 90 days: it exists to replay a failed match
-- and to answer "did the provider ever send us that", and both questions have a
-- short useful life. The ledger rows it produced are permanent.

CREATE OR REPLACE FUNCTION public.cleanup_fee_audit_log()
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  DELETE FROM public.fee_audit_log WHERE created_at < NOW() - INTERVAL '180 days';
$$;

CREATE OR REPLACE FUNCTION public.cleanup_fee_webhook_events()
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  DELETE FROM public.fee_webhook_events
  WHERE received_at < NOW() - INTERVAL '90 days' AND processed_at IS NOT NULL;
$$;

-- Sent reminders older than a year are noise; queued ones are never pruned,
-- because a message stuck in the queue is a bug somebody needs to see.
CREATE OR REPLACE FUNCTION public.cleanup_fee_notifications()
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  DELETE FROM public.fee_notifications
  WHERE created_at < NOW() - INTERVAL '365 days'
    AND status IN ('sent', 'skipped', 'failed');
$$;

-- pg_cron is already installed and this is the pattern
-- enable_pg_cron_and_schedule_retention.sql established. Unschedule first so
-- re-running this file does not stack duplicate jobs.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job
      WHERE jobname IN ('cleanup-fee-audit-log', 'cleanup-fee-webhook-events', 'cleanup-fee-notifications');

    PERFORM cron.schedule('cleanup-fee-audit-log',       '30 3 * * *', $c$ SELECT public.cleanup_fee_audit_log(); $c$);
    PERFORM cron.schedule('cleanup-fee-webhook-events',  '40 3 * * *', $c$ SELECT public.cleanup_fee_webhook_events(); $c$);
    PERFORM cron.schedule('cleanup-fee-notifications',   '50 3 * * *', $c$ SELECT public.cleanup_fee_notifications(); $c$);
  ELSE
    RAISE NOTICE 'pg_cron is not installed; fee retention jobs were not scheduled. Run enable_pg_cron_and_schedule_retention.sql first.';
  END IF;
END $$;

-- ── Grants ──────────────────────────────────────────────────────────────────

GRANT SELECT ON public.fee_permissions, public.fee_approvals TO authenticated;

NOTIFY pgrst, 'reload schema';
