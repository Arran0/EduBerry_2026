-- Add subject column to classrooms table
ALTER TABLE public.classrooms ADD COLUMN IF NOT EXISTS subject TEXT;
