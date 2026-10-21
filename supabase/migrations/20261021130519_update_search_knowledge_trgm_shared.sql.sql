/*
# Update search_knowledge_trgm: shared + private + chunk search

## Summary
Replaces the existing search_knowledge_trgm function with a new version that
searches BOTH the user's private entries AND admin-managed shared entries in
a single query. Also includes document chunks (entries with document_id).

## Changes
- New parameter p_include_shared (boolean, default true): when true, shared
  knowledge entries (is_shared=true) are included in results alongside the
  user's private entries.
- Returns additional columns: category, is_shared, document_id, chunk_index
  so the edge function can label retrieved sources appropriately.
- Owner scoping: (private entries matching owner_label/user_id) OR (shared
  entries with is_shared=true) — all wrapped in parentheses with the
  similarity AND filter applied to both branches.

## Security
- SECURITY DEFINER, search_path=public — same as before.
- Owner filtering unchanged for private entries. Shared entries are explicitly
  is_shared=true only.
- EXECUTE granted to authenticated and anon.
*/

DROP FUNCTION IF EXISTS search_knowledge_trgm(text, uuid, text, int);

CREATE FUNCTION search_knowledge_trgm(
  p_owner_label text,
  p_user_id uuid,
  p_search_text text,
  p_limit int DEFAULT 5,
  p_include_shared boolean DEFAULT true
)
RETURNS TABLE (
  id uuid,
  title text,
  content text,
  tags text[],
  source text,
  category text,
  is_shared boolean,
  document_id uuid,
  chunk_index int,
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
      -- Private entries: owner-scoped
      (
        (p_owner_label IS NOT NULL AND ke.owner_label = p_owner_label AND ke.is_shared = false)
        OR (p_owner_label IS NULL AND p_user_id IS NOT NULL AND ke.user_id = p_user_id AND ke.is_shared = false)
      )
      -- Shared entries: available to all users
      OR (p_include_shared = true AND ke.is_shared = true)
    )
    AND GREATEST(
      similarity(ke.title, p_search_text),
      similarity(ke.content, p_search_text)
    ) > 0.1
  ORDER BY similarity_score DESC, ke.created_at DESC
  LIMIT LEAST(p_limit, 10);
END;
$$;

GRANT EXECUTE ON FUNCTION search_knowledge_trgm(text, uuid, text, int, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION search_knowledge_trgm(text, uuid, text, int, boolean) TO anon;
