-- ============================================================
-- Migration: Smart Board task verification, submission & attachments
--
-- Extends smartboard_tasks so a board can mark a task as:
--   • require_check         — needs board/staff verification before it counts
--                              as fully complete (mirrors tasks.require_check)
--   • requires_submission   — the student must attach a note/link/file
--   • attachment_url / name — an attachment the board adds TO the task itself
--
-- The status logic these flags drive matches the staff Task Manager:
--   require_check = false → done is the final "completed" state
--   require_check = true  → student stops at done ("awaiting verification"),
--                            board/staff sets 'checked' to complete it.
--
-- Run this in the Supabase SQL Editor (after add_smartboard_tasks.sql).
-- ============================================================

ALTER TABLE public.smartboard_tasks
  ADD COLUMN IF NOT EXISTS require_check       BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS requires_submission BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS attachment_url      TEXT,
  ADD COLUMN IF NOT EXISTS attachment_name     TEXT;

NOTIFY pgrst, 'reload schema';
