# E2E Prompting Test — Bedrock Provider

Manual end-to-end tests that exercise the full Sentinel pipeline with a real Bedrock LLM (Haiku).
These tests verify frustration detection, draft creation, LLM summarization, active recall, experience evolution, and session-end capture.

**Provider**: AWS Bedrock (`us.anthropic.claude-haiku-4-5-20251001-v1:0`)
**Threshold**: 0.85

---

## Prerequisites

```bash
# Sentinel must be enabled with Bedrock provider
npx ts-node src/cli.ts status
# Expected: Status: enabled, Debug: on
```

---

## Test 1: Draft Confirm — LLM Summarization

**Goal**: Verify that `review confirm` runs LLM summarization on raw transcript and extracts structured fields.

### Steps

```bash
# 1. Send frustrated prompt
echo '{"prompt":"Why does this keep failing? I have tried everything and the CSS grid layout still breaks on Safari. This is the third time today.","session_id":"test-session-001"}' \
  | npx ts-node src/cli.ts --hook user-prompt-submit

# 2. Send resolution prompt (same session)
echo '{"prompt":"OK I finally fixed the Safari CSS grid issue. The problem was that Safari needs explicit grid-template-rows when using auto-fill. Adding minmax(0, 1fr) to the row template fixed it.","session_id":"test-session-001"}' \
  | npx ts-node src/cli.ts --hook user-prompt-submit

# 3. Send stop hook with transcript
cat > /tmp/sentinel-e2e-transcript.jsonl << 'EOF'
{"type":"human","message":{"role":"user","content":"Why does this keep failing? I have tried everything and the CSS grid layout still breaks on Safari. This is the third time today."}}
{"type":"assistant","message":{"role":"assistant","content":"Let me investigate the Safari CSS grid issue. Safari has known compatibility issues with certain CSS Grid features."}}
{"type":"tool_use","name":"Bash","input":{"command":"echo 'checking grid layout'"},"output":"checking grid layout"}
{"type":"assistant","message":{"role":"assistant","content":"I found the issue. Safari requires explicit grid-template-rows when using auto-fill with repeat(). The fix is to add minmax(0, 1fr) to the row template."}}
{"type":"human","message":{"role":"user","content":"OK I finally fixed the Safari CSS grid issue. The problem was that Safari needs explicit grid-template-rows when using auto-fill. Adding minmax(0, 1fr) to the row template fixed it."}}
{"type":"assistant","message":{"role":"assistant","content":"That's correct. Safari's CSS Grid implementation differs from Chrome/Firefox in how it handles implicit row sizing with auto-fill."}}
EOF

echo '{"session_id":"test-session-001","transcript_path":"/tmp/sentinel-e2e-transcript.jsonl"}' \
  | npx ts-node src/cli.ts --hook stop

# 4. Confirm the draft
npx ts-node src/cli.ts review confirm --recent

# 5. Inspect the result
npx ts-node src/cli.ts detail <id>
```

### Expected

- Debug log shows `frustrated(>=0.85)` then `resolution(>=0.85)`
- `review list` shows a pending draft with `(raw transcript saved ...)`
- After confirm: experience has structured fields extracted by LLM:
  - `Issue`: mentions Safari CSS Grid
  - `Failed Approaches`: populated (not empty)
  - `Successful Approach`: mentions minmax(0, 1fr)
  - `Lessons`: multiple actionable lessons

### Actual Result (2026-02-24)

```
Issue: Recurring Safari CSS Grid layout breakage due to browser-specific grid-template-rows handling

Failed Approaches:
  - Assumed CSS Grid auto-fill would work consistently across browsers without explicit row sizing
  - Likely tried multiple grid configurations without understanding Safari's requirement for explicit minmax() constraints

Successful Approach:
  Added explicit grid-template-rows with minmax(0, 1fr) to the repeat() function.

Lessons: (4 items — cross-browser testing, minmax pattern, documentation)
```

**PASS**

---

## Test 2: Active Recall

**Goal**: Verify that a similar frustration triggers recall of the experience stored in Test 1.

### Steps

```bash
# Send a similar frustration (different session)
echo '{"prompt":"WHY does Safari keep breaking my CSS grid?? This is the EXACT same issue I had before - grid items overlapping because of auto-fill. I am so frustrated, I have wasted hours on this AGAIN.","session_id":"test-session-002"}' \
  | npx ts-node src/cli.ts --hook user-prompt-submit
```

### Expected

- Output is a JSON object with `systemMessage` containing:
  - Sentinel banner with confidence percentage
  - Matched issue description
  - Failed approaches from stored experience
  - Lessons learned
  - Actionable suggestion (arrow `->`)

### Actual Result (2026-02-24)

```json
{
  "systemMessage": "... Sentinel (confidence: 95%) ... Issue: Recurring Safari CSS Grid layout breakage ... Lesson: When CSS Grid layouts break in Safari specifically, immediately check if you're relying on implicit row sizing ... -> Immediately apply the proven solution: Add explicit grid-template-rows with minmax(0, 1fr) ..."
}
```

**PASS** — 95% confidence match, actionable advice included.

---

## Test 3: Experience Evolution

**Goal**: Verify that a draft with `matchedExperienceId` evolves the existing experience instead of creating a new one.

### Steps

```bash
# 1. Send frustrated prompt (triggers recall from Test 2's experience)
# (already done in Test 2 — reuse session or create new one)

# 2. Send resolution with IMPROVED solution (same session)
echo '{"prompt":"Found an even better fix - instead of minmax(0, 1fr), using @supports with a Safari-specific fallback and the -webkit-grid prefix gives much more robust cross-browser support. Also discovered that the gap property behaves differently in Safari too.","session_id":"test-session-002"}' \
  | npx ts-node src/cli.ts --hook user-prompt-submit

# 3. Send stop hook with evolution transcript
cat > /tmp/sentinel-e2e-evolution.jsonl << 'EOF'
{"type":"human","message":{"role":"user","content":"WHY does Safari keep breaking my CSS grid?? This is the EXACT same issue I had before - grid items overlapping because of auto-fill. I am so frustrated, I have wasted hours on this AGAIN."}}
{"type":"assistant","message":{"role":"assistant","content":"I can see this is a recurring Safari CSS Grid issue. Let me look into a more robust solution than just adding minmax()."}}
{"type":"tool_use","name":"Bash","input":{"command":"echo 'testing @supports query'"},"output":"testing @supports query"}
{"type":"assistant","message":{"role":"assistant","content":"I found that using @supports with a Safari-specific fallback provides much better cross-browser compatibility. The -webkit-grid prefix and explicit gap handling also help."}}
{"type":"human","message":{"role":"user","content":"Found an even better fix - instead of minmax(0, 1fr), using @supports with a Safari-specific fallback and the -webkit-grid prefix gives much more robust cross-browser support. Also discovered that the gap property behaves differently in Safari too."}}
{"type":"assistant","message":{"role":"assistant","content":"Excellent finding. Using @supports for feature detection is indeed more robust."}}
EOF

echo '{"session_id":"test-session-002","transcript_path":"/tmp/sentinel-e2e-evolution.jsonl"}' \
  | npx ts-node src/cli.ts --hook stop

# 4. Verify evolution candidate
npx ts-node src/cli.ts review list
# Expected: "(evolution candidate)" tag

# 5. Confirm evolution
npx ts-node src/cli.ts review confirm --recent

# 6. Inspect evolved experience
npx ts-node src/cli.ts detail <id>
npx ts-node src/cli.ts history <id>
```

### Expected

- `review list` shows `(evolution candidate)` tag
- Confirm output: `evolved experience "<id>" to v2`
- Evolved experience shows:
  - `Revision: 2`
  - Old `successfulApproach` (minmax) demoted to `failedApproaches`
  - New `successfulApproach` mentions @supports feature detection
  - `Lessons` merged (old + new)
- `history` shows v1 snapshot preserved

### Actual Result (2026-02-24)

```
Draft "..." evolved experience "..." to v2.

Revision: 2
Failed Approaches: (4 items — includes demoted "minmax(0, 1fr) alone was partial")
Successful Approach: Used @supports feature detection with -webkit-appearance to target Safari specifically...
Lessons: (8 items — merged from v1 + v2)

History:
  v1 — original state preserved with 2 failed approaches, minmax solution, 4 lessons
```

**PASS** — Old solution demoted, new solution promoted, lessons merged, history preserved.

---

## Test 4: SessionEnd Hook (No Resolution/Abandonment)

**Goal**: Verify that when a session ends mid-debugging (no explicit resolution or abandonment), the SessionEnd hook still captures the frustrated experience.

### Steps

```bash
# 1. Send frustrated prompt (new session)
echo '{"prompt":"This Docker build keeps failing with COPY --from=builder error. I have rebuilt the base image twice and it still does not work. The multi-stage build is completely broken.","session_id":"test-session-end-001"}' \
  | npx ts-node src/cli.ts --hook user-prompt-submit

# 2. Create transcript (assistant debugs but session ends without user declaring success/failure)
cat > /tmp/sentinel-e2e-session-end.jsonl << 'EOF'
{"type":"human","message":{"role":"user","content":"This Docker build keeps failing with COPY --from=builder error. I have rebuilt the base image twice and it still does not work. The multi-stage build is completely broken."}}
{"type":"assistant","message":{"role":"assistant","content":"Let me look at your Dockerfile. The COPY --from=builder error usually means the builder stage name doesn't match or the build context is wrong."}}
{"type":"tool_use","name":"Read","input":{"file_path":"Dockerfile"},"output":"FROM node:20 AS builder\nWORKDIR /app\nCOPY package*.json ./\nRUN npm ci\nCOPY . .\nRUN npm run build\n\nFROM node:20-slim\nWORKDIR /app\nCOPY --from=builder /app/dist ./dist\nCOPY --from=builder /app/node_modules ./node_modules"}
{"type":"assistant","message":{"role":"assistant","content":"I see the issue - let me check if the build output is actually going to /app/dist."}}
{"type":"tool_use","name":"Bash","input":{"command":"docker build --target builder -t test-builder ."},"output":"Step 5/6 : RUN npm run build\n> tsc --outDir build\nerror TS6059: File '/app/src/index.ts' is not under 'rootDir'"}
{"type":"assistant","message":{"role":"assistant","content":"Found it - the TypeScript compiler outputs to /app/build not /app/dist. The Dockerfile COPY --from=builder references /app/dist but the actual output goes to /app/build. You need to either change the tsconfig outDir to 'dist' or update the COPY path in the Dockerfile."}}
EOF

# 3. Send session-end hook (NOT stop hook -- simulating session close without resolution)
echo '{"session_id":"test-session-end-001","transcript_path":"/tmp/sentinel-e2e-session-end.jsonl"}' \
  | npx ts-node src/cli.ts --hook session-end

# 4. Check draft was created
npx ts-node src/cli.ts review list

# 5. Confirm and inspect
npx ts-node src/cli.ts review confirm --recent
npx ts-node src/cli.ts detail <id>
```

### Expected

- session-end hook produces **no stdout** (silent)
- Debug log shows: `frustrated turn found, intent: ...`
- Draft created with frustration signature from the intent
- After confirm: LLM summarization extracts structured fields from the debugging transcript

### Actual Result (2026-02-24)

```
Debug log: [stop] frustrated turn found, intent: COPY --from=builder multi-stage build failure
           [stop] storeCandidate: ab2f1ccd-... (raw transcript, 4 msgs)

Issue: Docker multi-stage build COPY --from fails due to output directory path mismatch

Failed Approaches:
  - Rebuilt the base image twice (wrong assumption about root cause)
  - Didn't verify where build artifacts were actually written

Successful Approach:
  Ran builder stage in isolation with `docker build --target builder` to reveal path mismatch.

Lessons: (4 items — target isolation, path cross-referencing, artifact verification)
```

**PASS** — Draft captured via session-end without resolution, intent extracted, LLM summarization works.

---

## Summary

| # | Scenario | Pipeline Path | Result |
|---|----------|---------------|--------|
| 1 | Draft Confirm (LLM summarization) | UPS(frustrated) -> UPS(resolution) -> Stop -> review confirm | **PASS** |
| 2 | Active Recall | UPS(frustrated) -> searchMemory -> systemMessage | **PASS** |
| 3 | Experience Evolution | UPS(frustrated+recall) -> UPS(resolution) -> Stop -> review confirm(evolve) | **PASS** |
| 4 | SessionEnd (no resolution) | UPS(frustrated) -> SessionEnd -> review confirm | **PASS** |
