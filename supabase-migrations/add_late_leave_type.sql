-- ============================================================
-- Migration: Add Late Permit leave type
--
-- Mirrors the Half Day Permit leave type: a same-day application that, once
-- approved, syncs straight into the 'late' attendance status instead of
-- creating an unauthorised absence. Both attendance_status (students) and
-- staff_attendance_status already include 'late', so only the leave_type
-- enum needs a new value.
-- Run this in the Supabase SQL Editor.
-- ============================================================

ALTER TYPE public.leave_type ADD VALUE IF NOT EXISTS 'late';

NOTIFY pgrst, 'reload schema';
