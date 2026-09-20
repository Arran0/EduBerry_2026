-- ============================================================================
-- fee_r3_messaging — reminders, pay links, and the WhatsApp opt-out ledger
-- ============================================================================
-- Round 3 of docs/fee-upgrade-plan.md. Run after fee_r3_actor_attribution.sql.
-- Safe to re-run.
--
-- This deliberately adds no messaging stack. The database already has one,
-- built for the transport module and used by nothing in this repo:
--
--   notification_outbox   dedupe_key, not_before, attempts, provider_message_id,
--                         sent_at / delivered_at / failed_at
--   message_templates     channel, provider_template_name, provider_template_lang,
--                         variable_order  — exactly Meta's Cloud API shape
--   notification_channel  an enum that already contains 'whatsapp'
--
-- So Round 3 adds fee templates to that table, a `module = 'fees'` filter on the
-- drain, and the three things the outbox does not know about: which numbers may
-- be messaged, tokenised links that expire, and what a reminder achieved.
--
-- Reminders have no escalating tone, at the school's instruction. One
-- respectful template; only frequency and time of day are configurable.

-- ── Which numbers may be messaged ───────────────────────────────────────
-- student_details.whatsapp_opt_in_at already exists. This adds the other half:
-- an explicit opt-out, honoured before anything is queued. A guardian who
-- replies STOP must never be messaged again, and Meta's quality rating depends
-- on that as much as decency does.
CREATE TABLE IF NOT EXISTS public.whatsapp_numbers (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  student_id  UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  msisdn      TEXT NOT NULL,
  label       TEXT,
  opt_in_at   TIMESTAMPTZ,
  opt_out_at  TIMESTAMPTZ,
  verified_at TIMESTAMPTZ,
  source      TEXT NOT NULL DEFAULT 'admission',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (student_id, msisdn)
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_numbers_msisdn ON public.whatsapp_numbers(msisdn);

-- India: strip spaces and punctuation, drop a leading 0, add 91 when absent.
-- Meta wants an E.164 number without the +.
CREATE OR REPLACE FUNCTION public.normalize_msisdn(p_raw TEXT, p_default_cc TEXT DEFAULT '91')
RETURNS TEXT
LANGUAGE sql IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_raw IS NULL THEN NULL
    WHEN regexp_replace(p_raw, '\D', '', 'g') = '' THEN NULL
    ELSE (
      WITH d AS (SELECT regexp_replace(p_raw, '\D', '', 'g') AS n)
      SELECT CASE
        WHEN length(n) = 10                    THEN p_default_cc || n
        WHEN length(n) = 11 AND left(n,1) = '0' THEN p_default_cc || right(n, 10)
        WHEN length(n) >= 11                   THEN n
        ELSE n
      END FROM d)
  END;
$$;

-- Where a bill's messages go. The guardian's number wins over the student's,
-- because the person who pays is the person to tell.
CREATE OR REPLACE FUNCTION public.fee_contact_msisdn(p_student UUID)
RETURNS TEXT
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT public.normalize_msisdn(COALESCE(
    (SELECT w.msisdn FROM public.whatsapp_numbers w
      WHERE w.student_id = p_student AND w.opt_out_at IS NULL
      ORDER BY w.opt_in_at DESC NULLS LAST LIMIT 1),
    (SELECT d.guardian_phone FROM public.student_details d WHERE d.student_id = p_student),
    (SELECT d.phone FROM public.student_details d WHERE d.student_id = p_student)));
$$;

CREATE OR REPLACE FUNCTION public.fee_may_message(p_student UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT public.fee_contact_msisdn(p_student) IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.whatsapp_numbers w
        WHERE w.student_id = p_student
          AND w.opt_out_at IS NOT NULL
          AND w.msisdn = public.fee_contact_msisdn(p_student));
$$;

-- ── Tokenised links ─────────────────────────────────────────────────────
-- A WhatsApp message is forwarded, screenshotted and kept. A link inside one
-- must therefore expire, be revocable, and reveal nothing on its own.
CREATE TABLE IF NOT EXISTS public.fee_message_links (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  token       TEXT NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(18), 'hex'),
  kind        TEXT NOT NULL DEFAULT 'invoice' CHECK (kind IN ('invoice', 'receipt', 'statement')),
  invoice_id  UUID REFERENCES public.fee_invoices(id) ON DELETE CASCADE,
  student_id  UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  expires_at  TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '30 days',
  revoked_at  TIMESTAMPTZ,
  opened_at   TIMESTAMPTZ,
  open_count  INT NOT NULL DEFAULT 0,
  paid_at     TIMESTAMPTZ,
  created_by  UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fee_links_invoice ON public.fee_message_links(invoice_id);
CREATE INDEX IF NOT EXISTS idx_fee_links_student ON public.fee_message_links(student_id);

-- Resolving a link is the only thing the public pay page can do. It returns
-- what is already on the bill and nothing else — no student id, no profile.
CREATE OR REPLACE FUNCTION public.fee_resolve_pay_link(p_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_l   public.fee_message_links%ROWTYPE;
  v_inv RECORD;
BEGIN
  SELECT * INTO v_l FROM public.fee_message_links WHERE token = p_token;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;
  IF v_l.revoked_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'revoked');
  END IF;
  IF v_l.expires_at < NOW() THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'expired');
  END IF;

  SELECT i.number, i.due_date, i.net, i.paid, i.balance, i.status, p.full_name
    INTO v_inv
    FROM public.fee_invoices i
    JOIN public.profiles p ON p.id = i.student_id
   WHERE i.id = v_l.invoice_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;

  UPDATE public.fee_message_links
     SET opened_at = COALESCE(opened_at, NOW()), open_count = open_count + 1
   WHERE id = v_l.id;

  RETURN jsonb_build_object(
    'ok', v_inv.status <> 'cancelled',
    'reason', CASE WHEN v_inv.status = 'cancelled' THEN 'cancelled' ELSE NULL END,
    'number', v_inv.number, 'student', v_inv.full_name,
    'due_on', v_inv.due_date, 'amount', v_inv.net,
    'paid', v_inv.paid, 'balance', v_inv.balance, 'status', v_inv.status,
    'school', (SELECT COALESCE(value ->> 'schoolName', 'The school')
                 FROM public.site_settings WHERE key = 'branding'));
END $$;

-- ── Reminder schedules and the log ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.fee_reminder_schedules (
  id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  academic_year_id UUID NOT NULL REFERENCES public.academic_years(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  enabled          BOOLEAN NOT NULL DEFAULT false,
  -- Days relative to the due date. Negative is before. There is no tone here
  -- on purpose: the school asked for one respectful message, sent more or less
  -- often, not a sequence that gets sterner.
  offsets          INT[] NOT NULL DEFAULT ARRAY[-3, 0, 7, 14],
  send_at          TIME NOT NULL DEFAULT '10:00',
  channels         TEXT[] NOT NULL DEFAULT ARRAY['whatsapp'],
  skip_if_paid     BOOLEAN NOT NULL DEFAULT true,
  -- 0 = Sunday. A school that does not want Sunday messages says so here.
  quiet_days       INT[] NOT NULL DEFAULT ARRAY[]::INT[],
  created_by       UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.fee_reminder_log (
  id            BIGSERIAL PRIMARY KEY,
  student_id    UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  invoice_id    UUID REFERENCES public.fee_invoices(id) ON DELETE CASCADE,
  schedule_id   UUID REFERENCES public.fee_reminder_schedules(id) ON DELETE SET NULL,
  channel       TEXT NOT NULL DEFAULT 'whatsapp',
  template_key  TEXT,
  outbox_id     UUID REFERENCES public.notification_outbox(id) ON DELETE SET NULL,
  msisdn        TEXT,
  link_id       UUID REFERENCES public.fee_message_links(id) ON DELETE SET NULL,
  -- What the bill owed when the message went. Round 4's "collected because of
  -- reminders" is the difference between this and what was paid afterwards.
  balance_then  NUMERIC(12,2),
  sent_at       TIMESTAMPTZ,
  delivered_at  TIMESTAMPTZ,
  read_at       TIMESTAMPTZ,
  failed_at     TIMESTAMPTZ,
  paid_at       TIMESTAMPTZ,
  sent_by       UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fee_reminder_log_student ON public.fee_reminder_log(student_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_fee_reminder_log_invoice ON public.fee_reminder_log(invoice_id);
CREATE INDEX IF NOT EXISTS idx_fee_reminder_log_outbox  ON public.fee_reminder_log(outbox_id);

DROP TRIGGER IF EXISTS fee_reminder_schedules_touch ON public.fee_reminder_schedules;
CREATE TRIGGER fee_reminder_schedules_touch BEFORE UPDATE ON public.fee_reminder_schedules
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ── Queueing a reminder ─────────────────────────────────────────────────
-- Everything a send has to get right in one place: skip the paid, skip the
-- opted-out, mint a link, queue on the existing outbox with a dedupe key so a
-- double-click cannot double-message, and log it.
CREATE OR REPLACE FUNCTION public.fee_queue_reminder(
  p_invoice   UUID,
  p_template  TEXT DEFAULT 'fee_reminder_due',
  p_schedule  UUID DEFAULT NULL,
  p_not_before TIMESTAMPTZ DEFAULT NULL,
  p_actor     UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor  UUID := public.fee_actor(p_actor);
  v_inv    RECORD;
  v_msisdn TEXT;
  v_token  TEXT;
  v_link   UUID;
  v_outbox UUID;
  v_dedupe TEXT;
  v_site   TEXT;
BEGIN
  IF NOT public.fee_requires('fees.reminder.send') THEN
    RAISE EXCEPTION 'You do not have permission to send reminders';
  END IF;

  SELECT i.id, i.number, i.student_id, i.academic_year_id, i.due_date,
         i.balance, i.status, p.full_name
    INTO v_inv
    FROM public.fee_invoices i JOIN public.profiles p ON p.id = i.student_id
   WHERE i.id = p_invoice;
  IF NOT FOUND THEN RAISE EXCEPTION 'No such bill'; END IF;

  -- Nobody gets chased for a bill they have already settled. This is the
  -- single most damaging reminder a school can send.
  IF v_inv.balance <= 0 OR v_inv.status IN ('paid', 'cancelled') THEN
    RETURN jsonb_build_object('queued', false, 'reason', 'already_settled');
  END IF;

  IF NOT public.fee_may_message(v_inv.student_id) THEN
    RETURN jsonb_build_object('queued', false, 'reason', 'no_contact_or_opted_out');
  END IF;

  v_msisdn := public.fee_contact_msisdn(v_inv.student_id);

  INSERT INTO public.fee_message_links (kind, invoice_id, student_id, created_by)
  VALUES ('invoice', p_invoice, v_inv.student_id, v_actor)
  RETURNING id, token INTO v_link, v_token;

  SELECT COALESCE(value ->> 'site_url', '') INTO v_site
    FROM public.site_settings WHERE key = 'branding';

  -- One message per bill per template per day. A clerk pressing Remind twice
  -- must not send twice, and the outbox already enforces this.
  v_dedupe := format('fees:%s:%s:%s', p_invoice, p_template, CURRENT_DATE);

  INSERT INTO public.notification_outbox (
    module, event_type, channel, recipient_user_id, recipient_address,
    subject_ref, template_key, variables, dedupe_key, not_before, priority)
  VALUES (
    'fees', p_template, 'whatsapp', v_inv.student_id, v_msisdn,
    jsonb_build_object('invoice_id', p_invoice, 'student_id', v_inv.student_id),
    p_template,
    jsonb_build_object(
      'student',  v_inv.full_name,
      'number',   v_inv.number,
      'amount',   to_char(v_inv.balance, 'FM99,99,99,990'),
      'due_date', to_char(v_inv.due_date, 'DD Mon YYYY'),
      'link',     v_token),
    v_dedupe, COALESCE(p_not_before, NOW()), 5)
  ON CONFLICT (dedupe_key) DO NOTHING
  RETURNING id INTO v_outbox;

  IF v_outbox IS NULL THEN
    -- Already queued today. Drop the link we just minted rather than leaving
    -- an orphan that never reaches anyone.
    DELETE FROM public.fee_message_links WHERE id = v_link;
    RETURN jsonb_build_object('queued', false, 'reason', 'already_sent_today');
  END IF;

  INSERT INTO public.fee_reminder_log (
    student_id, invoice_id, schedule_id, channel, template_key,
    outbox_id, msisdn, link_id, balance_then, sent_by)
  VALUES (v_inv.student_id, p_invoice, p_schedule, 'whatsapp', p_template,
          v_outbox, v_msisdn, v_link, v_inv.balance, v_actor);

  PERFORM public.fee_log('reminder.queue', 'fee_invoices', p_invoice,
    v_inv.student_id, v_inv.academic_year_id, NULL,
    jsonb_build_object('template', p_template, 'to', right(v_msisdn, 4)),
    NULL, v_inv.balance, v_actor);

  RETURN jsonb_build_object(
    'queued', true, 'outbox_id', v_outbox, 'link_token', v_token,
    'to', '••••••' || right(v_msisdn, 4));
END $$;

-- ── The nightly reminder run ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fee_reminder_tick()
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_s      RECORD;
  v_inv    RECORD;
  v_offset INT;
  v_queued INT := 0;
  v_seen   INT := 0;
BEGIN
  FOR v_s IN
    SELECT * FROM public.fee_reminder_schedules WHERE enabled
  LOOP
    -- A school that does not message on a Sunday says so, and this is where it
    -- is honoured rather than in the message body.
    CONTINUE WHEN EXTRACT(DOW FROM CURRENT_DATE)::INT = ANY(v_s.quiet_days);

    FOREACH v_offset IN ARRAY v_s.offsets LOOP
      FOR v_inv IN
        SELECT i.id FROM public.fee_invoices i
         WHERE i.academic_year_id = v_s.academic_year_id
           AND i.status IN ('pending', 'partly_paid', 'overdue')
           AND i.balance > 0
           AND i.due_date + v_offset = CURRENT_DATE
      LOOP
        v_seen := v_seen + 1;
        IF (public.fee_queue_reminder(
              v_inv.id,
              CASE WHEN v_offset > 0 THEN 'fee_reminder_overdue' ELSE 'fee_reminder_due' END,
              v_s.id) ->> 'queued')::BOOLEAN THEN
          v_queued := v_queued + 1;
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object('considered', v_seen, 'queued', v_queued);
END $$;

-- ── Fee templates on the existing message_templates table ───────────────
-- provider_template_name and variable_order are what the Meta Cloud API needs:
-- its template messages take positional parameters, so the order here is the
-- contract with what you register in WhatsApp Manager.
INSERT INTO public.message_templates (
  key, channel, locale, provider_template_name, provider_template_lang,
  variable_order, title_template, body_template, url_template, active)
VALUES
  ('fee_invoice_issued', 'whatsapp', 'en', 'fee_invoice_issued', 'en',
   ARRAY['student','number','amount','due_date'],
   'Fee bill {{number}}',
   'Dear Parent, the fee bill {{number}} for {{student}} is Rs. {{amount}}, due {{due_date}}. You can pay using the link below.',
   '/pay/{{link}}', true),

  ('fee_payment_receipt', 'whatsapp', 'en', 'fee_payment_receipt', 'en',
   ARRAY['student','receipt_no','amount','paid_on'],
   'Receipt {{receipt_no}}',
   'Thank you. We have received Rs. {{amount}} for {{student}} on {{paid_on}}. Receipt {{receipt_no}}.',
   '/verify/receipt/{{link}}', true),

  ('fee_reminder_due', 'whatsapp', 'en', 'fee_reminder_due', 'en',
   ARRAY['student','number','amount','due_date'],
   'Fee due {{due_date}}',
   'Dear Parent, Rs. {{amount}} is due on {{due_date}} for {{student}} (bill {{number}}). You can pay using the link below. If you have already paid, please ignore this.',
   '/pay/{{link}}', true),

  ('fee_reminder_overdue', 'whatsapp', 'en', 'fee_reminder_overdue', 'en',
   ARRAY['student','number','amount','due_date'],
   'Fee overdue',
   'Dear Parent, Rs. {{amount}} for {{student}} (bill {{number}}) was due on {{due_date}} and is still outstanding. You can pay using the link below, or contact the school office if you would like to discuss it.',
   '/pay/{{link}}', true),

  ('fee_cheque_bounced', 'whatsapp', 'en', 'fee_cheque_bounced', 'en',
   ARRAY['student','cheque_no','amount'],
   'Cheque returned',
   'Dear Parent, cheque {{cheque_no}} for Rs. {{amount}} towards {{student}}''s fees has been returned by the bank. The bill has been reopened. Please contact the school office.',
   NULL, true),

  ('fee_concession_applied', 'whatsapp', 'en', 'fee_concession_applied', 'en',
   ARRAY['student','label','amount','number'],
   'Concession applied',
   'Dear Parent, a {{label}} of Rs. {{amount}} has been applied to {{student}}''s bill {{number}}. The updated amount is shown on the bill.',
   NULL, true)
ON CONFLICT (key, channel, locale) DO UPDATE
  SET provider_template_name = EXCLUDED.provider_template_name,
      variable_order = EXCLUDED.variable_order,
      title_template = EXCLUDED.title_template,
      body_template = EXCLUDED.body_template,
      url_template = EXCLUDED.url_template;

-- Which students a number belongs to, for an inbound STOP.
-- A guardian's number is often shared by siblings, and opting out means
-- opting out of messages about all of them — anything else is a family still
-- being messaged after they asked not to be.
CREATE OR REPLACE FUNCTION public.fee_students_by_msisdn(p_msisdn TEXT)
RETURNS SETOF UUID
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT d.student_id FROM public.student_details d
   WHERE public.normalize_msisdn(d.guardian_phone) = public.normalize_msisdn(p_msisdn)
      OR public.normalize_msisdn(d.guardian_phone_alt) = public.normalize_msisdn(p_msisdn)
      OR public.normalize_msisdn(d.phone) = public.normalize_msisdn(p_msisdn);
$$;

-- ── The drain kick ──────────────────────────────────────────────────────
-- transport_kick_drain with a module filter. Counting first means a quiet
-- minute costs a COUNT, not an HTTP request that wakes a serverless function.
CREATE OR REPLACE FUNCTION public.fee_kick_drain()
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, net
AS $$
DECLARE
  v_url    TEXT;
  v_secret TEXT;
  v_pending INT;
BEGIN
  SELECT value ->> 'drain_url'   INTO v_url    FROM public.site_settings WHERE key = 'fee_runtime';
  SELECT value ->> 'cron_secret' INTO v_secret FROM public.site_settings WHERE key = 'fee_runtime';
  IF v_url IS NULL OR v_secret IS NULL THEN RETURN; END IF;

  SELECT count(*) INTO v_pending
    FROM public.notification_outbox
   WHERE module = 'fees' AND status IN ('queued', 'sending') AND not_before <= NOW();
  IF v_pending = 0 THEN RETURN; END IF;

  PERFORM net.http_post(
    url := v_url,
    body := jsonb_build_object('limit', 50),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret));
END $$;

-- Claim a batch for sending. FOR UPDATE SKIP LOCKED so two workers running at
-- once take different messages rather than both taking the same one.
CREATE OR REPLACE FUNCTION public.fee_claim_outbox(p_limit INT DEFAULT 50)
RETURNS SETOF public.notification_outbox
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH claimed AS (
    SELECT id FROM public.notification_outbox
     WHERE module = 'fees' AND status = 'queued' AND not_before <= NOW()
       AND (expires_at IS NULL OR expires_at > NOW())
     ORDER BY priority, not_before
     LIMIT p_limit
     FOR UPDATE SKIP LOCKED)
  UPDATE public.notification_outbox o
     SET status = 'sending', attempts = o.attempts + 1, updated_at = NOW()
    FROM claimed
   WHERE o.id = claimed.id
  RETURNING o.*;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('fee-drain')     WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'fee-drain');
    PERFORM cron.unschedule('fee-reminders') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'fee-reminders');
    PERFORM cron.schedule('fee-drain', '* * * * *', 'SELECT public.fee_kick_drain();');
    -- 10:00 IST is 04:30 UTC.
    PERFORM cron.schedule('fee-reminders', '30 4 * * *', 'SELECT public.fee_reminder_tick();');
  END IF;
END$$;

-- ── RLS ─────────────────────────────────────────────────────────────────
ALTER TABLE public.whatsapp_numbers         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fee_message_links        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fee_reminder_schedules   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fee_reminder_log         ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read whatsapp numbers" ON public.whatsapp_numbers;
CREATE POLICY "Read whatsapp numbers" ON public.whatsapp_numbers
  FOR SELECT TO authenticated
  USING (student_id = (SELECT auth.uid()) OR public.has_fee_permission('fees.profile.view'));
DROP POLICY IF EXISTS "Manage whatsapp numbers" ON public.whatsapp_numbers;
CREATE POLICY "Manage whatsapp numbers" ON public.whatsapp_numbers
  FOR ALL TO authenticated
  USING (public.has_fee_permission('fees.reminder.send'))
  WITH CHECK (public.has_fee_permission('fees.reminder.send'));

-- Links are read through fee_resolve_pay_link, which is SECURITY DEFINER and
-- returns only what is on the bill. No client reads this table directly.
DROP POLICY IF EXISTS "Read fee message links" ON public.fee_message_links;
CREATE POLICY "Read fee message links" ON public.fee_message_links
  FOR SELECT TO authenticated USING (public.has_fee_permission('fees.reminder.send'));
DROP POLICY IF EXISTS "Revoke fee message links" ON public.fee_message_links;
CREATE POLICY "Revoke fee message links" ON public.fee_message_links
  FOR UPDATE TO authenticated
  USING (public.has_fee_permission('fees.reminder.send'))
  WITH CHECK (public.has_fee_permission('fees.reminder.send'));

DROP POLICY IF EXISTS "Manage reminder schedules" ON public.fee_reminder_schedules;
CREATE POLICY "Manage reminder schedules" ON public.fee_reminder_schedules
  FOR ALL TO authenticated
  USING (public.has_fee_permission('fees.reminder.send'))
  WITH CHECK (public.has_fee_permission('fees.reminder.send'));

DROP POLICY IF EXISTS "Read reminder log" ON public.fee_reminder_log;
CREATE POLICY "Read reminder log" ON public.fee_reminder_log
  FOR SELECT TO authenticated
  USING (student_id = (SELECT auth.uid()) OR public.has_fee_permission('fees.profile.view'));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.whatsapp_numbers, public.fee_reminder_schedules TO authenticated;
GRANT SELECT, UPDATE ON public.fee_message_links TO authenticated;
GRANT SELECT ON public.fee_reminder_log TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.fee_reminder_log_id_seq TO authenticated;

DO $$
DECLARE fn TEXT;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'normalize_msisdn(text,text)', 'fee_contact_msisdn(uuid)', 'fee_may_message(uuid)',
    'fee_queue_reminder(uuid,text,uuid,timestamptz,uuid)',
    'fee_reminder_tick()', 'fee_kick_drain()', 'fee_claim_outbox(int)',
    'fee_resolve_pay_link(text)', 'fee_students_by_msisdn(text)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', fn);
  END LOOP;

  EXECUTE 'GRANT EXECUTE ON FUNCTION public.fee_queue_reminder(uuid,text,uuid,timestamptz,uuid) TO authenticated';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.fee_contact_msisdn(uuid) TO authenticated';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.fee_may_message(uuid) TO authenticated';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.normalize_msisdn(text,text) TO authenticated';
  -- The pay page is reached without a login, so anon must be able to resolve a
  -- token. It returns only what the bill already says.
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.fee_resolve_pay_link(text) TO anon, authenticated';
END$$;

NOTIFY pgrst, 'reload schema';
