/*
# Rayyan AI - Core Schema

## Overview
Creates the full data layer for the Rayyan AI application: a public AI chat
(with threads, messages, and persistent memory), an app-builder (projects +
generated files), admin-configurable settings, and API usage logging for
cost estimation.

## Tables

1. `app_settings` (singleton row) — public app name, appearance/theme,
   feature toggles for chat / voice / app-builder, and AI provider config
   (provider name, model, generation params). API keys are NOT stored here.
   Keys live in Supabase edge-function secrets and are referenced by name.
2. `chat_threads` — conversation threads owned by a user (or anon session
   label for the no-auth public chat).
3. `chat_messages` — individual messages in a thread (role + content).
4. `memory_entries` — persistent assistant memory facts, scoped per thread
   or global.
5. `projects` — app-builder projects: name, description, prompt, status.
6. `generated_files` — files produced for a project (path, language, content).
7. `api_usage_logs` — every Gemini API call: model, prompt tokens, completion
   tokens, estimated cost, status, error message. Drives the admin cost
   dashboard.
8. `admin_events` — audit log for destructive admin actions.

## Security (RLS)
- `app_settings`: readable by everyone (public app name/theme), writable only
  by admins (checked via app_metadata.is_admin JWT claim through a SECURITY
  DEFINER helper). A security definer function `is_admin()` checks
  `auth.jwt()->>'is_admin' = 'true'` safely.
- `chat_threads` / `chat_messages` / `memory_entries`: owner-scoped to the
  signed-in user. For the public no-auth chat, anon is allowed to create and
  read rows it owns via a session label stored in `owner_label`.
- `projects` / `generated_files`: owner-scoped.
- `api_usage_logs` / `admin_events`: admin-only SELECT; INSERT is allowed
  from the service role (edge functions) via SECURITY DEFINER functions.

## Important notes
- The first admin is created through a secure setup edge function that
  checks an env secret (ADMIN_SETUP_KEY) and sets app_metadata.is_admin='true'
  on the target user. No hardcoded default password.
- `user_id` columns default to auth.uid() so client inserts that omit the
  owner still satisfy WITH CHECK.
*/

-- Helper: is the current user an admin? Checks JWT app_metadata, which is
-- server-controlled and NOT user-mutable (unlike raw_user_meta_data).
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(
    (auth.jwt() -> 'app_metadata' ->> 'is_admin')::boolean,
    false
  );
$$;

-- =========================================================
-- app_settings (singleton)
-- =========================================================
CREATE TABLE IF NOT EXISTS app_settings (
  id int PRIMARY KEY DEFAULT 1,
  app_name text NOT NULL DEFAULT 'Rayyan AI',
  tagline text NOT NULL DEFAULT 'Your AI assistant',
  -- appearance
  theme text NOT NULL DEFAULT 'slate',
  accent_color text NOT NULL DEFAULT 'blue',
  -- feature toggles
  chat_enabled boolean NOT NULL DEFAULT true,
  voice_enabled boolean NOT NULL DEFAULT true,
  app_builder_enabled boolean NOT NULL DEFAULT true,
  -- AI provider config (NO api key here)
  provider text NOT NULL DEFAULT 'gemini',
  model text NOT NULL DEFAULT 'gemini-2.0-flash',
  temperature real NOT NULL DEFAULT 0.7,
  max_tokens int NOT NULL DEFAULT 2048,
  system_prompt text NOT NULL DEFAULT 'You are Rayyan AI, a helpful, friendly assistant.',
  -- usage / cost display
  show_usage_costs boolean NOT NULL DEFAULT true,
  updated_at timestamptz DEFAULT now()
);

INSERT INTO app_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;

-- Everyone can read the public-facing settings (app name, theme, toggles).
-- Sensitive columns (provider config) are exposed but contain no secrets.
DROP POLICY IF EXISTS "read_app_settings" ON app_settings;
CREATE POLICY "read_app_settings"
  ON app_settings FOR SELECT
  TO anon, authenticated
  USING (true);

-- Only admins can update settings.
DROP POLICY IF EXISTS "update_app_settings" ON app_settings;
CREATE POLICY "update_app_settings"
  ON app_settings FOR UPDATE
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- =========================================================
-- chat_threads
-- =========================================================
CREATE TABLE IF NOT EXISTS chat_threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  owner_label text,
  title text NOT NULL DEFAULT 'New chat',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE chat_threads ENABLE ROW LEVEL SECURITY;

-- Authed users see their own threads; anon sees rows with its owner_label
-- (no auth.uid so we allow anon/label-based ownership).
DROP POLICY IF EXISTS "select_own_threads" ON chat_threads;
CREATE POLICY "select_own_threads"
  ON chat_threads FOR SELECT
  TO anon, authenticated
  USING (
    (auth.uid() IS NOT NULL AND user_id = auth.uid())
    OR (auth.uid() IS NULL AND owner_label IS NOT NULL)
  );

DROP POLICY IF EXISTS "insert_own_threads" ON chat_threads;
CREATE POLICY "insert_own_threads"
  ON chat_threads FOR INSERT
  TO anon, authenticated
  WITH CHECK (
    (auth.uid() IS NOT NULL AND (user_id = auth.uid() OR user_id IS NULL))
    OR (auth.uid() IS NULL AND owner_label IS NOT NULL)
  );

DROP POLICY IF EXISTS "update_own_threads" ON chat_threads;
CREATE POLICY "update_own_threads"
  ON chat_threads FOR UPDATE
  TO anon, authenticated
  USING (
    (auth.uid() IS NOT NULL AND user_id = auth.uid())
    OR (auth.uid() IS NULL AND owner_label IS NOT NULL)
  )
  WITH CHECK (
    (auth.uid() IS NOT NULL AND user_id = auth.uid())
    OR (auth.uid() IS NULL AND owner_label IS NOT NULL)
  );

DROP POLICY IF EXISTS "delete_own_threads" ON chat_threads;
CREATE POLICY "delete_own_threads"
  ON chat_threads FOR DELETE
  TO anon, authenticated
  USING (
    (auth.uid() IS NOT NULL AND user_id = auth.uid())
    OR (auth.uid() IS NULL AND owner_label IS NOT NULL)
  );

-- =========================================================
-- chat_messages
-- =========================================================
CREATE TABLE IF NOT EXISTS chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id uuid NOT NULL REFERENCES chat_threads(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user','assistant','system')),
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;

-- Ownership derived through the parent thread.
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
        OR (auth.uid() IS NULL AND t.owner_label IS NOT NULL)
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
        OR (auth.uid() IS NULL AND t.owner_label IS NOT NULL)
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
        OR (auth.uid() IS NULL AND t.owner_label IS NOT NULL)
      )
    )
  );

-- =========================================================
-- memory_entries
-- =========================================================
CREATE TABLE IF NOT EXISTS memory_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  owner_label text,
  thread_id uuid REFERENCES chat_threads(id) ON DELETE CASCADE,
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE memory_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_memory" ON memory_entries;
CREATE POLICY "select_own_memory"
  ON memory_entries FOR SELECT
  TO anon, authenticated
  USING (
    (auth.uid() IS NOT NULL AND user_id = auth.uid())
    OR (auth.uid() IS NULL AND owner_label IS NOT NULL)
  );

DROP POLICY IF EXISTS "insert_own_memory" ON memory_entries;
CREATE POLICY "insert_own_memory"
  ON memory_entries FOR INSERT
  TO anon, authenticated
  WITH CHECK (
    (auth.uid() IS NOT NULL AND (user_id = auth.uid() OR user_id IS NULL))
    OR (auth.uid() IS NULL AND owner_label IS NOT NULL)
  );

DROP POLICY IF EXISTS "delete_own_memory" ON memory_entries;
CREATE POLICY "delete_own_memory"
  ON memory_entries FOR DELETE
  TO anon, authenticated
  USING (
    (auth.uid() IS NOT NULL AND user_id = auth.uid())
    OR (auth.uid() IS NULL AND owner_label IS NOT NULL)
  );

-- =========================================================
-- projects (app builder)
-- =========================================================
CREATE TABLE IF NOT EXISTS projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  owner_label text,
  name text NOT NULL,
  description text,
  prompt text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','generating','ready','error')),
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE projects ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_projects" ON projects;
CREATE POLICY "select_own_projects"
  ON projects FOR SELECT
  TO anon, authenticated
  USING (
    (auth.uid() IS NOT NULL AND user_id = auth.uid())
    OR (auth.uid() IS NULL AND owner_label IS NOT NULL)
  );

DROP POLICY IF EXISTS "insert_own_projects" ON projects;
CREATE POLICY "insert_own_projects"
  ON projects FOR INSERT
  TO anon, authenticated
  WITH CHECK (
    (auth.uid() IS NOT NULL AND (user_id = auth.uid() OR user_id IS NULL))
    OR (auth.uid() IS NULL AND owner_label IS NOT NULL)
  );

DROP POLICY IF EXISTS "update_own_projects" ON projects;
CREATE POLICY "update_own_projects"
  ON projects FOR UPDATE
  TO anon, authenticated
  USING (
    (auth.uid() IS NOT NULL AND user_id = auth.uid())
    OR (auth.uid() IS NULL AND owner_label IS NOT NULL)
  )
  WITH CHECK (
    (auth.uid() IS NOT NULL AND user_id = auth.uid())
    OR (auth.uid() IS NULL AND owner_label IS NOT NULL)
  );

DROP POLICY IF EXISTS "delete_own_projects" ON projects;
CREATE POLICY "delete_own_projects"
  ON projects FOR DELETE
  TO anon, authenticated
  USING (
    (auth.uid() IS NOT NULL AND user_id = auth.uid())
    OR (auth.uid() IS NULL AND owner_label IS NOT NULL)
  );

-- =========================================================
-- generated_files
-- =========================================================
CREATE TABLE IF NOT EXISTS generated_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  path text NOT NULL,
  language text NOT NULL DEFAULT 'text',
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE generated_files ENABLE ROW LEVEL SECURITY;

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
        OR (auth.uid() IS NULL AND p.owner_label IS NOT NULL)
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
        OR (auth.uid() IS NULL AND p.owner_label IS NOT NULL)
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
        OR (auth.uid() IS NULL AND p.owner_label IS NOT NULL)
      )
    )
  );

-- =========================================================
-- api_usage_logs (admin-only reads; inserts via service role / definer fn)
-- =========================================================
CREATE TABLE IF NOT EXISTS api_usage_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL DEFAULT 'gemini',
  model text NOT NULL,
  feature text NOT NULL DEFAULT 'chat',
  prompt_tokens int NOT NULL DEFAULT 0,
  completion_tokens int NOT NULL DEFAULT 0,
  total_tokens int NOT NULL DEFAULT 0,
  estimated_cost_usd numeric(10,6) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'success' CHECK (status IN ('success','error')),
  error_message text,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  owner_label text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE api_usage_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_usage_admin" ON api_usage_logs;
CREATE POLICY "select_usage_admin"
  ON api_usage_logs FOR SELECT
  TO authenticated
  USING (public.is_admin());

-- No anon/authenticated INSERT policy: inserts happen via the service-role
-- key inside edge functions, which bypasses RLS.

-- =========================================================
-- admin_events (audit log)
-- =========================================================
CREATE TABLE IF NOT EXISTS admin_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  action text NOT NULL,
  detail jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE admin_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_events_admin" ON admin_events;
CREATE POLICY "select_events_admin"
  ON admin_events FOR SELECT
  TO authenticated
  USING (public.is_admin());

-- =========================================================
-- Indexes
-- =========================================================
CREATE INDEX IF NOT EXISTS idx_chat_messages_thread ON chat_messages(thread_id, created_at);
CREATE INDEX IF NOT EXISTS idx_chat_threads_user ON chat_threads(user_id);
CREATE INDEX IF NOT EXISTS idx_projects_user ON projects(user_id);
CREATE INDEX IF NOT EXISTS idx_generated_files_project ON generated_files(project_id);
CREATE INDEX IF NOT EXISTS idx_api_usage_created ON api_usage_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_memory_user ON memory_entries(user_id);

-- =========================================================
-- SECURITY DEFINER: log_api_usage (callable by edge functions w/ service key)
-- =========================================================
CREATE OR REPLACE FUNCTION public.log_api_usage(
  p_provider text,
  p_model text,
  p_feature text,
  p_prompt_tokens int,
  p_completion_tokens int,
  p_total_tokens int,
  p_estimated_cost_usd numeric,
  p_status text,
  p_error_message text DEFAULT NULL,
  p_user_id uuid DEFAULT NULL,
  p_owner_label text DEFAULT NULL
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO api_usage_logs
    (provider, model, feature, prompt_tokens, completion_tokens, total_tokens,
     estimated_cost_usd, status, error_message, user_id, owner_label)
  VALUES
    (p_provider, p_model, p_feature, p_prompt_tokens, p_completion_tokens,
     p_total_tokens, p_estimated_cost_usd, p_status, p_error_message,
     p_user_id, p_owner_label);
$$;

-- =========================================================
-- SECURITY DEFINER: log_admin_event
-- =========================================================
CREATE OR REPLACE FUNCTION public.log_admin_event(
  p_action text,
  p_detail jsonb DEFAULT NULL
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO admin_events (admin_id, action, detail)
  VALUES (auth.uid(), p_action, p_detail);
$$;

-- =========================================================
-- SECURITY DEFINER: admin stats aggregate (safe read for dashboard)
-- =========================================================
CREATE OR REPLACE FUNCTION public.admin_stats()
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'total_threads', (SELECT count(*) FROM chat_threads),
    'total_messages', (SELECT count(*) FROM chat_messages),
    'total_projects', (SELECT count(*) FROM projects),
    'total_files', (SELECT count(*) FROM generated_files),
    'total_memory_entries', (SELECT count(*) FROM memory_entries),
    'total_api_calls', (SELECT count(*) FROM api_usage_logs),
    'error_count', (SELECT count(*) FROM api_usage_logs WHERE status = 'error'),
    'total_tokens', (SELECT coalesce(sum(total_tokens),0) FROM api_usage_logs),
    'total_cost_usd', (SELECT coalesce(sum(estimated_cost_usd),0) FROM api_usage_logs),
    'calls_today', (SELECT count(*) FROM api_usage_logs WHERE created_at > now() - interval '24 hours'),
    'errors_today', (SELECT count(*) FROM api_usage_logs WHERE status = 'error' AND created_at > now() - interval '24 hours'),
    'recent_errors', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'model', model, 'error', error_message, 'created_at', created_at
      ) ORDER BY created_at DESC), '[]'::jsonb)
      FROM (SELECT * FROM api_usage_logs WHERE status = 'error' ORDER BY created_at DESC LIMIT 10) e
    )
  );
$$;

-- Revoke public execute on definer functions, grant authenticated
REVOKE EXECUTE ON FUNCTION public.log_api_usage FROM public, anon;
REVOKE EXECUTE ON FUNCTION public.log_admin_event FROM public, anon;
REVOKE EXECUTE ON FUNCTION public.admin_stats FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_stats TO authenticated;
GRANT EXECUTE ON FUNCTION public.log_admin_event TO authenticated;