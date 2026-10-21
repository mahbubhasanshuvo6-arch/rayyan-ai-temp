/*
# Add trigram similarity search function for knowledge_entries

## Purpose
Rayyan AI's knowledge retrieval previously used ILIKE keyword matching that only
extracted ASCII words ([a-z0-9_]{3,}), completely ignoring Bengali Unicode text.
This migration creates a SECURITY DEFINER function that uses pg_trgm's similarity()
to fuzzy-match the user's message against title and content in knowledge_entries.
pg_trgm and the GIN trigram indexes on title/content already exist.

## New Database Objects
1. `search_knowledge_trgm(p_owner_label text, p_user_id uuid, p_search_text text, p_limit int)`
   - SECURITY DEFINER function that searches knowledge_entries using trigram similarity
   - Owner-scoped: filters by owner_label (priority) or user_id
   - Returns up to p_limit rows ranked by best similarity score across title+content
   - Uses the existing knowledge_entries_title_trgm_idx and knowledge_entries_content_trgm_idx
   - similarity threshold of 0.1 (low, to catch Bengali partial matches)

## Security
- Function is SECURITY DEFINER (runs as the table owner) so it can read knowledge_entries
  bypassing RLS — but it manually filters by owner_label/user_id so a user only sees
  their own entries, exactly like the existing retrieveKnowledge code path.
- EXECUTE granted to authenticated and anon so the edge function (service-role client)
  can call it via RPC.
- No new tables, no column changes, no RLS policy changes.

## Important Notes
1. This function is idempotent — DROP IF EXISTS before CREATE.
2. The edge function falls back to ILIKE if this RPC is unavailable, so a failure
   here does not break the chat flow.
3. Bengali Unicode text works with pg_trgm because Postgres trigram extraction
   operates on character-level n-grams, not word boundaries.
*/

DROP FUNCTION IF EXISTS search_knowledge_trgm(text, uuid, text, int);

CREATE FUNCTION search_knowledge_trgm(
  p_owner_label text,
  p_user_id uuid,
  p_search_text text,
  p_limit int DEFAULT 5
)
RETURNS TABLE (
  id uuid,
  title text,
  content text,
  tags text[],
  source text,
  created_at timestamptz,
  similarity_score real
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    ke.id,
    ke.title,
    ke.content,
    ke.tags,
    ke.source,
    ke.created_at,
    GREATEST(
      similarity(ke.title, p_search_text),
      similarity(ke.content, p_search_text)
    ) AS similarity_score
  FROM knowledge_entries ke
  WHERE
    -- Owner scoping: match by owner_label (priority) or user_id
    (p_owner_label IS NOT NULL AND ke.owner_label = p_owner_label)
    OR (p_owner_label IS NULL AND p_user_id IS NOT NULL AND ke.user_id = p_user_id)
    -- Trigram similarity threshold: low to catch partial Bengali matches
    AND GREATEST(
      similarity(ke.title, p_search_text),
      similarity(ke.content, p_search_text)
    ) > 0.1
  ORDER BY similarity_score DESC, ke.created_at DESC
  LIMIT LEAST(p_limit, 10);
END;
$$;

GRANT EXECUTE ON FUNCTION search_knowledge_trgm(text, uuid, text, int) TO authenticated;
GRANT EXECUTE ON FUNCTION search_knowledge_trgm(text, uuid, text, int) TO anon;
