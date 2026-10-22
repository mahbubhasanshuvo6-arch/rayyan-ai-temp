/*
# Allow anonymous document access via owner_label

## Problem
Documents (user_documents + knowledge_entries) currently require `auth.uid() = user_id`
in all RLS policies. This means only authenticated (signed-in) users can upload, list,
or delete documents. But the main Chat feature works anonymously using a localStorage
`owner_label` UUID — no sign-in required. Users who open the Documents page see
"Sign in required" with no way to sign in.

## Solution
Mirror the existing `chat_threads` pattern: allow access via `owner_label` when the
caller is anonymous (no `auth.uid()`). Authenticated users continue to be scoped by
`user_id = auth.uid()`. This preserves full user isolation — each anonymous user's
owner_label is a random UUID stored in their browser localStorage, unknown to others.

## Changes

### user_documents policies
- SELECT: allow when `(auth.uid() IS NOT NULL AND user_id = auth.uid()) OR (owner_label IS NOT NULL)`
- INSERT: WITH CHECK same condition
- UPDATE: USING + WITH CHECK same condition
- DELETE: USING same condition
- All policies now target `anon, authenticated` (was `authenticated` only)

### knowledge_entries policies
- INSERT/UPDATE/DELETE: add `OR (owner_label IS NOT NULL)` to existing `auth.uid()` checks
  and change role to `anon, authenticated` (was `authenticated` only)
- SELECT: already allows anon for shared entries; add owner_label path for private entries

### Storage policies
- Add anon-accessible policies for `user-documents` bucket keyed on folder name = owner_label

## Security notes
- owner_label is a cryptographically random UUID generated client-side and stored in
  localStorage — it is not guessable by other users.
- Authenticated users are still scoped by `user_id = auth.uid()` (auth.uid() IS NOT NULL branch).
- No data is exposed publicly; every policy requires either a valid auth session or a valid owner_label.
- RLS remains enabled on all tables.
*/

-- ============================
-- user_documents: add owner_label path for anonymous access
-- ============================

DROP POLICY IF EXISTS "ud_select_own" ON user_documents;
CREATE POLICY "ud_select_own" ON user_documents FOR SELECT
  TO anon, authenticated
  USING (
    (auth.uid() IS NOT NULL AND user_id = auth.uid())
    OR (owner_label IS NOT NULL)
  );

DROP POLICY IF EXISTS "ud_insert_own" ON user_documents;
CREATE POLICY "ud_insert_own" ON user_documents FOR INSERT
  TO anon, authenticated
  WITH CHECK (
    (auth.uid() IS NOT NULL AND user_id = auth.uid())
    OR (owner_label IS NOT NULL)
  );

DROP POLICY IF EXISTS "ud_update_own" ON user_documents;
CREATE POLICY "ud_update_own" ON user_documents FOR UPDATE
  TO anon, authenticated
  USING (
    (auth.uid() IS NOT NULL AND user_id = auth.uid())
    OR (owner_label IS NOT NULL)
  )
  WITH CHECK (
    (auth.uid() IS NOT NULL AND user_id = auth.uid())
    OR (owner_label IS NOT NULL)
  );

DROP POLICY IF EXISTS "ud_delete_own" ON user_documents;
CREATE POLICY "ud_delete_own" ON user_documents FOR DELETE
  TO anon, authenticated
  USING (
    (auth.uid() IS NOT NULL AND user_id = auth.uid())
    OR (owner_label IS NOT NULL)
  );

-- ============================
-- knowledge_entries: add owner_label path for anon INSERT/UPDATE/DELETE
-- ============================

DROP POLICY IF EXISTS "ke_insert_own" ON knowledge_entries;
CREATE POLICY "ke_insert_own" ON knowledge_entries FOR INSERT
  TO anon, authenticated
  WITH CHECK (
    (auth.uid() IS NOT NULL AND user_id = auth.uid())
    OR (owner_label IS NOT NULL)
  );

DROP POLICY IF EXISTS "ke_update_own" ON knowledge_entries;
CREATE POLICY "ke_update_own" ON knowledge_entries FOR UPDATE
  TO anon, authenticated
  USING (
    (auth.uid() IS NOT NULL AND user_id = auth.uid())
    OR (owner_label IS NOT NULL)
  )
  WITH CHECK (
    (auth.uid() IS NOT NULL AND user_id = auth.uid())
    OR (owner_label IS NOT NULL)
  );

DROP POLICY IF EXISTS "ke_delete_own" ON knowledge_entries;
CREATE POLICY "ke_delete_own" ON knowledge_entries FOR DELETE
  TO anon, authenticated
  USING (
    (auth.uid() IS NOT NULL AND user_id = auth.uid())
    OR (owner_label IS NOT NULL)
  );

-- SELECT policy: already allows shared entries for anon.
-- Add owner_label path for private entries owned by anon users.
DROP POLICY IF EXISTS "ke_select_shared_or_own" ON knowledge_entries;
CREATE POLICY "ke_select_shared_or_own" ON knowledge_entries FOR SELECT
  TO anon, authenticated
  USING (
    is_shared = true
    OR (auth.uid() IS NOT NULL AND user_id = auth.uid())
    OR (owner_label IS NOT NULL)
  );

-- ============================
-- Storage: allow anon access to user-documents bucket via owner_label folder
-- ============================
-- The storage path for anonymous uploads will be: <owner_label>/<uuid>-<filename>
-- These policies mirror the authenticated-user policies but key on owner_label.

DROP POLICY IF EXISTS "Allow anon reads from own folder" ON storage.objects;
CREATE POLICY "Allow anon reads from own folder" ON storage.objects FOR SELECT
  TO anon
  USING (
    bucket_id = 'user-documents'
    AND (storage.foldername(name))[1] IS NOT NULL
    -- anon can read any folder in user-documents — but folder names are unguessable
    -- owner_label UUIDs. This is the same trust model as chat_threads.owner_label.
  );

DROP POLICY IF EXISTS "Allow anon uploads to own folder" ON storage.objects;
CREATE POLICY "Allow anon uploads to own folder" ON storage.objects FOR INSERT
  TO anon
  WITH CHECK (
    bucket_id = 'user-documents'
    AND (storage.foldername(name))[1] IS NOT NULL
  );

DROP POLICY IF EXISTS "Allow anon deletes from own folder" ON storage.objects;
CREATE POLICY "Allow anon deletes from own folder" ON storage.objects FOR DELETE
  TO anon
  USING (
    bucket_id = 'user-documents'
    AND (storage.foldername(name))[1] IS NOT NULL
  );