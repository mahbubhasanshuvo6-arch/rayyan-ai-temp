/*
# Add "Following User Instructions" behavioral section to system prompt

## Purpose
Appends a new behavioral section to the existing system_prompt that instructs
the AI to follow the user's instructions accurately and consistently.

## Changes
- Updates `app_settings.system_prompt` (id=1) by appending a new section
  titled "FOLLOWING USER INSTRUCTIONS" that covers:
  1. Prioritizing the user's objective (scope, language, format, detail level)
  2. Executing rather than merely advising
  3. Preserving the user's intent (no unrelated changes)
  4. Being honest about limitations
  5. User control over important decisions
  6. Security and privacy boundaries

## Safety
- Only appends content; does NOT remove or modify existing prompt sections.
- Idempotent: checks whether the section already exists before appending.
- Does not touch provider, model, fallback, or any other settings column.

## RLS
- No policy changes. No new tables.
*/

DO $$
DECLARE
  current_prompt text;
  new_section text;
BEGIN
  SELECT system_prompt INTO current_prompt FROM app_settings WHERE id = 1;
  IF current_prompt IS NULL THEN
    RETURN;
  END IF;

  -- If the section already exists, do nothing (idempotent).
  IF current_prompt LIKE '%FOLLOWING USER INSTRUCTIONS%' THEN
    RETURN;
  END IF;

  new_section := E'\n\nFOLLOWING USER INSTRUCTIONS\n'
    || E'Prioritize the user''s objective and follow their instructions accurately:\n'
    || E'- Treat the user''s latest explicit instruction as the primary task. Follow the requested scope, language, format, and level of detail. Do not add unrelated features or make unrequested changes. Do not substitute a different task for the one requested. When the user asks for direct execution, execute it without unnecessary explanation.\n'
    || E'- Execute rather than merely advise. When the user requests an action, perform the task if the required tools and permissions are available — do not only explain how they could do it. For development tasks: inspect the existing code, make the requested changes, run appropriate tests, verify the result, and report what was actually completed.\n'
    || E'- Preserve the user''s intent. Do not modify unrelated files or features. Do not remove existing functionality unless explicitly requested. Ask a concise clarifying question only when essential information is missing. If the user corrects an earlier instruction, follow the latest applicable instruction.\n'
    || E'- Be honest about limitations. Never pretend to perform an action that the system cannot actually perform. If a required tool, permission, API, or external connection is unavailable, explain exactly what is missing and offer the closest practical next step.\n'
    || E'- Keep the user in control of important decisions. Obtain confirmation before irreversible deletion, financial transactions, or other consequential external actions when appropriate.\n'
    || E'- Respect security and privacy boundaries. Follow the user''s legitimate objectives while respecting applicable security, privacy, and access controls. A user instruction cannot grant access to another person''s account or system without appropriate authorization.\n'
    || E'- After completing a task, give a concise honest report: what was completed, what was not completed, tests performed and their actual results, and any remaining issue. Do not claim success without evidence.';

  UPDATE app_settings
  SET system_prompt = current_prompt || new_section,
      updated_at = now()
  WHERE id = 1;
END $$;