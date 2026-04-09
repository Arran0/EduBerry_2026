-- =============================================================
-- Calendar Access Migration
-- Tracks explicit calendar-view grants between users.
--
-- Role-based defaults (enforced in application code):
--   admin       → can view all calendars
--   principal   → can view all staff calendars
--   coordinator → can view all staff calendars
--   teacher     → own calendar only (unless explicitly granted)
--   student     → own calendar only (unless explicitly granted)
--
-- This table stores additional explicit grants (e.g. a teacher
-- granted access to another teacher's calendar by an admin).
-- =============================================================

CREATE TABLE IF NOT EXISTS calendar_access (
  id         UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_id   UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  viewer_id  UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  granted_by UUID        REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (owner_id, viewer_id)
);

-- Index for fast "who can I view?" lookups
CREATE INDEX IF NOT EXISTS idx_calendar_access_viewer  ON calendar_access(viewer_id);
CREATE INDEX IF NOT EXISTS idx_calendar_access_owner   ON calendar_access(owner_id);

-- ── RLS ──────────────────────────────────────────────────────────────────────
ALTER TABLE calendar_access ENABLE ROW LEVEL SECURITY;

-- Admins can read/write all rows
CREATE POLICY "admins_full_access_calendar_access"
  ON calendar_access
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- Users can read rows where they are the viewer (to know whose calendars they can see)
CREATE POLICY "viewers_can_read_own_grants"
  ON calendar_access
  FOR SELECT
  USING (viewer_id = auth.uid());

-- Users can read rows where they are the owner (to know who can see their calendar)
CREATE POLICY "owners_can_read_own_grants"
  ON calendar_access
  FOR SELECT
  USING (owner_id = auth.uid());
