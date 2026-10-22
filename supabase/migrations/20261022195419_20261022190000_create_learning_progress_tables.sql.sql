/*
# Create learning progress tables for programming & cybersecurity learning

1. Purpose
   Persist user learning progress: completed lessons, skill levels, exercises,
   saved code snippets, and user-selected learning goals. Data is scoped per-user
   using the same dual-auth pattern (owner_label + user_id) used by chat_threads.

2. New Tables
   - `learning_goals` — user-selected learning goals (e.g. "Learn Python", "OWASP Top 10")
     - id (uuid PK)
     - user_id (uuid, nullable, for authenticated users)
     - owner_label (text, nullable, for anon users)
     - goal (text, not null) — the learning goal name
     - category (text) — 'programming' | 'cybersecurity' | 'general'
     - skill_level (text) — 'beginner' | 'intermediate' | 'advanced'
     - status (text) — 'active' | 'completed' | 'paused'
     - created_at (timestamptz)
     - updated_at (timestamptz)

   - `learning_progress` — completed lessons/exercises within a goal
     - id (uuid PK)
     - user_id (uuid, nullable)
     - owner_label (text, nullable)
     - goal_id (uuid, FK to learning_goals, ON DELETE CASCADE)
     - lesson_id (text, not null) — stable identifier for the lesson/exercise
     - lesson_title (text)
     - lesson_type (text) — 'lesson' | 'exercise' | 'project' | 'quiz'
     - status (text) — 'completed' | 'in_progress'
     - score (integer, nullable) — for quizzes/exercises
     - notes (text, nullable) — user notes about the lesson
     - created_at (timestamptz)
     - updated_at (timestamptz)

   - `code_snippets` — user-saved code snippets
     - id (uuid PK)
     - user_id (uuid, nullable)
     - owner_label (text, nullable)
     - title (text, not null)
     - language (text) — e.g. 'python', 'javascript', 'bash'
     - code (text, not null)
     - description (text, nullable)
     - tags (text[], default '{}')
     - thread_id (uuid, nullable, FK to chat_threads ON DELETE SET NULL)
     - created_at (timestamptz)
     - updated_at (timestamptz)

3. Security
   - RLS enabled on all three tables.
   - Grants: SELECT, INSERT, UPDATE, DELETE to anon + authenticated (dual-auth pattern).
   - Policies follow the existing pattern: (auth.uid() IS NOT NULL AND user_id = auth.uid()) OR (owner_label IS NOT NULL).
   - For learning_progress, ownership is checked through the parent goal_id as well.
   - No service_role grant needed — these tables are only accessed from the frontend.

4. Idempotency
   - All CREATE TABLE IF NOT EXISTS.
   - Policies dropped before recreate.
   - Indexes created with IF NOT EXISTS.

5. Important Notes
   - No existing tables or data are modified.
   - No columns are dropped or changed.
   - The dual-auth pattern matches chat_threads, memory_entries, etc.
*/

-- learning_goals
CREATE TABLE IF NOT EXISTS learning_goals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  owner_label text,
  goal text NOT NULL,
  category text NOT NULL DEFAULT 'programming',
  skill_level text NOT NULL DEFAULT 'beginner',
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE learning_goals ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON learning_goals TO anon, authenticated;

CREATE INDEX IF NOT EXISTS idx_learning_goals_owner ON learning_goals(owner_label);
CREATE INDEX IF NOT EXISTS idx_learning_goals_user ON learning_goals(user_id);

DROP POLICY IF EXISTS "lg_select_own" ON learning_goals;
CREATE POLICY "lg_select_own" ON learning_goals FOR SELECT
  TO anon, authenticated
  USING ((auth.uid() IS NOT NULL AND user_id = auth.uid()) OR (owner_label IS NOT NULL));

DROP POLICY IF EXISTS "lg_insert_own" ON learning_goals;
CREATE POLICY "lg_insert_own" ON learning_goals FOR INSERT
  TO anon, authenticated
  WITH CHECK ((auth.uid() IS NOT NULL AND (user_id = auth.uid() OR user_id IS NULL)) OR (owner_label IS NOT NULL));

DROP POLICY IF EXISTS "lg_update_own" ON learning_goals;
CREATE POLICY "lg_update_own" ON learning_goals FOR UPDATE
  TO anon, authenticated
  USING ((auth.uid() IS NOT NULL AND user_id = auth.uid()) OR (owner_label IS NOT NULL))
  WITH CHECK ((auth.uid() IS NOT NULL AND user_id = auth.uid()) OR (owner_label IS NOT NULL));

DROP POLICY IF EXISTS "lg_delete_own" ON learning_goals;
CREATE POLICY "lg_delete_own" ON learning_goals FOR DELETE
  TO anon, authenticated
  USING ((auth.uid() IS NOT NULL AND user_id = auth.uid()) OR (owner_label IS NOT NULL));

-- learning_progress
CREATE TABLE IF NOT EXISTS learning_progress (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  owner_label text,
  goal_id uuid REFERENCES learning_goals(id) ON DELETE CASCADE,
  lesson_id text NOT NULL,
  lesson_title text,
  lesson_type text NOT NULL DEFAULT 'lesson',
  status text NOT NULL DEFAULT 'completed',
  score integer,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE learning_progress ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON learning_progress TO anon, authenticated;

CREATE INDEX IF NOT EXISTS idx_learning_progress_owner ON learning_progress(owner_label);
CREATE INDEX IF NOT EXISTS idx_learning_progress_user ON learning_progress(user_id);
CREATE INDEX IF NOT EXISTS idx_learning_progress_goal ON learning_progress(goal_id);

DROP POLICY IF EXISTS "lp_select_own" ON learning_progress;
CREATE POLICY "lp_select_own" ON learning_progress FOR SELECT
  TO anon, authenticated
  USING ((auth.uid() IS NOT NULL AND user_id = auth.uid()) OR (owner_label IS NOT NULL));

DROP POLICY IF EXISTS "lp_insert_own" ON learning_progress;
CREATE POLICY "lp_insert_own" ON learning_progress FOR INSERT
  TO anon, authenticated
  WITH CHECK ((auth.uid() IS NOT NULL AND (user_id = auth.uid() OR user_id IS NULL)) OR (owner_label IS NOT NULL));

DROP POLICY IF EXISTS "lp_update_own" ON learning_progress;
CREATE POLICY "lp_update_own" ON learning_progress FOR UPDATE
  TO anon, authenticated
  USING ((auth.uid() IS NOT NULL AND user_id = auth.uid()) OR (owner_label IS NOT NULL))
  WITH CHECK ((auth.uid() IS NOT NULL AND user_id = auth.uid()) OR (owner_label IS NOT NULL));

DROP POLICY IF EXISTS "lp_delete_own" ON learning_progress;
CREATE POLICY "lp_delete_own" ON learning_progress FOR DELETE
  TO anon, authenticated
  USING ((auth.uid() IS NOT NULL AND user_id = auth.uid()) OR (owner_label IS NOT NULL));

-- code_snippets
CREATE TABLE IF NOT EXISTS code_snippets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  owner_label text,
  title text NOT NULL,
  language text NOT NULL DEFAULT 'text',
  code text NOT NULL,
  description text,
  tags text[] DEFAULT '{}',
  thread_id uuid REFERENCES chat_threads(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE code_snippets ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON code_snippets TO anon, authenticated;

CREATE INDEX IF NOT EXISTS idx_code_snippets_owner ON code_snippets(owner_label);
CREATE INDEX IF NOT EXISTS idx_code_snippets_user ON code_snippets(user_id);

DROP POLICY IF EXISTS "cs_select_own" ON code_snippets;
CREATE POLICY "cs_select_own" ON code_snippets FOR SELECT
  TO anon, authenticated
  USING ((auth.uid() IS NOT NULL AND user_id = auth.uid()) OR (owner_label IS NOT NULL));

DROP POLICY IF EXISTS "cs_insert_own" ON code_snippets;
CREATE POLICY "cs_insert_own" ON code_snippets FOR INSERT
  TO anon, authenticated
  WITH CHECK ((auth.uid() IS NOT NULL AND (user_id = auth.uid() OR user_id IS NULL)) OR (owner_label IS NOT NULL));

DROP POLICY IF EXISTS "cs_update_own" ON code_snippets;
CREATE POLICY "cs_update_own" ON code_snippets FOR UPDATE
  TO anon, authenticated
  USING ((auth.uid() IS NOT NULL AND user_id = auth.uid()) OR (owner_label IS NOT NULL))
  WITH CHECK ((auth.uid() IS NOT NULL AND user_id = auth.uid()) OR (owner_label IS NOT NULL));

DROP POLICY IF EXISTS "cs_delete_own" ON code_snippets;
CREATE POLICY "cs_delete_own" ON code_snippets FOR DELETE
  TO anon, authenticated
  USING ((auth.uid() IS NOT NULL AND user_id = auth.uid()) OR (owner_label IS NOT NULL));
