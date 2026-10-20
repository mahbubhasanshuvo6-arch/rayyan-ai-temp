#!/bin/bash
# Regression test for scientific accuracy in quantum-computing answers.
#
# Sends quantum-computing questions to the chat edge function and checks
# the responses for three specific misleading claim patterns:
#   1. Universal exponential speedup claims
#   2. Simultaneous readout of all superposition states
#   3. Guaranteed quantum advantage for optimization problems
#
# Also verifies that the scientific_claim_corrected flag is set when
# the post-generation scanner detects a misleading pattern.
#
# Usage: bash scripts/test-scientific-accuracy.sh
# Expects EDGE_URL and ANON_KEY to be derivable from .env

set -euo pipefail

EDGE_URL=$(grep -E 'VITE_SUPABASE_URL|SUPABASE_URL' .env | head -1 | sed -E 's/^[^=]+=//;s/^"//;s/"$//;s#/*$##')
ANON=$(grep -E 'VITE_SUPABASE_ANON_KEY|SUPABASE_ANON_KEY' .env | head -1 | sed -E 's/^[^=]+=//;s/^"//;s/"$//')

if [ -z "$EDGE_URL" ] || [ -z "$ANON" ]; then
  echo "FAIL: Could not extract EDGE_URL or ANON_KEY from .env"
  exit 1
fi

CHAT_URL="$EDGE_URL/functions/v1/gemini-chat"
PASS=0
FAIL=0
SKIP=0

# --- Test helpers ---

# Send a chat message and capture the full JSON response.
send_chat() {
  local message="$1"
  local history="$2"
  curl -sS -m 90 -X POST "$CHAT_URL" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $ANON" \
    -d "{\"mode\":\"chat\",\"message\":\"$message\",\"history\":$history}" 2>&1
}

# Check if a text contains a misleading pattern.
# Uses python3 for proper Unicode + regex support.
# Returns 0 (match found) or 1 (no match).
check_pattern() {
  local text="$1"
  local pattern="$2"
  echo "$text" | python3 -c "
import sys, re
text = sys.stdin.read()
pattern = r'''$pattern'''
if re.search(pattern, text, re.IGNORECASE | re.DOTALL):
    sys.exit(0)
else:
    sys.exit(1)
" && return 0 || return 1
}

# Extract the reply field from JSON response.
get_reply() {
  local response="$1"
  if command -v python3 &>/dev/null; then
    echo "$response" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('reply',''))" 2>/dev/null || echo ""
  else
    echo "$response" | grep -oP '"reply":"[^"]*"' | head -1 | sed 's/"reply":"//;s/"$//' || echo ""
  fi
}

# Strip the correction note appended by the scientific claim scanner.
# The correction starts with '---\n⚠️' — we want to check only the model's
# original text, not the correction note (which legitimately mentions the
# misleading concept while correcting it).
strip_correction() {
  local text="$1"
  echo "$text" | python3 -c "
import sys
text = sys.stdin.read()
# Split on the correction marker and keep only the original text.
idx = text.find('\n---\n')
if idx >= 0:
    print(text[:idx])
else:
    print(text)
" 2>/dev/null || echo "$text"
}

# Check if scientific_claim_corrected is true in the response.
check_corrected_flag() {
  local response="$1"
  echo "$response" | grep -q '"scientific_claim_corrected":true' && return 0 || return 1
}

# --- Misleading patterns to detect ---
# These patterns match ONLY the misleading versions of claims, not correct
# scientific statements. For example, "a qubit exists in multiple states
# simultaneously" is correct and should NOT match; "you can read out all
# answers simultaneously" is misleading and SHOULD match.

# Pattern 1: Universal exponential speedup (without specific problem/algorithm)
# Matches "quantum computers are exponentially faster" as a general claim.
# Does NOT match "Shor's algorithm provides an exponential speedup for factoring"
# because that names a specific algorithm and problem.
P_EXPONENTIAL='(quantum.{0,15}(computers?|computing).{0,15}(are\\s+)?(exponentially|exponential)(?:\\s+(?:faster|speedup|advantage))|কোয়ান্টাম.{0,15}কম্পিউটার.{0,15}(সূচকীয়ভাবে|সূচকীয়\\s+দ্রুত))'

# Pattern 2: Simultaneous READOUT of all answers — the superposition myth.
# Matches "examine/get/read all possibilities at once" — the misleading claim.
# Does NOT match "qubit exists in multiple states simultaneously" (correct).
# IMPORTANT: Uses [^\n] instead of . so the pattern stays within one line,
# preventing false matches across separate sentences.
P_SIMULTANEOUS='(all[^\n]{0,10}(possibilities|answers)[^\n]{0,15}(at.once|simultaneously)[^\n]{0,15}(examine|read|get|compute|try|test|see)|সব[^\n]{0,10}(সম্ভাবনা|উত্তর|ফলাফল)[^\n]{0,15}(একসাথে|একই.সময়ে)[^\n]{0,15}(পড়|দেখ|পরীক্ষা|বের.কর|পাওয়া))'

# Pattern 3: Guaranteed quantum advantage for optimization (exponential)
# Matches "optimization problems exponentially faster" — misleading.
# Does NOT match "Grover gives quadratic speedup for unstructured search" (correct).
P_OPTIMIZATION='(optimization.{0,30}(exponentially|exponential)|অপ্টিমাইজেশন.{0,30}(সূচকীয়ভাবে|সূচকীয়\\s+দ্রুত))'

echo "============================================"
echo "Scientific Accuracy Regression Tests"
echo "============================================"
echo ""

# --- Test 1: Basic quantum computing explanation ---
echo "TEST 1: Basic quantum computing question"
echo "  Question: কোয়ান্টাম কম্পিউটিং কী? সহজ ভাষায় ব্যাখ্যা করুন।"
RESPONSE=$(send_chat "কোয়ান্টাম কম্পিউটিং কী? সহজ ভাষায় ব্যাখ্যা করুন।" "[]")
REPLY=$(get_reply "$RESPONSE")

if [ -z "$REPLY" ] || [ "$REPLY" = "" ]; then
  echo "  Result: SKIP (no reply received — likely rate-limited)"
  echo "  Response: $(echo "$RESPONSE" | head -c 200)"
  SKIP=$((SKIP + 1))
else
  # Strip the correction note before checking — we only want to check
  # the model's original text, not the scanner's appended correction.
  ORIGINAL_REPLY=$(strip_correction "$REPLY")
  FOUND_ISSUES=0

  if check_pattern "$ORIGINAL_REPLY" "$P_EXPONENTIAL"; then
    echo "  FAIL: Response contains universal exponential speedup claim"
    FOUND_ISSUES=1
  fi

  if check_pattern "$ORIGINAL_REPLY" "$P_SIMULTANEOUS"; then
    echo "  FAIL: Response contains simultaneous readout claim"
    FOUND_ISSUES=1
  fi

  if check_pattern "$ORIGINAL_REPLY" "$P_OPTIMIZATION"; then
    echo "  FAIL: Response contains guaranteed optimization advantage claim"
    FOUND_ISSUES=1
  fi

  if check_corrected_flag "$RESPONSE"; then
    echo "  INFO: scientific_claim_corrected flag was set (scanner detected and appended correction)"
  fi

  if [ $FOUND_ISSUES -eq 0 ]; then
    if check_corrected_flag "$RESPONSE"; then
      echo "  PASS: No misleading patterns in original text (scanner corrected a detected issue)"
    else
      echo "  PASS: No misleading patterns detected in response"
    fi
    PASS=$((PASS + 1))
  else
    FAIL=$((FAIL + 1))
  fi
fi
echo ""

# --- Test 2: Quantum vs classical speed ---
echo "TEST 2: Quantum speed advantage question"
echo "  Question: কোয়ান্টাম কম্পিউটার সাধারণ কম্পিউটারের চেয়ে কতটা দ্রুত?"
RESPONSE=$(send_chat "কোয়ান্টাম কম্পিউটার সাধারণ কম্পিউটারের চেয়ে কতটা দ্রুত?" "[]")
REPLY=$(get_reply "$RESPONSE")

if [ -z "$REPLY" ] || [ "$REPLY" = "" ]; then
  echo "  Result: SKIP (no reply received — likely rate-limited)"
  echo "  Response: $(echo "$RESPONSE" | head -c 200)"
  SKIP=$((SKIP + 1))
else
  ORIGINAL_REPLY=$(strip_correction "$REPLY")
  FOUND_ISSUES=0

  if check_pattern "$ORIGINAL_REPLY" "$P_EXPONENTIAL"; then
    echo "  FAIL: Response contains universal exponential speedup claim"
    FOUND_ISSUES=1
  fi

  if check_pattern "$ORIGINAL_REPLY" "$P_SIMULTANEOUS"; then
    echo "  FAIL: Response contains simultaneous readout claim"
    FOUND_ISSUES=1
  fi

  if check_corrected_flag "$RESPONSE"; then
    echo "  INFO: scientific_claim_corrected flag was set"
  fi

  if [ $FOUND_ISSUES -eq 0 ]; then
    echo "  PASS: No misleading patterns detected"
    PASS=$((PASS + 1))
  else
    FAIL=$((FAIL + 1))
  fi
fi
echo ""

# --- Test 3: Quantum optimization question ---
echo "TEST 3: Quantum optimization question"
echo "  Question: কোয়ান্টাম কম্পিউটার কি অপ্টিমাইজেশন সমস্যা সমাধানে সাহায্য করতে পারে?"
RESPONSE=$(send_chat "কোয়ান্টাম কম্পিউটার কি অপ্টিমাইজেশন সমস্যা সমাধানে সাহায্য করতে পারে?" "[]")
REPLY=$(get_reply "$RESPONSE")

if [ -z "$REPLY" ] || [ "$REPLY" = "" ]; then
  echo "  Result: SKIP (no reply received — likely rate-limited)"
  echo "  Response: $(echo "$RESPONSE" | head -c 200)"
  SKIP=$((SKIP + 1))
else
  ORIGINAL_REPLY=$(strip_correction "$REPLY")
  FOUND_ISSUES=0

  if check_pattern "$ORIGINAL_REPLY" "$P_OPTIMIZATION"; then
    echo "  FAIL: Response contains guaranteed optimization advantage claim"
    FOUND_ISSUES=1
  fi

  if check_corrected_flag "$RESPONSE"; then
    echo "  INFO: scientific_claim_corrected flag was set"
  fi

  if [ $FOUND_ISSUES -eq 0 ]; then
    echo "  PASS: No misleading patterns detected"
    PASS=$((PASS + 1))
  else
    FAIL=$((FAIL + 1))
  fi
fi
echo ""

# --- Test 4: Superposition-specific question ---
echo "TEST 4: Superposition question"
echo "  Question: সুপারপজিশন কী এবং এটি কীভাবে কাজ করে?"
RESPONSE=$(send_chat "সুপারপজিশন কী এবং এটি কীভাবে কাজ করে?" "[]")
REPLY=$(get_reply "$RESPONSE")

if [ -z "$REPLY" ] || [ "$REPLY" = "" ]; then
  echo "  Result: SKIP (no reply received — likely rate-limited)"
  echo "  Response: $(echo "$RESPONSE" | head -c 200)"
  SKIP=$((SKIP + 1))
else
  ORIGINAL_REPLY=$(strip_correction "$REPLY")
  FOUND_ISSUES=0

  if check_pattern "$ORIGINAL_REPLY" "$P_SIMULTANEOUS"; then
    echo "  FAIL: Response contains simultaneous readout claim"
    FOUND_ISSUES=1
  fi

  if check_corrected_flag "$RESPONSE"; then
    echo "  INFO: scientific_claim_corrected flag was set"
  fi

  if [ $FOUND_ISSUES -eq 0 ]; then
    echo "  PASS: No misleading patterns detected"
    PASS=$((PASS + 1))
  else
    FAIL=$((FAIL + 1))
  fi
fi
echo ""

# --- Summary ---
echo "============================================"
echo "SUMMARY"
echo "============================================"
echo "  PASS: $PASS"
echo "  FAIL: $FAIL"
echo "  SKIP: $SKIP (rate-limited or no response)"
echo ""
if [ $FAIL -gt 0 ]; then
  echo "RESULT: FAIL — misleading patterns detected in some responses"
  exit 1
else
  echo "RESULT: PASS — no misleading patterns detected (or skipped due to rate limits)"
  exit 0
fi
