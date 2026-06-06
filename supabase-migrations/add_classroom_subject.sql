-- Add subject column to classrooms table
ALTER TABLE classrooms ADD COLUMN IF NOT EXISTS subject TEXT;
