-- Fix subtask_comments and related tables RLS so that admin/principal users
-- can view and post comments even when not explicitly in project_members.
-- Also ensures subtask assignees (who may have been removed from project_members)
-- retain access to their own subtasks' comments.

-- ─── subtask_comments ───────────────────────────────────────────────────────

CREATE POLICY "admin_principal_view_subtask_comments"
  ON public.subtask_comments FOR SELECT
  USING (public.get_user_role() IN ('admin', 'principal'));

CREATE POLICY "admin_principal_insert_subtask_comments"
  ON public.subtask_comments FOR INSERT
  WITH CHECK (
    author_id = auth.uid()
    AND public.get_user_role() IN ('admin', 'principal')
  );

-- Allow the subtask assignee to view and post comments
CREATE POLICY "assignee_view_subtask_comments"
  ON public.subtask_comments FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.subtasks s
      WHERE s.id = subtask_comments.subtask_id
      AND s.assignee_id = auth.uid()
    )
  );

CREATE POLICY "assignee_insert_subtask_comments"
  ON public.subtask_comments FOR INSERT
  WITH CHECK (
    author_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.subtasks s
      WHERE s.id = subtask_comments.subtask_id
      AND s.assignee_id = auth.uid()
    )
  );

-- ─── subtask_checklist_items ────────────────────────────────────────────────

CREATE POLICY "admin_principal_view_subtask_checklist"
  ON public.subtask_checklist_items FOR SELECT
  USING (public.get_user_role() IN ('admin', 'principal'));

CREATE POLICY "admin_principal_manage_subtask_checklist"
  ON public.subtask_checklist_items FOR ALL
  USING (public.get_user_role() IN ('admin', 'principal'))
  WITH CHECK (public.get_user_role() IN ('admin', 'principal'));

-- ─── subtask_comment_attachments ────────────────────────────────────────────

CREATE POLICY "admin_principal_view_subtask_comment_attachments"
  ON public.subtask_comment_attachments FOR SELECT
  USING (public.get_user_role() IN ('admin', 'principal'));

CREATE POLICY "admin_principal_insert_subtask_comment_attachments"
  ON public.subtask_comment_attachments FOR INSERT
  WITH CHECK (public.get_user_role() IN ('admin', 'principal'));
