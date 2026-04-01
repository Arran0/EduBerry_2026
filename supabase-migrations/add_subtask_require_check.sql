-- Migration: Add require_check and end_time to subtasks table
-- Run this in your Supabase SQL editor

ALTER TABLE subtasks ADD COLUMN IF NOT EXISTS require_check BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE subtasks ADD COLUMN IF NOT EXISTS end_time TEXT;

COMMENT ON COLUMN subtasks.require_check IS 'If true, subtask needs coordinator/principal verification before completion';
COMMENT ON COLUMN subtasks.end_time IS 'End time for the subtask (HH:MM format)';
