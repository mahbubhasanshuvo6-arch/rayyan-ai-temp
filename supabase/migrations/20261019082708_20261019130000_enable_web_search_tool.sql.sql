-- Phase 2: Enable the web_search tool so the model can use Tavily search.
-- The tool was wired in code but the admin toggle was off, so the model
-- never received the web_search tool instruction. Flip it on now that
-- TAVILY_API_KEY is configured. Reversible: admin can turn it off again.
UPDATE app_settings SET tool_web_search_enabled = true, updated_at = now() WHERE id = 1;