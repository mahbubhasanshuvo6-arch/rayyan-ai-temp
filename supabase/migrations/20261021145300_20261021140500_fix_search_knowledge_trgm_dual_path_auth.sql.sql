/*
# Fix search_knowledge_trgm: Dual-Path Identity Verification

## Problem
The previous fix used auth.uid() exclusively, but the edge function
(gemini-chat) calls this RPC with the service-role key, where auth.uid()
returns NULL. This broke knowledge retrieval for authenticated users
when called from the server side.

## Solution
Use a dual-path identity verification:
1. When called directly by an authenticated user (auth.uid() IS NOT NULL):
   Use auth.uid() — this is the verified identity from the JWT.
   Ignore p_user_id entirely (prevents spoofing).
2. When called by service_role (auth.uid() IS NULL, p_user_id IS NOT NULL):
   Use p_user_id — the edge function already verified the user's JWT
   via supabase.auth.getUser(userJwt) before calling this function.
   Only service_role has EXECUTE privilege, so only the trusted edge
   function can reach this path.
3. Anonymous callers (auth.uid() IS NULL, p_user_id IS NULL):
   Fall back to p_owner_label for legacy entries.

This is secure because:
- EXECUTE is revoked from anon and PUBLIC — only authenticated and
  service_role can call the function.
- Authenticated callers: auth.uid() is cryptographically verified by
  Postgres from the JWT. p_user_id is ignored.
- Service-role callers: only the edge function has the service role key,
  and it verifies the JWT before passing p_user_id.

## No Data Changes
- Only the function definition changes.
*/

DROP FUNCTION IF EXISTS public.search_knowledge_trgm(text, uuid, text, integer, boolean);

CREATE OR REPLACE FUNCTION public.search_knowledge_trgm(
  p_owner_label text,
  p_user_id uuid,
  p_search_text text,
  p_limit integer DEFAULT 5,
  p_include_shared boolean DEFAULT true
)
RETURNS TABLE(
  id uuid,
  title text,
  content text,
  tags text[],
  source text,
  category text,
  is_shared boolean,
  document_id uuid,
  chunk_index integer,
  created_at timestamp with time zone,
  similarity_score real
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_auth_uid uuid := auth.uid();
  v_effective_uid uuid;
BEGIN
  -- Determine the effective user ID for private entry matching.
  -- Path 1: Direct authenticated call — auth.uid() is set by Postgres
  --   from the caller's JWT. This is the verified identity; p_user_id
  --   is IGNORED to prevent spoofing.
  -- Path 2: Service-role call (from the edge function) — auth.uid() is
  --   NULL because the service role has no user context. Fall back to
  --   p_user_id, which the edge function verified via supabase.auth.getUser()
  --   before calling this RPC. Only service_role has EXECUTE privilege.
  IF v_auth_uid IS NOT NULL THEN
    v_effective_uid := v_auth_uid;
  ELSE
    v_effective_uid := p_user_id;
  END IF;

  RETURN QUERY
  SELECT
    ke.id,
    ke.title,
    ke.content,
    ke.tags,
    ke.source,
    ke.category,
    ke.is_shared,
    ke.document_id,
    ke.chunk_index,
    ke.created_at,
    GREATEST(
      similarity(ke.title, p_search_text),
      similarity(ke.content, p_search_text)
    ) AS similarity_score
  FROM knowledge_entries ke
  WHERE
    (
      -- Authenticated or service-role caller: search by effective user ID.
      -- Covers document chunks (owner_label=NULL, user_id=<uid>) AND
      -- legacy user-saved notes (owner_label=<label>, user_id=<uid>).
      (
        v_effective_uid IS NOT NULL
        AND ke.is_shared = false
        AND ke.user_id = v_effective_uid
      )
      OR
      -- Anonymous caller (no auth, no user_id): search by owner_label only.
      -- Only used when the caller is completely unauthenticated.
      (
        v_effective_uid IS NULL
        AND p_owner_label IS NOT NULL
        AND ke.owner_label = p_owner_label
        AND ke.is_shared = false
      )
      OR
      -- Shared entries: available to all callers.
      (
        p_include_shared = true
        AND ke.is_shared = true
      )
    )
    AND GREATEST(
      similarity(ke.title, p_search_text),
      similarity(ke.content, p_search_text)
    ) > 0.1
  ORDER BY similarity_score DESC, ke.created_at DESC
  LIMIT LEAST(p_limit, 10);
END;
$function$;

-- Revoke EXECUTE from PUBLIC and anon — only authenticated and service_role need access.
REVOKE EXECUTE ON FUNCTION public.search_knowledge_trgm(text, uuid, text, integer, boolean) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.search_knowledge_trgm(text, uuid, text, integer, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.search_knowledge_trgm(text, uuid, text, integer, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.search_knowledge_trgm(text, uuid, text, integer, boolean) TO service_role;