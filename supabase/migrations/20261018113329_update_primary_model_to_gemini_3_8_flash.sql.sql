-- Update primary model from gemini-3.6-flash to gemini-3.8-flash.
-- Reason: gemini-3.6-flash still GA but experiencing widespread free-tier
-- 429/503 high-demand errors (Oct 2026). gemini-3.8-flash is the newest GA
-- Flash model, less congested, and the model Google recommends in
-- retirement error messages for older models.
UPDATE app_settings SET model = 'gemini-3.8-flash', updated_at = now() WHERE id = 1;
ALTER TABLE app_settings ALTER COLUMN model SET DEFAULT 'gemini-3.8-flash';