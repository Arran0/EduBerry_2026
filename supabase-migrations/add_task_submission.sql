-- Migration: "Needs submission" for tasks, mirroring classroom classwork's
-- requires_submission / submission text-note pattern.
-- Run this in your Supabase SQL editor.

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS requires_submission BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS submission_note TEXT;

COMMENT ON COLUMN tasks.requires_submission IS 'If true, the assignee must submit a note before the task can be marked done.';
COMMENT ON COLUMN tasks.submission_note IS 'Free-text submission left by the assignee, required before completion when requires_submission=true.';
