-- ============================================================
-- Fix: allow students to read homerooms they belong to
--
-- The homerooms table previously only had a staff SELECT policy,
-- so fetchHomeromsForStudent() returned empty for student JWTs
-- even when the student had homeroom_members rows — the JOIN to
-- homerooms(*) was silently blocked by RLS.
--
-- PostgreSQL ORs multiple SELECT policies on the same table, so
-- this new policy coexists safely with the existing staff one.
-- Run this in the Supabase SQL Editor.
-- ============================================================

CREATE POLICY "Students can view homerooms they belong to"
  ON public.homerooms FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.homeroom_members
      WHERE homeroom_members.homeroom_id = public.homerooms.id
        AND homeroom_members.student_id = auth.uid()
    )
  );
