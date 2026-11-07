-- REVIEW ONLY. Not applied. Requires explicit approval before running via apply_migration.
-- Removes the three anonymous Storage policies on the user-documents bucket.
-- Each allowed anon SELECT/INSERT/DELETE on ANY folder (predicate only checked
-- foldername(name)[1] IS NOT NULL), so any holder of the public anon key could
-- read or delete other users' document files.
-- Safe because: the app never calls Storage from the browser; process-document
-- and admin-api use the service role, which bypasses RLS.
-- Authenticated policies (folder = auth.uid()::text) are left unchanged.

DROP POLICY IF EXISTS "Allow anon reads from own folder" ON storage.objects;
DROP POLICY IF EXISTS "Allow anon uploads to own folder" ON storage.objects;
DROP POLICY IF EXISTS "Allow anon deletes from own folder" ON storage.objects;
