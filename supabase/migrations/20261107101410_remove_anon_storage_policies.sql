-- Removes the three anonymous Storage policies on the user-documents bucket.
-- The anon policies allowed anyone holding the public anon key to read, upload,
-- and delete files across ALL folders — a cross-user data exposure.
-- Safe because the app never calls Storage from the browser; process-document
-- and admin-api use the service role which bypasses RLS.
-- The four authenticated policies remain unchanged.

DROP POLICY IF EXISTS "Allow anon reads from own folder" ON storage.objects;
DROP POLICY IF EXISTS "Allow anon uploads to own folder" ON storage.objects;
DROP POLICY IF EXISTS "Allow anon deletes from own folder" ON storage.objects;
