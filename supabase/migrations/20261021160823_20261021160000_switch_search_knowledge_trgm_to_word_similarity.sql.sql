/*
# Switch search_knowledge_trgm from similarity() to word_similarity()

## Problem
The current `search_knowledge_trgm` function uses `similarity()` which compares
the ENTIRE search text against the ENTIRE content/title. For short queries
(e.g. "ঢাকা", "RAYYAN-7284") against large document chunks (~600 chars),
`similarity()` returns 0.01-0.04 — far below the 0.1 threshold. This makes
pg_trgm search (Strategy 1) completely ineffective; the system relies entirely
on the ILIKE fallback (Strategy 2).

## Solution
Replace `similarity(a, b)` with `word_similarity(b, a)` which finds the BEST
MATCHING SUBSTRING within the target text. This returns 1.0 for exact substring
matches (e.g. "ঢাকা" found in content) and 0.0 for no match — regardless of
content length.

Threshold raised from 0.1 to 0.3 based on verified testing:
- Exact matches (Bengali + English): 1.0 → PASS at 0.3
- Partial matches (RAYYAN-9999): 0.64 → PASS at 0.3
- Common stopwords (এবং): 0.25 → FAIL at 0.3 (correct rejection)
- Unrelated queries: 0.0-0.17 → FAIL at 0.3 (correct rejection)

## Changes
1. Function `search_knowledge_trgm`:
   - SELECT: `similarity(ke.title, p_search_text)` → `word_similarity(p_search_text, ke.title)`
   - SELECT: `similarity(ke.content, p_search_text)` → `word_similarity(p_search_text, ke.content)`
   - WHERE: same replacements in the GREATEST() threshold check
   - Threshold: `> 0.1` → `> 0.3`
   - RETURN COLUMN: `similarity_score` name kept (same real type)

## What does NOT change
- SECURITY DEFINER: unchanged
- search_path = 'public': unchanged
- Auth logic (auth.uid() → p_user_id dual-path): unchanged
- Ownership WHERE clauses (user_id / owner_label / is_shared): unchanged
- ORDER BY, LIMIT: unchanged
- Grants (authenticated, service_role, postgres only): unchanged
- RLS policies on knowledge_entries: unchanged
- No data modifications, no schema changes, no index changes
- Function signature (parameters, return type): unchanged

## Risk Assessment
- word_similarity() requires pg_trgm 1.3+; current version is 1.6 ✓
- word_similarity() arguments are swapped vs similarity():
  similarity(a, b) = word_similarity(b, a) — query is first arg, target is second
- The GIN trigram indexes (gin_trgm_ops) on title and content support both
  similarity() and word_similarity() for index-accelerated filtering
- ILIKE fallback (Strategy 2 in retrieveKnowledge) remains as a safety net
*/
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
      word_similarity(p_search_text, ke.title),
      word_similarity(p_search_text, ke.content)
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
    word_similarity(p_search_text, ke.title),
    word_similarity(p_search_text, ke.content)
  ) > 0.3
  ORDER BY similarity_score DESC, ke.created_at DESC
  LIMIT LEAST(p_limit, 10);
END;
$function$;

-- Re-grant EXECUTE (CREATE OR REPLACE may reset privileges in some Postgres versions)
GRANT EXECUTE ON FUNCTION public.search_knowledge_trgm TO authenticated;
GRANT EXECUTE ON FUNCTION public.search_knowledge_trgm TO service_role;
-- Ensure anon/PUBLIC does NOT have execute (security)
REVOKE EXECUTE ON FUNCTION public.search_knowledge_trgm FROM anon;
REVOKE EXECUTE ON FUNCTION public.search_knowledge_trgm FROM PUBLIC;
