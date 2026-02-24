# V2 E2E Test: Experience Evolution

## Test Date
2026-02-24

## Environment
- LLM Provider: AWS Bedrock
- Completion Model: `us.anthropic.claude-haiku-4-5-20251001-v1:0`
- Embedding Model: `amazon.titan-embed-text-v2:0`
- DB: Real `~/.sentinel/sentinel.db`

## Scenario: Jest Mock Problem (re-encounter + evolution)

### Pre-existing Experience (v1)
- **ID**: `b3660ea5-b03d-4674-8605-39e2cdac3bb6`
- **Signature**: Jest mocks persisting across tests due to missing cleanup in afterEach hook
- **Solution (v1)**: `jest.restoreAllMocks()` in afterEach hook
- **Revision**: 1

### Pipeline Steps

#### Step 1: Frustrated Prompt (user-prompt-submit hook)

```json
{
  "prompt": "아 또 Jest mock이 리셋이 안 돼서 다른 테스트에 영향을 주고 있어. jest.clearAllMocks()를 beforeEach에 넣었는데도 이전 테스트의 mock이 계속 남아있어. 이거 몇 번째 같은 문제인지 모르겠다.",
  "session_id": "e2e-test-session-001"
}
```

**Result**:
- Analysis: `frustrated(0.92)`, threshold=0.85 -> triggered
- Active Recall: matched experience with 95% confidence
- Flag: `status=frustrated`, `matched_experience_id=b3660ea5-...`
- Output: systemMessage with warning box (past experience advice)

#### Step 2: Resolution Prompt (user-prompt-submit hook)

```json
{
  "prompt": "해결했다. jest.restoreAllMocks 대신 jest.config.ts에 restoreMocks: true 옵션을 설정하니까 자동으로 처리된다. 이게 훨씬 깔끔한 방법이야.",
  "session_id": "e2e-test-session-001"
}
```

**Result**:
- Analysis: `resolution(0.95)`
- Flag upgraded: `frustrated` -> `capture`
- `matched_experience_id` preserved through upgrade

#### Step 3: Stop Hook (transcript capture)

```json
{
  "session_id": "e2e-test-session-001",
  "transcript_path": "/tmp/e2e-test-transcript.jsonl"
}
```

**Result**:
- Draft stored with `matchedExperienceId=b3660ea5-...`
- Flag cleared
- Signature extracted: "Jest mock state leaking between tests despite clearAllMocks"

#### Step 4: Review Confirm (evolution)

```bash
sentinel review confirm 43cacaf9-e205-45fd-b775-46a029da694c
```

**Result**:
- LLM summarization (1st call): extracted new approach from transcript
- Evolution judge (2nd call): `isBetter=true`
- Experience evolved to **v2**:
  - Old `successfulApproach` demoted to `failedApproaches`
  - New `successfulApproach`: `restoreMocks: true` in jest.config.ts
  - Lessons merged: 3 -> 6
  - Revision history stored (v1 snapshot preserved)

### Evolution Diff

| Field | v1 | v2 |
|-------|----|----|
| successfulApproach | `jest.restoreAllMocks()` in afterEach | `restoreMocks: true` in jest.config.ts |
| failedApproaches | 2 items | 4 items (old success demoted + note added) |
| lessons | 3 | 6 |
| revision | 1 | 2 |

### CLI Commands Verified

```bash
sentinel list          # Shows (v2) tag for evolved experience
sentinel detail <id>   # Shows Revision: 2
sentinel history <id>  # Shows v1 snapshot with original state
sentinel review list   # Shows (evolution candidate) for tagged drafts
```

## Known Issues

### Critical: Resolution Detection is Unrealistic

The current capture pipeline requires the user to explicitly say something like "I solved it" for the LLM to classify it as `resolution`. In real Claude Code usage, **this almost never happens**.

When a developer solves a problem:
- They just move on to the next task silently
- They might say "ok next, let's work on feature X" (classified as `normal`, not `resolution`)
- They don't announce "I have solved the problem" to their AI assistant

This means the `frustrated -> resolution -> capture` path rarely triggers in production. The pipeline needs a fundamentally different approach to detect resolution.

**Possible directions** (not yet designed):
- Detect resolution by _absence_ of frustration: if a frustrated session continues without further frustration for N turns, infer resolution
- Use the stop hook more aggressively: if a session had a `frustrated` flag and ends normally, treat it as implicit resolution
- Time-based: if `frustrated` flag exists and session is idle for X minutes, auto-upgrade to `capture`
- Analyze the _assistant's_ response: if Claude says "that fixed it" or shows successful output, detect resolution from the assistant side

This is a fundamental design question for v2.1.

## Shell Testing Note

`!` (exclamation mark) must NEVER be used in Bash test commands. Bash interprets it as history expansion, causing silent failures. All test prompts were rewritten without `!`.
