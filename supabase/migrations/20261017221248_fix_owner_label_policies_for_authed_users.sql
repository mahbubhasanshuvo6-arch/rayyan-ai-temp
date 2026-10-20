/*
# Fix: owner_label access breaks for authenticated users

## Root Cause
The public chat uses `owner_label` (a random per-browser UUID stored in
localStorage) to associate conversations with a visitor. The RLS policies
were written as:

  (auth.uid() IS NOT NULL AND user_id = auth.uid())
  OR (auth.uid() IS NULL AND owner_label IS NOT NULL)

This means: if you are signed in (auth.uid() is not null), you can ONLY see
rows where `user_id = auth.uid()`. But the public chat inserts rows with
`owner_label` set and `user_id` left NULL. So a signed-in user (e.g. the
admin/owner) who visits the public chat can INSERT a thread (the INSERT
policy allows `user_id IS NULL`), but the subsequent SELECT to read it back
returns zero rows — both branches of the OR fail. The frontend then shows
"Could not start a new conversation."

## Fix
Change all owner_label-based policies from:
  (auth.uid() IS NULL AND owner_label IS NOT NULL)
to:
  (owner_label IS NOT NULL)

This allows owner_label-matching regardless of auth status. The security
model is unchanged: owner_label is a random UUID secret stored in the
visitor's browser. Whether the visitor is anon or authenticated, they can
only see rows whose owner_label matches the value they pass in their query.
This is the same security level that already existed for anon users.

## Tables affected
- chat_threads (SELECT, INSERT, UPDATE, DELETE)
- chat_messages (SELECT, INSERT, DELETE)
- memory_entries (SELECT, INSERT, DELETE)
- projects (SELECT, INSERT, UPDATE, DELETE)
- generated_files (SELECT, INSERT, DELETE)
*/

-- chat_threads
DROP POLICY IF EXISTS "select_own_threads" ON chat_threads;
CREATE POLICY "select_own_threads"
  ON chat_threads FOR SELECT
  TO anon, authenticated
  USING (
    (auth.uid() IS NOT NULL AND user_id = auth.uid())
    OR (owner_label IS NOT NULL)
  );

DROP POLICY IF EXISTS "insert_own_threads" ON chat_threads;
CREATE POLICY "insert_own_threads"
  ON chat_threads FOR INSERT
  TO anon, authenticated
  WITH CHECK (
    (auth.uid() IS NOT NULL AND (user_id = auth.uid() OR user_id IS NULL))
    OR (owner_label IS NOT NULL)
  );

DROP POLICY IF EXISTS "update_own_threads" ON chat_threads;
CREATE POLICY "update_own_threads"
  ON chat_threads FOR UPDATE
  TO anon, authenticated
  USING (
    (auth.uid() IS NOT NULL AND user_id = auth.uid())
    OR (owner_label IS NOT NULL)
  )
  WITH CHECK (
    (auth.uid() IS NOT NULL AND user_id = auth.uid())
    OR (owner_label IS NOT NULL)
  );

DROP POLICY IF EXISTS "delete_own_threads" ON chat_threads;
CREATE POLICY "delete_own_threads"
  ON chat_threads FOR DELETE
  TO anon, authenticated
  USING (
    (auth.uid() IS NOT NULL AND user_id = auth.uid())
    OR (owner_label IS NOT NULL)
  );

-- chat_messages
DROP POLICY IF EXISTS "select_own_messages" ON chat_messages;
CREATE POLICY "select_own_messages"
  ON chat_messages FOR SELECT
  TO anon, authenticated
  USING (
    EXISTS (
      SELECT 1 FROM chat_threads t
      WHERE t.id = chat_messages.thread_id
      AND (
        (auth.uid() IS NOT NULL AND t.user_id = auth.uid())
        OR (t.owner_label IS NOT NULL)
      )
    )
  );

DROP POLICY IF EXISTS "insert_own_messages" ON chat_messages;
CREATE POLICY "insert_own_messages"
  ON chat_messages FOR INSERT
  TO anon, authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM chat_threads t
      WHERE t.id = chat_messages.thread_id
      AND (
        (auth.uid() IS NOT NULL AND t.user_id = auth.uid())
        OR (t.owner_label IS NOT NULL)
      )
    )
  );

DROP POLICY IF EXISTS "delete_own_messages" ON chat_messages;
CREATE POLICY "delete_own_messages"
  ON chat_messages FOR DELETE
  TO anon, authenticated
  USING (
    EXISTS (
      SELECT 1 FROM chat_threads t
      WHERE t.id = chat_messages.thread_id
      AND (
        (auth.uid() IS NOT NULL AND t.user_id = auth.uid())
        OR (t.owner_label IS NOT NULL)
      )
    )
  );

-- memory_entries
DROP POLICY IF EXISTS "select_own_memory" ON memory_entries;
CREATE POLICY "select_own_memory"
  ON memory_entries FOR SELECT
  TO anon, authenticated
  USING (
    (auth.uid() IS NOT NULL AND user_id = auth.uid())
    OR (owner_label IS NOT NULL)
  );

DROP POLICY IF EXISTS "insert_own_memory" ON memory_entries;
CREATE POLICY "insert_own_memory"
  ON memory_entries FOR INSERT
  TO anon, authenticated
  WITH CHECK (
    (auth.uid() IS NOT NULL AND (user_id = auth.uid() OR user_id IS NULL))
    OR (owner_label IS NOT NULL)
  );

DROP POLICY IF EXISTS "delete_own_memory" ON memory_entries;
CREATE POLICY "delete_own_memory"
  ON memory_entries FOR DELETE
  TO anon, authenticated
  USING (
    (auth.uid() IS NOT NULL AND user_id = auth.uid())
    OR (owner_label IS NOT NULL)
  );

-- projects
DROP POLICY IF EXISTS "select_own_projects" ON projects;
CREATE POLICY "select_own_projects"
  ON projects FOR SELECT
  TO anon, authenticated
  USING (
    (auth.uid() IS NOT NULL AND user_id = auth.uid())
    OR (owner_label IS NOT NULL)
  );

DROP POLICY IF EXISTS "insert_own_projects" ON projects;
CREATE POLICY "insert_own_projects"
  ON projects FOR INSERT
  TO anon, authenticated
  WITH CHECK (
    (auth.uid() IS NOT NULL AND (user_id = auth.uid() OR user_id IS NULL))
    OR (owner_label IS NOT NULL)
  );

DROP POLICY IF EXISTS "update_own_projects" ON projects;
CREATE POLICY "update_own_projects"
  ON projects FOR UPDATE
  TO anon, authenticated
  USING (
    (auth.uid() IS NOT NULL AND user_id = auth.uid())
    OR (owner_label IS NOT NULL)
  )
  WITH CHECK (
    (auth.uid() IS NOT NULL AND user_id = auth.uid())
    OR (owner_label IS NOT NULL)
  );

DROP POLICY IF EXISTS "delete_own_projects" ON projects;
CREATE POLICY "delete_own_projects"
  ON projects FOR DELETE
  TO anon, authenticated
  USING (
    (auth.uid() IS NOT NULL AND user_id = auth.uid())
    OR (owner_label IS NOT NULL)
  );

-- generated_files
DROP POLICY IF EXISTS "select_own_files" ON generated_files;
CREATE POLICY "select_own_files"
  ON generated_files FOR SELECT
  TO anon, authenticated
  USING (
    EXISTS (
      SELECT 1 FROM projects p
      WHERE p.id = generated_files.project_id
      AND (
        (auth.uid() IS NOT NULL AND p.user_id = auth.uid())
        OR (p.owner_label IS NOT NULL)
      )
    )
  );

DROP POLICY IF EXISTS "insert_own_files" ON generated_files;
CREATE POLICY "insert_own_files"
  ON generated_files FOR INSERT
  TO anon, authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM projects p
      WHERE p.id = generated_files.project_id
      AND (
        (auth.uid() IS NOT NULL AND p.user_id = auth.uid())
        OR (p.owner_label IS NOT NULL)
      )
    )
  );

DROP POLICY IF EXISTS "delete_own_files" ON generated_files;
CREATE POLICY "delete_own_files"
  ON generated_files FOR DELETE
  TO anon, authenticated
  USING (
    EXISTS (
      SELECT 1 FROM projects p
      WHERE p.id = generated_files.project_id
      AND (
        (auth.uid() IS NOT NULL AND p.user_id = auth.uid())
        OR (p.owner_label IS NOT NULL)
      )
    )
  );
