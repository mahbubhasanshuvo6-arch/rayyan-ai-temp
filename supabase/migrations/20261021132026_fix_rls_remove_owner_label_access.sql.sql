/*
# Fix knowledge_entries RLS: remove insecure owner_label-based access

## Problem
The existing SELECT policy `ke_select_own_or_shared` allows ANY anon user
to see ALL private entries that have `owner_label IS NOT NULL AND user_id IS NULL`.
This is because `owner_label` is user-supplied and not authenticated — RLS
cannot use it as a security boundary. Any user who knows (or guesses) another
user's owner_label can read their private knowledge.

The same issue affects UPDATE and DELETE policies: any anon user can modify
or delete another user's private entries by supplying the same owner_label.

## Fix
Remove all `owner_label`-based conditions from RLS policies. Private entries
are now protected solely by `user_id = auth.uid()` (authenticated users only).
Shared entries (is_shared = true) remain readable by all.

This is safe because:
- The gemini-chat edge function uses the SERVICE ROLE client, which bypasses
  RLS entirely. It filters by owner_label manually in application code.
- The admin-api edge function also uses the service role client.
- The frontend NEVER queries knowledge_entries directly — only user_documents.
- Anon users' knowledge entries (inserted via save_knowledge tool with
  owner_label but no user_id) are accessible ONLY through the edge function's
  service-role client, not through RLS-gated direct queries.

## Impact on existing functionality
- Gemini chat: unaffected (uses service role, bypasses RLS)
- Admin panel: unaffected (uses service role, bypasses RLS)
- Frontend direct queries: not used for knowledge_entries
- save_knowledge tool: unaffected (service role insert)
- Shared knowledge: still readable by all (is_shared = true policy)
- Authenticated users' private entries: still accessible to their owner

## Reversibility
All changes are policy DROP/CREATE — no data is modified or deleted.
The migration can be reversed by recreating the old policies.
*/

-- ============================================================
-- 1. Fix knowledge_entries RLS policies
-- ============================================================

-- Drop all existing policies
DROP POLICY IF EXISTS "ke_select_own_or_shared" ON knowledge_entries;
DROP POLICY IF EXISTS "ke_insert_own" ON knowledge_entries;
DROP POLICY IF EXISTS "ke_update_own" ON knowledge_entries;
DROP POLICY IF EXISTS "ke_delete_own" ON knowledge_entries;

-- SELECT: shared entries (visible to all) + own entries (authenticated only)
CREATE POLICY "ke_select_shared_or_own"
  ON knowledge_entries FOR SELECT
  TO anon, authenticated
  USING (
    is_shared = true
    OR (auth.uid() IS NOT NULL AND user_id = auth.uid())
  );

-- INSERT: authenticated users can insert their own entries
-- (Anon inserts go through the service role client in gemini-chat, bypassing RLS)
CREATE POLICY "ke_insert_own"
  ON knowledge_entries FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL AND user_id = auth.uid());

-- UPDATE: only the owner can update their own entries
CREATE POLICY "ke_update_own"
  ON knowledge_entries FOR UPDATE
  TO authenticated
  USING (auth.uid() IS NOT NULL AND user_id = auth.uid())
  WITH CHECK (auth.uid() IS NOT NULL AND user_id = auth.uid());

-- DELETE: only the owner can delete their own entries
CREATE POLICY "ke_delete_own"
  ON knowledge_entries FOR DELETE
  TO authenticated
  USING (auth.uid() IS NOT NULL AND user_id = auth.uid());

-- ============================================================
-- 2. Fix user_documents RLS policies (same pattern)
-- ============================================================

DROP POLICY IF EXISTS "ud_select_own" ON user_documents;
DROP POLICY IF EXISTS "ud_insert_own" ON user_documents;
DROP POLICY IF EXISTS "ud_update_own" ON user_documents;
DROP POLICY IF EXISTS "ud_delete_own" ON user_documents;

-- SELECT: only the owner (authenticated user)
CREATE POLICY "ud_select_own"
  ON user_documents FOR SELECT
  TO authenticated
  USING (auth.uid() IS NOT NULL AND user_id = auth.uid());

-- INSERT: authenticated users can insert their own document records
CREATE POLICY "ud_insert_own"
  ON user_documents FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL AND user_id = auth.uid());

-- UPDATE: only the owner can update
CREATE POLICY "ud_update_own"
  ON user_documents FOR UPDATE
  TO authenticated
  USING (auth.uid() IS NOT NULL AND user_id = auth.uid())
  WITH CHECK (auth.uid() IS NOT NULL AND user_id = auth.uid());

-- DELETE: only the owner can delete
CREATE POLICY "ud_delete_own"
  ON user_documents FOR DELETE
  TO authenticated
  USING (auth.uid() IS NOT NULL AND user_id = auth.uid());

-- ============================================================
-- 3. Fix Storage policies: remove anon access
-- ============================================================
-- The anon role cannot be securely scoped to a folder because there is no
-- authenticated identity. Only authenticated users can manage files.

DROP POLICY IF EXISTS "Allow user uploads to own folder" ON storage.objects;
DROP POLICY IF EXISTS "Allow user reads from own folder" ON storage.objects;
DROP POLICY IF EXISTS "Allow user deletes from own folder" ON storage.objects;
DROP POLICY IF EXISTS "Allow user updates to own folder" ON storage.objects;

-- INSERT: authenticated users can upload to their own folder
CREATE POLICY "Allow user uploads to own folder"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'user-documents'
    AND auth.uid() IS NOT NULL
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- SELECT: authenticated users can read from their own folder
CREATE POLICY "Allow user reads from own folder"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'user-documents'
    AND auth.uid() IS NOT NULL
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- DELETE: authenticated users can delete from their own folder
CREATE POLICY "Allow user deletes from own folder"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'user-documents'
    AND auth.uid() IS NOT NULL
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- UPDATE: authenticated users can update files in their own folder
CREATE POLICY "Allow user updates to own folder"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'user-documents'
    AND auth.uid() IS NOT NULL
    AND (storage.foldername(name))[1] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'user-documents'
    AND auth.uid() IS NOT NULL
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
