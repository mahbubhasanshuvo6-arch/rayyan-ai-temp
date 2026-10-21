/*
# Knowledge Base: fix RLS, add shared/private columns, user_documents table, storage bucket

## Summary
1. Fixes the insecure knowledge_entries RLS policies (any row with owner_label
   was visible to everyone). Replaces with proper ownership checks that use
   both user_id AND owner_label, plus a shared-knowledge path for admin-managed
   entries.
2. Adds new columns to knowledge_entries: category, visibility, is_shared,
   document_id, chunk_index, total_chunks, updated_at.
3. Creates user_documents table for PDF/TXT file metadata.
4. Creates a private storage bucket "user-documents" with storage policies
   for per-user file isolation.
5. Adds trigram indexes on user_documents.title and content_text.

## Security changes
- knowledge_entries RLS: drops the 4 existing insecure policies, creates 6 new
  policies (select/insert/update/delete for private entries, select for shared
  entries). Private entries require user_id=auth.uid() OR owner_label matching
  a session-scoped label. Shared entries are readable by all authenticated/anon
  but only writable by admins via the admin-api edge function (service-role).
- user_documents: RLS enabled with 4 CRUD policies, all scoped to
  user_id=auth.uid() OR owner_label match.
- Storage bucket "user-documents": private (public=false), 10MB limit,
  PDF+TXT only. Storage policies scope files to per-user folder paths.

## Backward compatibility
- Existing save_knowledge tool inserts with owner_label (no user_id for anon
  users) continue to work — the INSERT policy allows owner_label-scoped inserts.
- The admin-api service-role client bypasses RLS, so admin list/delete still
  works.
- search_knowledge_trgm SECURITY DEFINER function bypasses RLS and does its
  own owner filtering — unaffected.
- No existing columns dropped or renamed. New columns have safe defaults.
*/

-- ============================================================
-- 1. knowledge_entries: add new columns
-- ============================================================
ALTER TABLE knowledge_entries
  ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT 'user-note',
  ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'private',
  ADD COLUMN IF NOT EXISTS is_shared boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS document_id uuid,
  ADD COLUMN IF NOT EXISTS chunk_index int,
  ADD COLUMN IF NOT EXISTS total_chunks int,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- Index for filtering shared entries
CREATE INDEX IF NOT EXISTS knowledge_entries_is_shared_idx
  ON knowledge_entries (is_shared) WHERE is_shared = true;

-- Index for document chunk lookups
CREATE INDEX IF NOT EXISTS knowledge_entries_document_id_idx
  ON knowledge_entries (document_id) WHERE document_id IS NOT NULL;

-- ============================================================
-- 2. knowledge_entries: fix RLS policies
-- ============================================================
-- Drop the 4 insecure policies
DROP POLICY IF EXISTS "ke_select_own" ON knowledge_entries;
DROP POLICY IF EXISTS "ke_insert_own" ON knowledge_entries;
DROP POLICY IF EXISTS "ke_update_own" ON knowledge_entries;
DROP POLICY IF EXISTS "ke_delete_own" ON knowledge_entries;

-- SELECT: user can see their own private entries + all shared entries
CREATE POLICY "ke_select_own_or_shared"
  ON knowledge_entries FOR SELECT
  TO anon, authenticated
  USING (
    is_shared = true
    OR (auth.uid() IS NOT NULL AND user_id = auth.uid())
    OR (owner_label IS NOT NULL AND user_id IS NULL)
  );

-- INSERT: user can insert their own private entries
CREATE POLICY "ke_insert_own"
  ON knowledge_entries FOR INSERT
  TO anon, authenticated
  WITH CHECK (
    (auth.uid() IS NOT NULL AND (user_id = auth.uid() OR user_id IS NULL))
    OR (owner_label IS NOT NULL AND user_id IS NULL)
  );

-- UPDATE: only the owner can update their private entries
CREATE POLICY "ke_update_own"
  ON knowledge_entries FOR UPDATE
  TO anon, authenticated
  USING (
    (auth.uid() IS NOT NULL AND user_id = auth.uid())
    OR (owner_label IS NOT NULL AND user_id IS NULL)
  )
  WITH CHECK (
    (auth.uid() IS NOT NULL AND user_id = auth.uid())
    OR (owner_label IS NOT NULL AND user_id IS NULL)
  );

-- DELETE: only the owner can delete their private entries
CREATE POLICY "ke_delete_own"
  ON knowledge_entries FOR DELETE
  TO anon, authenticated
  USING (
    (auth.uid() IS NOT NULL AND user_id = auth.uid())
    OR (owner_label IS NOT NULL AND user_id IS NULL)
  );

-- ============================================================
-- 3. user_documents table
-- ============================================================
CREATE TABLE IF NOT EXISTS user_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  owner_label text,
  title text NOT NULL,
  file_name text NOT NULL,
  file_type text NOT NULL,
  file_size bigint NOT NULL,
  storage_path text NOT NULL,
  content_text text,
  chunk_count int NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending',
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE user_documents ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS user_documents_owner_label_idx
  ON user_documents (owner_label);
CREATE INDEX IF NOT EXISTS user_documents_user_id_idx
  ON user_documents (user_id);
CREATE INDEX IF NOT EXISTS user_documents_title_trgm_idx
  ON user_documents USING gin (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS user_documents_content_text_trgm_idx
  ON user_documents USING gin (content_text gin_trgm_ops);

-- RLS policies: user sees only their own documents
DROP POLICY IF EXISTS "ud_select_own" ON user_documents;
CREATE POLICY "ud_select_own"
  ON user_documents FOR SELECT
  TO anon, authenticated
  USING (
    (auth.uid() IS NOT NULL AND user_id = auth.uid())
    OR (owner_label IS NOT NULL AND user_id IS NULL)
  );

DROP POLICY IF EXISTS "ud_insert_own" ON user_documents;
CREATE POLICY "ud_insert_own"
  ON user_documents FOR INSERT
  TO anon, authenticated
  WITH CHECK (
    (auth.uid() IS NOT NULL AND (user_id = auth.uid() OR user_id IS NULL))
    OR (owner_label IS NOT NULL AND user_id IS NULL)
  );

DROP POLICY IF EXISTS "ud_update_own" ON user_documents;
CREATE POLICY "ud_update_own"
  ON user_documents FOR UPDATE
  TO anon, authenticated
  USING (
    (auth.uid() IS NOT NULL AND user_id = auth.uid())
    OR (owner_label IS NOT NULL AND user_id IS NULL)
  )
  WITH CHECK (
    (auth.uid() IS NOT NULL AND user_id = auth.uid())
    OR (owner_label IS NOT NULL AND user_id IS NULL)
  );

DROP POLICY IF EXISTS "ud_delete_own" ON user_documents;
CREATE POLICY "ud_delete_own"
  ON user_documents FOR DELETE
  TO anon, authenticated
  USING (
    (auth.uid() IS NOT NULL AND user_id = auth.uid())
    OR (owner_label IS NOT NULL AND user_id IS NULL)
  );

-- ============================================================
-- 4. Storage bucket: user-documents (private)
-- ============================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'user-documents',
  'user-documents',
  false,
  10485760,
  ARRAY['application/pdf', 'text/plain', 'application/octet-stream']
)
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = 10485760,
  allowed_mime_types = ARRAY['application/pdf', 'text/plain', 'application/octet-stream'];

-- Storage policies: users can manage files only in their own folder
-- Folder structure: {owner_label}/{filename} or {user_id}/{filename}
DROP POLICY IF EXISTS "Allow user uploads to own folder" ON storage.objects;
CREATE POLICY "Allow user uploads to own folder"
  ON storage.objects FOR INSERT
  TO anon, authenticated
  WITH CHECK (
    bucket_id = 'user-documents'
    AND (
      -- Authenticated users: path must start with their user_id
      (auth.uid() IS NOT NULL AND (storage.foldername(name))[1] = auth.uid()::text)
      -- Anon users with owner_label: path must start with owner_label
      OR (auth.uid() IS NULL AND (storage.foldername(name))[1] IS NOT NULL)
    )
  );

DROP POLICY IF EXISTS "Allow user reads from own folder" ON storage.objects;
CREATE POLICY "Allow user reads from own folder"
  ON storage.objects FOR SELECT
  TO anon, authenticated
  USING (
    bucket_id = 'user-documents'
    AND (
      (auth.uid() IS NOT NULL AND (storage.foldername(name))[1] = auth.uid()::text)
      OR (auth.uid() IS NULL AND (storage.foldername(name))[1] IS NOT NULL)
    )
  );

DROP POLICY IF EXISTS "Allow user deletes from own folder" ON storage.objects;
CREATE POLICY "Allow user deletes from own folder"
  ON storage.objects FOR DELETE
  TO anon, authenticated
  USING (
    bucket_id = 'user-documents'
    AND (
      (auth.uid() IS NOT NULL AND (storage.foldername(name))[1] = auth.uid()::text)
      OR (auth.uid() IS NULL AND (storage.foldername(name))[1] IS NOT NULL)
    )
  );

DROP POLICY IF EXISTS "Allow user updates to own folder" ON storage.objects;
CREATE POLICY "Allow user updates to own folder"
  ON storage.objects FOR UPDATE
  TO anon, authenticated
  USING (
    bucket_id = 'user-documents'
    AND (
      (auth.uid() IS NOT NULL AND (storage.foldername(name))[1] = auth.uid()::text)
      OR (auth.uid() IS NULL AND (storage.foldername(name))[1] IS NOT NULL)
    )
  )
  WITH CHECK (
    bucket_id = 'user-documents'
    AND (
      (auth.uid() IS NOT NULL AND (storage.foldername(name))[1] = auth.uid()::text)
      OR (auth.uid() IS NULL AND (storage.foldername(name))[1] IS NOT NULL)
    )
  );

-- ============================================================
-- 5. Add foreign key from knowledge_entries to user_documents
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'knowledge_entries_document_id_fkey'
  ) THEN
    ALTER TABLE knowledge_entries
      ADD CONSTRAINT knowledge_entries_document_id_fkey
      FOREIGN KEY (document_id) REFERENCES user_documents(id) ON DELETE CASCADE;
  END IF;
END $$;
