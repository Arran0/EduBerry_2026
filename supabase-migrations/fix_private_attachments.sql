-- Private storage for leave, task, subtask and announcement attachments, and an
-- end to anyone listing or deleting other people's files.
--
-- Three problems, one migration:
--
-- 1. Sensitive files in a public bucket. Leave attachments (medical
--    certificates), task comment attachments and announcement files were
--    uploaded to `classroom-files`, a public bucket: anyone holding a link could
--    open them, with no sign-in, forever.
--
-- 2. The whole bucket could be listed by anyone. The "Public read
--    classroom-files" policy granted SELECT on every object to `public`, which
--    includes the anon key shipped in the web app. The storage list API runs on
--    that policy, so anyone could enumerate every file in the bucket, find each
--    leave certificate's path and download it. Public URLs do not need a SELECT
--    policy at all, so dropping it costs nothing that the app uses.
--
-- 3. Any signed-in user could delete or overwrite any file in the bucket ("Auth
--    delete / update classroom-files" checked only that the caller was signed
--    in), including other people's submissions and the school's logo.
--
-- And a fourth, smaller one: subtask comment attachments uploaded to a
-- `subtask-attachments` bucket that never existed, so every upload failed.
--
-- The fix:
--   * A private bucket, `private-files`. New uploads of the four kinds go there,
--     and rows store a reference ('private-file:<path>') instead of a URL. The
--     app turns a reference into a signed URL valid for an hour.
--   * Reading a private file follows reading its row: a file is readable by
--     whoever can read the leave application, leave decision, task comment,
--     subtask comment or announcement that references it (the rows' own
--     row-level security decides), and by its uploader.
--   * In `classroom-files`, listing, overwriting and deleting are limited to
--     the file's uploader and admins. Public URLs keep working, so coursework,
--     avatars, banners and branding are unaffected.
--
-- Existing files: scripts/move-private-attachments.mjs moves the leave, task
-- comment and announcement files already in `classroom-files` into the private
-- bucket and rewrites the rows. Until it runs, those files stay reachable by
-- their old URLs (but can no longer be found by listing).
--
-- SAFE TO RE-RUN.

INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('private-files', 'private-files', false, 20971520)
ON CONFLICT (id) DO UPDATE SET public = false;

-- Whether the caller may read a private file, decided by the row that
-- references it. SECURITY INVOKER on purpose: each lookup runs under the
-- caller's own row-level security, so "can see the row" is literally the test.
CREATE OR REPLACE FUNCTION public.can_read_private_file(p_name TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT CASE split_part(p_name, '/', 1)
    WHEN 'leave' THEN
         EXISTS (SELECT 1 FROM public.leave_applications WHERE attachment_url = 'private-file:' || p_name)
      OR EXISTS (SELECT 1 FROM public.leave_approvals    WHERE attachment_url = 'private-file:' || p_name)
    WHEN 'task-comments' THEN
         EXISTS (SELECT 1 FROM public.task_comments WHERE attachment_url = 'private-file:' || p_name)
    WHEN 'subtasks' THEN
         EXISTS (SELECT 1 FROM public.subtask_comment_attachments WHERE url = 'private-file:' || p_name)
    WHEN 'announcements' THEN
         EXISTS (SELECT 1 FROM public.announcements
                  WHERE attachments @> jsonb_build_array(jsonb_build_object('url', 'private-file:' || p_name)))
    ELSE false
  END;
$$;

REVOKE EXECUTE ON FUNCTION public.can_read_private_file(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_read_private_file(TEXT) TO authenticated;

-- ── private-files ───────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Private files: read with the row" ON storage.objects;
CREATE POLICY "Private files: read with the row"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'private-files'
    AND (owner_id = (SELECT auth.uid())::TEXT OR public.can_read_private_file(name))
  );

DROP POLICY IF EXISTS "Private files: upload" ON storage.objects;
CREATE POLICY "Private files: upload"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'private-files'
    AND (storage.foldername(name))[1] = ANY (ARRAY['leave', 'task-comments', 'subtasks', 'announcements'])
  );

DROP POLICY IF EXISTS "Private files: uploader or admin can change" ON storage.objects;
CREATE POLICY "Private files: uploader or admin can change"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'private-files'
    AND (owner_id = (SELECT auth.uid())::TEXT OR (SELECT public.get_user_role()) = 'admin')
  );

DROP POLICY IF EXISTS "Private files: uploader or admin can delete" ON storage.objects;
CREATE POLICY "Private files: uploader or admin can delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'private-files'
    AND (owner_id = (SELECT auth.uid())::TEXT OR (SELECT public.get_user_role()) = 'admin')
  );

-- ── classroom-files ─────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Public read classroom-files" ON storage.objects;
DROP POLICY IF EXISTS "classroom-files: uploader or admin can list" ON storage.objects;
CREATE POLICY "classroom-files: uploader or admin can list"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'classroom-files'
    AND (owner_id = (SELECT auth.uid())::TEXT OR (SELECT public.get_user_role()) = 'admin')
  );

DROP POLICY IF EXISTS "Auth update classroom-files" ON storage.objects;
CREATE POLICY "Auth update classroom-files"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'classroom-files'
    AND (owner_id = (SELECT auth.uid())::TEXT OR (SELECT public.get_user_role()) = 'admin')
  );

DROP POLICY IF EXISTS "Auth delete classroom-files" ON storage.objects;
CREATE POLICY "Auth delete classroom-files"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'classroom-files'
    AND (owner_id = (SELECT auth.uid())::TEXT OR (SELECT public.get_user_role()) = 'admin')
  );
