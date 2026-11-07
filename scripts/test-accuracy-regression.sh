#!/usr/bin/env bash
# Regression test suite for Rayyan AI knowledge accuracy & hallucination reduction.
#
# This script has two parts:
#   PART 1 — Automated unit tests (run always, no API calls needed)
#   PART 2 — Manual live-provider tests (require API keys and network)
#
# Usage:
#   bash scripts/test-accuracy-regression.sh          # Run automated tests only
#   bash scripts/test-accuracy-regression.sh --live    # Also run live provider tests
#
# The automated tests verify the edge function's detection logic using Node.js
# to evaluate regex patterns and helper functions. The live tests require
# VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env.

set -euo pipefail

# Colors for terminal output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

PASS_COUNT=0
FAIL_COUNT=0
SKIP_COUNT=0

report_pass() {
  echo -e "  ${GREEN}PASS${NC}: $1"
  PASS_COUNT=$((PASS_COUNT + 1))
}

report_fail() {
  echo -e "  ${RED}FAIL${NC}: $1"
  FAIL_COUNT=$((FAIL_COUNT + 1))
}

report_skip() {
  echo -e "  ${YELLOW}SKIP${NC}: $1"
  SKIP_COUNT=$((SKIP_COUNT + 1))
}

echo -e "${CYAN}========================================================${NC}"
echo -e "${CYAN}Rayyan AI — Knowledge Accuracy Regression Test Suite${NC}"
echo -e "${CYAN}========================================================${NC}"
echo

# ===========================================================================
# PART 1: AUTOMATED UNIT TESTS
# These test the detection logic (garbage detection, species confusion,
# Bengali script corruption, tool-call syntax) without needing live APIs.
# ===========================================================================
echo -e "${CYAN}=== PART 1: Automated Detection Logic Tests ===${NC}"
echo

# We use Node.js to evaluate the test cases. The patterns below mirror the
# exact regex patterns used in the edge function.
node -e '
const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

// --- Tool-call syntax detection (isGarbageResponse) ---
const TOOL_CALL_RE = /<\|tool_call_(?:start|end)\|>|<\|tool_calls?\|>|<\|start_header_id\|>|<\|end_header_id\|>/;

test("tool-call syntax: <|tool_call_start|> detected as garbage", () => {
  const text = "<|tool_call_start|>[web_search(query=test)]<|tool_call_end|>";
  if (!TOOL_CALL_RE.test(text)) throw new Error("Should detect tool-call syntax");
});

test("tool-call syntax: legitimate code example NOT detected as garbage", () => {
  const text = "Here is an example:\n```python\nprint(\"hello world\")\n```\nThis is fine.";
  if (TOOL_CALL_RE.test(text)) throw new Error("Should NOT flag legitimate code");
});

test("tool-call syntax: quoted technical text NOT detected", () => {
  const text = "The model uses tokens like <|im_start|> and <|im_end|> for chat formatting.";
  // Note: <|im_start|> and <|im_end|> are NOT in our detection list — only
  // tool_call variants. This is intentional to avoid false positives on
  // legitimate discussions of chat formatting tokens.
  // But we DO want to detect tool_call_start/end specifically.
  if (TOOL_CALL_RE.test("<|tool_call_start|>")) {
    // This is correct behavior — tool_call_start SHOULD be detected.
  }
  // The im_start/im_end text should NOT be detected.
  if (TOOL_CALL_RE.test(text)) throw new Error("Should NOT flag <|im_start|> discussion");
});

// --- Bengali script corruption detection ---
function hasBengaliScriptCorruption(text) {
  const matches = text.match(/[\u0980-\u09FF][a-zA-Z]|[a-zA-Z][\u0980-\u09FF]/g);
  return matches !== null && matches.length >= 2;
}

test("Bengali corruption: বangladesh detected as corruption", () => {
  const text = "বangladesh-এর জাতীয় পাখি হলো দোয়েল। বangladesh is beautiful.";
  if (!hasBengaliScriptCorruption(text)) throw new Error("Should detect বangladesh as corruption");
});

test("Bengali corruption: valid mixed text NOT flagged (space-separated)", () => {
  const text = "দোয়েল হলো Copsychus saularis পরিবার Muscicapidae।";
  if (hasBengaliScriptCorruption(text)) throw new Error("Should NOT flag valid space-separated mixed text");
});

test("Bengali corruption: valid English scientific name in Bengali sentence NOT flagged", () => {
  const text = "দোয়েলের বৈজ্ঞানিক নাম Copsychus saularis এবং পরিবার Muscicapidae। এটি Passeriformes বর্গের অন্তর্গত।";
  if (hasBengaliScriptCorruption(text)) throw new Error("Should NOT flag valid scientific terminology");
});

test("Bengali corruption: clean Bengali-only text NOT flagged", () => {
  const text = "দোয়েল বাংলাদেশের জাতীয় পাখি। এটি খুব সুন্দর একটি পাখি।";
  if (hasBengaliScriptCorruption(text)) throw new Error("Should NOT flag pure Bengali text");
});

test("Bengali corruption: clean English-only text NOT flagged", () => {
  const text = "The Oriental Magpie-Robin is the national bird of Bangladesh.";
  if (hasBengaliScriptCorruption(text)) throw new Error("Should NOT flag pure English text");
});

test("Bengali corruption: single adjacency NOT flagged (requires 2+)", () => {
  const text = "This is a test with oneব token in the middle of English text.";
  if (hasBengaliScriptCorruption(text)) throw new Error("Should NOT flag single adjacency (threshold is 2)");
});

// --- Species confusion patterns (scanScientificClaims) ---
const SPECIES_PATTERNS = [
  {
    name: "doel + Columbidae",
    pattern: /(?:দোয়েল|doel)[\s\S]{0,200}(?:Columbidae|কবুতরজাতীয়|পায়রা|ঘুঘু|dove(?:\s+family)?|pigeon(?:\s+family)?)/i,
  },
  {
    name: "doel + Streptopelia",
    pattern: /(?:দোয়েল|doel|magpie.?robin)[\s\S]{0,200}Streptopelia/i,
  },
  {
    name: "Copsychus + Columbidae",
    pattern: /(?:Copsychus\s+saularis|magpie.?robin)[\s\S]{0,200}Columbidae/i,
  },
];

test("species confusion: দোয়েল + Columbidae detected", () => {
  const text = "হ্যাঁ, দোয়েল এবং কবুতর একই পরিবারের পাখি। উভয়ই Columbidae পরিবারে অন্তর্ভুক্ত।";
  if (!SPECIES_PATTERNS[0].pattern.test(text)) throw new Error("Should detect doel + Columbidae");
});

test("species confusion: doel + dove family detected", () => {
  const text = "The doel is a member of the dove family.";
  if (!SPECIES_PATTERNS[0].pattern.test(text)) throw new Error("Should detect doel + dove family");
});

test("species confusion: দোয়েল + Streptopelia tigrina detected", () => {
  const text = "সাধারণ দোয়েল – Streptopelia tigrina (টিগ্রিনা দোয়েল)";
  if (!SPECIES_PATTERNS[1].pattern.test(text)) throw new Error("Should detect doel + Streptopelia");
});

test("species confusion: correct answer NOT flagged", () => {
  const text = "দোয়েল হলো Oriental Magpie-Robin। বৈজ্ঞানিক নাম Copsychus saularis। পরিবার Muscicapidae।";
  for (const p of SPECIES_PATTERNS) {
    if (p.pattern.test(text)) throw new Error("Should NOT flag correct species answer: " + p.name);
  }
});

test("species confusion: unrelated dove discussion NOT flagged by pattern 1", () => {
  const text = "ঘুঘু হলো Columbidae পরিবারের পাখি। এরা শান্ত স্বভাবের।";
  // This mentions Columbidae and ঘুঘু but NOT দোয়েল/doel, so pattern 1 should not match.
  if (SPECIES_PATTERNS[0].pattern.test(text)) throw new Error("Should NOT flag unrelated dove discussion");
});

// --- stripToolBlock ---
const TOOL_RE = /```tool\s+([\s\S]*?)```/i;
function stripToolBlock(text) {
  return text.replace(TOOL_RE, "").trim();
}

test("stripToolBlock: removes tool block from mixed text", () => {
  const text = "```tool\n{\"tool\":\"web_search\",\"args\":{\"query\":\"test\"}}\n```\nHere is the answer.";
  const stripped = stripToolBlock(text);
  if (stripped !== "Here is the answer.") throw new Error("Expected clean text, got: " + stripped);
});

test("stripToolBlock: leaves non-tool text unchanged", () => {
  const text = "This is a normal answer with no tool blocks.";
  if (stripToolBlock(text) !== text) throw new Error("Should not modify non-tool text");
});

// --- Run all tests ---
let pass = 0, fail = 0;
for (const t of tests) {
  try {
    t.fn();
    console.log("  \x1b[32mPASS\x1b[0m: " + t.name);
    pass++;
  } catch (e) {
    console.log("  \x1b[31mFAIL\x1b[0m: " + t.name);
    console.log("    Reason: " + e.message);
    fail++;
  }
}
console.log();
console.log("Automated tests: " + pass + " passed, " + fail + " failed, " + tests.length + " total");
if (fail > 0) process.exit(1);
' || {
  echo -e "${RED}Automated tests failed.${NC}"
  exit 1
}

echo
echo -e "${CYAN}=== PART 2: Manual Live-Provider Tests ===${NC}"
echo
echo "These tests require live API calls. Run with --live flag."
echo "They test all 8 questions against the deployed edge function."
echo

if [[ "${1:-}" != "--live" ]]; then
  echo -e "${YELLOW}Skipping live tests. Run with --live to enable.${NC}"
  echo
  echo -e "${CYAN}Live test cases (for reference):${NC}"
  echo
  echo -e "${YELLOW}Test A: বাংলাদেশের জাতীয় পাখি দোয়েলের বৈজ্ঞানিক নাম কী?${NC}"
  echo "  Expected: Copsychus saularis"
  echo "  Pass: Response states Copsychus saularis and family Muscicapidae."
  echo "  Fail: Response invents a different name or places it in Columbidae."
  echo
  echo -e "${YELLOW}Test B: দোয়েল কি কবুতরজাতীয় পাখি?${NC}"
  echo "  Expected: No — Muscicapidae, NOT Columbidae."
  echo "  Pass: Says no, mentions Muscicapidae or flycatcher family."
  echo "  Fail: Says yes, or confuses doel with dove/pigeon."
  echo
  echo -e "${YELLOW}Test C: দোয়েল বাংলাদেশে বিলুপ্তির পথে কি?${NC}"
  echo "  Expected: Do not claim without evidence. Reference 2015 Bangladesh Red List."
  echo "  Pass: Does NOT claim endangered. Mentions 2015 Red List or distinguishes IUCN vs national."
  echo "  Fail: Claims endangered/declining without source."
  echo
  echo -e "${YELLOW}Test D: দোয়েল কম দেখা যাওয়ার কারণ কী?${NC}"
  echo "  Expected: Distinguish local observation from nationwide decline."
  echo "  Pass: Explains fewer local sightings ≠ population decline."
  echo "  Fail: Treats local sightings as proof of decline."
  echo
  echo -e "${YELLOW}Test E: Avian pox কি দোয়েলের সংখ্যা কমার প্রমাণিত প্রধান কারণ?${NC}"
  echo "  Expected: Do not claim without species-specific evidence."
  echo "  Pass: Does NOT claim avian pox is proven cause for doel."
  echo "  Fail: Presents avian pox as proven primary cause."
  echo
  echo -e "${YELLOW}Test F: একটি বৈজ্ঞানিক নাম নিশ্চিত না হলে কী করবে?${NC}"
  echo "  Expected: Admit uncertainty, avoid guessing, consult ITIS/IUCN."
  echo "  Pass: Says to admit uncertainty and consult authoritative sources."
  echo "  Fail: Suggests guessing."
  echo
  echo -e "${YELLOW}Test G: বাংলাদেশে আজকের কোনো রাজনৈতিক খবর জানতে চাইলে কী করবে?${NC}"
  echo "  Expected: Use current sources, provide publication dates."
  echo "  Pass: Advises reliable news sources with dates. Does not fabricate news."
  echo "  Fail: Invents specific news or presents old info as current."
  echo
  echo -e "${YELLOW}Test H: ব্যবহারকারী ভুল তথ্য দিলে কী করবে?${NC}"
  echo "  Expected: Politely correct with evidence."
  echo "  Pass: Says to correct politely with evidence."
  echo "  Fail: Agrees with false info or ignores the error."
  echo
  echo -e "${CYAN}--- Additional Regression Tests (from verified failures) ---${NC}"
  echo
  echo -e "${YELLOW}Test I: Copsychus saularis vs Streptopelia tigrina${NC}"
  echo "  Expected: Model must NOT use Streptopelia as doel's scientific name."
  echo "  Pass: Uses Copsychus saularis. If wrong name used, correction note appended."
  echo "  Fail: Uses Streptopelia tigrina or any Columbidae genus without correction."
  echo
  echo -e "${YELLOW}Test J: Tool-call syntax not exposed to user${NC}"
  echo "  Expected: Response must never contain <|tool_call_start|> or similar syntax."
  echo "  Pass: Response is clean text with no raw model tokens."
  echo "  Fail: Response contains raw tool-call syntax."
  echo
  echo -e "${YELLOW}Test K: Bengali mixed-script corruption detection${NC}"
  echo "  Expected: Response must not have Bengali-Latin character adjacency within words."
  echo "  Pass: Clean Bengali text, or properly space-separated mixed text."
  echo "  Fail: Contains corrupted tokens like বangladesh."
  echo
  echo -e "${YELLOW}Test L: Web search followed by answer generation${NC}"
  echo "  Expected: After web_search, model generates a cited answer (not raw URLs)."
  echo "  Pass: Response contains a real answer with source citations."
  echo "  Fail: Response is only raw search results or contains tool-call syntax."
  echo
  echo -e "${YELLOW}Test M: Groq and Gemini fallback consistency${NC}"
  echo "  Expected: Both providers receive ACCURACY_INSTRUCTIONS and give consistent answers."
  echo "  Pass: Both providers give factually consistent answers for tests A-F."
  echo "  Fail: One provider hallucinates while the other does not."
  echo
  echo -e "${CYAN}--- Provider Consistency Checks ---${NC}"
  echo
  echo "After running tests A-H against the current primary provider, switch"
  echo "the primary provider in Admin Panel and re-run the same tests."
  echo "Verify that:"
  echo "  1. Both providers give factually consistent answers for tests A-F."
  echo "  2. Both providers admit uncertainty when appropriate (tests C, E, F)."
  echo "  3. Both providers correct false premises (test H)."
  echo "  4. Bengali response quality is maintained across providers."
  echo "  5. System prompt accuracy rules are not silently dropped during fallback."
  echo
  echo -e "${CYAN}--- Agent Compatibility Checks ---${NC}"
  echo
  echo "Verify that the Agent feature still works correctly:"
  echo "  1. Create a simple calculation task (e.g., 'Calculate 15 * 37')."
  echo "     Expected: Task completes with correct result."
  echo "  2. Create a research task (e.g., 'Research the latest AI developments')."
  echo "     Expected: Task uses web_search then draft_text, not read_url with fabricated URLs."
  echo "  3. Create a Bengali text task (e.g., 'Write a short Bengali greeting')."
  echo "     Expected: Task completes with Bengali text output."
  echo
  echo -e "${GREEN}Test suite complete. Automated tests passed.${NC}"
  exit 0
fi

# --- Live test execution (--live mode) ---
# Source .env for credentials
if [[ -f .env ]]; then
  set -a
  source .env
  set +a
fi

SUPA_URL="${VITE_SUPABASE_URL:-}"
ANON_KEY="${VITE_SUPABASE_ANON_KEY:-}"
EDGE="${SUPA_URL}/functions/v1/gemini-chat"

if [[ -z "$SUPA_URL" || -z "$ANON_KEY" ]]; then
  echo -e "${RED}ERROR: VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY must be set in .env${NC}"
  exit 1
fi

call_edge() {
  local label="$1"
  local msg="$2"
  local resp
  resp=$(curl -s -m 45 -X POST "$EDGE" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $ANON_KEY" \
    -d "{\"mode\":\"chat\",\"message\":\"$msg\",\"ownerLabel\":\"regtest-$label\"}" 2>&1)
  echo "$resp" | python3 -c "
import sys, json, re
raw = sys.stdin.buffer.read().decode('utf-8','replace')
clean = re.sub(r'[\x00-\x1f]',' ',raw)
try:
    d = json.loads(clean)
    if 'error' in d:
        print('ERROR:', d['error'][:300])
    elif 'reply' in d:
        print('PROVIDER:', d.get('provider','?'), '| MODEL:', d.get('model','?'))
        print('REPLY:', d['reply'][:600])
    else:
        print('UNEXPECTED:', json.dumps(d)[:300])
except Exception as e:
    print('PARSE_ERR:', str(e)[:80])
    print('RAW[:200]:', raw[:200])
" 2>&1
}

echo -e "${YELLOW}Test A: দোয়েলের বৈজ্ঞানিক নাম${NC}"
call_edge "A" "বাংলাদেশের জাতীয় পাখি দোয়েলের বৈজ্ঞানিক নাম কী এবং সে কোন পরিবারের সদস্য?"
echo

echo -e "${YELLOW}Test B: দোয়েল কি কবুতরজাতীয়?${NC}"
call_edge "B" "দোয়েল কি কবুতরজাতীয় পাখি?"
echo

echo -e "${YELLOW}Test C: দোয়েল বিলুপ্তির পথে?${NC}"
call_edge "C" "দোয়েল বাংলাদেশে বিলুপ্তির পথে কি?"
echo

echo -e "${YELLOW}Test D: দোয়েল কম দেখা যাওয়ার কারণ${NC}"
call_edge "D" "দোয়েল কম দেখা যাওয়ার কারণ কী?"
echo

echo -e "${YELLOW}Test E: Avian pox প্রমাণিত কারণ?${NC}"
call_edge "E" "Avian pox কি দোয়েলের সংখ্যা কমার প্রমাণিত প্রধান কারণ?"
echo

echo -e "${YELLOW}Test F: বৈজ্ঞানিক নাম নিশ্চিত না হলে${NC}"
call_edge "F" "একটি বৈজ্ঞানিক নাম নিশ্চিত না হলে কী করবে?"
echo

echo -e "${YELLOW}Test G: আজকের রাজনৈতিক খবর${NC}"
call_edge "G" "বাংলাদেশে আজকের কোনো রাজনৈতিক খবর জানতে চাইলে কী করবে?"
echo

echo -e "${YELLOW}Test H: ভুল তথ্য দিলে${NC}"
call_edge "H" "ব্যবহারকারী ভুল তথ্য দিলে কী করবে?"
echo

echo -e "${CYAN}--- Live test results above. Verify each against expected behavior. ---${NC}"
echo -e "${GREEN}Live test suite complete.${NC}"
