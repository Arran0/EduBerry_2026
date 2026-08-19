-- ============================================================
-- Web Push subscriptions
--
-- Stores one row per browser/device a user has enabled notifications on.
-- Push itself is free: we sign our own payloads with VAPID keys and post
-- them to the browser vendor's push service (FCM / Mozilla / Apple). No
-- paid messaging product is involved.
--
-- Safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- The push service URL that identifies this device. Unique so re-subscribing
  -- the same browser updates the row instead of piling up duplicates.
  endpoint    TEXT NOT NULL UNIQUE,
  -- Encryption material handed to us by the browser's PushManager
  p256dh      TEXT NOT NULL,
  auth        TEXT NOT NULL,
  user_agent  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS push_subscriptions_user_idx
  ON public.push_subscriptions (user_id);

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

-- A user may only ever see or touch their own devices. The send path runs
-- with the service role, which bypasses RLS entirely.
DROP POLICY IF EXISTS "push_subs_select_own" ON public.push_subscriptions;
CREATE POLICY "push_subs_select_own"
  ON public.push_subscriptions FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "push_subs_insert_own" ON public.push_subscriptions;
CREATE POLICY "push_subs_insert_own"
  ON public.push_subscriptions FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "push_subs_update_own" ON public.push_subscriptions;
CREATE POLICY "push_subs_update_own"
  ON public.push_subscriptions FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "push_subs_delete_own" ON public.push_subscriptions;
CREATE POLICY "push_subs_delete_own"
  ON public.push_subscriptions FOR DELETE
  USING (auth.uid() = user_id);
