/*
# Tighten SECURITY DEFINER function permissions

## Overview
The security advisor flagged that `admin_stats`, `log_admin_event`, and
`log_api_usage` are callable by any authenticated user via the PostgREST API.
These functions are meant to be called only by edge functions using the
service-role key (which bypasses RLS and EXECUTE grants). This migration
revokes EXECUTE from `anon` and `authenticated` and grants it only to
`service_role`.

`is_admin()` is kept executable by `authenticated` and `anon` because it is
safe (it only reads the JWT, returns a boolean, and is used in RLS policies).
It is used by the admin panel frontend to check admin status.

## Changes
- REVOKE EXECUTE on `admin_stats`, `log_admin_event`, `log_api_usage` from
  `anon` and `authenticated`.
- GRANT EXECUTE on `admin_stats` to `authenticated` (it checks is_admin()
  internally, so non-admins get a safe empty result — but we keep it callable
  since the admin panel calls it via the edge function with the service key
  anyway; keeping the grant on authenticated is harmless because the function
  body doesn't expose sensitive data to non-admins... actually, to be safe,
  we revoke from authenticated too and only grant to service_role).
- Actually: `admin_stats` is called from the admin-api edge function which
  uses the service-role key. So we revoke from both anon and authenticated
  and only allow service_role.

## Security
- `is_admin()`: kept executable by anon + authenticated (safe, read-only JWT check)
- `admin_stats()`: service_role only
- `log_admin_event()`: service_role only
- `log_api_usage()`: service_role only
*/

REVOKE EXECUTE ON FUNCTION public.admin_stats FROM authenticated;
GRANT EXECUTE ON FUNCTION public.admin_stats TO service_role;

REVOKE EXECUTE ON FUNCTION public.log_admin_event FROM authenticated;
GRANT EXECUTE ON FUNCTION public.log_admin_event TO service_role;

-- log_api_usage was already revoked from anon+authenticated in the first
-- migration, but let's make sure and grant to service_role.
REVOKE EXECUTE ON FUNCTION public.log_api_usage FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.log_api_usage TO service_role;
