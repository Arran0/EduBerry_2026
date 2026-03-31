-- Add grade and section columns to classrooms table
ALTER TABLE public.classrooms ADD COLUMN IF NOT EXISTS grade SMALLINT;
ALTER TABLE public.classrooms ADD COLUMN IF NOT EXISTS section TEXT;
