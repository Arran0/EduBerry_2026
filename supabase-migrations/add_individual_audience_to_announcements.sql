-- Add individual user targeting to announcement audiences
ALTER TABLE announcement_audiences
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES profiles(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_announcement_audiences_user_id
  ON announcement_audiences(user_id);
