# Dev Sentinel — Architecture

> Version: 1.0

---

## Core Concept

```
prompt
└─ LLM analysis → type?
   ├─ normal         → silent pass-through
   ├─ frustrated     → flag session ("frustrated")
   │                    └─ DB match? → advice (Active Recall)
   ├─ resolution     → upgrade flag → "capture"
   └─ abandonment    → upgrade flag → "capture"

Stop hook (fires after every Claude response)
└─ flag status?
   ├─ "capture"  → parse transcript → generate draft
   └─ otherwise  → skip (approve)
```

Two hooks, one shared decision: "Is the developer frustrated, and have we seen this before?"

### Why 2-Stage Flags?

Stop hook fires after **every Claude response**, not just at session end. If we generated a draft on the first frustration signal, we'd capture incomplete sessions (developer hasn't resolved yet). The 2-stage flag (`"frustrated"` → `"capture"`) ensures we only generate drafts after the outcome is known (resolution or abandonment).

---

## Hook 1: UserPromptSubmit (Active Recall + Frustration Detection)

### Input/Output

- **stdin**: `{ session_id, prompt, transcript_path, ... }`
- **stdout**: `{}` or `{"systemMessage": "..."}`

### Pipeline

```
prompt (stdin)
  │
  ├─ Step 1: LLM Analysis
  │   └─ generateCompletion(PROMPTS.frustrationAnalysis, prompt)
  │      → { type, confidence, intent, context, reasoning }
  │        type: 'normal' | 'frustrated' | 'resolution' | 'abandonment'
  │
  ├─ Step 2: Branch on type
  │   │
  │   ├─ type = 'frustrated':
  │   │   └─ setFlag(session_id, 'frustrated')
  │   │   └─ searchMemory(prompt) → match found?
  │   │       ├─ yes → systemMessage with advice (Active Recall)
  │   │       └─ no  → (flag already set, wait for outcome)
  │   │
  │   ├─ type = 'resolution' or 'abandonment':
  │   │   └─ existing flag = 'frustrated'?
  │   │       └─ yes → upgradeFlag(session_id, 'capture')
  │   │         (next Stop hook will generate draft)
  │   │
  │   └─ type = 'normal':
  │       └─ pass through
  │
  ├─ Step 3: Persist turn
  │   └─ sqliteStore.storeTurn({ session_id, prompt, analysis })
  │
  └─ Step 4: Check pending drafts (from previous sessions)
      └─ drafts exist? → append notification to systemMessage

stdout: '{}' or '{"systemMessage": "..."}'
```

### Frustration Detection (LLM-based)

The LLM receives the raw prompt and returns a structured analysis.
Key signals to detect:
- **frustrated**: Explicit frustration ("not working again", "why is this happening"), escalating desperation ("다른 방법 없어?")
- **resolution**: Success indicators ("got it!", "solved!", "It works!", "thanks")
- **abandonment**: Giving up ("giving up", "let's do it later", "let's skip for now", "skip this")
- **normal**: Everything else — questions, instructions, neutral prompts

Output:
- `type: 'normal' | 'frustrated' | 'resolution' | 'abandonment'`
- `confidence: number` (0-1)
- `intent: string` (what the user wants to achieve)
- `context: string` (error/technology/approach summary)
- `reasoning: string` (why this classification was made)

### Memory Search (RAG)

When frustrated, search for similar past experiences:

```
1. Embed prompt → vector
2. Vector search: cosine similarity against experiences
3. Top-K candidates → LLM judge: "Is this actually relevant?"
4. Relevant match → format advice from experience data
```

Simple RAG — no multi-step search, no cross-referencing, no caching wrappers.

---

## Hook 2: Stop (Experience Capture)

### Input/Output

- **stdin**: `{ session_id, transcript_path, ... }`
- **stdout**: `{ "decision": "approve" }` (always)

### Pipeline

```
Stop hook (stdin) — fires after EVERY Claude response
  │
  ├─ Step 1: Check flag status
  │   └─ sqliteStore.getFlag(session_id)
  │   └─ status !== 'capture'? → return approve (STOP)
  │       (includes: no flag, status = 'frustrated')
  │
  ├─ Step 2: Parse transcript
  │   └─ parseTranscriptFile(transcript_path)
  │   └─ Extract: user messages, assistant messages, tool calls, errors
  │
  ├─ Step 3: Frustration context lookup (no slicing)
  │   └─ findFirstFrustratedTurn(session_id)
  │       → Look up session_turns for first turn with type='frustrated'
  │       → Extract { prompt, intent } from that turn
  │   └─ Use frustrated turn's intent as frustrationSignature (no LLM)
  │   └─ Full transcript is stored as-is (no slicing)
  │
  ├─ Step 4: Save draft + clear flag
  │   └─ Dedup: skip if draft already exists for this session
  │   └─ sqliteStore.storeCandidate(draft) — raw full transcript
  │   └─ sqliteStore.clearFlag(session_id)
  │
  └─ LLM summarization deferred to `sentinel review confirm`

stdout: '{"decision": "approve"}'
```

### Full Transcript Storage

The Stop hook stores the **complete session transcript** without slicing.
Context extraction is deferred to `sentinel review confirm`, where the LLM
receives the full transcript along with frustration metadata to identify the
relevant portion.

```
session_turns (from UserPromptSubmit hook):
  Turn 1: "Fix the login bug"           → normal
  Turn 2: "Still not working!"          → frustrated  ← anchor point
  Turn 3: "I figured it out"            → resolution
  Turn 4: "Now the API is broken"       → normal
  Turn 5: "Why does this keep failing"  → frustrated
  Turn 6: "Forget it, skip this"        → abandonment → flag='capture'

Stop hook fires:
  1. findFirstFrustratedTurn → Turn 5's prompt + intent (for frustrationSignature)
  2. Store full transcript (all Turns 1-6)
  3. On `review confirm`: LLM receives full transcript + "── Frustration Context ──"
     section with the frustrated turn's prompt and intent, focusing analysis
     on the relevant portion
```

This approach preserves the full context (earlier conversation may contain
relevant setup information) while letting the LLM intelligently focus on
the frustration-related portion during summarization.

### Note Generation (Lazy — on `review confirm`)

The Stop hook stores raw transcript data without LLM calls. LLM
summarization runs when the user confirms the draft:

```
sentinel review confirm <id>
  → parse stored transcriptData
  → LLM generateCompletion(lessonSummarization, context, { think: true })
  → extract: frustrationSignature, failedApproaches, successfulApproach, lessons
  → generate embedding → store experience + vector
```

This "lazy LLM" approach keeps the Stop hook fast (no LLM latency) and
lets the user review raw data before committing LLM credits.

---

## Hook 3: User (Async — CLI)

```bash
sentinel review list              # Show pending drafts
sentinel review confirm <id>      # Draft → experience + vector store
sentinel review reject <id>       # Delete draft
```

Confirm writes to BOTH:
- SQLite `experiences` table (metadata)
- Vector store (embedding for future search)

### Embedding Text for Vector Store

On `review confirm`, the experience is converted to a natural text for embedding:

```
{frustrationSignature}. Failed: {failedApproaches.join(', ')}. Fixed: {successfulApproach}. Lessons: {lessons.join('. ')}
```

Example:
```
DynamoDB timeout on PutItem. Failed: retry with exponential backoff, increase timeout. Fixed: partition key rebalancing. Lessons: DynamoDB timeout is often caused by hot partitions. Check key distribution before adding retry logic.
```

No LLM call needed — template-based concatenation. This natural text produces better embeddings than raw JSON.

---

## Data Model

### SQLite Tables

```sql
-- Prompt analysis per turn
CREATE TABLE session_turns (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  turn_number INTEGER NOT NULL,
  prompt TEXT NOT NULL,
  analysis_json TEXT NOT NULL,    -- LLM analysis result
  timestamp TEXT NOT NULL
);

-- 2-stage capture flags for sessions
CREATE TABLE session_flags (
  session_id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'frustrated',  -- 'frustrated' | 'capture'
  flagged_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Draft failure notes (pending review)
CREATE TABLE auto_memory_candidates (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',  -- draft | confirmed | rejected
  candidate_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  confirmed_experience_id TEXT
);

-- Confirmed failure experiences
CREATE TABLE experiences (
  id TEXT PRIMARY KEY,
  frustration_signature TEXT NOT NULL,
  failed_approaches TEXT NOT NULL,  -- JSON array
  successful_approach TEXT,          -- nullable
  lessons TEXT NOT NULL,             -- JSON array
  source TEXT NOT NULL,              -- 'auto_detected'
  created_at TEXT NOT NULL
);
```

### Vector Store

```sql
-- Embeddings for semantic search
CREATE TABLE vectors (
  id TEXT PRIMARY KEY,              -- matches experiences.id
  embedding TEXT NOT NULL,            -- JSON array of numbers
  metadata TEXT,                    -- JSON: { model, dimensions }
  created_at TEXT NOT NULL
);
```

---

## Component Interaction

```
┌─ UserPromptSubmit ────────────────────────────────────┐
│                                                        │
│  LLM Provider ──► Frustration Analysis                 │
│       │           → type: normal|frustrated|           │
│       │                   resolution|abandonment       │
│       │                 │                              │
│       │     ┌───────────┼───────────┐                  │
│       │  frustrated  resolution/  normal               │
│       │     │        abandonment    └── stdout: {}     │
│       │     │           │                              │
│       │     │     upgrade flag                         │
│       │     │     → 'capture'                          │
│       │     │                                          │
│       │  setFlag('frustrated')                         │
│       │     │                                          │
│       │  searchMemory(prompt)                          │
│       │     ├─ match → systemMessage (Active Recall)   │
│       ▼     └─ no match → wait for outcome             │
│  Vector Store ──► RAG search                           │
│                                                        │
│  SQLite Store ──► storeTurn() + checkDrafts()          │
└────────────────────────────────────────────────────────┘
         │                              │
    experiences                   session_flags (status)
    vectors                       session_turns
         │                              │
         ▼                              ▼
┌─ Stop (fires after every Claude response) ────────────┐
│                                                        │
│  SQLite Store ──► getFlag(session_id)                  │
│       │           status = 'capture'? ──► proceed      │
│       │           otherwise? ──► skip (approve)        │
│       │                                                │
│  Transcript Parser ──► parse JSONL                     │
│       │                                                │
│  Note Generator ──► LLM summarize ──► storeCandidate() │
│       │                                                │
│  SQLite Store ──► clearFlag(session_id)                │
│                                                        │
│  stdout: {"decision": "approve"}                       │
└────────────────────────────────────────────────────────┘
         │
    auto_memory_candidates (drafts)
         │
         ▼
┌─ CLI: sentinel review ────────────────────────────────┐
│                                                        │
│  list    → show drafts                                 │
│  confirm → experiences + vector store (both!)          │
│  reject  → delete draft                                │
└────────────────────────────────────────────────────────┘
```

---

## Flag Lifecycle

```
Session start: no flag
       │
Turn N: "Why isn't this error getting fixed" (frustrated)
       │
       ▼
  setFlag(session_id, 'frustrated')      ← Stop hook: skip
       │
Turn N+1: Claude responds → Stop fires → flag = 'frustrated' → skip
       │
Turn N+2: "Got it!" (resolution)
       │
       ▼
  upgradeFlag(session_id, 'capture')     ← Stop hook: generate draft
       │
Turn N+2: Claude responds → Stop fires → flag = 'capture'
       │
       ▼
  parse transcript → generate note → storeCandidate()
  clearFlag(session_id)                  ← Done
```

### State Transitions

| Current State | LLM Type | Action |
|--------------|----------|--------|
| (no flag) | `frustrated` | `setFlag('frustrated')` |
| (no flag) | `normal/resolution/abandonment` | no-op |
| `frustrated` | `frustrated` | no-op (already flagged) |
| `frustrated` | `resolution` | `upgradeFlag('capture')` |
| `frustrated` | `abandonment` | `upgradeFlag('capture')` |
| `frustrated` | `normal` | no-op (stay frustrated) |
| `capture` | any | no-op (Stop hook will handle) |

---

## Performance Budget

| Operation | Frequency | Target | Strategy |
|-----------|-----------|--------|----------|
| Frustration analysis | Every prompt | < 3s | Single LLM call |
| RAG search (when frustrated) | ~10% of prompts | < 2s | Embed + vector search + LLM judge |
| Turn persistence | Every prompt | < 10ms | Single SQLite INSERT |
| Flag check (Stop) | Every Stop | < 5ms | Single SQLite SELECT |
| Transcript parse + store | Rare (~1/session) | < 100ms | File read + SQLite INSERT |
| LLM summarization (confirm) | Manual trigger | < 15s | `/api/generate` with think mode |

---

## Constraints

1. **No prompt modification**: stdout is `{}` or `{"systemMessage": "..."}`. Claude never sees Sentinel.
2. **Stateless per invocation**: Each hook call is a fresh process. All state via SQLite.
3. **Stop hook cannot send systemMessage**: Only `{"decision": "approve"}`. Use next UserPromptSubmit for notifications.
4. **Graceful degradation**: Any failure → silent pass-through. Sentinel never blocks Claude.

---

## LLM Provider: Ollama qwen3 Thinking Mode

### The Problem

qwen3 supports a "thinking" mode where the model reasons internally before
producing output. However, the Ollama `/api/chat` endpoint with `think: true`
and `format: "json"` returns an **empty** `message.content` — the model puts
all output into the `message.thinking` field instead.

### Dual-Path Solution

The `LocalLLMProvider` uses two different Ollama API endpoints depending on
whether thinking is requested:

```
CompletionOptions { think?: boolean }

think: false (default)
  └─ POST /api/chat
     ├─ think: false        ← explicitly disable thinking
     ├─ format: "json"      ← constrain output to JSON
     └─ timeout: 30s
     → response: message.content (ChatResponseSchema)

think: true
  └─ POST /api/generate
     ├─ format: "json"      ← constrains FINAL output to JSON
     └─ timeout: 120s       ← thinking takes longer
     → response: response (GenerateResponseSchema)
```

### Why `/api/generate` for Thinking?

With `/api/generate`, qwen3 thinks automatically (no explicit `think` flag
needed). The `format: "json"` parameter constrains only the **final output**
after thinking, not the thinking process itself. This produces a non-empty
`response` field containing valid JSON.

### Where Each Path Is Used

| Call Site | think | API | Timeout | Reason |
|-----------|-------|-----|---------|--------|
| Frustration analysis | `false` | `/api/chat` | 30s | Speed: runs on every prompt |
| RAG relevance judge | `false` | `/api/chat` | 30s | Speed: runs on frustrated prompts |
| Lesson summarization | `true` | `/api/generate` | 120s | Quality: complex reasoning needed |

### Think Block Stripping

The `/api/generate` response may include `<think>...</think>` blocks in the
response text. The `stripThinkBlock()` utility removes these before JSON parsing:

```
Raw response: "<think>reasoning here...</think>{\"frustrationSignature\": \"...\"}"
After strip:  "{\"frustrationSignature\": \"...\"}"
```

### Provider Abstraction

The `CompletionOptions` interface is shared across all providers:
- `LocalLLMProvider` (Ollama): Uses dual-path as described above
- `BedrockLLMProvider` (AWS): Ignores `think` option (Bedrock handles reasoning internally)
- `MockLLMProvider` (tests): Ignores `think` option
