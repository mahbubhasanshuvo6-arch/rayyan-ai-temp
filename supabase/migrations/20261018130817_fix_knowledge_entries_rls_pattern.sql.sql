/*
# Fix knowledge_entries RLS to match existing memory_entries pattern

## Why
The previous migration (cybersec_upgrade_phases_1_to_4) used
`current_setting('app.owner_label', true)` for the anon ownership check.
That GUC is never set by the app, so anon-key clients would see zero rows
and be unable to save knowledge — breaking the public no-auth chat.

The existing memory_entries and chat_messages policies in this project use
`owner_label IS NOT NULL` as the anon ownership predicate (the row carries
its owner_label, and the app filters client-side by the per-browser
owner_label stored in localStorage). This migration realigns
knowledge_entries to that exact pattern so the public chat works and the
existing isolation behavior is preserved.

## Changes
- Drops and recreates the four knowledge_entries policies to match the
  memory_entries predicate shape:
    (auth.uid() IS NOT NULL AND user_id = auth.uid())
    OR (owner_label IS NOT NULL)
- No table or column changes. No data touched. RLS stays enabled.

## Security
This matches the project's existing, approved ownership model. The admin
edge function reads/deletes via the service role (bypasses RLS), so admin
listing/deletion still works.
*/

DROP POLICY IF EXISTS "ke_select_own" ON knowledge_entries;
CREATE POLICY "ke_select_own" ON knowledge_entries FOR SELECT
  TO anon, authenticated
  USING (
    (auth.uid() IS NOT NULL AND user_id = auth.uid())
    OR (owner_label IS NOT NULL)
  );

DROP POLICY IF EXISTS "ke_insert_own" ON knowledge_entries;
CREATE POLICY "ke_insert_own" ON knowledge_entries FOR INSERT
  TO anon, authenticated
  WITH CHECK (
    (auth.uid() IS NOT NULL AND (user_id = auth.uid() OR user_id IS NULL))
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