-- Fix: Groq shut down llama-3.3-70b-versatile on 2026-08-16.
-- Official replacement: openai/gpt-oss-120b (Groq's recommended production model).
-- This was the root cause of "Both AI providers are temporarily unavailable":
-- when Gemini hit its free-tier quota, the fallback to the dead Groq model
-- also failed, leaving no working provider.
UPDATE app_settings
SET fallback_model = 'openai/gpt-oss-120b',
    updated_at = now()
WHERE id = 1;