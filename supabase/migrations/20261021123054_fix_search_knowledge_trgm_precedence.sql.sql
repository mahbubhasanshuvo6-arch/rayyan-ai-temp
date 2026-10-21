/*
# Fix operator precedence bug in search_knowledge_trgm

## Problem
The WHERE clause in search_knowledge_trgm had an OR for owner scoping followed
by an AND for the similarity threshold. SQL operator precedence makes AND bind
tighter than OR, so the similarity filter was only applied to the second branch
of the OR (user_id path), not the first (owner_label path). This caused all
owner_label-matched rows to be returned regardless of similarity score.

## Fix
Wrap the owner-scoping OR in parentheses so the similarity AND applies to both branches.

## Security
No changes to RLS, owner scoping logic, or permissions.
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
    -- Owner scoping: match by owner_label (priority) or user_id.
    -- Wrapped in parentheses so the similarity AND applies to both branches.
    (
      (p_owner_label IS NOT NULL AND ke.owner_label = p_owner_label)
      OR (p_owner_label IS NULL AND p_user_id IS NOT NULL AND ke.user_id = p_user_id)
    )
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
