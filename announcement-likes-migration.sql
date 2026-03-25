-- Migration: announcement_likes table
-- Run this in your Supabase SQL editor to enable the heart/like feature.

CREATE TABLE IF NOT EXISTS announcement_likes (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  announcement_id  UUID NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
  user_id          UUID NOT NULL REFERENCES auth.users(id)    ON DELETE CASCADE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(announcement_id, user_id)
);

ALTER TABLE announcement_likes ENABLE ROW LEVEL SECURITY;

-- Everyone who can see an announcement can see its like count
CREATE POLICY "likes_select"
  ON announcement_likes FOR SELECT
  USING (true);

-- Users can like (insert their own row)
CREATE POLICY "likes_insert"
  ON announcement_likes FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Users can un-like (delete their own row)
CREATE POLICY "likes_delete"
  ON announcement_likes FOR DELETE
  USING (auth.uid() = user_id);
