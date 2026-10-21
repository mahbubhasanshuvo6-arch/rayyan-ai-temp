-- Add admin authorization check inside admin_stats() so even if an
-- authenticated user calls it via REST, it returns NULL unless they
-- are an admin. The edge function uses the service-role client which
-- bypasses RLS and these checks, so legitimate admin access is unaffected.

CREATE OR REPLACE FUNCTION admin_stats()
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN is_admin() THEN jsonb_build_object(
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
    )
    ELSE NULL
  END;
$$;
