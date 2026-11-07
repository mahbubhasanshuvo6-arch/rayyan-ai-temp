-- REVIEW ONLY. Not applied. Requires explicit approval before running via apply_migration.
--
-- Removes the three anonymous Storage policies on the user-documents bucket.
--
-- Problem:
--   The anon policies allowed anyone holding the public anon key to read,
--   upload, and delete files across ALL folders. The predicate only checked
--   foldername(name)[1] IS NOT NULL — it did NOT match the folder to any
--   specific user or label. This is a cross-user data exposure.
--
-- Safety:
--   The app never calls Storage from the browser (no storage.from in src/).
--   process-document and admin-api use the service role for all Storage
--   operations, which bypasses RLS. Removing these policies does not affect
--   document upload, replace, or delete.
--
-- Not changed:
--   The four authenticated policies (reads, uploads, updates, deletes) on
--   storage.objects remain unchanged. They check foldername(name)[1] =
--   auth.uid()::text.

-- === APPLY (forward) ===
DROP POLICY IF EXISTS "Allow anon reads from own folder" ON storage.objects;
DROP POLICY IF EXISTS "Allow anon uploads to own folder" ON storage.objects;
DROP POLICY IF EXISTS "Allow anon deletes from own folder" ON storage.objects;

-- === ROLLBACK (exact recreation from verified live definitions) ===
-- Re-run these only if you need to restore the anon policies.
--
-- CREATE POLICY "Allow anon reads from own folder" ON storage.objects
--   FOR SELECT TO anon
--   USING ((bucket_id = 'user-documents'::text) AND (storage.foldername(name))[1] IS NOT NULL));
--
-- CREATE POLICY "Allow anon uploads to own folder" ON storage.objects
--   FOR INSERT TO anon
--   WITH CHECK ((bucket_id = 'user-documents'::text) AND (storage.foldername(name))[1] IS NOT NULL));
--
-- CREATE POLICY "Allow anon deletes from own folder" ON storage.objects
--   FOR DELETE TO anon
--   USING ((bucket_id = 'user-documents'::text) AND (storage.foldername(name))[1] IS NOT NULL));
