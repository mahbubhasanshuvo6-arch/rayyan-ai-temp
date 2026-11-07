-- Bangladesh species disambiguation shared knowledge entry.
-- Inserts a single shared row into the existing knowledge_entries table.
-- No schema change, no RLS change. The existing search_knowledge_trgm function
-- already searches shared entries (is_shared=true) when p_include_shared=true.
-- The edge function's retrieveKnowledge() injects matched entries into the
-- system prompt for both Gemini and Groq, so both providers receive the facts.

INSERT INTO knowledge_entries (title, content, tags, source, category, visibility, is_shared, user_id, owner_label)
VALUES (
  'Bangladesh National Bird: Doel (দোয়েল) — Species Facts',
  'দোয়েল (Doel) is the national bird of Bangladesh. It is the Oriental Magpie-Robin.
Common name: Oriental Magpie-Robin (Bengali: দোয়েল)
Scientific name: Copsychus saularis
Family: Muscicapidae (Old World flycatchers)
Order: Passeriformes

IMPORTANT DISAMBIGUATION:
- দোয়েল (doel) is NOT a dove. It is NOT a pigeon. It does NOT belong to family Columbidae.
- দোয়েল is sometimes confused with "dove" due to phonetic similarity, but they are completely unrelated.
- Doves and pigeons belong to family Columbidae (order Columbiformes). ঘুঘু/পায়রা are doves/pigeons.
- দোয়েল belongs to family Muscicapidae (order Passeriformes) — it is a songbird (flycatcher family).

CONSERVATION STATUS:
- Global IUCN Red List: Least Concern (LC). Population trend: stable or increasing.
- Bangladesh-specific: The 2015 Bangladesh Red List assessment should be referenced for country-specific status.
- Do not claim দোয়েল is endangered or on the brink of extinction without citing a current, specific source.
- Local observation of fewer দোয়েল in one area does not prove a nationwide population decline.

OTHER COMMON BANGLADESH BIRDS (for reference, not exhaustive):
- শালিক (Shalik) = Common Myna (Acridotheres tristis), family Sturnidae
- কোকিল (Kokil) = Asian Koel (Eudynamys scolopaceus), family Cuculidae',
  ARRAY['bangladesh', 'species', 'doel', 'birds', 'taxonomy', 'disambiguation'],
  'admin-curated',
  'reference',
  'shared',
  true,
  NULL,
  NULL
)
ON CONFLICT DO NOTHING;
