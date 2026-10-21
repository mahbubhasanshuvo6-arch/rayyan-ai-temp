/*
# Fix search_knowledge_trgm: Use auth.uid() for User Identity Verification

## Problem
The search_knowledge_trgm function is SECURITY DEFINER and accepts p_user_id
as a client-supplied parameter. Since the function bypasses RLS (SECURITY DEFINER),
any caller could pass another user's UUID as p_user_id and retrieve that user's
private knowledge entries — a cross-user data leak.

Additionally, the function's precedence logic was:
  IF p_owner_label IS NOT NULL → search by owner_label (ignoring p_user_id)
  ELSE IF p_user_id IS NOT NULL → search by user_id

Since the frontend always sends a non-null ownerLabel (from localStorage), the
user_id path was never reached for authenticated users. Document chunks created
by the process-document edge function have owner_label=NULL and user_id=<auth uid>,
so they could never be matched by the search function.

## Fix
1. Use auth.uid() inside the function to verify the caller's identity — do NOT
   trust the client-supplied p_user_id parameter.
2. For authenticated callers (auth.uid() IS NOT NULL):
   - Search private entries where ke.user_id = auth.uid() (covers document chunks)
   - Also search legacy entries where ke.owner_label = p_owner_label AND 
     ke.user_id = auth.uid() (covers old user-saved notes that have BOTH fields)
   - This prevents cross-user access: a caller cannot see another user's private
     entries regardless of what p_owner_label or p_user_id they pass.
3. For anonymous callers (auth.uid() IS NULL):
   - Search private entries by p_owner_label only (legacy behavior preserved)
   - This maintains backward compatibility for anon users who saved notes with
     owner_label before authentication was added.
4. Shared entries (is_shared = true) remain available to all callers when
   p_include_shared = true.
5. Revoke EXECUTE from PUBLIC and anon to reduce attack surface — only
   authenticated and service_role need access. The gemini-chat edge function
   calls this with the service role key, and the frontend calls it with the
   user's JWT (authenticated role).

## Security Changes
- Function now uses auth.uid() for identity verification instead of trusting
  client-supplied p_user_id.
- EXECUTE privilege revoked from PUBLIC and anon roles.
- EXECUTE retained for authenticated and service_role only.

## No Data Changes
- No tables, columns, or data are modified.
- Only the function definition and its grants change.
*/

-- Drop existing function to replace with the fixed version
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
BEGIN
  -- p_user_id is ignored for security; we use auth.uid() to verify identity.
  -- This prevents a caller from passing another user's UUID to access their
  -- private entries through this SECURITY DEFINER function.

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
      -- Authenticated user: search by auth.uid() (verified identity).
      -- Covers document chunks (owner_label=NULL, user_id=<uid>) AND
      -- legacy user-saved notes (owner_label=<label>, user_id=<uid>).
      (
        v_auth_uid IS NOT NULL
        AND ke.is_shared = false
        AND ke.user_id = v_auth_uid
      )
      OR
      -- Anonymous user (no auth): search by owner_label only (legacy behavior).
      -- Only used when the caller is not authenticated.
      (
        v_auth_uid IS NULL
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

-- Ensure authenticated and service_role retain access.
GRANT EXECUTE ON FUNCTION public.search_knowledge_trgm(text, uuid, text, integer, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.search_knowledge_trgm(text, uuid, text, integer, boolean) TO service_role;