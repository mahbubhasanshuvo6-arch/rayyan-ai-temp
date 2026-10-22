/*
# Add attachments column to chat_messages

## Purpose
Stores image/file attachment metadata (name, type, isImage, thumbnail dataUrl) so
that chat history can display image previews when reloading past messages.

## Changes
- Added `attachments` column to `chat_messages` (jsonb, nullable, default null).
  Only populated for user messages that included image/file attachments.
  Each entry: { name, type, isImage, thumb } where `thumb` is a small base64
  data URL (max ~10KB, resized to 80x80) for images, or null for text files.

## Security
- No new tables. No policy changes — the column is accessible through the
  existing chat_messages RLS policies (owner-scoped via thread_id → chat_threads).
- No new grants needed — the existing grants on chat_messages cover all columns.
*/

ALTER TABLE chat_messages
  ADD COLUMN IF NOT EXISTS attachments jsonb DEFAULT null;
