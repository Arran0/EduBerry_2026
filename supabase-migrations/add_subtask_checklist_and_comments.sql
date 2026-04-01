-- ============================================================
-- Subtask Checklist Items & Comments (with file attachments)
-- Run this in Supabase SQL Editor
-- ============================================================

-- 1. Subtask checklist items
CREATE TABLE IF NOT EXISTS public.subtask_checklist_items (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subtask_id  uuid NOT NULL REFERENCES public.subtasks(id) ON DELETE CASCADE,
  text        text NOT NULL,
  is_completed boolean NOT NULL DEFAULT false,
  sort_order  integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS subtask_checklist_items_subtask_id_idx
  ON public.subtask_checklist_items (subtask_id);

ALTER TABLE public.subtask_checklist_items ENABLE ROW LEVEL SECURITY;

-- All project members can read checklist items
CREATE POLICY "project_members_view_subtask_checklist"
  ON public.subtask_checklist_items FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM   public.subtasks s
      JOIN   public.project_members pm ON pm.project_id = s.project_id
      WHERE  s.id = subtask_checklist_items.subtask_id
      AND    pm.user_id = auth.uid()
    )
  );

-- All project members can insert checklist items
CREATE POLICY "project_members_insert_subtask_checklist"
  ON public.subtask_checklist_items FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM   public.subtasks s
      JOIN   public.project_members pm ON pm.project_id = s.project_id
      WHERE  s.id = subtask_checklist_items.subtask_id
      AND    pm.user_id = auth.uid()
    )
  );

-- All project members can update checklist items
CREATE POLICY "project_members_update_subtask_checklist"
  ON public.subtask_checklist_items FOR UPDATE
  USING (
    EXISTS (
      SELECT 1
      FROM   public.subtasks s
      JOIN   public.project_members pm ON pm.project_id = s.project_id
      WHERE  s.id = subtask_checklist_items.subtask_id
      AND    pm.user_id = auth.uid()
    )
  );

-- All project members can delete checklist items
CREATE POLICY "project_members_delete_subtask_checklist"
  ON public.subtask_checklist_items FOR DELETE
  USING (
    EXISTS (
      SELECT 1
      FROM   public.subtasks s
      JOIN   public.project_members pm ON pm.project_id = s.project_id
      WHERE  s.id = subtask_checklist_items.subtask_id
      AND    pm.user_id = auth.uid()
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────

-- 2. Subtask comments
CREATE TABLE IF NOT EXISTS public.subtask_comments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subtask_id  uuid NOT NULL REFERENCES public.subtasks(id) ON DELETE CASCADE,
  author_id   uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  content     text NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS subtask_comments_subtask_id_idx
  ON public.subtask_comments (subtask_id);

ALTER TABLE public.subtask_comments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "project_members_view_subtask_comments"
  ON public.subtask_comments FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM   public.subtasks s
      JOIN   public.project_members pm ON pm.project_id = s.project_id
      WHERE  s.id = subtask_comments.subtask_id
      AND    pm.user_id = auth.uid()
    )
  );

CREATE POLICY "project_members_insert_subtask_comments"
  ON public.subtask_comments FOR INSERT
  WITH CHECK (
    author_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM   public.subtasks s
      JOIN   public.project_members pm ON pm.project_id = s.project_id
      WHERE  s.id = subtask_comments.subtask_id
      AND    pm.user_id = auth.uid()
    )
  );

CREATE POLICY "own_or_admin_delete_subtask_comments"
  ON public.subtask_comments FOR DELETE
  USING (author_id = auth.uid() OR public.get_user_role() IN ('admin', 'principal'));

-- ─────────────────────────────────────────────────────────────────────────────

-- 3. Subtask comment attachments
CREATE TABLE IF NOT EXISTS public.subtask_comment_attachments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  comment_id  uuid NOT NULL REFERENCES public.subtask_comments(id) ON DELETE CASCADE,
  url         text NOT NULL,
  name        text NOT NULL,
  type        text NOT NULL CHECK (type IN ('image', 'document')),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS subtask_comment_attachments_comment_id_idx
  ON public.subtask_comment_attachments (comment_id);

ALTER TABLE public.subtask_comment_attachments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "project_members_view_subtask_comment_attachments"
  ON public.subtask_comment_attachments FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM   public.subtask_comments c
      JOIN   public.subtasks s ON s.id = c.subtask_id
      JOIN   public.project_members pm ON pm.project_id = s.project_id
      WHERE  c.id = subtask_comment_attachments.comment_id
      AND    pm.user_id = auth.uid()
    )
  );

CREATE POLICY "project_members_insert_subtask_comment_attachments"
  ON public.subtask_comment_attachments FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM   public.subtask_comments c
      JOIN   public.subtasks s ON s.id = c.subtask_id
      JOIN   public.project_members pm ON pm.project_id = s.project_id
      WHERE  c.id = subtask_comment_attachments.comment_id
      AND    pm.user_id = auth.uid()
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────

-- 4. Storage bucket for subtask comment attachments
-- Run separately if bucket creation via SQL is not enabled:
-- INSERT INTO storage.buckets (id, name, public) VALUES ('subtask-attachments', 'subtask-attachments', true) ON CONFLICT DO NOTHING;

-- Storage policies (run after bucket exists)
-- CREATE POLICY "auth_upload_subtask_attachments" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'subtask-attachments');
-- CREATE POLICY "public_view_subtask_attachments" ON storage.objects FOR SELECT USING (bucket_id = 'subtask-attachments');
-- CREATE POLICY "owner_delete_subtask_attachments" ON storage.objects FOR DELETE USING (bucket_id = 'subtask-attachments' AND auth.uid()::text = (storage.foldername(name))[1]);
