-- ============================================================================
-- Migration: Transport — Round 3a, notifications and safety
--
-- Round 2 made the module know things. This makes it able to say them, and to
-- handle the case where something has gone badly wrong.
--
-- Applied to the live project as: transport_r3_a_notifications_and_safety.
-- Prereq: transport_r2_c_schedule_and_retire.sql.
-- Run this in the Supabase SQL Editor.
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'notification_channel') THEN
    CREATE TYPE public.notification_channel AS ENUM ('push', 'whatsapp', 'sms', 'email', 'inapp');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'notification_status') THEN
    CREATE TYPE public.notification_status AS ENUM
      ('queued', 'sending', 'sent', 'delivered', 'failed', 'skipped', 'cancelled');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'transport_incident_type') THEN
    CREATE TYPE public.transport_incident_type AS ENUM
      ('sos', 'breakdown', 'accident', 'medical', 'security', 'route_blocked', 'other');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'transport_incident_status') THEN
    CREATE TYPE public.transport_incident_status AS ENUM
      ('open', 'responding', 'resolved', 'false_alarm');
  END IF;
END $$;

-- ── Outbox ──────────────────────────────────────────────────────────────────
-- The unique dedupe_key is the whole idea: enqueue is INSERT ... ON CONFLICT DO
-- NOTHING, so the tick carries no notification state at all and is therefore
-- safe to run twice, safe after a crash, and safe to backfill. A parent cannot
-- be messaged twice about the same fact.

CREATE TABLE IF NOT EXISTS public.notification_outbox (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  module              TEXT NOT NULL DEFAULT 'transport',
  event_type          TEXT NOT NULL,
  channel             public.notification_channel NOT NULL,
  recipient_user_id   UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  recipient_address   TEXT,
  subject_ref         JSONB NOT NULL DEFAULT '{}'::jsonb,
  template_key        TEXT,
  variables           JSONB NOT NULL DEFAULT '{}'::jsonb,
  payload             JSONB,
  dedupe_key          TEXT NOT NULL,
  status              public.notification_status NOT NULL DEFAULT 'queued',
  -- 1 = emergency, bypasses quiet hours.
  priority            SMALLINT NOT NULL DEFAULT 5,
  -- Skip rather than defer past quiet hours: a 6am "arriving in 5 minutes"
  -- delivered at 7am is noise, but a route change for tomorrow is not.
  perishable          BOOLEAN NOT NULL DEFAULT false,
  not_before          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at          TIMESTAMPTZ,
  attempts            SMALLINT NOT NULL DEFAULT 0,
  last_error          TEXT,
  provider            TEXT,
  provider_message_id TEXT,
  sent_at TIMESTAMPTZ, delivered_at TIMESTAMPTZ, failed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS notification_outbox_dedupe ON public.notification_outbox (dedupe_key);
CREATE INDEX IF NOT EXISTS notification_outbox_drain
  ON public.notification_outbox (not_before) WHERE status IN ('queued', 'sending');
CREATE INDEX IF NOT EXISTS notification_outbox_recipient
  ON public.notification_outbox (recipient_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS notification_outbox_provider_msg
  ON public.notification_outbox (provider, provider_message_id) WHERE provider_message_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.message_templates (
  key                    TEXT NOT NULL,
  channel                public.notification_channel NOT NULL,
  locale                 TEXT NOT NULL DEFAULT 'en',
  -- Meta requires business-initiated messages to use a pre-approved template,
  -- so our stable key maps to whatever name they approved.
  provider_template_name TEXT,
  provider_template_lang TEXT DEFAULT 'en',
  variable_order         TEXT[],
  title_template         TEXT,
  body_template          TEXT,
  url_template           TEXT,
  active                 BOOLEAN NOT NULL DEFAULT true,
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (key, channel, locale)
);

CREATE TABLE IF NOT EXISTS public.notification_preferences (
  user_id    UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  channel    public.notification_channel NOT NULL,
  enabled    BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, event_type, channel)
);

-- ── Incidents ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.transport_incidents (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id      UUID REFERENCES public.transport_trip_runs(id) ON DELETE SET NULL,
  route_id    UUID REFERENCES public.transport_routes(id) ON DELETE SET NULL,
  vehicle_id  UUID REFERENCES public.transport_vehicles(id) ON DELETE SET NULL,
  type        public.transport_incident_type NOT NULL,
  severity    public.transport_alert_severity NOT NULL DEFAULT 'critical',
  status      public.transport_incident_status NOT NULL DEFAULT 'open',
  raised_by   UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  lat DOUBLE PRECISION, lng DOUBLE PRECISION, accuracy_m REAL,
  -- Frozen evidence, captured once and never recomputed. An incident is a legal
  -- and parental record; reconstructing "who was on the bus" three days later
  -- from live tables gives a different answer than what the driver saw.
  snapshot    JSONB NOT NULL DEFAULT '{}'::jsonb,
  description TEXT,
  resolved_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  resolution_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_transport_incidents_open
  ON public.transport_incidents (occurred_at DESC) WHERE status <> 'resolved';
CREATE INDEX IF NOT EXISTS idx_transport_incidents_run ON public.transport_incidents (run_id);
CREATE INDEX IF NOT EXISTS idx_transport_incidents_route ON public.transport_incidents (route_id);
CREATE INDEX IF NOT EXISTS idx_transport_incidents_vehicle ON public.transport_incidents (vehicle_id);
CREATE INDEX IF NOT EXISTS idx_transport_incidents_raised_by ON public.transport_incidents (raised_by);
CREATE INDEX IF NOT EXISTS idx_transport_incidents_resolved_by ON public.transport_incidents (resolved_by);

CREATE TABLE IF NOT EXISTS public.transport_incident_updates (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id UUID NOT NULL REFERENCES public.transport_incidents(id) ON DELETE CASCADE,
  author_id   UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  kind        TEXT NOT NULL DEFAULT 'note',
  body        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_transport_incident_updates_incident
  ON public.transport_incident_updates (incident_id, created_at);
CREATE INDEX IF NOT EXISTS idx_transport_incident_updates_author
  ON public.transport_incident_updates (author_id);

-- ── Per-school provider credentials ─────────────────────────────────────────
-- whatsapp_secrets exists in this database with no migration and nothing
-- reading it, in exactly the payment_secrets shape (key TEXT PK, value JSONB).
-- Adopt and generalise it rather than adding a third secrets table.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'whatsapp_secrets')
     AND NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'integration_secrets')
  THEN
    EXECUTE 'ALTER TABLE public.whatsapp_secrets RENAME TO integration_secrets';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.integration_secrets (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Parent contact ──────────────────────────────────────────────────────────
-- student_details.phone is the only contact number the ERP has, and there is no
-- guardian number at all. whatsapp_opt_in_at is the opt-in evidence Meta
-- requires for business-initiated messages; the drain refuses to send without it.

ALTER TABLE public.student_details
  ADD COLUMN IF NOT EXISTS guardian_phone     TEXT,
  ADD COLUMN IF NOT EXISTS guardian_phone_alt TEXT,
  ADD COLUMN IF NOT EXISTS whatsapp_opt_in_at TIMESTAMPTZ;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['notification_outbox', 'transport_incidents'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = t || '_updated_at') THEN
      EXECUTE format(
        'CREATE TRIGGER %I BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION update_task_updated_at()',
        t || '_updated_at', t);
    END IF;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
