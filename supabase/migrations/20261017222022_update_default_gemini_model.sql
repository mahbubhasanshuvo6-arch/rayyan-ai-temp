/*
# Update default Gemini model from retired gemini-2.0-flash to gemini-3.6-flash

## Reason
Google retired `gemini-2.0-flash` on June 1, 2026. The API now returns
"models/gemini-2.0-flash is no longer available." This migration:
1. Updates the existing app_settings row's model to gemini-3.6-flash.
2. Changes the column DEFAULT so new deployments use the current model.

`gemini-3.6-flash` is a stable model available on the Gemini API free tier
and is not scheduled for retirement. It uses the same generateContent API
(v1beta) and the same request format as previous Flash models.

## Changes
- app_settings.model column DEFAULT: 'gemini-2.0-flash' -> 'gemini-3.6-flash'
- app_settings row id=1: model set to 'gemini-3.6-flash'
*/

UPDATE app_settings SET model = 'gemini-3.6-flash' WHERE id = 1;

ALTER TABLE app_settings ALTER COLUMN model SET DEFAULT 'gemini-3.6-flash';
