-- Phase 1: Admin RBAC + database hardening
-- Adds role hierarchy (super_admin/admin/support), restricts over-granted
-- privileges, and makes SECURITY DEFINER functions admin-only.

-- ============================================================
-- 1. admin_users table: stores the role for each admin user.
--    app_metadata.is_admin remains the JWT fast-path; admin_users.role
--    provides fine-grained authorization.
-- ============================================================

CREATE TABLE IF NOT EXISTS admin_users (
  user_id    uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role       text NOT NULL DEFAULT 'admin'
              CHECK (role IN ('super_admin', 'admin', 'support')),
  suspended  boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE admin_users ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS admin_users_select ON admin_users;
CREATE POLICY admin_users_select ON admin_users
  FOR SELECT TO authenticated
  USING (is_admin());

REVOKE ALL ON admin_users FROM anon;
REVOKE ALL ON admin_users FROM authenticated;
GRANT SELECT ON admin_users TO authenticated;

-- ============================================================
-- 2. Add outcome/target columns to admin_events.
-- ============================================================

ALTER TABLE admin_events
  ADD COLUMN IF NOT EXISTS outcome text DEFAULT 'success'
    CHECK (outcome IN ('success', 'failed', 'denied'));

ALTER TABLE admin_events
  ADD COLUMN IF NOT EXISTS target text;

ALTER TABLE admin_events
  ADD COLUMN IF NOT EXISTS target_type text;

-- ============================================================
-- 3. Harden admin_events: revoke direct write/delete from all roles.
-- ============================================================

REVOKE ALL ON admin_events FROM anon;
REVOKE ALL ON admin_events FROM authenticated;
GRANT SELECT ON admin_events TO authenticated;

DROP POLICY IF EXISTS select_events_admin ON admin_events;
CREATE POLICY select_events_admin ON admin_events
  FOR SELECT TO authenticated
  USING (is_admin());

-- ============================================================
-- 4. Harden api_usage_logs.
-- ============================================================

REVOKE UPDATE ON api_usage_logs FROM anon;
REVOKE DELETE ON api_usage_logs FROM anon;
REVOKE INSERT ON api_usage_logs FROM anon;
REVOKE UPDATE ON api_usage_logs FROM authenticated;
REVOKE DELETE ON api_usage_logs FROM authenticated;
REVOKE INSERT ON api_usage_logs FROM authenticated;

-- ============================================================
-- 5. Harden app_settings.
-- ============================================================

REVOKE INSERT ON app_settings FROM anon;
REVOKE DELETE ON app_settings FROM anon;
REVOKE INSERT ON app_settings FROM authenticated;
REVOKE DELETE ON app_settings FROM authenticated;

-- ============================================================
-- 6. Restrict SECURITY DEFINER function execution.
-- ============================================================

REVOKE EXECUTE ON FUNCTION is_admin() FROM anon;
REVOKE EXECUTE ON FUNCTION is_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION is_admin() TO authenticated;

REVOKE EXECUTE ON FUNCTION admin_stats() FROM anon;
REVOKE EXECUTE ON FUNCTION admin_stats() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_stats() TO authenticated;

REVOKE EXECUTE ON FUNCTION log_api_usage(text, text, text, integer, integer, integer, numeric, text, text, uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION log_api_usage(text, text, text, integer, integer, integer, numeric, text, text, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION log_api_usage(text, text, text, integer, integer, integer, numeric, text, text, uuid, text) TO authenticated;

-- ============================================================
-- 7. Redefine log_admin_event with target + outcome params.
-- ============================================================

CREATE OR REPLACE FUNCTION log_admin_event(
  p_action text,
  p_detail jsonb DEFAULT NULL,
  p_target text DEFAULT NULL,
  p_target_type text DEFAULT NULL,
  p_outcome text DEFAULT 'success'
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  INSERT INTO admin_events (admin_id, action, detail, target, target_type, outcome)
  VALUES (auth.uid(), p_action, p_detail, p_target, p_target_type, p_outcome);
$$;

REVOKE EXECUTE ON FUNCTION log_admin_event(text, jsonb, text, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION log_admin_event(text, jsonb, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION log_admin_event(text, jsonb, text, text, text) TO authenticated;

-- Also revoke the old signature from anon (in case it still exists).
REVOKE EXECUTE ON FUNCTION log_admin_event(text, jsonb) FROM anon;

-- ============================================================
-- 8. RBAC helper functions.
-- ============================================================

CREATE OR REPLACE FUNCTION get_admin_role()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT role FROM admin_users WHERE user_id = auth.uid() AND NOT suspended;
$$;

REVOKE EXECUTE ON FUNCTION get_admin_role() FROM anon;
REVOKE EXECUTE ON FUNCTION get_admin_role() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_admin_role() TO authenticated;

CREATE OR REPLACE FUNCTION is_super_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM admin_users
    WHERE user_id = auth.uid()
      AND role = 'super_admin'
      AND NOT suspended
  );
$$;

REVOKE EXECUTE ON FUNCTION is_super_admin() FROM anon;
REVOKE EXECUTE ON FUNCTION is_super_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION is_super_admin() TO authenticated;

-- ============================================================
-- 9. grant_admin_role: only super_admin can grant. No self-promotion.
-- ============================================================

CREATE OR REPLACE FUNCTION grant_admin_role(
  p_target_user_id uuid,
  p_role text DEFAULT 'admin'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  caller_role text;
BEGIN
  SELECT role INTO caller_role FROM admin_users
    WHERE user_id = auth.uid() AND NOT suspended;

  IF caller_role IS NULL OR caller_role <> 'super_admin' THEN
    INSERT INTO admin_events (admin_id, action, target, target_type, outcome, detail)
    VALUES (auth.uid(), 'grant_admin_role', p_target_user_id::text, 'user', 'denied',
            jsonb_build_object('requested_role', p_role));
    RAISE EXCEPTION 'Not authorized: only super admins can grant roles';
  END IF;

  IF p_target_user_id = auth.uid() THEN
    RAISE EXCEPTION 'Cannot modify your own role';
  END IF;

  IF p_role NOT IN ('super_admin', 'admin', 'support') THEN
    RAISE EXCEPTION 'Invalid role: %', p_role;
  END IF;

  INSERT INTO admin_users (user_id, role, suspended, created_at, updated_at)
  VALUES (p_target_user_id, p_role, false, now(), now())
  ON CONFLICT (user_id)
  DO UPDATE SET role = EXCLUDED.role, suspended = false, updated_at = now();
END;
$$;

REVOKE EXECUTE ON FUNCTION grant_admin_role(uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION grant_admin_role(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION grant_admin_role(uuid, text) TO authenticated;

-- ============================================================
-- 10. set_admin_suspended: only super_admin can suspend.
-- ============================================================

CREATE OR REPLACE FUNCTION set_admin_suspended(
  p_target_user_id uuid,
  p_suspended boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  caller_role text;
BEGIN
  SELECT role INTO caller_role FROM admin_users
    WHERE user_id = auth.uid() AND NOT suspended;

  IF caller_role IS NULL OR caller_role <> 'super_admin' THEN
    INSERT INTO admin_events (admin_id, action, target, target_type, outcome, detail)
    VALUES (auth.uid(), 'set_admin_suspended', p_target_user_id::text, 'user', 'denied',
            jsonb_build_object('suspended', p_suspended));
    RAISE EXCEPTION 'Not authorized: only super admins can suspend admins';
  END IF;

  IF p_target_user_id = auth.uid() THEN
    RAISE EXCEPTION 'Cannot suspend your own account';
  END IF;

  UPDATE admin_users
    SET suspended = p_suspended, updated_at = now()
    WHERE user_id = p_target_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Target user is not an admin';
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION set_admin_suspended(uuid, boolean) FROM anon;
REVOKE EXECUTE ON FUNCTION set_admin_suspended(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION set_admin_suspended(uuid, boolean) TO authenticated;

-- ============================================================
-- 11. revoke_admin_role: only super_admin can revoke. No self-revoke.
-- ============================================================

CREATE OR REPLACE FUNCTION revoke_admin_role(
  p_target_user_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  caller_role text;
BEGIN
  SELECT role INTO caller_role FROM admin_users
    WHERE user_id = auth.uid() AND NOT suspended;

  IF caller_role IS NULL OR caller_role <> 'super_admin' THEN
    INSERT INTO admin_events (admin_id, action, target, target_type, outcome, detail)
    VALUES (auth.uid(), 'revoke_admin_role', p_target_user_id::text, 'user', 'denied', null);
    RAISE EXCEPTION 'Not authorized: only super admins can revoke admin roles';
  END IF;

  IF p_target_user_id = auth.uid() THEN
    RAISE EXCEPTION 'Cannot revoke your own admin role';
  END IF;

  DELETE FROM admin_users WHERE user_id = p_target_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Target user is not an admin';
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION revoke_admin_role(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION revoke_admin_role(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION revoke_admin_role(uuid) TO authenticated;

-- ============================================================
-- 12. Seed: the existing admin (identified by the edge function
--     during setup) will be added to admin_users by the edge
--     function on next login. We can't access app_metadata from
--     SQL, so seeding happens in the edge function's auth check.
-- ============================================================
