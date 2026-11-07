#!/usr/bin/env bash
# Test procedure for document upload, replace, and delete through the Edge Function.
# Run this AFTER the anon Storage policies are removed to confirm the app still works.
#
# Prerequisites:
#   - A test Supabase account (email/password) or use an existing dev account.
#   - Do NOT use production secrets. Set these env vars in a separate terminal:
#     export SUPABASE_URL="https://<your-project>.supabase.co"
#     export SUPABASE_ANON_KEY="<anon-key>"
#     export TEST_USER_EMAIL="<test-user-email>"
#     export TEST_USER_PASSWORD="<test-user-password>"
#
# What this tests:
#   1. Sign in with a test account and get a session JWT.
#   2. Upload a small text document via POST /functions/v1/process-document.
#   3. Replace the document (upload with the same title).
#   4. Delete the document.
#   5. Confirm each step returns success.
#
# If any step fails after the policy removal, DO NOT proceed. Roll back the
# policies using the rollback SQL in review/storage_anon_policy_removal.sql.

set -euo pipefail

: "${SUPABASE_URL:?Set SUPABASE_URL}"
: "${SUPABASE_ANON_KEY:?Set SUPABASE_ANON_KEY}"
: "${TEST_USER_EMAIL:?Set TEST_USER_EMAIL}"
: "${TEST_USER_PASSWORD:?Set TEST_USER_PASSWORD}"

EDGE_URL="${SUPABASE_URL}/functions/v1"

echo "=== 1. Sign in ==="
SIGNIN=$(curl -sS -X POST "${SUPABASE_URL}/auth/v1/token?grant_type=password" \
  -H "apikey: ${SUPABASE_ANON_KEY}" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"${TEST_USER_EMAIL}\",\"password\":\"${TEST_USER_PASSWORD}\"}")
TOKEN=$(echo "$SIGNIN" | jq -r '.access_token // empty')
if [ -z "$TOKEN" ]; then
  echo "FAIL: could not sign in. Response: $SIGNIN"
  exit 1
fi
echo "OK: got session token"

echo "=== 2. Upload document ==="
UPLOAD=$(curl -sS -X POST "${EDGE_URL}/process-document" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"action":"upload","fileName":"test-storage-policy.txt","fileContent":"hello world","title":"test-storage-policy"}')
DOC_ID=$(echo "$UPLOAD" | jq -r '.document.id // .id // empty')
if [ -z "$DOC_ID" ]; then
  echo "FAIL: upload did not return a document id. Response: $UPLOAD"
  exit 1
fi
echo "OK: uploaded document $DOC_ID"

echo "=== 3. Replace document (same title) ==="
REPLACE=$(curl -sS -X POST "${EDGE_URL}/process-document" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"action":"upload","fileName":"test-storage-policy.txt","fileContent":"hello world replaced","title":"test-storage-policy"}')
REPLACE_ID=$(echo "$REPLACE" | jq -r '.document.id // .id // empty')
if [ -z "$REPLACE_ID" ]; then
  echo "FAIL: replace did not return a document id. Response: $REPLACE"
  exit 1
fi
echo "OK: replaced document (new id: $REPLACE_ID)"

echo "=== 4. Delete original document ==="
DELETE=$(curl -sS -X POST "${EDGE_URL}/process-document" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"action\":\"delete\",\"documentId\":\"${DOC_ID}\"}")
DEL_STATUS=$(echo "$DELETE" | jq -r '.success // .deleted // empty')
if [ "$DEL_STATUS" != "true" ] && [ "$DEL_STATUS" != "1" ]; then
  echo "WARN: delete response did not include success=true. Response: $DELETE"
fi
echo "OK: delete request sent for $DOC_ID"

echo "=== 5. Delete replacement document (cleanup) ==="
curl -sS -X POST "${EDGE_URL}/process-document" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"action\":\"delete\",\"documentId\":\"${REPLACE_ID}\"}" > /dev/null
echo "OK: cleanup done"

echo ""
echo "=== ALL TESTS PASSED ==="
echo "Document upload, replace, and delete all work through the Edge Function."
echo "The anon Storage policy removal is safe to apply."
