-- Migration: Track who completed/verified a task and when
-- Run this in your Supabase SQL editor

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS completed_by UUID REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

COMMENT ON COLUMN tasks.completed_by IS 'User who last moved this task into its completed state (done when require_check=false, checked when require_check=true). Cleared when the task is reopened.';
COMMENT ON COLUMN tasks.completed_at IS 'Timestamp of the completion in completed_by. Cleared when the task is reopened.';
