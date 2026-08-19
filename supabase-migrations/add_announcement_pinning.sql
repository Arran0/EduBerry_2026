-- ============================================================
-- Announcement pinning
-- Lets the announcer (creator) — and principal/admin — pin an
-- announcement so it stays at the top of the feed.
-- Safe to run multiple times.
-- ============================================================

ALTER TABLE public.announcements
  ADD COLUMN IF NOT EXISTS pinned    BOOLEAN     NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS pinned_at TIMESTAMPTZ;

-- Feed ordering: pinned first, then newest first
CREATE INDEX IF NOT EXISTS announcements_pinned_created_idx
  ON public.announcements (pinned DESC, created_at DESC);

-- ------------------------------------------------------------
-- Update policy — mirrors the delete policy:
-- creator (coordinator) can pin/unpin their own, principal/admin any
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "update_own_or_privileged" ON public.announcements;

CREATE POLICY "update_own_or_privileged"
  ON public.announcements FOR UPDATE
  USING (
    (auth.jwt() -> 'user_metadata' ->> 'role') IN ('principal', 'admin')
    OR (
      created_by = auth.uid()
      AND (auth.jwt() -> 'user_metadata' ->> 'role') = 'coordinator'
    )
  )
  WITH CHECK (
    (auth.jwt() -> 'user_metadata' ->> 'role') IN ('principal', 'admin')
    OR (
      created_by = auth.uid()
      AND (auth.jwt() -> 'user_metadata' ->> 'role') = 'coordinator'
    )
  );
