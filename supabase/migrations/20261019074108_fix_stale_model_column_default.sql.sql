-- The original schema set the column DEFAULT to 'gemini-2.0-flash', which
-- Google retired. Subsequent migrations updated the row value to
-- 'gemini-3.8-flash' but left the column default stale. Fix the default so
-- any future re-insert of the settings row picks up a valid model.
ALTER TABLE app_settings ALTER COLUMN model SET DEFAULT 'gemini-3.8-flash';