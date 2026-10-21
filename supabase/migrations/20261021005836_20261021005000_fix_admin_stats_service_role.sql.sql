-- Fix: admin_stats() returns NULL when called via the service-role client
-- because is_admin() reads auth.jwt() which doesn't have app_metadata.is_admin
-- in the service-role context. The edge function already verifies the caller
-- is an admin before calling admin_stats(), so the internal check is redundant
-- for that path and actively breaks it.
--
-- Solution: Remove the is_admin() gate from admin_stats() and instead
-- restrict EXECUTE to service_role + postgres only (not authenticated).
-- This blocks direct REST calls by authenticated non-admins while allowing
-- the edge function (which uses the service-role client) to get real data.

CREATE OR REPLACE FUNCTION admin_stats()
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
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

-- Block authenticated from calling admin_stats() directly via REST.
-- Only service_role (edge function) and postgres (admin tools) can call it.
REVOKE EXECUTE ON FUNCTION admin_stats() FROM authenticated;
REVOKE EXECUTE ON FUNCTION admin_stats() FROM anon;
REVOKE EXECUTE ON FUNCTION admin_stats() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_stats() TO service_role;
