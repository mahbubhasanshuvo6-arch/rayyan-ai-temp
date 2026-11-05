/*
# Rayyan AI Agent — Schema, Functions, RLS, and Quota System
# READ-ONLY REVIEW COPY — DO NOT APPLY

## Purpose
Creates the complete agent task orchestration system: tasks, steps, events,
approvals, persistent memory, quota enforcement, and an archive table.
Includes three SECURITY DEFINER RPC functions used by the agent-run edge
function, all with hardened validation and explicit search_path.

## New Tables
1. `agent_tasks` — A user's top-level agent request (goal → plan → steps → result).
   - id (uuid PK), user_id (uuid NOT NULL, FK auth.users), title, goal, status,
     max_steps, current_step, result, error, retry_count, input_hash,
     lock_token, locked_until, created_at, updated_at.
2. `agent_steps` — Individual planned steps within a task.
   - id (uuid PK), task_id (FK agent_tasks CASCADE), user_id (FK auth.users),
     position, title, tool, input (jsonb), input_hash, status, attempts,
     output (jsonb), error, started_at, finished_at, created_at, updated_at.
3. `agent_events` — Append-only event log for task/step lifecycle.
   - id (bigserial PK), task_id (FK agent_tasks CASCADE), step_id (FK agent_steps CASCADE, nullable),
     user_id (FK auth.users), kind, message, payload (jsonb), created_at.
4. `agent_approvals` — User approval records for steps that require it.
   - id (uuid PK), task_id (FK agent_tasks CASCADE), step_id (FK agent_steps CASCADE),
     user_id (FK auth.users), action_summary, risk, status, preview, input_hash,
     created_at, decided_at.
5. `agent_memory` — Persistent facts/preferences saved by the agent for a user.
   - id (uuid PK), user_id (uuid NOT NULL, FK auth.users), task_id (FK agent_tasks, nullable),
     step_id (FK agent_steps, nullable), content (text 3–2000 chars), created_at.
6. `agent_quota_limits` — Per-user hourly quota buckets.
   - id (bigserial PK), user_id (uuid NOT NULL, FK auth.users), bucket_name (text),
     count (int), window_start (timestamptz).
   - UNIQUE(user_id, bucket_name).
7. `agent_archive` — Soft-archive of completed/cancelled/failed tasks (read-only).
   - id (uuid PK), task_id (FK agent_tasks CASCADE), user_id (FK auth.users),
     snapshot (jsonb), archived_at.

## Security
- RLS enabled on ALL seven tables.
- Owner-scoped SELECT policies (auth.uid() = user_id) on all tables.
- All INSERT/UPDATE/DELETE goes through the edge function (service_role, bypasses RLS).
- agent_archive is SELECT-only (no INSERT/UPDATE/DELETE via client).
- agent_quota_limits is SELECT-only for clients; quota enforcement is via
  the agent_consume_quota SECURITY DEFINER function (service_role only).
- All three RPC functions are SECURITY DEFINER with SET search_path = 'public',
  REVOKE from PUBLIC/anon, GRANT EXECUTE to service_role only.
- service_role granted full CRUD on all agent tables (edge function bypasses RLS).

## Functions
1. agent_consume_quota(p_user_id, p_bucket_name, p_max_override) → boolean
   — Atomic increment-or-reset of a per-user hourly quota bucket using
     INSERT ... ON CONFLICT to prevent race conditions.
2. agent_decide_approval(p_user_id, p_task_id, p_approve) → jsonb
   — Approves or rejects the most recent pending approval for a task.
   Validates task status (must be awaiting_approval), approval status
   (must be pending), and step status (must be awaiting_approval) before
   acting. Blocks decisions on completed/failed/cancelled tasks.
   Verifies input_hash integrity. On approve: re-queues task. On reject:
   cancels task and skips remaining steps.
3. agent_commit_memory(p_user_id, p_task_id, p_step_id, p_content) → uuid
   — Saves a memory entry after validating content size (3–2000 chars),
   rejecting control characters, verifying task is in an active state,
   and verifying step state (running/awaiting_approval/succeeded) if
   step_id is provided.

## Idempotency
- All CREATE TABLE use IF NOT EXISTS.
- All CREATE INDEX use IF NOT EXISTS.
- All ALTER TABLE ... ENABLE ROW LEVEL SECURITY are idempotent.
- All policies use DROP POLICY IF EXISTS before CREATE.
- All constraints use DO $$ ... IF NOT EXISTS ... END $$ guards.
- All functions use CREATE OR REPLACE.
- All GRANT/REVOKE are safe to re-run.

## Preservation
- Does NOT touch any existing table, policy, function, or data.
- Does NOT modify auth, chat, voice, App Builder, admin panel, or deployment.
- All new tables are additive only.
- No DROP, no column type changes, no renames.
*/

-- ============================================================
-- 1. agent_tasks
-- ============================================================

CREATE TABLE IF NOT EXISTS agent_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  goal text NOT NULL CHECK (length(goal) BETWEEN 1 AND 4000),
  status text NOT NULL DEFAULT 'planning'
    CHECK (status IN ('planning','queued','running','paused','awaiting_approval','completed','failed','cancelled')),
  max_steps integer NOT NULL DEFAULT 12 CHECK (max_steps BETWEEN 1 AND 20),
  current_step integer,
  result text,
  error text,
  retry_count integer NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
  input_hash text,
  lock_token uuid,
  locked_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Idempotently add lock_token/locked_until columns if table pre-existed without them
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'agent_tasks' AND column_name = 'lock_token') THEN
    ALTER TABLE agent_tasks ADD COLUMN lock_token uuid;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'agent_tasks' AND column_name = 'locked_until') THEN
    ALTER TABLE agent_tasks ADD COLUMN locked_until timestamptz;
  END IF;
END $$;

ALTER TABLE agent_tasks ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_agent_tasks_user_id ON agent_tasks(user_id);
CREATE INDEX IF NOT EXISTS idx_agent_tasks_status ON agent_tasks(status);
CREATE INDEX IF NOT EXISTS idx_agent_tasks_input_hash ON agent_tasks(user_id, input_hash);
CREATE INDEX IF NOT EXISTS idx_agent_tasks_created_at ON agent_tasks(created_at DESC);

-- ============================================================
-- 2. agent_steps
-- ============================================================

CREATE TABLE IF NOT EXISTS agent_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES agent_tasks(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  position integer NOT NULL CHECK (position >= 1),
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 300),
  tool text NOT NULL CHECK (length(tool) BETWEEN 1 AND 100),
  input jsonb NOT NULL DEFAULT '{}'::jsonb,
  input_hash text NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','running','awaiting_approval','succeeded','failed','skipped','rejected')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  output jsonb,
  error text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE agent_steps ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_agent_steps_task_id ON agent_steps(task_id);
CREATE INDEX IF NOT EXISTS idx_agent_steps_task_status ON agent_steps(task_id, status);
CREATE INDEX IF NOT EXISTS idx_agent_steps_pending ON agent_steps(task_id, status, position);

-- ============================================================
-- 3. agent_events
-- ============================================================

CREATE TABLE IF NOT EXISTS agent_events (
  id bigserial PRIMARY KEY,
  task_id uuid NOT NULL REFERENCES agent_tasks(id) ON DELETE CASCADE,
  step_id uuid REFERENCES agent_steps(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('status','plan','step_start','tool_result','retry','approval_requested','approval_decided','error','info')),
  message text NOT NULL CHECK (length(message) BETWEEN 1 AND 2000),
  payload jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE agent_events ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_agent_events_task_id ON agent_events(task_id);
CREATE INDEX IF NOT EXISTS idx_agent_events_created_at ON agent_events(task_id, created_at DESC);

-- ============================================================
-- 4. agent_approvals
-- ============================================================

CREATE TABLE IF NOT EXISTS agent_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES agent_tasks(id) ON DELETE CASCADE,
  step_id uuid NOT NULL REFERENCES agent_steps(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  action_summary text NOT NULL CHECK (length(action_summary) BETWEEN 1 AND 1000),
  risk text NOT NULL DEFAULT 'medium'
    CHECK (risk IN ('low','medium','high')),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','approved','rejected')),
  preview text NOT NULL CHECK (length(preview) BETWEEN 1 AND 8000),
  input_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz
);

ALTER TABLE agent_approvals ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_agent_approvals_task_id ON agent_approvals(task_id);
CREATE INDEX IF NOT EXISTS idx_agent_approvals_step_id ON agent_approvals(step_id);
CREATE INDEX IF NOT EXISTS idx_agent_approvals_pending ON agent_approvals(task_id, status, created_at DESC);

-- ============================================================
-- 5. agent_memory
-- ============================================================

CREATE TABLE IF NOT EXISTS agent_memory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  task_id uuid REFERENCES agent_tasks(id) ON DELETE SET NULL,
  step_id uuid REFERENCES agent_steps(id) ON DELETE SET NULL,
  content text NOT NULL CHECK (length(content) BETWEEN 3 AND 2000),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE agent_memory ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_agent_memory_user_id ON agent_memory(user_id);
CREATE INDEX IF NOT EXISTS idx_agent_memory_created_at ON agent_memory(user_id, created_at DESC);

-- ============================================================
-- 6. agent_quota_limits
-- ============================================================

CREATE TABLE IF NOT EXISTS agent_quota_limits (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  bucket_name text NOT NULL CHECK (length(bucket_name) BETWEEN 1 AND 100),
  count integer NOT NULL DEFAULT 1 CHECK (count >= 0),
  window_start timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE agent_quota_limits ENABLE ROW LEVEL SECURITY;

-- Idempotent unique constraint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema = 'public' AND table_name = 'agent_quota_limits'
    AND constraint_type = 'UNIQUE' AND constraint_name = 'uq_agent_quota_user_bucket'
  ) THEN
    ALTER TABLE agent_quota_limits ADD CONSTRAINT uq_agent_quota_user_bucket UNIQUE (user_id, bucket_name);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_agent_quota_user_bucket ON agent_quota_limits(user_id, bucket_name);

-- ============================================================
-- 7. agent_archive
-- ============================================================

CREATE TABLE IF NOT EXISTS agent_archive (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES agent_tasks(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  snapshot jsonb NOT NULL,
  archived_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE agent_archive ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_agent_archive_user_id ON agent_archive(user_id);
CREATE INDEX IF NOT EXISTS idx_agent_archive_task_id ON agent_archive(task_id);

-- ============================================================
-- GRANTS — service_role gets full access (edge function bypasses RLS)
-- ============================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON agent_tasks TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON agent_steps TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON agent_events TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON agent_approvals TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON agent_memory TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON agent_quota_limits TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON agent_archive TO service_role;

-- Sequence grants for bigserial columns
GRANT USAGE, SELECT ON SEQUENCE agent_events_id_seq TO service_role;
GRANT USAGE, SELECT ON SEQUENCE agent_quota_limits_id_seq TO service_role;

-- ============================================================
-- GRANTS — authenticated users get owner-scoped access via RLS
-- ============================================================

-- All agent table writes go through the agent-run edge function (service_role),
-- so authenticated users only need SELECT to display their own data.
GRANT SELECT ON agent_tasks TO authenticated;
GRANT SELECT ON agent_steps TO authenticated;
GRANT SELECT ON agent_events TO authenticated;
GRANT SELECT ON agent_approvals TO authenticated;
GRANT SELECT ON agent_memory TO authenticated;
GRANT SELECT ON agent_quota_limits TO authenticated;
GRANT SELECT ON agent_archive TO authenticated;

-- ============================================================
-- RLS POLICIES — agent_tasks
-- ============================================================

DROP POLICY IF EXISTS "select_own_agent_tasks" ON agent_tasks;
CREATE POLICY "select_own_agent_tasks" ON agent_tasks
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- No INSERT/UPDATE/DELETE policies for authenticated on agent_tasks.
-- All task writes go through the edge function (service_role, bypasses RLS).
-- Authenticated users can only SELECT their own tasks.

-- ============================================================
-- RLS POLICIES — agent_steps
-- ============================================================

DROP POLICY IF EXISTS "select_own_agent_steps" ON agent_steps;
CREATE POLICY "select_own_agent_steps" ON agent_steps
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- No INSERT/UPDATE/DELETE policies for authenticated on agent_steps.
-- All step writes go through the edge function (service_role, bypasses RLS).
-- Authenticated users can only SELECT their own steps.

-- ============================================================
-- RLS POLICIES — agent_events
-- ============================================================

DROP POLICY IF EXISTS "select_own_agent_events" ON agent_events;
CREATE POLICY "select_own_agent_events" ON agent_events
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- No INSERT/UPDATE/DELETE policies for authenticated on agent_events.
-- All event writes go through the edge function (service_role, bypasses RLS).
-- Authenticated users can only SELECT their own events.

-- ============================================================
-- RLS POLICIES — agent_approvals
-- ============================================================

DROP POLICY IF EXISTS "select_own_agent_approvals" ON agent_approvals;
CREATE POLICY "select_own_agent_approvals" ON agent_approvals
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- No INSERT/UPDATE/DELETE policies for authenticated on agent_approvals.
-- All approval writes go through the edge function (service_role, bypasses RLS).
-- Authenticated users can only SELECT their own approvals.

-- ============================================================
-- RLS POLICIES — agent_memory
-- ============================================================

DROP POLICY IF EXISTS "select_own_agent_memory" ON agent_memory;
CREATE POLICY "select_own_agent_memory" ON agent_memory
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- No INSERT/UPDATE/DELETE policies for authenticated on agent_memory.
-- Memory is committed only through the agent_commit_memory RPC (service_role).
-- Authenticated users can only SELECT their own memory entries.

-- ============================================================
-- RLS POLICIES — agent_quota_limits
-- Client can SELECT their own row; all writes go through the
-- agent_consume_quota SECURITY DEFINER function (service_role only).
-- ============================================================

DROP POLICY IF EXISTS "select_own_agent_quota" ON agent_quota_limits;
CREATE POLICY "select_own_agent_quota" ON agent_quota_limits
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- ============================================================
-- RLS POLICIES — agent_archive
-- Read-only for the owner. No client INSERT/UPDATE/DELETE.
-- ============================================================

DROP POLICY IF EXISTS "select_own_agent_archive" ON agent_archive;
CREATE POLICY "select_own_agent_archive" ON agent_archive
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- ============================================================
-- FUNCTION: agent_consume_quota
-- Atomic increment-or-reset of a per-user hourly quota bucket.
-- Uses INSERT ... ON CONFLICT for race-free concurrent execution.
-- Returns true if still under the limit, false if exhausted.
-- SECURITY DEFINER, search_path = public, service_role only.
-- ============================================================

CREATE OR REPLACE FUNCTION public.agent_consume_quota(
  p_user_id uuid,
  p_bucket_name text,
  p_max_override integer DEFAULT NULL
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_max integer;
  v_now timestamptz := now();
  v_count integer;
  v_window_start timestamptz;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'User ID is required';
  END IF;
  IF p_bucket_name IS NULL OR length(p_bucket_name) < 1 OR length(p_bucket_name) > 100 THEN
    RAISE EXCEPTION 'Invalid bucket name';
  END IF;

  v_max := COALESCE(p_max_override, 0);
  IF v_max <= 0 THEN
    RETURN true;
  END IF;

  -- Atomic upsert: insert new bucket or update existing with conditional reset.
  -- ON CONFLICT ensures only one row per (user_id, bucket_name) pair,
  -- preventing duplicate rows from concurrent calls.
  INSERT INTO agent_quota_limits (user_id, bucket_name, count, window_start)
  VALUES (p_user_id, p_bucket_name, 1, v_now)
  ON CONFLICT (user_id, bucket_name)
  DO UPDATE SET
    count = CASE
      WHEN agent_quota_limits.window_start < v_now - interval '1 hour'
        THEN 1
      ELSE agent_quota_limits.count + 1
    END,
    window_start = CASE
      WHEN agent_quota_limits.window_start < v_now - interval '1 hour'
        THEN v_now
      ELSE agent_quota_limits.window_start
    END
  RETURNING count, window_start
  INTO v_count, v_window_start;

  RETURN v_count <= v_max;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.agent_consume_quota(uuid, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.agent_consume_quota(uuid, text, integer) TO service_role;

-- ============================================================
-- FUNCTION: agent_decide_approval
-- Approves or rejects the most recent pending approval for a task.
--
-- Validation chain (all checks before any mutation):
--   1. p_user_id is not null
--   2. Task exists and belongs to the user
--   3. Task status is not completed/failed/cancelled (terminal states blocked)
--   4. Task status is awaiting_approval
--   5. A pending approval exists for the task
--   6. The approval's step is in awaiting_approval status
--   7. The approval's input_hash matches the step's input_hash
--
-- On approve: approval→approved, step→pending, task→queued (re-queue for runner)
-- On reject:  approval→rejected, step→rejected, remaining pending steps→skipped,
--             task→cancelled
--
-- Returns jsonb: {task: {...}} on success, {error: "code"} on failure.
-- ============================================================

CREATE OR REPLACE FUNCTION public.agent_decide_approval(
  p_user_id uuid,
  p_task_id uuid,
  p_approve boolean
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_task agent_tasks%ROWTYPE;
  v_approval agent_approvals%ROWTYPE;
  v_step agent_steps%ROWTYPE;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN jsonb_build_object('error', 'invalid_user');
  END IF;

  -- Load and validate the task
  SELECT * INTO v_task FROM agent_tasks WHERE id = p_task_id AND user_id = p_user_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'task_not_found');
  END IF;

  -- Block decisions on terminal tasks
  IF v_task.status IN ('completed', 'failed', 'cancelled') THEN
    RETURN jsonb_build_object('error', 'task_not_active');
  END IF;

  -- Task must be in awaiting_approval state
  IF v_task.status != 'awaiting_approval' THEN
    RETURN jsonb_build_object('error', 'no_pending_approval');
  END IF;

  -- Find the most recent pending approval for this task
  SELECT * INTO v_approval
  FROM agent_approvals
  WHERE task_id = p_task_id
    AND user_id = p_user_id
    AND status = 'pending'
  ORDER BY created_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'no_pending_approval');
  END IF;

  -- Validate the step is in awaiting_approval status
  SELECT * INTO v_step FROM agent_steps WHERE id = v_approval.step_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'step_not_found');
  END IF;

  IF v_step.status != 'awaiting_approval' THEN
    -- The step has moved on — mark the approval as rejected to prevent re-use
    UPDATE agent_approvals
    SET status = 'rejected', decided_at = now()
    WHERE id = v_approval.id AND status = 'pending';
    RETURN jsonb_build_object('error', 'already_decided');
  END IF;

  -- Verify input_hash integrity (step input hasn't changed since approval was requested)
  IF v_approval.input_hash != v_step.input_hash THEN
    UPDATE agent_approvals
    SET status = 'rejected', decided_at = now()
    WHERE id = v_approval.id AND status = 'pending';
    UPDATE agent_steps SET status = 'rejected', updated_at = now() WHERE id = v_step.id;
    UPDATE agent_tasks SET status = 'cancelled', error = 'Step input changed after approval request.', updated_at = now()
    WHERE id = p_task_id;
    RETURN jsonb_build_object('error', 'input_changed');
  END IF;

  -- Apply the decision
  IF p_approve THEN
    UPDATE agent_approvals
    SET status = 'approved', decided_at = now()
    WHERE id = v_approval.id AND status = 'pending';

    UPDATE agent_steps
    SET status = 'pending', updated_at = now()
    WHERE id = v_step.id;

    UPDATE agent_tasks
    SET status = 'queued', lock_token = NULL, locked_until = NULL, updated_at = now()
    WHERE id = p_task_id;
  ELSE
    UPDATE agent_approvals
    SET status = 'rejected', decided_at = now()
    WHERE id = v_approval.id AND status = 'pending';

    UPDATE agent_steps
    SET status = 'rejected', updated_at = now()
    WHERE id = v_step.id;

    -- Skip any remaining pending steps
    UPDATE agent_steps
    SET status = 'skipped', updated_at = now()
    WHERE task_id = p_task_id AND status = 'pending';

    UPDATE agent_tasks
    SET status = 'cancelled', updated_at = now()
    WHERE id = p_task_id;
  END IF;

  -- Return the updated task
  SELECT * INTO v_task FROM agent_tasks WHERE id = p_task_id;
  RETURN jsonb_build_object('task', to_jsonb(v_task));
END;
$$;

REVOKE EXECUTE ON FUNCTION public.agent_decide_approval(uuid, uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.agent_decide_approval(uuid, uuid, boolean) TO service_role;

-- ============================================================
-- FUNCTION: agent_commit_memory
-- Saves a persistent memory entry for a user.
--
-- Validation chain:
--   1. p_user_id is not null
--   2. p_content is not null, trimmed length 3–2000 chars
--   3. p_content contains no control characters (except tab/newline/CR)
--   4. Task exists, belongs to the user, and is in an active state
--      (not completed/failed/cancelled)
--   5. If p_step_id is provided: step exists, belongs to the task,
--      and is in running/awaiting_approval/succeeded state
--
-- Returns the new memory entry UUID.
-- Raises exception on any validation failure.
-- ============================================================

CREATE OR REPLACE FUNCTION public.agent_commit_memory(
  p_user_id uuid,
  p_task_id uuid,
  p_step_id uuid,
  p_content text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_task agent_tasks%ROWTYPE;
  v_step agent_steps%ROWTYPE;
  v_content text;
  v_new_id uuid;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'User ID is required';
  END IF;

  IF p_content IS NULL THEN
    RAISE EXCEPTION 'Content is required';
  END IF;

  v_content := trim(p_content);
  IF length(v_content) < 3 OR length(v_content) > 2000 THEN
    RAISE EXCEPTION 'Content must be between 3 and 2000 characters';
  END IF;

  -- Reject null bytes and control characters (except tab=\x09, LF=\x0a, CR=\x0d)
  IF v_content ~ '[\x00-\x08\x0b\x0c\x0e-\x1f]' THEN
    RAISE EXCEPTION 'Content contains invalid characters';
  END IF;

  -- Validate task
  SELECT * INTO v_task FROM agent_tasks WHERE id = p_task_id AND user_id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Task not found';
  END IF;

  -- Task must be in an active state
  IF v_task.status IN ('completed', 'failed', 'cancelled') THEN
    RAISE EXCEPTION 'Cannot save memory for a task that is no longer active';
  END IF;

  -- Validate step if provided
  IF p_step_id IS NOT NULL THEN
    SELECT * INTO v_step FROM agent_steps WHERE id = p_step_id AND task_id = p_task_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Step not found';
    END IF;

    IF v_step.status NOT IN ('running', 'awaiting_approval', 'succeeded') THEN
      RAISE EXCEPTION 'Cannot save memory from a step in its current state';
    END IF;
  END IF;

  -- Insert the memory entry
  INSERT INTO agent_memory (user_id, task_id, step_id, content)
  VALUES (p_user_id, p_task_id, p_step_id, v_content)
  RETURNING id INTO v_new_id;

  RETURN v_new_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.agent_commit_memory(uuid, uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.agent_commit_memory(uuid, uuid, uuid, text) TO service_role;
