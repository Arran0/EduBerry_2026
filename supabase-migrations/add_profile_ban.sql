-- Add is_banned column to profiles table for admin-controlled account lockout.
-- Banned users are also blocked at the Supabase auth level via the toggle-ban API route.
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_banned BOOLEAN DEFAULT FALSE NOT NULL;
