/*
# Cybersecurity education, code review, knowledge library, and tool toggles

## Purpose
Additive-only migration that adds the cybersecurity upgrade (Phases 1-3) to
Rayyan AI. No existing column, table, policy, or row is dropped, renamed, or
retyped. All new columns have safe defaults so the existing singleton row
upgrades in place and the app behaves identically until an admin enables the
new capabilities.

## Phase 1 - Cybersecurity instruction set
- `cybersec_enabled` (boolean, default true): master toggle. When true, the
  chat edge function appends a structured cybersecurity persona/instruction
  block to the system prompt for BOTH Gemini and Groq (it is injected into
  the shared effectiveSystem string before provider dispatch).

## Phase 2 - Authorization scope + code review tool
- `cybersec_authorization_required` (boolean, default true): when true, the
  assistant asks the user to declare an authorized testing scope before
  helping with active testing requests. Advisory behavioral gate only; it
  does not execute attacks or store scope.
- `tool_code_review_enabled` (boolean, default true): enables the
  review_code tool. The tool passes user-submitted code back to the model
  with a structured review prompt; it does NOT execute the code or send it
  to any third party.

## Phase 3 - Knowledge library
- `tool_knowledge_enabled` (boolean, default true): enables the save_knowledge
  tool and the per-user knowledge-retrieval injection.
- New table `knowledge_entries`: owner-scoped store for user-supplied
  cybersecurity documentation, notes, and examples. Mirrors the existing
  memory_entries ownership model (owner_label for anon, user_id for signed-in
  users) so the no-auth public chat can read/write its own rows via the anon
  key, while signed-in users are scoped by auth.uid().
  Columns:
    id          uuid PK
    user_id     uuid nullable (set when a signed-in user saves)
    owner_label text   nullable (set for anon-key public chat)
    thread_id   uuid nullable (optional link to a conversation)
    title       text NOT NULL
    content     text NOT NULL
    tags        text[] NOT NULL DEFAULT '{}'
    source      text NOT NULL DEFAULT 'user-note'
    created_at  timestamptz DEFAULT now()

## Phase 4 (limited) - Dependency check tool
- `tool_deps_check_enabled` (boolean, default true): enables the check_deps
  tool, which queries the free OSV.dev API (no API key). No paid service.

## Security / RLS
- `knowledge_entries`: RLS enabled. Four owner-scoped policies (select/insert/
  update/delete) using `TO anon, authenticated` with an ownership predicate
  that accepts EITHER owner_label match (anon session) OR user_id match
  (signed-in user). This matches the existing memory_entries pattern so the
  public no-auth chat continues to work while signed-in users get uid scoping.
  The admin edge function uses the service role and bypasses RLS, so admin
  listing/deletion in the panel still works.
- No changes to any existing table's policies. app_settings keeps its
  existing read (anon) / update (admin) policies.
- No secrets stored in any new column.

## Important notes
1. Idempotent: every ALTER uses IF NOT EXISTS; CREATE TABLE IF NOT EXISTS;
   policies are dropped-if-exists then created.
2. The existing app_settings singleton row is NOT overwritten. New columns
   pick up their DEFAULTs automatically. The live system_prompt value is
   preserved; the new richer cybersec instructions are injected at runtime
   by the edge function (not stored in the row), so an admin's custom prompt
   is never clobbered.
3. pg_trgm extension is enabled (if not already) to support fuzzy keyword
   matching for knowledge retrieval. It is a free, standard Postgres
   extension available on Supabase.
4. A GIN index on tags and a trigram index on title/content support the
   retrieval query used by the edge function.
*/

-- Enable pg_trgm for fuzzy keyword search (free, standard extension).
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ---- New app_settings columns (Phases 1, 2, 3, 4) ----
ALTER TABLE app_settings
  ADD COLUMN IF NOT EXISTS cybersec_enabled boolean NOT NULL DEFAULT true;

ALTER TABLE app_settings
  ADD COLUMN IF NOT EXISTS cybersec_authorization_required boolean NOT NULL DEFAULT true;

ALTER TABLE app_settings
  ADD COLUMN IF NOT EXISTS tool_code_review_enabled boolean NOT NULL DEFAULT true;

ALTER TABLE app_settings
  ADD COLUMN IF NOT EXISTS tool_knowledge_enabled boolean NOT NULL DEFAULT true;

ALTER TABLE app_settings
  ADD COLUMN IF NOT EXISTS tool_deps_check_enabled boolean NOT NULL DEFAULT true;

-- ---- knowledge_entries table (Phase 3) ----
CREATE TABLE IF NOT EXISTS knowledge_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  owner_label text,
  thread_id uuid,
  title text NOT NULL,
  content text NOT NULL,
  tags text[] NOT NULL DEFAULT '{}',
  source text NOT NULL DEFAULT 'user-note',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE knowledge_entries ENABLE ROW LEVEL SECURITY;

-- Owner-scoped policies. A row belongs to a user if EITHER:
--   - owner_label matches (anon-key public chat), OR
--   - user_id matches auth.uid() (signed-in user).
-- This mirrors the existing memory_entries ownership model.
DROP POLICY IF EXISTS "ke_select_own" ON knowledge_entries;
CREATE POLICY "ke_select_own" ON knowledge_entries FOR SELECT
  TO anon, authenticated
  USING (
    owner_label IS NOT NULL AND owner_label = current_setting('app.owner_label', true)
    OR (user_id IS NOT NULL AND auth.uid() = user_id)
  );

DROP POLICY IF EXISTS "ke_insert_own" ON knowledge_entries;
CREATE POLICY "ke_insert_own" ON knowledge_entries FOR INSERT
  TO anon, authenticated
  WITH CHECK (
    owner_label IS NOT NULL AND owner_label = current_setting('app.owner_label', true)
    OR (user_id IS NOT NULL AND auth.uid() = user_id)
  );

DROP POLICY IF EXISTS "ke_update_own" ON knowledge_entries;
CREATE POLICY "ke_update_own" ON knowledge_entries FOR UPDATE
  TO anon, authenticated
  USING (
    owner_label IS NOT NULL AND owner_label = current_setting('app.owner_label', true)
    OR (user_id IS NOT NULL AND auth.uid() = user_id)
  )
  WITH CHECK (
    owner_label IS NOT NULL AND owner_label = current_setting('app.owner_label', true)
    OR (user_id IS NOT NULL AND auth.uid() = user_id)
  );

DROP POLICY IF EXISTS "ke_delete_own" ON knowledge_entries;
CREATE POLICY "ke_delete_own" ON knowledge_entries FOR DELETE
  TO anon, authenticated
  USING (
    owner_label IS NOT NULL AND owner_label = current_setting('app.owner_label', true)
    OR (user_id IS NOT NULL AND auth.uid() = user_id)
  );

-- Indexes for retrieval: GIN on tags, trigram on title and content.
CREATE INDEX IF NOT EXISTS knowledge_entries_owner_label_idx
  ON knowledge_entries (owner_label);
CREATE INDEX IF NOT EXISTS knowledge_entries_user_id_idx
  ON knowledge_entries (user_id);
CREATE INDEX IF NOT EXISTS knowledge_entries_tags_idx
  ON knowledge_entries USING GIN (tags);
CREATE INDEX IF NOT EXISTS knowledge_entries_title_trgm_idx
  ON knowledge_entries USING GIN (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS knowledge_entries_content_trgm_idx
  ON knowledge_entries USING GIN (content gin_trgm_ops);